import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { tugFlickIllegalReason, tugSlide, tugSolve, tugViewString, type TugClamp, type TugDir, type TugMoveReport, type TugState } from "@openseas/engine";
import { sfx } from "../audio.js";
import { RADIUS } from "../look/tokens.js";
import { FONT, FONT_MONO, INK, drawDot, drawHairline } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";
import { TUG_BLOCK_COLOR, TUG_BLOCK_PAINT, tugClampPaint, tugPodColor, tugPodPaint } from "./pieces.js";

export interface TugCallbacks {
  /** The player flicked a pod a way the engine allows. */
  onFlick(pod: number, dir: TugDir): void;
  /** The player gave the lit clamp up. */
  onSkip(): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface TugLabels {
  /** The strip over the bay: the lit clamp's par and the flicks spent on it. */
  status(par: number, flicks: number): string;
  skip: string;
  /** A delivery at par, with the streak it reached. */
  clean(streak: number): string;
  full: string;
  slow: string;
  skipped: string;
  /** Under a delivery's points: the flicks it took against par. */
  tally(flicks: number, par: number): string;
  /** Over a clamp as it lights. */
  par(par: number): string;
}

export interface TugRendererOptions {
  /** Show the first flick of a par route after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: TugLabels;
}

/** A flick's step in columns and rows, by direction: up, right, down, left. */
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const DIRS: readonly TugDir[] = [0, 1, 2, 3];
const HINT_AFTER_MS = 7000;
/** A clean delivery at this par or above is the beat: the long route, read whole. */
const BEAT_PAR = 4;
/** The ring round the picked pod: 2 units wide, 2 units off the piece. */
const RING_R = 0.45;
const RING_W = 0.07;
/** A ghost's pod, where a flick would stop, and the wanted pod in the strip, as shares of a cell. */
const GHOST_SIZE = 0.42;
const WANTED_SIZE = 0.66;

/** Draws the cargo bay and turns a swipe into a flick. Scores nothing: every number it shows is the engine's. */
export class TugRenderer extends KitBoard<TugState> {
  protected override readonly drawn = true;
  private readonly grid = new Grid(7, 7);
  private readonly bg = new Graphics();
  private readonly blockLayer = new Container();
  private readonly clampSprite = new Sprite();
  private readonly ghostLayer = new Graphics();
  private readonly ghostPods = new Container();
  private readonly podLayer = new Container();
  private readonly hintLayer = new Graphics();
  private readonly strip = new Graphics();
  private readonly wanted = new Sprite();
  private label: Text | null = null;
  private skipText: Text | null = null;
  private skipBox = { x: 0, y: 0, w: 0, h: 0 };
  private sprites: Sprite[] = [];
  private blockSprites: Sprite[] = [];
  private ghostSprites: Sprite[] = [];
  /** What is drawn: the blocks, the lit clamp (null between a delivery and the next lighting) and the flicks shown. */
  private drawnBlocks: readonly number[] = [];
  private drawnClamp: TugClamp | null = null;
  private lastPar = 0;
  private shownFlicks = 0;
  /** The pod the keyboard flicks and the ghosts are drawn for; -1 for none. */
  private selected = -1;
  private ghosts: Array<{ dir: TugDir; to: number }> = [];
  private ghostsFor: TugState | null = null;
  private ghostsPod = -1;
  private drag: { x: number; y: number; pod: number; onPod: boolean; fired: boolean } | null = null;
  private idle = 0;
  private hint: { pod: number; dir: TugDir; to: number } | "skip" | null = null;
  private hintFor: TugState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: TugCallbacks,
    private readonly opts: TugRendererOptions,
  ) {
    super(host, "tug", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0, 0.5);
    this.skipText = new Text({ text: this.opts.labels.skip, style: { fontFamily: FONT, fontSize: 14, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.skipText.anchor.set(0.5);
    this.clampSprite.anchor.set(0.5);
    this.clampSprite.visible = false;
    this.wanted.anchor.set(0.5);
    this.wanted.visible = false;
    this.world.addChild(this.bg, this.blockLayer, this.clampSprite, this.ghostLayer, this.ghostPods, this.podLayer, this.hintLayer, this.strip, this.wanted, this.label, this.skipText);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    g.fit(width, height, { top: 1, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = g.cell;
    // Bare ground under the strip and the bay. The one hairline is the bay's walls, since a wall is
    // a stop like any other; a dot marks every cell, because where a slide ends is the whole game.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, false);
    drawHairline(this.bg, g.ox, g.oy, g.width, g.height);
    for (let i = 0; i < g.cols * g.rows; i++) drawDot(this.bg, g.x(i), g.y(i), g.cell);
    const bw = Math.max(56, g.cell * 1.5);
    const bh = strip * 0.6;
    this.skipBox = { x: g.ox + g.width - bw, y: g.oy - pad - strip * 0.5 - bh / 2, w: bw, h: bh };
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.32));
      this.label.position.set(g.ox + g.cell * 0.86, g.oy - pad - strip * 0.5);
    }
    if (this.skipText) {
      this.skipText.style.fontSize = Math.max(11, Math.round(g.cell * 0.3));
      this.skipText.position.set(this.skipBox.x + bw / 2, this.skipBox.y + bh / 2);
    }
    this.publishGeom(g.ox, g.oy, g.cell);
    this.drag = null;
    if (this.state) this.snap(this.state);
    else this.drawStrip();
  }

  /** A pod's picture: its outline says which. */
  private podTexture(pod: number, size = this.grid.cell): Texture {
    return this.piece(`pod:${pod}`, size, tugPodColor(pod), tugPodPaint(pod));
  }

  /** The blocks, each a girder stub on its cell. */
  private drawBlocks(): void {
    const g = this.grid;
    const cells = this.drawnBlocks;
    while (this.blockSprites.length > cells.length) this.blockSprites.pop()!.destroy();
    cells.forEach((cell, i) => {
      let s = this.blockSprites[i];
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        this.blockLayer.addChild(s);
        this.blockSprites[i] = s;
      }
      s.texture = this.piece("block", g.cell, TUG_BLOCK_COLOR, TUG_BLOCK_PAINT);
      s.position.set(g.x(cell), g.y(cell));
    });
  }

  /** The lit clamp on its cell, whole: the socket of the pod it wants. */
  private showClamp(clamp: TugClamp): void {
    const g = this.grid;
    const s = this.clampSprite;
    s.texture = this.piece(`clamp:${clamp.pod}`, g.cell, tugPodColor(clamp.pod), tugClampPaint(clamp.pod));
    s.position.set(g.x(clamp.cell), g.y(clamp.cell));
    s.scale.set(1);
    s.visible = true;
  }

  /** The clamp is done with, delivered or given up: it shrinks to nothing. */
  private dropClamp(): void {
    this.drawnClamp = null;
    this.drawStrip();
    this.tweens.remove(this.clampSprite, {
      done: () => {
        if (!this.drawnClamp) this.clampSprite.visible = false;
      },
    });
  }

  /** The strip over the bay: the pod the clamp wants, the par and the flicks, and the skip button. */
  private drawStrip(): void {
    const g = this.grid;
    const s = this.strip;
    s.clear();
    const box = this.skipBox;
    const r = Math.min(RADIUS, box.h / 2);
    s.roundRect(box.x, box.y, box.w, box.h, r).fill({ color: INK.raised });
    // The board's advice to give the clamp up is cream, like every hint.
    if (this.hint === "skip") s.roundRect(box.x, box.y, box.w, box.h, r).stroke({ width: 2, color: INK.cream, alpha: this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240) });
    const clamp = this.drawnClamp;
    this.wanted.visible = clamp !== null;
    if (clamp) {
      this.wanted.texture = this.podTexture(clamp.pod, Math.round(g.cell * WANTED_SIZE));
      this.wanted.position.set(g.ox + g.cell * 0.42, this.label?.y ?? g.oy - g.cell * 0.5);
    }
    if (this.label) this.label.text = clamp ? this.opts.labels.status(clamp.par, this.shownFlicks) : "";
  }

