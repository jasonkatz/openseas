import { CanvasSource, Container, FillGradient, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import { Special, type CoolingState, type ClearRound, type Piece } from "@openseas/engine";
import type { CoolingContent } from "@openseas/content";
import { drawFlash, mix, tileCanvas, type TileStyle, type TileTexture } from "./tiles.js";
import { HULL, hullFrame, hullGradient } from "../hull.js";
import { KitBoard } from "../kit/board.js";

export interface RendererCallbacks {
  /** The player asked to swap (col,row) with (col+1,row). */
  onSwap(col: number, row: number): void;
  /** The player is considering a swap; the page can show a preview. */
  onHover(col: number, row: number): void;
  onHoverEnd(): void;
  /** Called on the first frame drawn once a new state has finished playing out. */
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
  showMarks: boolean;
  /** Labels drawn inside special tiles, from the message table. */
  labels: { charge: string; magnet: string; slag: string };
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
  flash: Sprite;
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
  /** Landing squash, 1 right after arriving, decaying to 0. */
  squash: number;
  /** Ms since this piece started clearing, or null while it lives. */
  dying: number | null;
  /** Clearing is silent when the piece is only being retired by a fast-forward. */
  quiet: boolean;
}

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  spin: number;
  life: number;
  max: number;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
  rise: number;
  scale: number;
}

interface Ring {
  g: Graphics;
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: number;
  width: number;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  wobble: number;
}

type Step = () => number | "settle";

const COLORS = {
  wellTop: 0x15253f,
  wellBottom: 0x070f1c,
  // The ship's heat: a glowing body under the line, a hot rim, embers and vented steam.
  heat: 0xd9541f,
  heatDeep: 0x3a0f0b,
  glow: 0xffc27a,
  steam: 0xd8f4ff,
  danger: 0xf0604d,
  brass: 0xd4a548,
  brassLight: 0xf5d58a,
  select: 0xf2f0e6,
  preview: 0x5ed3b8,
  magnet: 0x070e1a,
};

const SWAP_MS = 120;
const CLEAR_MS = 190;
const DIE_MS = 230;
/** A kick's rattle fades out over this long: the kit's straight fade, fitted to the board's old decay. */
const SHAKE_MS = 150;
/** No input for this long in a hinted round and the board points at a scoring swap. */
const HINT_IDLE_MS = 6000;

/** Streak milestones that earn a callout and a fanfare: 3, 5, 8, 12, then every 5. */
export function streakMilestone(combo: number): boolean {
  return combo === 3 || combo === 5 || combo === 8 || combo === 12 || (combo > 12 && combo % 5 === 0);
}

const linear = (vertical: boolean, stops: readonly number[]): FillGradient =>
  new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
    colorStops: stops.map((color, i) => ({ offset: i / (stops.length - 1), color })),
    textureSpace: "local",
  });

