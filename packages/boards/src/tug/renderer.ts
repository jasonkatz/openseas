import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { tugFlickIllegalReason, tugSlide, tugSolve, tugViewString, type TugClamp, type TugDir, type TugMoveReport, type TugState } from "@openseas/engine";
import { sfx } from "../audio.js";
import { FONT, INK, drawMark, drawPanel, drawPiece, drawWell, kindStyle, mix, spriteName } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";

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
  showMarks: boolean;
  /** Show the first flick of a par route after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: TugLabels;
}

/** A flick's step in columns and rows, by direction: up, right, down, left. */
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const DIRS: readonly TugDir[] = [0, 1, 2, 3];
const HINT_AFTER_MS = 7000;
const STEEL = 0x33435f;

/** Draws the cargo bay and turns a swipe into a flick. Scores nothing: every number it shows is the engine's. */
export class TugRenderer extends KitBoard<TugState> {
  private readonly grid = new Grid(7, 7);
  private readonly bg = new Graphics();
  private readonly blockLayer = new Graphics();
  private readonly clampLayer = new Graphics();
  private readonly ghostLayer = new Graphics();
  private readonly podLayer = new Container();
  private readonly hintLayer = new Graphics();
  private readonly strip = new Graphics();
  private label: Text | null = null;
  private skipText: Text | null = null;
  private skipBox = { x: 0, y: 0, w: 0, h: 0 };
  private sprites: Sprite[] = [];
  /** What is drawn: the blocks, the lit clamp (null between a delivery and the next lighting) and the flicks shown. */
  private drawnBlocks: readonly number[] = [];
  private drawnClamp: TugClamp | null = null;
  private clampLit = 0;
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
    super(host, "tug", cb.onFrame, opts.showMarks);
    this.hints = opts.hints;
  }

  override setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: INK.text, letterSpacing: 0.5 } });
    this.label.anchor.set(0, 0.5);
    this.skipText = new Text({ text: this.opts.labels.skip, style: { fontFamily: FONT, fontSize: 14, fontWeight: "700", fill: INK.text, letterSpacing: 0.5 } });
    this.skipText.anchor.set(0.5);
    this.world.addChild(this.bg, this.blockLayer, this.clampLayer, this.ghostLayer, this.podLayer, this.hintLayer, this.strip, this.label, this.skipText);
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
    this.bg.clear();
    drawPanel(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, Math.max(10, g.cell * 0.28));
    for (let i = 0; i < g.cols * g.rows; i++) drawWell(this.bg, g.x(i) - g.cell / 2, g.y(i) - g.cell / 2, g.cell);
    // The bay's walls: a brass rail all round, since a wall is a stop like any other.
    this.bg.roundRect(g.ox - 2, g.oy - 2, g.width + 4, g.height + 4, g.cell * 0.14).stroke({ width: 3, color: INK.brass, alpha: 0.6 });
    const bw = Math.max(56, g.cell * 1.5);
    const bh = strip * 0.6;
    this.skipBox = { x: g.ox + g.width - bw, y: g.oy - pad - strip * 0.5 - bh / 2, w: bw, h: bh };
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.34));
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

  private podTexture(pod: number): Texture {
    const cell = this.grid.cell;
    return this.bake(`pod:${pod}:${this.showMarks ? 1 : 0}`, cell, (g) => {
      // A pod is a round tray with its own shape riding on it: the tray says "cargo", the shape says which.
      if (this.sprite(g, spriteName("pod", pod), 0, 0, cell * 0.9)) {
        if (this.showMarks) drawMark(g, pod, 0, -cell * 0.04, cell * 0.3);
        return;
      }
      const tray = cell * 0.43;
      const color = kindStyle(pod).color;
      g.circle(0, tray * 0.1, tray).fill({ color: INK.black, alpha: 0.4 });
      g.circle(0, 0, tray).fill({ color: mix(INK.wellLit, color, 0.18) });
      g.circle(0, 0, tray).stroke({ width: Math.max(1.5, cell * 0.05), color: mix(color, INK.black, 0.25) });
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        g.circle(Math.cos(a) * tray * 0.82, Math.sin(a) * tray * 0.82, Math.max(1, cell * 0.028)).fill({ color: mix(color, INK.white, 0.3), alpha: 0.8 });
      }
      drawPiece(g, pod, 0, 0, cell * 0.25, { marks: this.showMarks });
    });
  }

  private drawBlocks(): void {
    const g = this.grid;
    const b = this.blockLayer;
    b.clear();
    for (const cell of this.drawnBlocks) {
      if (this.sprite(b, "block", g.x(cell), g.y(cell), g.cell * 0.9)) continue;
      const x = g.x(cell) - g.cell / 2;
      const y = g.y(cell) - g.cell / 2;
      const inset = g.cell * 0.07;
      const s = g.cell - inset * 2;
      b.roundRect(x + inset, y + inset + s * 0.06, s, s, g.cell * 0.14).fill({ color: INK.black, alpha: 0.4 });
      b.roundRect(x + inset, y + inset, s, s, g.cell * 0.14).fill({ color: STEEL });
      b.roundRect(x + inset, y + inset, s, s, g.cell * 0.14).stroke({ width: Math.max(1.5, g.cell * 0.05), color: mix(STEEL, INK.white, 0.28) });
      // A cross brace and four rivets: a fixed thing, nothing like a pod.
      const m = inset + s * 0.22;
      b.moveTo(x + m, y + m).lineTo(x + g.cell - m, y + g.cell - m).moveTo(x + g.cell - m, y + m).lineTo(x + m, y + g.cell - m);
      b.stroke({ width: Math.max(2, g.cell * 0.07), color: mix(STEEL, INK.black, 0.45), cap: "round" });
      for (const [dx, dy] of [
        [m, m],
        [g.cell - m, m],
        [m, g.cell - m],
        [g.cell - m, g.cell - m],
      ] as const) b.circle(x + dx, y + dy, Math.max(1.5, g.cell * 0.045)).fill({ color: mix(STEEL, INK.white, 0.45) });
    }
  }

  /** The strip over the bay: the pod the clamp wants, the par and the flicks, and the skip button. */
  private drawStrip(): void {
    const g = this.grid;
    const s = this.strip;
    s.clear();
    const box = this.skipBox;
    const pulse = this.hint === "skip" ? 0.5 + 0.5 * Math.sin(this.time / 200) : 0;
    s.roundRect(box.x, box.y, box.w, box.h, box.h * 0.4).fill({ color: mix(INK.well, INK.danger, 0.12 + pulse * 0.35) });
    s.roundRect(box.x, box.y, box.w, box.h, box.h * 0.4).stroke({ width: 1.5, color: mix(INK.edge, INK.danger, 0.3 + pulse * 0.6) });
    const clamp = this.drawnClamp;
    if (clamp) {
      const x = g.ox + g.cell * 0.42;
      const y = this.label?.y ?? g.oy - g.cell * 0.5;
      if (this.sprite(s, spriteName("pod", clamp.pod), x, y, g.cell * 0.62)) {
        if (this.showMarks) drawMark(s, clamp.pod, x, y - g.cell * 0.03, g.cell * 0.2);
      } else drawPiece(s, clamp.pod, x, y, g.cell * 0.24, { marks: this.showMarks });
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
      const ms = 90 + cells * 52;
      const color = kindStyle(pod).color;
      const dir = r.move.type === "flick" ? r.move.dir : 0;
      sfx.whoosh();
      this.fx.beam([x0, y0, x1, y1], color, Math.max(2, g.cell * 0.07), ms + 140);
      this.tweens.to(sprite, { x: x1, y: y1 }, ms, {
        ease: ease.outQuad,
        done: () => {
          // The stop: a thud, a puff where it hit, and the pod gives a little.
          sfx.thud();
          this.fx.burst(x1 + DX[dir]! * g.cell * 0.46, y1 + DY[dir]! * g.cell * 0.46, stop === "pod" ? INK.gold : INK.dim, 5, 0.12, 2.5);
          this.shownFlicks = r.delivered ? r.delivered.flicks : state.flicks;
          this.drawStrip();
        },
      });
      this.tweens.to(sprite, { scale: 0.86 }, 70, { delay: ms, ease: ease.outQuad });
      this.tweens.to(sprite, { scale: 1 }, 150, { delay: ms + 70, ease: ease.outBack });
      t = ms + 40;
      const d = r.delivered;
      if (d) {
        const tone = d.grade === "clean" ? INK.good : d.grade === "full" ? INK.gold : INK.dim;
        this.tweens.after(t, () => {
          this.drawnClamp = null;
          this.drawStrip();
          this.fx.ring(x1, y1, tone, g.cell * 0.3, g.cell * (d.grade === "clean" ? 1.7 : 1.2), 480, 4);
          this.fx.burst(x1, y1, color, d.grade === "clean" ? 16 : 8, 0.26, 4);
          this.fx.popup(x1, y1 - g.cell * 0.3, `+${d.points}`, tone, Math.max(16, g.cell * (d.grade === "clean" ? 0.56 : 0.44)));
          this.fx.popup(x1, y1 + g.cell * 0.82, this.opts.labels.tally(d.flicks, d.par), INK.text, Math.max(12, g.cell * 0.28));
          this.fx.say(d.grade === "clean" ? this.opts.labels.clean(d.streak) : d.grade === "full" ? this.opts.labels.full : this.opts.labels.slow, tone);
          if (d.grade === "clean") {
            this.fx.flash(INK.good, 0.1, 240);
            this.fx.shake(2 + d.par * 1.6, 220);
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
      this.drawnClamp = null;
      this.drawStrip();
      this.fx.say(this.opts.labels.skipped, INK.danger);
      if (r.skipped.penalty > 0) this.fx.popup(g.x(gone.cell), g.y(gone.cell) - g.cell * 0.2, `-${r.skipped.penalty}`, INK.danger, Math.max(16, g.cell * 0.46));
      this.fx.ring(g.x(gone.cell), g.y(gone.cell), INK.danger, g.cell * 0.5, g.cell * 0.1, 300, 3);
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

  /** A clamp lights: it is drawn from now on, it rings in, and the pod it wants is picked. */
  private light(clamp: TugClamp): void {
    const g = this.grid;
    // The par is called out only when it is not the last clamp's: that is the news.
    const news = clamp.par !== this.lastPar;
    this.lastPar = clamp.par;
    this.drawnClamp = clamp;
    this.clampLit = this.time;
    this.shownFlicks = 0;
    const x = g.x(clamp.cell);
    const y = g.y(clamp.cell);
    const color = kindStyle(clamp.pod).color;
    this.fx.ring(x, y, color, g.cell * 1.3, g.cell * 0.46, 420, 3);
    if (news) this.fx.popup(x, y - g.cell * 0.55, this.opts.labels.par(clamp.par), color, Math.max(13, g.cell * 0.34));
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
    this.drawClamp();
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
    const pulse = 0.45 + 0.4 * Math.sin(this.time / 240);
    const color = kindStyle(h.pod).color;
    this.hintLayer.circle(g.x(from), g.y(from), g.cell * 0.5).stroke({ width: 3, color: INK.white, alpha: pulse });
    arrow(this.hintLayer, g.x(from), g.y(from), g.x(h.to), g.y(h.to), g.cell, color, pulse);
  }

  /** The lit clamp: four jaws in the wanted pod's color round the outline of the pod it wants. */
  private drawClamp(): void {
    const g = this.grid;
    const c = this.clampLayer;
    c.clear();
    const clamp = this.drawnClamp;
    if (!clamp) return;
    const x = g.x(clamp.cell);
    const y = g.y(clamp.cell);
    const color = kindStyle(clamp.pod).color;
    const pulse = 0.5 + 0.5 * Math.sin(this.time / 300);
    const born = Math.min(1, (this.time - this.clampLit) / 260);
    const half = g.cell * (0.46 + (1 - born) * 0.3);
    c.roundRect(x - g.cell * 0.46, y - g.cell * 0.46, g.cell * 0.92, g.cell * 0.92, g.cell * 0.16).fill({ color, alpha: 0.1 + pulse * 0.1 });
    // The sheet's clamp is a frame round the outline of the pod it wants: it closes in as it lights, then breathes.
    const art = g.cell * 0.94;
    if (this.sprite(c, spriteName("clamp", clamp.pod), x, y, art * (1 + (1 - born) * 0.5), 0.7 + pulse * 0.3, art)) return;
    const jaw = g.cell * 0.26;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      c.moveTo(x + sx * half, y + sy * (half - jaw)).lineTo(x + sx * half, y + sy * half).lineTo(x + sx * (half - jaw), y + sy * half);
    }
    c.stroke({ width: Math.max(3, g.cell * 0.09), color: mix(color, INK.white, 0.15 + pulse * 0.3), alpha: 0.95, cap: "round", join: "round" });
    drawPiece(c, clamp.pod, x, y, g.cell * 0.24, { hollow: true, alpha: 0.65 + pulse * 0.35 });
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
    if (!show) {
      if (this.ghostsFor !== null || this.ghostsPod !== -1) {
        l.clear();
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
    const color = kindStyle(pod).color;
    l.circle(x0, y0, g.cell * 0.49).stroke({ width: Math.max(2, g.cell * 0.05), color: INK.white, alpha: 0.85 });
    for (const ghost of this.ghosts) {
      const x1 = g.x(ghost.to);
      const y1 = g.y(ghost.to);
      const delivers = pod === state.clamp.pod && ghost.to === state.clamp.cell;
      // A dotted track, a chevron leaving the pod, and the pod's outline where it would stop.
      const steps = Math.round((Math.abs(x1 - x0) + Math.abs(y1 - y0)) / g.cell);
      for (let i = 1; i < steps * 2; i++) {
        const k = i / (steps * 2);
        l.circle(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, Math.max(1.2, g.cell * 0.03)).fill({ color: delivers ? INK.good : color, alpha: 0.5 });
      }
      const dx = DX[ghost.dir]!;
      const dy = DY[ghost.dir]!;
      const tip = g.cell * 0.66;
      const wing = g.cell * 0.1;
      l.poly([x0 + dx * tip, y0 + dy * tip, x0 + dx * (tip - wing * 1.3) - dy * wing, y0 + dy * (tip - wing * 1.3) + dx * wing, x0 + dx * (tip - wing * 1.3) + dy * wing, y0 + dy * (tip - wing * 1.3) - dx * wing]).fill({ color: delivers ? INK.good : INK.white, alpha: 0.8 });
      if (delivers) l.circle(x1, y1, g.cell * (0.4 + 0.04 * Math.sin(this.time / 160))).stroke({ width: 3, color: INK.good, alpha: 0.9 });
      else drawPiece(l, pod, x1, y1, g.cell * 0.2, { hollow: true, alpha: 0.6 });
    }
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
        this.tweens.to(s, { x, y }, 110, { delay: 60, ease: ease.outBack });
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

/** A stout arrow from one cell's centre toward another's, for the hint. */
function arrow(g: Graphics, x0: number, y0: number, x1: number, y1: number, cell: number, color: number, alpha: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const head = cell * 0.26;
  const tx = x1 - ux * cell * 0.1;
  const ty = y1 - uy * cell * 0.1;
  g.moveTo(x0 + ux * cell * 0.5, y0 + uy * cell * 0.5).lineTo(tx - ux * head, ty - uy * head);
  g.stroke({ width: Math.max(4, cell * 0.12), color, alpha, cap: "round" });
  g.poly([tx, ty, tx - ux * head - uy * head * 0.7, ty - uy * head + ux * head * 0.7, tx - ux * head + uy * head * 0.7, ty - uy * head - ux * head * 0.7]).fill({ color, alpha });
}
