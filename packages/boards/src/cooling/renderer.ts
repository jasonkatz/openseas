import { sfx } from "../audio.js";
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import { Special, type CoolingState, type ClearRound, type MoveReport, type Piece } from "@openseas/engine";
import type { CoolingContent, PieceColor } from "@openseas/content";
import { pieceCanvas, type Pictogram } from "./pieces.js";
import { boardSurface } from "../surface.js";
import { FONT, MOTION, blend, ink } from "../look/tokens.js";

export interface RendererCallbacks {
  /** The player asked to swap (col,row) with (col+1,row). */
  onSwap(col: number, row: number): void;
  /** The player is considering a swap; the page can show a preview. */
  onHover(col: number, row: number): void;
  onHoverEnd(): void;
  /** Called on the first frame drawn after a new state arrives. */
  onFrame(): void;
  /** A cascade step is clearing on screen now. Drives sound so it lines up with what is seen. */
  onClear(round: ClearRound): void;
  /** A move finished playing out. Streak and heat changes land here, in step with the screen. */
  onMoveShown(shown: MoveShown): void;
  /** The swap a hint should point at, or null when there is none. Asked only while hints are on. */
  findHint(): { col: number; row: number } | null;
}

export interface MoveShown {
  /** Consecutive scoring moves after this one; 0 when this move broke the streak. */
  combo: number;
  /** The streak this move broke, or 0. */
  lostCombo: number;
  /** Combo milestone this move reached (3, 5, 8, 12, ...), or 0. */
  milestone: number;
  /** Whole rows the heat moved: negative when vented down. */
  heatRows: number;
  /** The heat just crossed into the danger half. */
  enteredDanger: boolean;
}

export interface RendererOptions {
  /** Formats the callout shown for cascade step `chain` (2 and up), from the message table. */
  chainLabel(chain: number): string;
  /** Callout for clearing `groups` (2 and up) runs in one step, from the message table. */
  multiLabel(groups: number): string;
  /** Callout for a streak milestone of `count` scoring moves in a row, from the message table. */
  streakLabel(count: number): string;
  /** A swap below the heat line takes this long, and the board takes no other swap meanwhile. */
  overheatSwapMs: number;
}

interface PieceView {
  c: Container;
  tile: Sprite;
  kind: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  vy: number;
  /** Horizontal slide: start x and progress 0..1 (1 is done). */
  sx: number;
  slide: number;
  slideDir: number;
  slideMs: number;
  /** Overheated slides ease in and out instead of snapping across. */
  slideSlow: boolean;
  /** Ms since this piece started clearing, or null while it lives. */
  dying: number | null;
  /** Clearing is silent when the piece is only being retired by a fast-forward. */
  quiet: boolean;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
  rise: number;
  scale: number;
}

type Step = () => number | "settle";

/** Every colour the board draws, from the game's one palette (docs/BRAND.md section 2). */
const COLORS = {
  line: ink("line"),
  cream: ink("cream"),
  ground: ink("ground"),
  amber: ink("amber"),
  danger: ink("danger"),
  // The ship's heat: a flat tint of the ground under the line, deeper once it is half way up.
  heat: blend("ground", "danger", 0.2),
  heatHigh: blend("ground", "danger", 0.34),
};

const SWAP_MS = MOTION.move;
const CLEAR_MS = MOTION.clear;
const DIE_MS = MOTION.clear;
const BEAT_MS = MOTION.beat;
/** No input for this long in a hinted round and the board points at a scoring swap. */
const HINT_IDLE_MS = 6000;

/** Streak milestones that earn a callout and a fanfare: 3, 5, 8, 12, then every 5. */
export function streakMilestone(combo: number): boolean {
  return combo === 3 || combo === 5 || combo === 8 || combo === 12 || (combo > 12 && combo % 5 === 0);
}

const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * PixiJS view of a Cooling state. Pure presentation: it never touches the engine. A move plays out
 * as a timeline (swap, then each cascade step: clear, rise, settle) built from the move report, so
 * the player sees every chain. A new move fast-forwards whatever is still playing, so input never
 * waits on animation.
 */