  /** Put the bay exactly as the engine holds it, with nothing in motion. */
  private snap(state: TugState): void {
    while (this.sprites.length > state.pods.length) this.sprites.pop()!.destroy();
    while (this.sprites.length < state.pods.length) {
      const s = new Sprite();
      s.anchor.set(0.5);
      this.podLayer.addChild(s);
      this.sprites.push(s);
    }
    state.pods.forEach((cell, pod) => {
      const s = this.sprites[pod]!;
      s.texture = this.podTexture(pod);
      s.position.set(this.grid.x(cell), this.grid.y(cell));
      s.scale.set(1);
      s.alpha = 1;
    });
    this.drawnBlocks = state.blocks;
    this.drawBlocks();
    this.drawnClamp = state.clamp;
    this.showClamp(state.clamp);
    this.lastPar = state.clamp.par;
    this.shownFlicks = state.flicks;
    if (this.selected >= state.pods.length) this.selected = -1;
    this.ghostsFor = null;
    this.drawStrip();
    this.publishSelected();
    this.touchView();
  }

  private matches(prev: TugState): boolean {
    const c = this.drawnClamp;
    if (!c || c.pod !== prev.clamp.pod || c.cell !== prev.clamp.cell) return false;
    if (this.sprites.length !== prev.pods.length || this.drawnBlocks.length !== prev.blocks.length) return false;
    return prev.pods.every((cell, pod) => this.grid.at(this.sprites[pod]!.x, this.sprites[pod]!.y)?.index === cell) && prev.blocks.every((b, i) => this.drawnBlocks[i] === b);
  }