const easeOutBack = (t: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * PixiJS view of a Cooling state, on the kit's lifecycle (ADR 0040). Pure presentation: it never
 * touches the engine. A move plays out as a timeline (swap, then each cascade step: clear, rise,
 * settle) built from the move report, so the player sees every chain; the board is busy until the
 * timeline has run and every piece has landed. A new move fast-forwards whatever is still playing,
 * so input never waits on animation.
 */
export class CoolingRenderer extends KitBoard<CoolingState> {
  /** The well and everything in it, scaled about its centre by a punch. */
  private readonly board = new Container();
  /** Frame and well never change between layouts, so they render once into a cached texture. */
  private readonly staticLayer = new Container();
  private readonly border = new Graphics();
  private readonly glow = new Graphics();
  private readonly well = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly heatBack = new Graphics();
  private readonly heatLayer = new Graphics();
  private readonly gauge = new Graphics();
  private readonly overlay = new Graphics();
  private readonly fxLayer = new Container();
  private readonly calloutLayer = new Container();
  private readonly pieces = new Map<number, PieceView>();
  private readonly particles: Particle[] = [];
  private readonly popups: Popup[] = [];
  private readonly rings: Ring[] = [];
  private readonly bubbles: Bubble[] = [];
  private readonly colorByKind = new Map<number, number>();
  private readonly markByKind = new Map<number, string>();
  private readonly textureByKind = new Map<number, TileTexture>();
  private readonly textures = new Map<number, Texture>();
  private readonly hullFill = hullGradient(true, [HULL.plateTop, HULL.plateMid, HULL.plateBottom]);
  private readonly wellFill = linear(true, [COLORS.wellTop, COLORS.wellBottom]);
  private readonly heatFill = linear(true, [COLORS.heat, COLORS.heatDeep]);
  private readonly dangerFill = linear(true, [mix(COLORS.heat, 0xff2d2d, 0.6), mix(COLORS.heatDeep, 0xff2d2d, 0.12)]);
  private flashTex: Texture = Texture.WHITE;
  private sparkTex: Texture = Texture.WHITE;
  private cell = 48;
  private pad = 10;
  private ox = 0;
  private oy = 0;
  private width = 6;
  private height = 12;
  private heatTarget = 0;
  private heatShown = 0;
  private combo = 0;
  private comboShown = 0;
  private selected: { col: number; row: number } | null = null;
  private cursor: { col: number; row: number } | null = null;
  private hoverPair: { col: number; row: number } | null = null;
  /** Overheated swaps hold the board until `lockedUntil` (renderer time, ms). */
  private lockedUntil = 0;
  private slowPair: { col: number; row: number } | null = null;
  private denied: { col: number; row: number; at: number } | null = null;
  private slideMs = SWAP_MS;
  private previewCells: readonly number[] = [];
  private dragStart: { col: number; row: number; x: number; y: number } | null = null;
  private dragDx = 0;
  private holdTimer: number | null = null;
  private steps: Step[] = [];
  private waitMs = 0;
  private waitSettle = 0;
  private moving = false;
  /** Board punch: a brief scale-up on big clears, decaying to 0. */
  private punch = 0;
  private hints = false;
  private lastInputAt = 0;
  private hint: { col: number; row: number } | null = null;
  private hintCheckedAt = -1;
  private sparkClock = 0;

  constructor(
    host: HTMLElement,
    content: CoolingContent,
    private readonly cb: RendererCallbacks,
    private readonly opts: RendererOptions,
  ) {
    super(host, "cooling", cb.onFrame, opts.showMarks);
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, parseInt(p.color.slice(1), 16));
      this.markByKind.set(i, p.mark);
      this.textureByKind.set(i, p.texture);
    });
    this.colorByKind.set(Special.Charge, parseInt(content.specials.charge.color.slice(1), 16));
    this.colorByKind.set(Special.Magnet, parseInt(content.specials.magnet.color.slice(1), 16));
    this.colorByKind.set(Special.Slag, parseInt(content.specials.slag.color.slice(1), 16));
  }

  private styleFor(kind: number): TileStyle {
    const color = this.colorByKind.get(kind) ?? 0xffffff;
    const special = kind === Special.Charge ? "charge" : kind === Special.Magnet ? "magnet" : kind === Special.Slag ? "slag" : null;
    return {
      color,
      texture: special ? null : (this.textureByKind.get(kind) ?? null),
      mark: special ? null : (this.markByKind.get(kind) ?? null),
      special,
      label: special ? this.opts.labels[special] : "",
      showMarks: this.showMarks,
    };
  }

  /** Fx color for a kind: specials burst in their accent rather than their dark body. */
  private fxColor(kind: number): number {
    if (kind === Special.Charge) return 0xffb347;
    if (kind === Special.Magnet) return 0xc084fc;
    if (kind === Special.Slag) return 0xf2f0e6;
    return this.colorByKind.get(kind) ?? 0xffffff;
  }

  /** Marks change only the tiles' art, so a toggle bakes the tiles again and leaves a move playing out. */
  override setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    if (this.isReady) this.bakeTiles();
  }

  /** Special labels are baked into textures, so the board waits (briefly) for the webfont before its canvas. */
  protected override async beforeCanvas(): Promise<void> {
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
  }

  protected build(): void {
    this.pieceLayer.sortableChildren = true;
    this.staticLayer.addChild(this.border, this.well);
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    this.board.addChild(this.staticLayer, this.glow, this.heatBack, this.pieceLayer, this.heatLayer, this.gauge, this.overlay, this.fxLayer, this.calloutLayer);
    this.world.addChild(this.board);
  }

  protected override dispose(): void {
    this.cancelHold();
    for (const tex of this.textures.values()) tex.destroy(true);
    for (const f of [this.hullFill, this.wellFill, this.heatFill, this.dangerFill]) f.destroy();
  }

  protected override onInteractive(on: boolean): void {
    if (!on) {
      this.selected = null;
      this.dragStart = null;
      this.hoverPair = null;
      this.previewCells = [];
    }
  }

  /** A move is still playing out: steps left on its timeline, a wait between them, or pieces sliding and rising. */
  protected override get busy(): boolean {
    return super.busy || this.steps.length > 0 || this.waitMs > 0 || this.moving;
  }

  /** Idle hints, for unrated practice only: a rated round is the player's own work. */
  override setHints(on: boolean): void {
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

  /** Show a new engine state. The report of the move that led to it plays as a timeline; anything else snaps. */
  protected onState(state: CoolingState, prev: CoolingState | null): void {
    const report = state.lastMove;
    this.combo = state.combo;
    if (state.config.width !== this.width || state.config.height !== this.height) {
      this.width = state.config.width;
      this.height = state.config.height;
      this.layout(this.app.screen.width, this.app.screen.height);
    }
    this.heatTarget = state.heatRow;
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
      this.burst(this.cx(col) + this.cell / 2, this.cy(row), COLORS.glow, 5);
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
      this.callout(this.opts.streakLabel(shown.milestone), 2 + Math.min(4, shown.milestone / 3), 0x8ff0d8);
      this.ring((this.width * this.cell) / 2, (this.height * this.cell) / 2, this.cell, this.cell * 6, COLORS.brassLight, 700, 0.08);
    }
    if (shown.heatRows < 0) {
      // Vented: the line puffs steam where it settles.
      const top = (this.height - state.heatRow) * this.cell;
      for (let k = 0; k < this.width; k++) this.burst(this.cx(k), top, COLORS.steam, this.reduced ? 1 : 3, 0.6);
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
    const tile = new Sprite(this.textures.get(p.kind) ?? Texture.WHITE);
    tile.anchor.set(0.5);
    const flash = new Sprite(this.flashTex);
    flash.anchor.set(0.5);
    // Hidden until the piece clears: an additive sprite on every tile would split the batch per piece.
    flash.visible = false;
    flash.blendMode = "add";
    c.addChild(tile, flash);
    c.position.set(x, y);
    this.pieceLayer.addChild(c);
    const v: PieceView = { c, tile, flash, kind: p.kind, x, y, tx: x, ty: y, vy: 0, sx: x, slide: 1, slideDir: 0, slideMs: SWAP_MS, slideSlow: false, squash: 0, dying: null, quiet: false };
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
    v.flash.visible = !quiet;
    v.c.zIndex = 10;
  }

  /** One cascade step: pop the cleared pieces with debris, score popups, and a callout for chains. */
  private clear(round: ClearRound): void {
    this.cb.onClear(round);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const group of round.groups) {
      for (const id of group.ids) {
        const v = this.pieces.get(id);
        if (!v || v.dying !== null) continue;
        this.kill(v, false);
        sx += v.x;
        sy += v.y;
        n++;
        this.burst(v.x, v.y, this.fxColor(v.kind), group.cause === "match" ? 5 + Math.min(5, group.ids.length - 3) : 9);
      }
      if (group.cause === "match" && group.ids.length) {
        const center = this.centerOf(group.ids);
        const first = this.pieces.get(group.ids[0]!);
        const big = group.ids.length >= 5;
        this.ring(center.x, center.y, this.cell * 0.3, this.cell * (big ? 2.2 : 1.3), first ? this.fxColor(first.kind) : COLORS.select, big ? 480 : 340, big ? 0.1 : 0.06);
        if (big) this.bump(0.03 + Math.min(0.03, (group.ids.length - 5) * 0.01));
      }
      if (group.cause === "charge" && group.ids.length) {
        const center = this.centerOf(group.ids);
        this.ring(center.x, center.y, this.cell * 0.3, this.cell * 2.1, 0xffb347, 420, 0.14);
        this.ring(center.x, center.y, this.cell * 0.2, this.cell * 1.4, 0xfff1c9, 260, 0.08);
        this.kick(0.22);
        this.bump(0.05);
      } else if (group.cause === "magnet" && group.ids.length) {
        const center = this.centerOf(group.ids);
        this.ring(center.x, center.y, this.cell * 0.4, this.cell * 4.5, 0xc084fc, 620, 0.1);
        this.kick(0.12);
        this.bump(0.04);
      } else if (group.cause === "slag") {
        const center = this.centerOf(group.ids);
        this.ring(center.x, center.y, this.cell * 0.3, this.cell * 0.9, COLORS.select, 360, 0.06);
      }
    }
    const groups = round.groups.length;
    if (groups > 1 || round.chain > 1) this.kick(0.04 * Math.min(4, groups + round.chain - 1));
    if (n > 0 && round.points > 0) {
      const mult = round.chain > 1 ? ` ×${round.chain}` : groups > 1 ? ` ×${groups}` : "";
      this.popup(sx / n, sy / n, `+${round.points}${mult}`, round.chain >= 3 ? 0xff9a6b : round.chain === 2 || groups > 1 ? COLORS.brassLight : COLORS.select, 0.46 + Math.min(0.24, round.points / 400));
    }
    const runs = round.groups.filter((g) => g.cause === "match" && g.ids.length >= 3).length;
    const lines: string[] = [];
    if (runs >= 2) lines.push(this.opts.multiLabel(runs));
    if (round.chain >= 2) lines.push(this.opts.chainLabel(round.chain));
    if (lines.length) this.callout(lines.join("\n"), round.chain + (runs >= 2 ? runs - 1 : 0));
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

  private burst(x: number, y: number, color: number, count: number, speedScale = 1): void {
    if (this.reduced) count = Math.ceil(count / 3);
    for (let k = 0; k < count; k++) {
      const s = new Sprite(this.sparkTex);
      s.anchor.set(0.5);
      s.tint = mix(color, 0xffffff, Math.random() * 0.35);
      const a = rand(0, Math.PI * 2);
      const speed = this.cell * rand(0.0025, 0.007) * speedScale;
      s.position.set(x + Math.cos(a) * this.cell * 0.2, y + Math.sin(a) * this.cell * 0.2);
      s.scale.set(rand(0.55, 1.1));
      s.rotation = rand(0, Math.PI);
      this.fxLayer.addChild(s);
      this.particles.push({ s, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - this.cell * 0.002, spin: rand(-0.012, 0.012), life: 0, max: rand(380, 620) });
    }
  }

  private ring(x: number, y: number, r0: number, r1: number, color: number, max: number, width: number): void {
    const g = new Graphics();
    this.fxLayer.addChild(g);
    this.rings.push({ g, x, y, r0, r1, life: 0, max, color, width: this.cell * width });
  }

  private popup(x: number, y: number, text: string, color: number, size: number): void {
    const t = new Text({
      text,
      style: {
        fontFamily: "Fraunces, Georgia, serif",
        fontSize: Math.max(15, this.cell * size),
        fontWeight: "800",
        fill: color,
        stroke: { color: COLORS.magnet, width: Math.max(3, this.cell * 0.09), join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.5, blur: 4, distance: 2, angle: Math.PI / 2 },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    const margin = t.width / 2 + 4;
    t.position.set(Math.min(Math.max(x, margin - this.pad), this.width * this.cell - margin + this.pad), y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: 950, y0: t.y, rise: this.cell * 0.9, scale: 1 });
  }

  private callout(text: string, chain: number, color?: number): void {
    for (const p of this.popups) if (p.t.parent === this.calloutLayer) p.life = Math.max(p.life, p.max - 120);
    const t = new Text({
      text,
      style: {
        fontFamily: "Fraunces, Georgia, serif",
        fontStyle: "italic",
        fontSize: Math.max(26, this.cell * (0.8 + Math.min(0.5, chain * 0.08))),
        fontWeight: "900",
        fill: color ?? (chain >= 4 ? 0xff9a6b : COLORS.brassLight),
        align: "center",
        stroke: { color: COLORS.magnet, width: Math.max(4, this.cell * 0.12), join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3, angle: Math.PI / 2 },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set((this.width * this.cell) / 2, this.height * this.cell * 0.42);
    t.rotation = -0.06;
    this.calloutLayer.addChild(t);
    this.popups.push({ t, life: 0, max: 900, y0: t.y, rise: this.cell * 0.4, scale: 1.15 });
  }

  /** Rattle the board by `amount` of half a cell: the kit's shake, which sits still for reduced motion. */
  private kick(amount: number): void {
    this.fx.shake(amount * this.cell * 0.5, SHAKE_MS);
  }

  private bump(amount: number): void {
    if (this.reduced) return;
    this.punch = Math.min(0.07, Math.max(this.punch, amount));
  }

  // ---- layout and baking

  protected layout(w: number, h: number): void {
    // The frame is kept thin so the tiles get as much of the screen as possible.
    const padFor = (cell: number): number => Math.max(6, Math.round(cell * 0.15));
    let cell = Math.floor(Math.min(w / this.width, h / this.height));
    cell = Math.floor(Math.min((w - padFor(cell) * 2 - 2) / this.width, (h - padFor(cell) * 2 - 2) / this.height));
    this.cell = Math.max(12, cell);
    this.pad = padFor(this.cell);
    this.ox = Math.floor((w - this.cell * this.width) / 2);
    this.oy = Math.floor((h - this.cell * this.height) / 2);
    this.board.pivot.set((this.cell * this.width) / 2, (this.cell * this.height) / 2);
    this.board.position.set(this.ox + this.board.pivot.x, this.oy + this.board.pivot.y);
    this.drawFrame();
    this.bakeTiles();
    if (this.state) this.place(this.state.cells, true);
    this.steps = [];
    this.bubbles.length = 0;
  }

  private drawFrame(): void {
    const g = this.border;
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    const p = this.pad;
    g.clear();
    // A riveted gunmetal frame around the well.
    hullFrame(g, this.hullFill, { x: -p, y: -p, w: W + p * 2, h: H + p * 2, r: p + 4 }, { x: 0, y: 0, w: W, h: H }, { rivetStep: this.cell * 2 });

    const w = this.well;
    w.clear();
    w.rect(0, 0, W, H).fill(this.wellFill);
    const inset = this.cell * 0.06;
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        w.roundRect(c * this.cell + inset, r * this.cell + inset, this.cell - inset * 2, this.cell - inset * 2, this.cell * 0.16).fill({ color: 0xffffff, alpha: 0.035 });
      }
    }
    w.rect(0, 0, W, H).stroke({ width: 3, color: 0x000000, alpha: 0.55, alignment: 1 });
    this.staticLayer.updateCacheTexture();
  }

  /** Bake each kind's tile, the clear flash, and the debris spark to textures at the current size. */
  private bakeTiles(): void {
    const resolution = this.app.renderer.resolution;
    const old = [...this.textures.values()];
    const s = this.cell;
    for (const kind of this.colorByKind.keys()) {
      const canvas = tileCanvas(s, this.styleFor(kind), resolution);
      this.textures.set(kind, new Texture({ source: new CanvasSource({ resource: canvas, resolution }) }));
    }
    // The kit keeps these until its next layout. Their keys carry the size, since a lab config of
    // another size lays the board out again from `onState`, before the kit drops what it baked.
    this.flashTex = this.bake(`flash@${s}`, s, (g) => drawFlash(g, s));
    const k = Math.max(3, s * 0.1);
    this.sparkTex = this.bake(`spark@${k}`, k * 2, (g) => g.roundRect(-k, -k, k * 2, k * 2, k * 0.5).fill(0xffffff));
    for (const v of this.pieces.values()) {
      v.tile.texture = this.textures.get(v.kind) ?? Texture.WHITE;
      v.flash.texture = this.flashTex;
    }
    for (const p of this.particles) p.s.texture = this.sparkTex;
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

  protected override update(dt: number): void {
    this.runSteps(dt);
    this.movePieces(dt);
    this.moveFx(dt);
    if (this.punch > 0.001) {
      this.board.scale.set(1 + this.punch);
      this.punch *= Math.pow(0.8, dt / 16.67);
    } else if (this.punch !== 0) {
      this.punch = 0;
      this.board.scale.set(1);
    }
    this.updateHint();
    this.emitSparks(dt);
    const k = Math.min(1, dt / 16.67);
    this.heatShown += (this.heatTarget - this.heatShown) * Math.min(1, 0.06 * k);
    if (Math.abs(this.heatTarget - this.heatShown) < 0.003) this.heatShown = this.heatTarget;
    this.comboShown += (Math.min(8, this.combo) - this.comboShown) * Math.min(1, 0.1 * k);
    this.drawHeat(dt);
    this.drawGlow();
    this.drawOverlay();
  }

  /** After a quiet spell in a hinted round, pick a scoring swap to point at. */
  private updateHint(): void {
    if (!this.hints || !this.interactive || this.busy || this.time < this.lockedUntil) {
      this.hint = null;
      this.hintCheckedAt = -1;
      return;
    }
    if (this.time - this.lastInputAt < HINT_IDLE_MS) return;
    if (this.hint || this.hintCheckedAt === this.lastInputAt) return;
    this.hintCheckedAt = this.lastInputAt;
    this.hint = this.cb.findHint();
  }

  /** Lit charges throw the odd spark from their fuse, so a charge on the board catches the eye. */
  private emitSparks(dt: number): void {
    if (this.reduced) return;
    this.sparkClock += dt;
    if (this.sparkClock < 140) return;
    this.sparkClock = 0;
    for (const v of this.pieces.values()) {
      if (v.kind !== Special.Charge || v.dying !== null || Math.random() > 0.3) continue;
      const fx = v.x + this.cell * 0.18;
      const fy = v.y - this.cell * (this.cell >= 36 ? 0.26 : 0.19);
      const s = new Sprite(this.sparkTex);
      s.anchor.set(0.5);
      s.tint = Math.random() > 0.5 ? 0xffd27a : 0xffb347;
      s.scale.set(rand(0.25, 0.45));
      s.position.set(fx, fy);
      this.fxLayer.addChild(s);
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const speed = this.cell * rand(0.0015, 0.0035);
      this.particles.push({ s, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, spin: rand(-0.02, 0.02), life: 0, max: rand(260, 420) });
    }
  }

  /**
   * The kinds actually on screen, bottom row first, which the kit writes to the canvas once the board
   * settles. The smoke test compares it with the engine's board so the view can never silently diverge.
   */
  protected view(): string {
    const kinds = new Array<string>(this.width * this.height).fill("?");
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const col = Math.round(v.tx / this.cell - 0.5);
      const row = this.height - 1 - Math.round(v.ty / this.cell - 0.5);
      if (col >= 0 && col < this.width && row >= 0 && row < this.height) kinds[row * this.width + col] = String(v.kind);
    }
    return kinds.join(",");
  }

  private movePieces(dt: number): void {
    const accel = this.cell * 0.00018;
    const vmax = this.cell * 0.032;
    let moving = false;
    const drag = this.dragStart && Math.abs(this.dragDx) > 2 ? this.dragStart : null;
    for (const [id, v] of this.pieces) {
      if (v.dying !== null) {
        v.dying += dt;
        const t = v.dying / (v.quiet ? 120 : DIE_MS);
        if (v.quiet) {
          v.c.alpha = Math.max(0, 1 - t);
        } else {
          const grow = t < 0.3 ? 1 + 0.18 * easeOutCubic(t / 0.3) : 1.18 * (1 - easeOutCubic((t - 0.3) / 0.7) * 0.85);
          v.c.scale.set(grow);
          v.flash.alpha = t < 0.3 ? 0.85 * (t / 0.3) : 0.85 * Math.max(0, 1 - (t - 0.3) / 0.4);
          v.c.alpha = t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.55);
        }
        if (t >= 1) this.remove(id);
        continue;
      }
      if (v.y > v.ty) {
        v.vy = Math.min(vmax, v.vy + accel * dt);
        v.y = Math.max(v.ty, v.y - v.vy * dt);
        if (v.y === v.ty) {
          v.squash = Math.min(1, v.vy / vmax + 0.25);
          v.vy = 0;
        }
        moving = true;
      } else if (v.y < v.ty) {
        v.y = v.ty;
        v.vy = 0;
      }
      let arc = 0;
      let pop = 0;
      if (v.slide < 1) {
        // Reduced motion shortens ordinary slides; an overheated slide is a gameplay cost and stays.
        v.slide = Math.min(1, v.slide + dt / (v.slideSlow || !this.reduced ? v.slideMs : 60));
        const e = v.slideSlow ? easeInOutSine(v.slide) : easeOutBack(v.slide);
        v.x = v.sx + (v.tx - v.sx) * e;
        arc = Math.sin(Math.PI * v.slide) * this.cell * (v.slideSlow ? 0.05 : 0.1) * v.slideDir;
        pop = v.slideSlow ? 0 : Math.sin(Math.PI * v.slide) * 0.08;
        v.c.zIndex = v.slideDir < 0 ? 2 : 1;
        if (v.slide === 1) {
          v.x = v.tx;
          v.c.zIndex = 0;
        }
        moving = true;
      } else v.x = v.tx;
      if (v.squash > 0.01) v.squash *= Math.pow(0.8, dt / 16.67);
      else v.squash = 0;

      let nudge = 0;
      const col = Math.round(v.tx / this.cell - 0.5);
      const row = this.height - 1 - Math.round(v.ty / this.cell - 0.5);
      if (drag && drag.row === row) {
        const d = Math.max(-this.cell * 0.4, Math.min(this.cell * 0.4, this.dragDx));
        if (drag.col === col) nudge = d;
        else if ((d > 0 && col === drag.col + 1) || (d < 0 && col === drag.col - 1)) nudge = -d * 0.5;
      }
      const lifted = this.selected && this.selected.col === col && this.selected.row === row ? 0.06 + Math.sin(this.time * 0.008) * 0.02 : 0;
      const sq = v.squash * 0.1;
      // Submerged pieces sway with the heat; at rest only, so moving pieces stay crisp.
      let sway = 0;
      let rot = 0;
      if (!this.reduced && v.slide === 1 && v.y === v.ty && row < this.heatShown - 0.2) {
        const ph = this.time * 0.0019 + col * 0.9 + row * 0.6;
        sway = Math.sin(ph) * this.cell * 0.022;
        rot = Math.sin(ph + 0.8) * 0.025;
      }
      // A hinted pair wiggles in short bursts.
      if (this.hint && this.hint.row === row && (col === this.hint.col || col === this.hint.col + 1)) {
        const cycle = (this.time - this.lastInputAt - HINT_IDLE_MS) % 1500;
        if (cycle < 520) rot += Math.sin(cycle * 0.045) * 0.13 * (1 - cycle / 520);
      }
      v.c.rotation = rot;
      v.c.position.set(v.x + nudge + sway, v.y + arc + sq * this.cell * 0.3);
      // Pieces rising from below the board fade in out of the murk instead of being masked.
      const below = (v.y - (this.height - 0.5) * this.cell) / this.cell;
      v.c.visible = below < 1;
      v.c.alpha = below > 0 ? 1 - below : 1;
      const breathe = v.kind === Special.Magnet || v.kind === Special.Charge ? Math.sin(this.time * 0.005 + v.tx) * 0.025 : 0;
      v.c.scale.set(1 + pop + lifted + breathe + sq * 0.5, 1 + pop + lifted + breathe - sq);
    }
    this.moving = moving;
  }

  private moveFx(dt: number): void {
    const gravity = this.cell * 0.000012;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      p.vx *= Math.pow(0.985, dt / 16.67);
      p.vy += gravity * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      const t = p.life / p.max;
      p.s.alpha = 1 - t * t;
      if (t >= 1) {
        p.s.destroy();
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life += dt;
      const t = Math.min(1, r.life / r.max);
      const e = easeOutCubic(t);
      r.g.clear().circle(r.x, r.y, r.r0 + (r.r1 - r.r0) * e).stroke({ width: r.width * (1 - t * 0.7), color: r.color, alpha: 0.85 * (1 - t) });
      if (t >= 1) {
        r.g.destroy();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const t = p.life / p.max;
      const pop = easeOutBack(Math.min(1, p.life / 200));
      p.t.scale.set(p.scale * (0.4 + 0.6 * pop));
      p.t.y = p.y0 - p.rise * easeOutCubic(Math.min(1, t));
      p.t.alpha = t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
      if (t >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
  }

  private drawHeat(dt: number): void {
    const g = this.heatLayer;
    const back = this.heatBack;
    const gauge = this.gauge;
    g.clear();
    back.clear();
    gauge.clear();
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    const danger = this.heatShown >= this.height * 0.5;
    if (this.heatShown <= 0.01) return;
    const top = (this.height - this.heatShown) * this.cell;
    const amp = this.cell * 0.07;
    const steps = 30;
    const wave = (i: number, phase: number): number =>
      Math.max(2, top + Math.sin(this.time * 0.0021 + i * 0.5 + phase) * amp + Math.sin(this.time * 0.0033 + i * 1.15) * amp * 0.45);
    const pts: number[] = [0, H];
    const line: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = (W * i) / steps;
      const y = wave(i, 0);
      pts.push(x, y);
      line.push(x, y);
    }
    pts.push(W, H);
    // The body sits behind the tiles and only a light film in front, so kinds stay readable overheated.
    back.poly(pts).fill({ fill: danger ? this.dangerFill : this.heatFill, alpha: 0.75 });
    g.poly(pts).fill({ color: danger ? mix(COLORS.heat, 0xff2d2d, 0.6) : COLORS.heat, alpha: 0.13 });
    // A lagging second crest gives the surface depth, then a bright foam line on top.
    const crest: number[] = [];
    for (let i = 0; i <= steps; i++) crest.push((W * i) / steps, Math.max(2, wave(i, 1.9) - amp * 0.6));
    g.poly(crest, false).stroke({ width: Math.max(1, this.cell * 0.035), color: COLORS.glow, alpha: 0.22 });
    g.poly(line, false).stroke({ width: Math.max(3, this.cell * 0.12), color: COLORS.heat, alpha: 0.35 });
    g.poly(line, false).stroke({ width: Math.max(1.5, this.cell * 0.05), color: COLORS.glow, alpha: 0.85 });

    // Embers drift up through the heat and wink out at the line.
    const want = this.reduced ? 0 : Math.round(4 + this.heatShown * 1.2);
    while (this.bubbles.length < want) {
      this.bubbles.push({ x: rand(0, W), y: rand(top, H), r: this.cell * rand(0.03, 0.08), speed: this.cell * rand(0.0008, 0.002), wobble: rand(0, 6) });
    }
    this.bubbles.length = Math.min(this.bubbles.length, want);
    for (const b of this.bubbles) {
      b.y -= b.speed * dt;
      if (b.y < top + b.r) {
        b.y = H - b.r;
        b.x = rand(0, W);
      }
      const x = b.x + Math.sin(this.time * 0.003 + b.wobble) * this.cell * 0.06;
      const fade = Math.min(1, (b.y - top) / (this.cell * 0.8));
      g.circle(x, b.y, b.r * 1.8).fill({ color: COLORS.heat, alpha: 0.18 * fade });
      g.circle(x, b.y, b.r * 0.7).fill({ color: COLORS.glow, alpha: 0.7 * fade });
    }

    // Heat-line markers on the planking, red once the heat is half full.
    const p = this.pad;
    const mark = danger ? COLORS.danger : COLORS.preview;
    const m = Math.max(4, p * 0.45);
    gauge.poly([-p, top - m, -p + m * 1.1, top, -p, top + m]).fill({ color: mark, alpha: danger ? 0.7 + 0.3 * Math.sin(this.time * 0.01) : 0.9 });
    gauge.poly([W + p, top - m, W + p - m * 1.1, top, W + p, top + m]).fill({ color: mark, alpha: danger ? 0.7 + 0.3 * Math.sin(this.time * 0.01) : 0.9 });
  }

  /** A brass glow around the well that grows with the combo. */
  private drawGlow(): void {
    const g = this.glow;
    g.clear();
    const c = this.comboShown;
    if (c < 0.05) return;
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    const strength = Math.min(1, c / 6);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * (0.004 + strength * 0.004));
    const color = c >= 6 ? 0xff9a6b : COLORS.brass;
    for (let k = 0; k < 3; k++) {
      const grow = 2 + k * 3;
      g.roundRect(-grow, -grow, W + grow * 2, H + grow * 2, 4 + grow).stroke({ width: 3, color, alpha: strength * pulse * (0.55 - k * 0.16) });
    }
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const s = this.cell;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 0.009);
    const rr = s * 0.18;
    for (const c of this.previewCells) {
      const col = c % this.width;
      const row = Math.floor(c / this.width);
      const x = col * s;
      const y = (this.height - row - 1) * s;
      g.roundRect(x + 3, y + 3, s - 6, s - 6, rr).fill({ color: COLORS.preview, alpha: 0.12 + 0.12 * pulse });
      g.roundRect(x + 2, y + 2, s - 4, s - 4, rr).stroke({ width: 2, color: COLORS.preview, alpha: 0.6 + 0.35 * pulse });
    }
    const pair = (col: number, row: number, color: number, alpha: number): void => {
      const c = Math.max(0, Math.min(this.width - 2, col));
      const x = c * s;
      const y = (this.height - row - 1) * s;
      g.roundRect(x + 1, y + 1, s * 2 - 2, s - 2, rr + 2).stroke({ width: Math.max(2, s * 0.06), color, alpha });
      // A small swap tick between the two cells.
      const mx = x + s;
      const my = y + s / 2;
      const a = s * 0.09;
      g.poly([mx - a * 1.6, my, mx - a * 0.4, my - a, mx - a * 0.4, my + a]).fill({ color, alpha });
      g.poly([mx + a * 1.6, my, mx + a * 0.4, my - a, mx + a * 0.4, my + a]).fill({ color, alpha });
    };
    if (this.hint) pair(this.hint.col, this.hint.row, COLORS.preview, 0.35 + 0.35 * pulse);
    if (this.slowPair && this.time < this.lockedUntil) pair(this.slowPair.col, this.slowPair.row, COLORS.glow, 0.45 + 0.4 * pulse);
    if (this.denied && this.time - this.denied.at < 260) pair(this.denied.col, this.denied.row, COLORS.danger, 1 - (this.time - this.denied.at) / 260);
    if (this.hoverPair && !this.selected) pair(this.hoverPair.col, this.hoverPair.row, COLORS.brass, 0.55);
    if (this.cursor && this.interactive) pair(this.cursor.col, this.cursor.row, COLORS.brass, 0.95);
    if (this.selected) {
      const { col, row } = this.selected;
      const x = col * s;
      const y = (this.height - row - 1) * s;
      g.roundRect(x - 1, y - 1, s + 2, s + 2, rr + 2).stroke({ width: Math.max(2.5, s * 0.07), color: COLORS.select, alpha: 0.7 + 0.3 * pulse });
      // Chevrons point at the two pieces it can swap with.
      const a = s * 0.11;
      const my = y + s / 2;
      if (col > 0) g.poly([x - a * 0.2, my - a, x - a * 1.2, my, x - a * 0.2, my + a]).fill({ color: COLORS.select, alpha: 0.5 + 0.5 * pulse });
      if (col < this.width - 1) g.poly([x + s + a * 0.2, my - a, x + s + a * 1.2, my, x + s + a * 0.2, my + a]).fill({ color: COLORS.select, alpha: 0.5 + 0.5 * pulse });
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

  protected override pointerDown(x: number, y: number, e: FederatedPointerEvent): void {
    this.noteInput();
    const cell = this.cellAt(x, y);
    if (!cell) return;
    this.dragStart = { ...cell, x, y };
    this.dragDx = 0;
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    if (e.pointerType === "touch") {
      this.holdTimer = window.setTimeout(() => this.hover(cell), 220);
    }
  }

  protected override pointerMove(x: number, y: number, e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const cell = this.cellAt(x, y);
    if (this.dragStart) {
      const dx = x - this.dragStart.x;
      this.dragDx = Math.abs(y - this.dragStart.y) < this.cell * 0.8 ? dx : 0;
      if (Math.abs(dx) > this.cell * 0.45 && Math.abs(y - this.dragStart.y) < this.cell * 0.8) {
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

  protected override pointerUp(x: number, y: number, e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    this.cancelHold();
    const start = this.dragStart;
    this.dragStart = null;
    this.dragDx = 0;
    const cell = this.cellAt(x, y);
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

  /** A release off the canvas, or a touch the browser took over: the drag ends where it is. */
  protected override pointerCancel(): void {
    this.cancelHold();
    this.dragStart = null;
    this.dragDx = 0;
    this.hoverEnd();
  }

  protected override pointerLeave(): void {
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
  override keyboard(key: string): boolean {
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