export class CoolingRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  /** The playfield's one hairline. There is no frame round a board (docs/BRAND.md section 3). */
  private readonly well = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly heatBack = new Graphics();
  private readonly heatLayer = new Graphics();
  private readonly overlay = new Graphics();
  private readonly beatLayer = new Graphics();
  private readonly fxLayer = new Container();
  private readonly calloutLayer = new Container();
  private readonly pieces = new Map<number, PieceView>();
  private readonly popups: Popup[] = [];
  private readonly colorByKind = new Map<number, PieceColor>();
  private readonly shapeByKind = new Map<number, Pictogram>();
  private readonly textures = new Map<number, Texture>();
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private cell = 48;
  private ox = 0;
  private oy = 0;
  private width = 6;
  private height = 12;
  private heatTarget = 0;
  private heatShown = 0;
  private time = 0;
  private combo = 0;
  private comboShown = 0;
  private selected: { col: number; row: number } | null = null;
  private cursor: { col: number; row: number } | null = null;
  private hoverPair: { col: number; row: number } | null = null;
  /** Overheated swaps hold the board until `lockedUntil` (renderer time, ms). */
  private lockedUntil = 0;
  private slowPair: { col: number; row: number } | null = null;
  private denied: { col: number; row: number; at: number } | null = null;
  private slideMs: number = SWAP_MS;
  private previewCells: readonly number[] = [];
  private dragStart: { col: number; row: number; x: number; y: number } | null = null;
  private dragDx = 0;
  private holdTimer: number | null = null;
  private steps: Step[] = [];
  private waitMs = 0;
  private waitSettle = 0;
  private moving = false;
  private framePending = false;
  private viewStale = true;
  private destroyed = false;
  private state: CoolingState | null = null;
  private interactive = true;
  /** The beat: one amber pulse of the whole board for a big moment (docs/BRAND.md section 6). */
  private beatNow: { life: number; strength: number } | null = null;
  private hints = false;
  private lastInputAt = 0;
  private hint: { col: number; row: number } | null = null;
  private hintCheckedAt = -1;

  constructor(
    private readonly host: HTMLElement,
    content: CoolingContent,
    private readonly cb: RendererCallbacks,
    private readonly opts: RendererOptions,
  ) {
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, p.color);
      this.shapeByKind.set(i, p.shape);
    });
    for (const [kind, name] of [[Special.Charge, "charge"], [Special.Magnet, "magnet"], [Special.Slag, "slag"]] as const) {
      this.colorByKind.set(kind, content.specials[name].color);
      this.shapeByKind.set(kind, name);
    }
  }

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      ...boardSurface(),
      autoDensity: true,
      preference: "webgl",
    });
    // Score popups are drawn as text, so wait (briefly) for the webfont.
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    // No atlas to wait for: the pieces are drawn in code (ADR 0062). The studio's thumbnails read this.
    this.app.canvas.dataset.pieces = "drawn";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "cooling-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.pieceLayer.sortableChildren = true;
    this.board.addChild(this.well, this.heatBack, this.pieceLayer, this.heatLayer, this.overlay, this.beatLayer, this.fxLayer, this.calloutLayer);
    this.app.stage.addChild(this.board);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointermove", (e) => this.pointerMove(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", () => this.pointerCancel());
    this.app.stage.on("pointerleave", () => this.hoverEnd());
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      for (const tex of this.textures.values()) tex.destroy(true);
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.selected = null;
      this.dragStart = null;
      this.hoverPair = null;
      this.previewCells = [];
    }
  }

  /** Idle hints, for unrated practice only: a rated round is the player's own work. */
  setHints(on: boolean): void {
    this.hints = on;
    this.lastInputAt = this.time;
    this.hint = null;
  }

  private noteInput(): void {
    this.lastInputAt = this.time;
    this.hint = null;
  }

  setPreview(cells: readonly number[]): void {
    this.previewCells = cells;
  }

  setCursor(c: { col: number; row: number } | null): void {
    this.cursor = c;
  }

  getCursor(): { col: number; row: number } | null {
    return this.cursor;
  }

  // ---- state and the move timeline

  /** Apply a new engine state. A move report plays as a timeline; anything else snaps. */
  setState(state: CoolingState, report: MoveReport | null): void {
    const prev = this.state;
    this.state = state;
    this.combo = state.combo;
    if (state.config.width !== this.width || state.config.height !== this.height) {
      this.width = state.config.width;
      this.height = state.config.height;
      this.layout();
    }
    this.heatTarget = state.heatRow;
    this.framePending = true;
    this.viewStale = true;
    this.selected = null;
    this.previewCells = [];
    this.hoverPair = null;

    if (!prev || !report || report.move.type !== "swap" || prev.config !== state.config) {
      this.steps = [];
      this.waitMs = 0;
      // A state without a move is a new game. Piece ids restart at 0 in every game, so no view
      // from the previous board may be reused or it would keep drawing the old kinds.
      if (!report) {
        for (const id of [...this.pieces.keys()]) this.remove(id);
        this.lockedUntil = 0;
        this.slowPair = null;
      }
      this.place(state.cells, prev === null || !report);
      if (!prev) this.heatShown = state.heatRow;
      return;
    }

    // Fast-forward anything still playing: the previous move's final board is this move's start.
    this.steps = [];
    this.waitMs = 0;
    this.waitSettle = 0;
    this.place(prev.cells, false);

    const { col, row } = report.move;
    const swapped = prev.cells.slice();
    const i = row * this.width + col;
    [swapped[i], swapped[i + 1]] = [swapped[i + 1]!, swapped[i]!];
    // Below the heat line pieces swap slowly, and the board holds until they land.
    const slow = row < prev.heatRow && this.opts.overheatSwapMs > 0;
    const swapMs = slow ? this.opts.overheatSwapMs : SWAP_MS;
    if (slow) {
      this.lockedUntil = this.time + swapMs;
      this.slowPair = { col, row };
    }
    this.steps.push(() => {
      this.slideMs = swapMs;
      this.place(swapped, false);
      this.slideMs = SWAP_MS;
      return report.rounds.length || slow ? swapMs : 0;
    });
    for (const round of report.rounds) {
      this.steps.push(() => {
        this.clear(round);
        // Bigger steps hold a beat longer so the hit lands before the board moves again.
        const size = round.groups.reduce((n, g) => n + g.ids.length, 0);
        return CLEAR_MS + Math.min(110, (round.chain - 1) * 30 + Math.max(0, size - 4) * 10);
      });
      this.steps.push(() => {
        this.place(round.settled, false);
        return "settle";
      });
    }
    this.steps.push(() => {
      this.place(state.cells, false);
      this.moveShown(prev, state);
      return 0;
    });
    this.noteInput();
    this.runSteps(0);
  }

  /** Streak and heat feedback once a move has finished playing. */
  private moveShown(prev: CoolingState, state: CoolingState): void {
    const half = state.config.height * 0.5;
    const shown: MoveShown = {
      combo: state.combo,
      lostCombo: state.combo === 0 ? prev.combo : 0,
      milestone: state.combo > prev.combo && streakMilestone(state.combo) ? state.combo : 0,
      heatRows: state.heatRow - prev.heatRow,
      enteredDanger: prev.heatRow < half && state.heatRow >= half,
    };
    if (shown.milestone) {
      this.callout(this.opts.streakLabel(shown.milestone), 2 + Math.min(4, shown.milestone / 3));
      this.beat(0.5 + Math.min(0.5, shown.milestone / 24));
    }
    this.cb.onMoveShown(shown);
  }

  /**
   * Point every piece at its cell in `cells`. New pieces enter from below the board in column
   * order; pieces no longer present retire quietly. `snap` puts everything in place immediately.
   */
  private place(cells: readonly Piece[], snap: boolean): void {
    const fresh = new Array<number>(this.width).fill(0);
    for (let i = 0; i < cells.length; i++) if (!this.pieces.has(cells[i]!.id)) fresh[i % this.width]!++;
    const live = new Set<number>();
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i]!;
      live.add(p.id);
      const col = i % this.width;
      const row = Math.floor(i / this.width);
      const tx = this.cx(col);
      const ty = this.cy(row);
      let v = this.pieces.get(p.id);
      if (!v || v.dying !== null || v.kind !== p.kind) {
        if (v) this.remove(p.id);
        v = this.spawn(p, tx, snap ? ty : this.cy(row - fresh[col]!));
      } else if (!snap && v.tx !== tx) {
        v.sx = v.x;
        v.slide = 0;
        v.slideDir = tx > v.x ? -1 : 1;
        v.slideMs = this.slideMs;
        v.slideSlow = this.slideMs > SWAP_MS;
      }
      v.tx = tx;
      v.ty = ty;
      if (snap) {
        v.x = tx;
        v.y = ty;
        v.vy = 0;
        v.slide = 1;
      }
      if (v.x !== v.tx || v.y !== v.ty) this.moving = true;
    }
    for (const [id, v] of this.pieces) {
      if (live.has(id) || v.dying !== null) continue;
      if (snap) this.remove(id);
      else this.kill(v, true);
    }
  }

  private spawn(p: Piece, x: number, y: number): PieceView {
    const c = new Container();
    const tile = new Sprite(this.textures.get(p.kind) ?? Texture.EMPTY);
    tile.anchor.set(0.5);
    c.addChild(tile);
    c.position.set(x, y);
    this.pieceLayer.addChild(c);
    const v: PieceView = { c, tile, kind: p.kind, x, y, tx: x, ty: y, vy: 0, sx: x, slide: 1, slideDir: 0, slideMs: SWAP_MS, slideSlow: false, dying: null, quiet: false };
    this.pieces.set(p.id, v);
    return v;
  }

  private remove(id: number): void {
    const v = this.pieces.get(id);
    if (!v) return;
    this.pieceLayer.removeChild(v.c);
    v.c.destroy({ children: true });
    this.pieces.delete(id);
  }

  private kill(v: PieceView, quiet: boolean): void {
    v.dying = 0;
    v.quiet = quiet;
    v.c.zIndex = 10;
  }

  /**
   * One cascade step: the cleared pieces shrink away, the step's points rise from where they were,
   * and a chain or a double is named. A long chain, or slag lifted together, is the beat.
   */
  private clear(round: ClearRound): void {
    this.cb.onClear(round);
    let sx = 0;
    let sy = 0;
    let n = 0;
    let slag = 0;
    for (const group of round.groups) {
      if (group.cause === "slag") slag += group.ids.length;
      for (const id of group.ids) {
        const v = this.pieces.get(id);
        if (!v || v.dying !== null) continue;
        this.kill(v, false);
        sx += v.x;
        sy += v.y;
        n++;
      }
    }
    const groups = round.groups.length;
    if (n > 0 && round.points > 0) {
      const mult = round.chain > 1 ? ` ×${round.chain}` : groups > 1 ? ` ×${groups}` : "";
      this.popup(sx / n, sy / n, `+${round.points}${mult}`, 0.46 + Math.min(0.24, round.points / 400));
    }
    const runs = round.groups.filter((g) => g.cause === "match" && g.ids.length >= 3).length;
    const lines: string[] = [];
    if (runs >= 2) lines.push(this.opts.multiLabel(runs));
    if (round.chain >= 2) lines.push(this.opts.chainLabel(round.chain));
    if (lines.length) this.callout(lines.join("\n"), round.chain + (runs >= 2 ? runs - 1 : 0));
    if (round.chain >= 3 || slag >= 2) this.beat(0.5 + Math.min(0.5, Math.max(round.chain - 3, slag - 2) * 0.17));
  }

  private centerOf(ids: readonly number[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of ids) {
      const v = this.pieces.get(id);
      if (!v) continue;
      x += v.x;
      y += v.y;
      n++;
    }
    return n ? { x: x / n, y: y / n } : { x: (this.width * this.cell) / 2, y: (this.height * this.cell) / 2 };
  }

  private runSteps(dt: number): void {
    if (this.waitMs > 0) this.waitMs -= dt;
    if (this.waitSettle > 0) this.waitSettle = this.moving ? this.waitSettle - dt : 0;
    while (this.waitMs <= 0 && this.waitSettle <= 0 && this.steps.length) {
      const r = this.steps.shift()!();
      if (r === "settle") this.waitSettle = 900;
      else this.waitMs = this.reduced ? Math.min(r, 60) : r;
    }
  }

  // ---- effects


  private popup(x: number, y: number, text: string, size: number): void {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.mono,
        fontSize: Math.max(15, this.cell * size),
        fontWeight: "700",
        fill: COLORS.cream,
        // A ground edge keeps the number readable over any piece.
        stroke: { color: COLORS.ground, width: Math.max(3, this.cell * 0.09), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    const margin = t.width / 2 + 4;
    t.position.set(Math.min(Math.max(x, margin), this.width * this.cell - margin), y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: 950, y0: t.y, rise: this.cell * 0.9, scale: 1 });
  }

  private callout(text: string, chain: number): void {
    for (const p of this.popups) if (p.t.parent === this.calloutLayer) p.life = Math.max(p.life, p.max - 120);
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.body,
        fontSize: Math.max(22, this.cell * (0.7 + Math.min(0.4, chain * 0.06))),
        fontWeight: "700",
        fill: COLORS.cream,
        align: "center",
        stroke: { color: COLORS.ground, width: Math.max(4, this.cell * 0.12), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set((this.width * this.cell) / 2, this.height * this.cell * 0.42);
    this.calloutLayer.addChild(t);
    this.popups.push({ t, life: 0, max: 900, y0: t.y, rise: this.cell * 0.4, scale: 1 });
  }

  /** Ask for the beat. A stronger moment while one is playing takes it over; it never stacks. */
  private beat(strength: number): void {
    // The pulse and its sound are asked for together, so they cannot drift apart.
    sfx.beat(strength);
    this.beatNow = { life: 0, strength: Math.max(strength, this.beatNow?.strength ?? 0) };
  }

  // ---- layout and baking

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    // Nothing frames the board, so the pieces get all of the screen but the hairline.
    this.cell = Math.max(12, Math.floor(Math.min((w - 2) / this.width, (h - 2) / this.height)));
    this.ox = Math.floor((w - this.cell * this.width) / 2);
    this.oy = Math.floor((h - this.cell * this.height) / 2);
    this.board.pivot.set((this.cell * this.width) / 2, (this.cell * this.height) / 2);
    this.board.position.set(this.ox + this.board.pivot.x, this.oy + this.board.pivot.y);
    this.drawWell();
    this.bake();
    if (this.state) this.place(this.state.cells, true);
    this.steps = [];
  }

  /** The playfield is bare ground with one hairline round it: no frame, no grid (docs/BRAND.md section 3). */
  private drawWell(): void {
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    // The ground is painted, not left clear, so the board is whole wherever it is shown (a thumbnail, a capture).
    this.well.clear().rect(0, 0, W, H).fill(COLORS.ground).rect(-0.5, -0.5, W + 1, H + 1).stroke({ width: 1, color: COLORS.line });
  }

  /** Bake each kind's pictogram to a texture at the current size. */
  private bake(): void {
    const r = this.app.renderer;
    if (!r) return;
    const old = [...this.textures.values()];
    for (const [kind, shape] of this.shapeByKind) {
      const canvas = pieceCanvas(this.cell, shape, this.colorByKind.get(kind) ?? "cream", r.resolution);
      this.textures.set(kind, new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) }));
    }
    for (const v of this.pieces.values()) v.tile.texture = this.textures.get(v.kind) ?? Texture.EMPTY;
    for (const tex of old) tex.destroy(true);
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  /** Row 0 is the bottom of the board. */
  private cy(row: number): number {
    return (this.height - row - 0.5) * this.cell;
  }
  private cellAt(x: number, y: number): { col: number; row: number } | null {
    const col = Math.floor((x - this.ox) / this.cell);
    const row = this.height - 1 - Math.floor((y - this.oy) / this.cell);
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return { col, row };
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    this.runSteps(dt);
    this.movePieces(dt);
    if (this.viewStale && !this.steps.length && !this.moving && this.waitMs <= 0) this.publishView();
    this.moveFx(dt);
    this.updateHint();
    const k = Math.min(1, dt / 16.67);
    this.heatShown += (this.heatTarget - this.heatShown) * Math.min(1, 0.06 * k);
    if (Math.abs(this.heatTarget - this.heatShown) < 0.003) this.heatShown = this.heatTarget;
    this.comboShown += (Math.min(8, this.combo) - this.comboShown) * Math.min(1, 0.1 * k);
    this.drawHeat();
    this.drawOverlay();
    this.drawBeat(dt);
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
  }

  /** After a quiet spell in a hinted round, pick a scoring swap to point at. */
  private updateHint(): void {
    if (!this.hints || !this.interactive || this.steps.length || this.moving || this.time < this.lockedUntil) {
      this.hint = null;
      this.hintCheckedAt = -1;
      return;
    }
    if (this.time - this.lastInputAt < HINT_IDLE_MS) return;
    if (this.hint || this.hintCheckedAt === this.lastInputAt) return;
    this.hintCheckedAt = this.lastInputAt;
    this.hint = this.cb.findHint();
  }

  /**
   * Writes the kinds actually on screen, bottom row first, to the canvas once the board settles.
   * The smoke test compares it with the engine's board so the view can never silently diverge.
   */
  private publishView(): void {
    this.viewStale = false;
    const kinds = new Array<string>(this.width * this.height).fill("?");
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const col = Math.round(v.tx / this.cell - 0.5);
      const row = this.height - 1 - Math.round(v.ty / this.cell - 0.5);
      if (col >= 0 && col < this.width && row >= 0 && row < this.height) kinds[row * this.width + col] = String(v.kind);
    }
    this.app.canvas.dataset.view = kinds.join(",");
  }

  private movePieces(dt: number): void {
    const accel = this.cell * 0.00018;
    const vmax = this.cell * 0.032;
    let moving = false;
    const drag = this.dragStart && Math.abs(this.dragDx) > 2 ? this.dragStart : null;
    for (const [id, v] of this.pieces) {
      if (v.dying !== null) {
        v.dying += dt;
        const t = Math.min(1, v.dying / (v.quiet ? 120 : DIE_MS));
        // A cleared piece shrinks to nothing; one retired by a fast-forward just fades.
        if (v.quiet) v.c.alpha = 1 - t;
        else v.c.scale.set(1 - t * t);
        if (t >= 1) this.remove(id);
        continue;
      }
      if (v.y > v.ty) {
        v.vy = Math.min(vmax, v.vy + accel * dt);
        v.y = Math.max(v.ty, v.y - v.vy * dt);
        if (v.y === v.ty) v.vy = 0;
        moving = true;
      } else if (v.y < v.ty) {
        v.y = v.ty;
        v.vy = 0;
      }
      if (v.slide < 1) {
        // Reduced motion shortens ordinary slides; an overheated slide is a gameplay cost and stays.
        v.slide = Math.min(1, v.slide + dt / (v.slideSlow || !this.reduced ? v.slideMs : 60));
        const e = v.slideSlow ? easeInOutSine(v.slide) : easeOutCubic(v.slide);
        v.x = v.sx + (v.tx - v.sx) * e;
        v.c.zIndex = v.slideDir < 0 ? 2 : 1;
        if (v.slide === 1) {
          v.x = v.tx;
          v.c.zIndex = 0;
        }
        moving = true;
      } else v.x = v.tx;

      let nudge = 0;
      const col = Math.round(v.tx / this.cell - 0.5);
      const row = this.height - 1 - Math.round(v.ty / this.cell - 0.5);
      if (drag && drag.row === row) {
        const d = Math.max(-this.cell * 0.4, Math.min(this.cell * 0.4, this.dragDx));
        if (drag.col === col) nudge = d;
        else if ((d > 0 && col === drag.col + 1) || (d < 0 && col === drag.col - 1)) nudge = -d * 0.5;
      }
      v.c.position.set(v.x + nudge, v.y);
      // Pieces rising from below the board fade in instead of being masked.
      const below = (v.y - (this.height - 0.5) * this.cell) / this.cell;
      v.c.visible = below < 1;
      v.c.alpha = below > 0 ? 1 - below : 1;
      v.c.scale.set(1);
    }
    this.moving = moving;
  }

  private moveFx(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const t = p.life / p.max;
      p.t.scale.set(p.scale * (0.6 + 0.4 * easeOutCubic(Math.min(1, p.life / MOTION.panel))));
      p.t.y = p.y0 - p.rise * easeOutCubic(Math.min(1, t));
      p.t.alpha = t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
      if (t >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
  }

  /** The heat: a flat tint under the line, which is one danger hairline (docs/BRAND.md section 3). */
  private drawHeat(): void {
    const g = this.heatLayer.clear();
    const back = this.heatBack.clear();
    if (this.heatShown <= 0.01) return;
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    const top = (this.height - this.heatShown) * this.cell;
    // The tint sits behind the pieces, so kinds read the same overheated.
    back.rect(0, top, W, H - top).fill(this.heatShown >= this.height * 0.5 ? COLORS.heatHigh : COLORS.heat);
    g.rect(0, top - 1, W, 2).fill(COLORS.danger);
  }

  /**
   * The beat: the whole board pulses once in amber and swells a hair, in `BEAT_MS`. Reduced motion
   * keeps it as a still flash.
   */
  private drawBeat(dt: number): void {
    const g = this.beatLayer;
    g.clear();
    const b = this.beatNow;
    if (!b) return;
    b.life += dt;
    const t = b.life / BEAT_MS;
    if (t >= 1) {
      this.beatNow = null;
      this.board.scale.set(1);
      return;
    }
    // Up in the first quarter, down over the rest.
    const env = this.reduced ? 1 : t < 0.25 ? easeOutCubic(t / 0.25) : 1 - easeOutCubic((t - 0.25) / 0.75);
    g.rect(0, 0, this.width * this.cell, this.height * this.cell).fill({ color: COLORS.amber, alpha: (0.14 + 0.16 * b.strength) * env });
    this.board.scale.set(this.reduced ? 1 : 1 + 0.012 * b.strength * env);
  }

  /**
   * What the player is doing, over the pieces. Amber is the player's own: the selection, the
   * cursor, the pair under the pointer. Cream shows what a swap would clear, and a hint. Danger is
   * a refused swap and one still settling in the heat.
   */
  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const s = this.cell;
    const rr = s * 0.2;
    const width = Math.max(2, s * (2 / 24));
    for (const c of this.previewCells) {
      const col = c % this.width;
      const row = Math.floor(c / this.width);
      g.roundRect(col * s + 2, (this.height - row - 1) * s + 2, s - 4, s - 4, rr).stroke({ width, color: COLORS.cream, alpha: 0.7 });
    }
    const pair = (col: number, row: number, color: number, alpha: number): void => {
      const c = Math.max(0, Math.min(this.width - 2, col));
      g.roundRect(c * s + 1, (this.height - row - 1) * s + 1, s * 2 - 2, s - 2, rr).stroke({ width, color, alpha });
    };
    if (this.hint) pair(this.hint.col, this.hint.row, COLORS.cream, 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(this.time * 0.006)));
    if (this.slowPair && this.time < this.lockedUntil) pair(this.slowPair.col, this.slowPair.row, COLORS.danger, 0.7);
    if (this.denied && this.time - this.denied.at < 260) pair(this.denied.col, this.denied.row, COLORS.danger, 1 - (this.time - this.denied.at) / 260);
    if (this.hoverPair && !this.selected) pair(this.hoverPair.col, this.hoverPair.row, COLORS.amber, 0.55);
    if (this.cursor && this.interactive) pair(this.cursor.col, this.cursor.row, COLORS.amber, 1);
    if (this.selected) {
      const { col, row } = this.selected;
      g.roundRect(col * s + 1, (this.height - row - 1) * s + 1, s - 2, s - 2, rr).stroke({ width, color: COLORS.amber });
    }
  }

  // ---- input: click-to-swap, tap-then-tap, drag-swap, hold-to-preview, hover-to-preview

  /** Every swap the player asks for passes here; an overheated swap still settling refuses it. */
  private requestSwap(col: number, row: number): void {
    if (this.time < this.lockedUntil) {
      this.denied = { col, row, at: this.time };
      return;
    }
    this.cb.onSwap(col, row);
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    this.noteInput();
    const cell = this.cellAt(e.global.x, e.global.y);
    if (!cell) return;
    this.dragStart = { ...cell, x: e.global.x, y: e.global.y };
    this.dragDx = 0;
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    if (e.pointerType === "touch") {
      this.holdTimer = window.setTimeout(() => this.hover(cell), 220);
    }
  }

  private pointerMove(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const cell = this.cellAt(e.global.x, e.global.y);
    if (this.dragStart) {
      const dx = e.global.x - this.dragStart.x;
      this.dragDx = Math.abs(e.global.y - this.dragStart.y) < this.cell * 0.8 ? dx : 0;
      if (Math.abs(dx) > this.cell * 0.45 && Math.abs(e.global.y - this.dragStart.y) < this.cell * 0.8) {
        const dir = dx > 0 ? 1 : -1;
        const col = dir > 0 ? this.dragStart.col : this.dragStart.col - 1;
        if (col >= 0 && col < this.width - 1) {
          const row = this.dragStart.row;
          this.cancelHold();
          this.dragStart = null;
          this.dragDx = 0;
          this.selected = null;
          this.requestSwap(col, row);
          return;
        }
      }
      return;
    }
    if (e.pointerType === "mouse") {
      if (cell) this.hover(cell);
      else this.hoverEnd();
    }
  }

  private pointerUp(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    this.cancelHold();
    const start = this.dragStart;
    this.dragStart = null;
    this.dragDx = 0;
    const cell = this.cellAt(e.global.x, e.global.y);
    if (!start || !cell || cell.col !== start.col || cell.row !== start.row) {
      this.hoverEnd();
      return;
    }
    // A mouse click swaps the hovered pair outright; touch keeps tap-then-tap.
    if (e.pointerType === "mouse") {
      this.selected = null;
      this.cursor = null;
      const col = Math.min(cell.col, this.width - 2);
      this.hoverPair = { col, row: cell.row };
      this.requestSwap(col, cell.row);
      return;
    }
    // Tap.
    if (this.selected && this.selected.row === cell.row && Math.abs(this.selected.col - cell.col) === 1) {
      const col = Math.min(this.selected.col, cell.col);
      this.selected = null;
      this.requestSwap(col, cell.row);
      return;
    }
    this.selected = this.selected && this.selected.col === cell.col && this.selected.row === cell.row ? null : cell;
    this.cursor = null;
    if (this.selected) this.cb.onHover(this.selected.col, this.selected.row);
    else this.cb.onHoverEnd();
  }

  private pointerCancel(): void {
    this.cancelHold();
    this.dragStart = null;
    this.dragDx = 0;
    this.hoverEnd();
  }

  private cancelHold(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private hover(cell: { col: number; row: number }): void {
    if (this.selected && this.selected.row === cell.row && Math.abs(this.selected.col - cell.col) === 1) {
      const col = Math.min(this.selected.col, cell.col);
      this.hoverPair = { col, row: cell.row };
      this.cb.onHover(col, cell.row);
    } else if (!this.selected) {
      const col = Math.min(cell.col, this.width - 2);
      this.hoverPair = { col, row: cell.row };
      this.cb.onHover(col, cell.row);
    }
  }

  private hoverEnd(): void {
    if (this.selected) return;
    this.hoverPair = null;
    this.cb.onHoverEnd();
  }

  /** Keyboard: move the cursor; swap with the piece to the right. */
  keyboard(key: string): boolean {
    if (!this.interactive) return false;
    this.noteInput();
    const c = this.cursor ?? { col: 0, row: this.height - 1 };
    switch (key) {
      case "ArrowLeft":
        this.setCursor({ col: Math.max(0, c.col - 1), row: c.row });
        break;
      case "ArrowRight":
        this.setCursor({ col: Math.min(this.width - 1, c.col + 1), row: c.row });
        break;
      case "ArrowUp":
        this.setCursor({ col: c.col, row: Math.min(this.height - 1, c.row + 1) });
        break;
      case "ArrowDown":
        this.setCursor({ col: c.col, row: Math.max(0, c.row - 1) });
        break;
      case " ":
      case "Enter": {
        const col = Math.min(c.col, this.width - 2);
        this.setCursor({ col: c.col, row: c.row });
        this.requestSwap(col, c.row);
        return true;
      }
      default:
        return false;
    }
    const cur = this.cursor!;
    this.selected = null;
    this.cb.onHover(Math.min(cur.col, this.width - 2), cur.row);
    return true;
  }
}