  protected onState(state: TugState, prev: TugState | null): void {
    this.idle = 0;
    this.hint = null;
    this.hintLayer.clear();
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different bay (a lab config): lay it out afresh.
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const report = state.lastMove;
    if (!report || !prev || !this.matches(prev)) {
      this.snap(state);
      // A fresh bay: the pod the clamp wants is the one to look at.
      if (!report) this.select(state.clamp.pod);
      return;
    }
    this.play(state, report);
  }

  /** Play a move out: the slide and its stop, then a delivery or a skip, then the next clamp lighting. */
  private play(state: TugState, r: TugMoveReport): void {
    const g = this.grid;
    let t = 0;
    if (r.slide) {
      const { pod, from, to, stop } = r.slide;
      const sprite = this.sprites[pod]!;
      const x0 = g.x(from);
      const y0 = g.y(from);
      const x1 = g.x(to);
      const y1 = g.y(to);
      const cells = Math.round((Math.abs(x1 - x0) + Math.abs(y1 - y0)) / g.cell);
      // The slide's length is the rule, so it takes the time its length asks, eased and with no give at the stop.
      const ms = 90 + cells * 52;
      sfx.whoosh();
      this.tweens.to(sprite, { x: x1, y: y1 }, ms, {
        ease: ease.outQuad,
        done: () => {
          sfx.thud();
          this.shownFlicks = r.delivered ? r.delivered.flicks : state.flicks;
          this.drawStrip();
        },
      });
      t = ms + 40;
      const d = r.delivered;
      if (d) {
        // Good news is cream; a slow delivery is said quietly.
        const tone = d.grade === "slow" ? INK.dim : INK.cream;
        const top = d.grade === "clean" && d.streak === state.config.streakPercent.length && state.config.streakPercent.length > 1;
        const long = d.grade === "clean" && d.par >= BEAT_PAR;
        this.tweens.after(t, () => {
          this.dropClamp();
          this.fx.popup(x1, y1 - g.cell * 0.3, `+${d.points}`, tone, Math.max(16, g.cell * (d.grade === "clean" ? 0.56 : 0.44)));
          this.fx.popup(x1, y1 + g.cell * 0.82, this.opts.labels.tally(d.flicks, d.par), INK.dim, Math.max(12, g.cell * 0.28));
          this.fx.say(d.grade === "clean" ? this.opts.labels.clean(d.streak) : d.grade === "full" ? this.opts.labels.full : this.opts.labels.slow, tone);
          // The beat is for a clean delivery at the top par, and for a streak brought to its top.
          if (long || top) this.beat(long && top ? 1 : top ? 0.7 : 0.5);
          if (d.grade === "clean") {
            sfx.clear(Math.min(6, d.streak), d.par * 2);
            if (d.streak >= 3) sfx.streak(d.streak);
          } else if (d.grade === "full") sfx.good();
          else sfx.swapQuiet();
        });
        t += 340;
      }
    } else if (r.skipped) {
      const gone = r.skipped.clamp;
      sfx.bad();
      this.dropClamp();
      this.fx.say(this.opts.labels.skipped, INK.danger);
      if (r.skipped.penalty > 0) this.fx.popup(g.x(gone.cell), g.y(gone.cell) - g.cell * 0.2, `-${r.skipped.penalty}`, INK.danger, Math.max(16, g.cell * 0.46));
      t = 280;
    }
    if (r.clamp) {
      const next = r.clamp;
      this.tweens.after(t, () => this.light(next));
      t += 60;
    }
    // Whatever the tweens did, the bay ends as the engine holds it.
    this.tweens.after(t + 20, () => this.snap(state));
  }

  /** A clamp lights: it grows onto its cell, it is drawn from now on, and the pod it wants is picked. */
  private light(clamp: TugClamp): void {
    const g = this.grid;
    // The par is called out only when it is not the last clamp's: that is the news.
    const news = clamp.par !== this.lastPar;
    this.lastPar = clamp.par;
    this.drawnClamp = clamp;
    this.shownFlicks = 0;
    this.showClamp(clamp);
    this.clampSprite.scale.set(0);
    this.tweens.move(this.clampSprite, { scale: 1 });
    if (news) this.fx.popup(g.x(clamp.cell), g.y(clamp.cell) - g.cell * 0.55, this.opts.labels.par(clamp.par), INK.cream, Math.max(13, g.cell * 0.34));
    sfx.ping(5 - clamp.par);
    this.select(clamp.pod);
    this.drawStrip();
    this.touchView();
  }

  protected view(): string {
    const g = this.grid;
    const pods = this.sprites.map((s) => g.at(s.x, s.y)?.index ?? -1);
    return tugViewString(g.cols, g.rows, this.drawnBlocks, pods, this.drawnClamp?.cell ?? -1, this.drawnClamp?.pod ?? -1);
  }

  protected override update(dt: number): void {
    this.drawGhosts();
    if (this.hint === "skip") this.drawStrip();
    // The first flick of a par route shows after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.busy || this.drag) {
      this.idle = 0;
      if (this.hint) {
        this.hint = null;
        this.hintLayer.clear();
        this.drawStrip();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== this.state || !this.hint) {
      this.hintFor = this.state;
      const route = tugSolve(this.state);
      const first = route?.[0];
      this.hint = first ? { pod: first.pod, dir: first.dir, to: tugSlide(this.state, first.pod, first.dir).to } : "skip";
    }
    this.hintLayer.clear();
    if (this.hint === "skip") return;
    const g = this.grid;
    const h = this.hint;
    const from = this.state.pods[h.pod]!;
    // A hint is cream, never amber: it is the board's advice, not the player's own mark.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    arrow(this.hintLayer, g.x(from), g.y(from), g.x(h.to), g.y(h.to), g.cell, INK.cream, pulse);
  }

  // ---- the picked pod

  private publishSelected(): void {
    this.app.canvas.setAttribute("data-selected", String(this.selected));
  }

  private select(pod: number): void {
    if (this.selected === pod) return;
    this.selected = pod;
    this.ghostsFor = null;
    this.publishSelected();
  }

  /** Where each flick would carry the picked pod, drawn faint: the engine's answer, one step ahead and no more. */
  private drawGhosts(): void {
    const g = this.grid;
    const l = this.ghostLayer;
    const state = this.state;
    const show = state !== null && this.interactive && this.selected >= 0 && this.selected < state.pods.length && !this.busy && !state.finished;
    while (this.ghostSprites.length < DIRS.length) {
      const s = new Sprite();
      s.anchor.set(0.5);
      s.visible = false;
      this.ghostPods.addChild(s);
      this.ghostSprites.push(s);
    }
    if (!show) {
      if (this.ghostsFor !== null || this.ghostsPod !== -1) {
        l.clear();
        for (const s of this.ghostSprites) s.visible = false;
        this.ghostsFor = null;
        this.ghostsPod = -1;
      }
      return;
    }
    const pod = this.selected;
    if (this.ghostsFor !== state || this.ghostsPod !== pod) {
      this.ghostsFor = state;
      this.ghostsPod = pod;
      this.ghosts = DIRS.map((dir) => ({ dir, to: tugSlide(state, pod, dir).to })).filter((x) => x.to !== state.pods[pod]);
    }
    l.clear();
    const from = state.pods[pod]!;
    const x0 = g.x(from);
    const y0 = g.y(from);
    // The picked pod is the player's own: an amber ring round it.
    l.circle(x0, y0, g.cell * RING_R).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
    this.ghosts.forEach((ghost, i) => {
      const x1 = g.x(ghost.to);
      const y1 = g.y(ghost.to);
      const delivers = pod === state.clamp.pod && ghost.to === state.clamp.cell;
      // The track: the dots of the cells the pod would cross light up, in cream when the flick delivers.
      // Then a small copy of the pod where it would stop, which for the flick that delivers is inside the clamp.
      const steps = Math.round((Math.abs(x1 - x0) + Math.abs(y1 - y0)) / g.cell);
      for (let at = 1; at < steps; at++) drawDot(l, x0 + DX[ghost.dir]! * at * g.cell, y0 + DY[ghost.dir]! * at * g.cell, g.cell, delivers ? INK.cream : INK.dim);
      const s = this.ghostSprites[i]!;
      s.texture = this.podTexture(pod, Math.round(g.cell * GHOST_SIZE));
      s.position.set(x1, y1);
      s.visible = true;
    });
    for (let i = this.ghosts.length; i < this.ghostSprites.length; i++) this.ghostSprites[i]!.visible = false;
  }

  private flick(pod: number, dir: TugDir): void {
    const state = this.state;
    if (!state || state.finished) return;
    this.idle = 0;
    this.select(pod);
    if (tugFlickIllegalReason(state, pod, dir) !== null) {
      // Up against something already: the pod leans and comes back.
      if (this.busy) this.tweens.flush();
      const s = this.sprites[pod];
      if (s) {
        const x = this.grid.x(state.pods[pod]!);
        const y = this.grid.y(state.pods[pod]!);
        this.tweens.to(s, { x: x + DX[dir]! * this.grid.cell * 0.1, y: y + DY[dir]! * this.grid.cell * 0.1 }, 60, { ease: ease.outQuad });
        this.tweens.move(s, { x, y }, { delay: 60 });
      }
      sfx.bump();
      return;
    }
    this.cb.onFlick(pod, dir);
  }

  // ---- pointer

  /** The pod under or nearest a point, within easy reach of a thumb, or -1. */
  private podNear(x: number, y: number): number {
    let best = -1;
    let bestD = (this.grid.cell * 0.72) ** 2;
    this.sprites.forEach((s, pod) => {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = pod;
      }
    });
    return best;
  }

  private inSkip(x: number, y: number): boolean {
    const b = this.skipBox;
    const slop = 6;
    return x >= b.x - slop && x <= b.x + b.w + slop && y >= b.y - slop && y <= b.y + b.h + slop;
  }

  protected override pointerDown(x: number, y: number): void {
    if (!this.state || this.state.finished) return;
    this.idle = 0;
    if (this.inSkip(x, y)) {
      this.cb.onSkip();
      return;
    }
    const pod = this.podNear(x, y);
    if (pod >= 0) {
      this.select(pod);
      sfx.pop(pod);
      this.drag = { x, y, pod, onPod: true, fired: false };
    } else if (this.selected >= 0) this.drag = { x, y, pod: this.selected, onPod: false, fired: false };
  }

  /** A swipe flicks as soon as it has a direction: it need not be let go. */
  protected override pointerMove(x: number, y: number): void {
    const d = this.drag;
    if (!d || d.fired) return;
    const dx = x - d.x;
    const dy = y - d.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.grid.cell * 0.32) return;
    d.fired = true;
    this.flick(d.pod, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
  }

  /** A tap off the pods flicks the picked pod toward the tapped cell when the two share a row or a column. */
  protected override pointerUp(x: number, y: number): void {
    const d = this.drag;
    this.drag = null;
    const state = this.state;
    if (!d || d.fired || d.onPod || !state) return;
    const at = this.grid.at(x, y);
    const from = state.pods[d.pod];
    if (!at || from === undefined) return;
    const col = from % this.grid.cols;
    const row = Math.floor(from / this.grid.cols);
    if (at.row === row && at.col !== col) this.flick(d.pod, at.col > col ? 1 : 3);
    else if (at.col === col && at.row !== row) this.flick(d.pod, at.row > row ? 2 : 0);
  }

  protected override pointerCancel(): void {
    this.drag = null;
  }

  // ---- keyboard

  /**
   * 1 to 5 pick a pod and space picks the next one; arrows or WASD flick the picked pod; X or
   * backspace skips the clamp; escape lets go of the pod.
   */
  override keyboard(key: string): boolean {
    const state = this.state;
    if (!this.interactive || !state || state.finished) return false;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const dirs: Record<string, TugDir> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };
    const dir = dirs[k];
    if (dir !== undefined) {
      this.flick(this.selected >= 0 ? this.selected : state.clamp.pod, dir);
      return true;
    }
    if (/^[1-9]$/.test(k)) {
      const pod = Number(k) - 1;
      if (pod >= state.pods.length) return false;
      this.select(pod);
      sfx.pop(pod);
      this.idle = 0;
      return true;
    }
    if (k === " ") {
      this.select((this.selected + 1) % state.pods.length);
      sfx.pop(this.selected);
      this.idle = 0;
      return true;
    }
    if (k === "x" || k === "Backspace" || k === "Delete") {
      this.cb.onSkip();
      return true;
    }
    if (k === "Escape" && this.selected >= 0) {
      this.select(-1);
      return true;
    }
    return false;
  }
}

/** An arrow from one cell's centre toward another's, for the hint. */
function arrow(g: Graphics, x0: number, y0: number, x1: number, y1: number, cell: number, color: number, alpha: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const head = cell * 0.2;
  const tx = x1 - ux * cell * 0.24;
  const ty = y1 - uy * cell * 0.24;
  g.moveTo(x0 + ux * cell * 0.5, y0 + uy * cell * 0.5).lineTo(tx - ux * head, ty - uy * head);
  g.stroke({ width: Math.max(3, cell * 0.07), color, alpha, cap: "round" });
  g.poly([tx, ty, tx - ux * head - uy * head * 0.7, ty - uy * head + ux * head * 0.7, tx - ux * head + uy * head * 0.7, ty - uy * head - ux * head * 0.7]).fill({ color, alpha });
}
