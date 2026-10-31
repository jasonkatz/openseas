import { Application, Container, FillGradient, Graphics, Text, type FederatedPointerEvent, type FederatedWheelEvent } from "pixi.js";
import {
  carpentryCheckPlacement,
  carpentryEffectiveGrain,
  carpentryExtent,
  carpentryHoleIndex,
  carpentryOrient,
  type CarpentryPlacementCheck,
  type CarpentryState,
  type Grain,
  type HoleRating,
} from "@openseas/engine";
import type { CarpentryContent } from "@openseas/content";
import { mix } from "../bilging/tiles.js";
import { drawMark } from "../sailing/renderer.js";

export interface CarpentryCallbacks {
  /** The player nailed down the plank in `slot` at this orientation and origin. */
  onPlace(slot: number, rot: number, flip: boolean, col: number, row: number): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** A hole was patched on screen, with its rating. */
  onPatched(rating: HoleRating, chain: number): void;
  /** A plank landed on screen. */
  onNailed(waste: boolean): void;
  /** A hole widened on screen. */
  onGrew(): void;
  /** A new hole cracked open on screen. `opening` is true for the round's first holes. */
  onCracked(opening: boolean): void;
  /** The player picked, turned or flipped a plank, or moved the ghost by tap. */
  onNudge(): void;
  /** The player tried to nail a plank where it does not go. */
  onBump(): void;
}

export interface CarpentryRendererOptions {
  showMarks: boolean;
  ratingLabel(rating: HoleRating): string;
  streakLabel(count: number): string;
  grainLabel: string;
  grewLabel: string;
  /** The toolbar under a plank set down on the hull. */
  turnLabel: string;
  flipLabel: string;
  nailLabel: string;
}

type Oriented = Array<[number, number]>;

interface Flash {
  cells: readonly number[];
  color: number;
  life: number;
  max: number;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

/** A plank dropping onto the board: slides from where it was held to its cells and settles. */
interface Landing {
  plankId: number;
  cells: Oriented;
  kind: number;
  grain: Grain;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  waste: boolean;
  life: number;
  max: number;
}

/** A patched hole's plank lifting off the hull. Drawn in place while `delay` runs down. */
interface Lift {
  cells: Oriented;
  x: number;
  y: number;
  kind: number;
  grain: Grain;
  delay: number;
  life: number;
  max: number;
}

/** Sound hull over a hole that is about to crack open; shrinks away to reveal it. */
interface Cover {
  cells: readonly number[];
  delay: number;
  life: number;
  max: number;
  opening: boolean;
  grew: boolean;
}

/** A plank that would not go where it was dropped, flying back to its tray slot. */
interface Flyback {
  cells: Oriented;
  kind: number;
  grain: Grain;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  m0: number;
  m1: number;
  slot: number;
  life: number;
  max: number;
}

interface Timer {
  at: number;
  fn: () => void;
}

interface Drag {
  id: number;
  slot: number;
  /** Where the finger went down: a tray slot, the resting ghost, or bare hull. */
  from: "tray" | "ghost" | "board";
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
  touch: boolean;
  /** Anchor minus pointer, in cells, once the plank is in hand. */
  offX: number;
  offY: number;
}

type HudAction = "rotate" | "flip" | "nail";

const COLORS = {
  hullA: 0x6b4423,
  hullB: 0x5e3b1e,
  hullEdge: 0x3a2412,
  holeTop: 0x120c08,
  holeBottom: 0x05030a,
  brass: 0xd4a548,
  brassLight: 0xf5d58a,
  amber: 0xf0b445,
  legal: 0x5ed3b8,
  illegal: 0xf0604d,
  waste: 0xf0604d,
  trayBg: 0x1c2b48,
  ink: 0x0b1526,
};
const TRAY_ROWS = 3.1;
const LIFT_TOUCH = 1.15;
const MARK_GLYPH: Record<string, string> = { square: "■", diamond: "◆", triangle: "▲", hexagon: "⬢", circle: "●", star: "★" };
const FONT = "Atkinson Hyperlegible, sans-serif";
const DISPLAY = "Fraunces, Georgia, serif";

const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const easeIn = (k: number): number => k * k;

export class CarpentryRenderer {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly hull = new Graphics();
  private readonly holesG = new Graphics();
  private readonly holeFxG = new Graphics();
  private readonly planksG = new Graphics();
  private readonly markLayer = new Container();
  private readonly fxG = new Graphics();
  private readonly ghostG = new Graphics();
  private readonly trayG = new Graphics();
  private readonly trayPiecesG = new Graphics();
  private readonly trayText = new Container();
  private readonly hudG = new Graphics();
  private readonly hudText = new Container();
  private readonly dragG = new Graphics();
  private readonly textLayer = new Container();
  private readonly colorByKind = new Map<number, number>();
  private readonly markByKind = new Map<number, string>();
  private readonly holeFill = linear([COLORS.holeTop, COLORS.holeBottom]);
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private readonly flashes: Flash[] = [];
  private readonly popups: Popup[] = [];
  private readonly lifts: Lift[] = [];
  private readonly covers: Cover[] = [];
  private readonly timers: Timer[] = [];
  private landing: Landing | null = null;
  private flyback: Flyback | null = null;
  private shake: { life: number; max: number } | null = null;
  private refill: { slot: number; life: number; max: number } | null = null;
  private clock = 0;
  private showMarks: boolean;
  private cell = 36;
  private ox = 0;
  private oy = 0;
  private width = 9;
  private height = 12;
  private trayY = 0;
  private trayH = 0;
  private slotRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  private slotLabels: Text[] = [];
  private state: CarpentryState | null = null;
  private interactive = false;
  private destroyed = false;
  private framePending = false;
  private viewStale = true;
  private holeFxDirty = true;
  /** Selection: which tray slot, its orientation, and where the plank's centre sits (in cells, fractional). */
  private slot = 0;
  private rot = 0;
  private flip = false;
  private anchor: { cx: number; cy: number } | null = null;
  private cursor: { col: number; row: number } | null = null;
  private drag: Drag | null = null;
  /** The toolbar's buttons, in canvas pixels, while it shows. */
  private hudRects: Array<{ x: number; y: number; w: number; h: number; action: HudAction }> = [];
  private hudLabels: Text[] = [];
  private hudPressed: { action: HudAction; life: number } | null = null;
  /** True after touch input: the toolbar shows for a plank set down. A mouse hovers and clicks instead. */
  private touchUI = false;
  /** Where the plank was when the player nailed it, so the landing starts from there. */
  private pendingLand: { x: number; y: number; slot: number } | null = null;
  /** Where the last plank went, so the keyboard picks up from there after the ghost clears. */
  private lastOrigin: { col: number; row: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: CarpentryContent,
    private readonly cb: CarpentryCallbacks,
    private readonly opts: CarpentryRendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, parseInt(p.color.slice(1), 16));
      this.markByKind.set(i, p.mark);
    });
    this.width = content.config.width;
    this.height = content.config.height;
  }

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "carpentry-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    this.host.appendChild(this.app.canvas);
    this.root.addChild(this.hull, this.holesG, this.holeFxG, this.planksG, this.markLayer, this.fxG, this.ghostG, this.trayG, this.trayPiecesG, this.trayText, this.hudG, this.hudText, this.dragG, this.textLayer);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointermove", (e) => this.pointerMove(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", (e) => this.pointerCancel(e));
    this.app.stage.on("pointercancel", (e) => this.pointerCancel(e));
    this.app.stage.on("wheel", (e) => this.wheel(e));
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      this.holeFill.destroy();
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.drag = null;
      this.dragG.clear();
      this.drawTrayPieces();
    }
    this.drawGhost();
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    this.drawPlanks();
    this.drawTrayPieces();
  }

  /** A new engine state. Plays what the last move did and redraws everything. */
  setState(state: CarpentryState): void {
    if (!this.app.renderer) return;
    const prev = this.state;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    this.holeFxDirty = true;
    const rep = state.lastMove;
    const reset = !prev || prev === state || state.moveCount < prev.moveCount || (state.moveCount === prev.moveCount && state.lastMove === null);
    if (reset) {
      this.clearEffects();
      this.anchor = null;
      this.cursor = null;
      this.lastOrigin = null;
      this.pendingLand = null;
      // The round opens with the hull cracking: each hole breaks in turn.
      if (prev !== state) {
        state.holes.forEach((h, i) => this.covers.push({ cells: h.cells, delay: 120 + i * 140, life: 0, max: this.dur(320), opening: true, grew: false }));
      }
    } else if (prev && rep && rep.move.type === "place" && rep.placed) {
      this.playMove(prev, state);
    }
    if (this.slot >= state.slots.length) this.slot = 0;
    this.syncCursor();
    this.drawHoles();
    this.drawPlanks();
    this.drawTrayPieces();
    this.drawGhost();
  }

  private playMove(prev: CarpentryState, state: CarpentryState): void {
    const rep = state.lastMove!;
    if (rep.move.type !== "place" || !rep.placed) return;
    const plank = rep.placed.plank;
    const waste = rep.placed.wasteCells.length > 0;
    const rel = relative(plank.cells, this.width);
    const x1 = this.ox + rel.col * this.cell;
    const y1 = this.oy + rel.row * this.cell;
    const from = this.pendingLand && this.pendingLand.slot === rep.move.slot ? this.pendingLand : null;
    this.pendingLand = null;
    const landMs = this.dur(from && Math.hypot(from.x - x1, from.y - y1) > this.cell ? 170 : 110);
    if (this.landing) this.cb.onNailed(this.landing.waste);
    this.landing = {
      plankId: plank.id,
      cells: rel.cells,
      kind: plank.kind,
      grain: plank.grain,
      x0: from ? from.x : x1,
      y0: from ? from.y : y1 - this.cell * 0.45,
      x1,
      y1,
      waste,
      life: 0,
      max: landMs,
    };
    // Everything the landing caused waits for it to touch down.
    let t = landMs;
    if (rep.patched) {
      const patched = rep.patched;
      const gone = [...prev.planks.filter((p) => p.holeId === patched.holeId), plank];
      gone.forEach((p, i) => {
        const r = relative(p.cells, this.width);
        this.lifts.push({ cells: r.cells, x: this.ox + r.col * this.cell, y: this.oy + r.row * this.cell, kind: p.kind, grain: p.grain, delay: t + 60 + i * 50, life: 0, max: this.dur(460) });
      });
      this.at(t + 40, () => {
        this.flash(patched.cells, COLORS.brassLight, 650);
        const first = patched.cells[Math.floor(patched.cells.length / 2)]!;
        this.popup(this.cx(first % this.width), this.cy(Math.floor(first / this.width)), `+${patched.points}`, COLORS.brassLight, 0.55);
        const tone = patched.rating === "masterpiece" ? COLORS.brassLight : patched.rating === "pig" ? COLORS.illegal : 0xefe3c6;
        this.callout(this.opts.ratingLabel(patched.rating), tone, 0.3);
        if (patched.chain >= 2) this.callout(this.opts.streakLabel(patched.chain), COLORS.brassLight, 0.42);
        if (patched.grainBonus) this.callout(this.opts.grainLabel, COLORS.legal, patched.chain >= 2 ? 0.52 : 0.42);
        this.cb.onPatched(patched.rating, patched.chain);
      });
      t += 380;
    }
    for (const h of rep.spawned) {
      this.covers.push({ cells: h.cells, delay: t + 120, life: 0, max: this.dur(340), opening: false, grew: false });
      t += 90;
    }
    if (rep.grown) {
      const grown = rep.grown;
      this.covers.push({ cells: [grown.cell], delay: landMs + 80, life: 0, max: this.dur(420), opening: false, grew: true });
      this.at(landMs + 80, () => this.callout(this.opts.grewLabel, COLORS.illegal, 0.62));
    }
    // The slot refilled under the player: show the new plank arriving, and keep the ghost if it still fits.
    this.refill = { slot: rep.move.slot, life: 0, max: this.dur(220) };
    this.lastOrigin = this.cursor;
    this.anchor = null;
  }

  // ---- layout and drawing

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const pad = 8;
    const cell = Math.floor(Math.min((w - pad * 2) / this.width, (h - pad * 2) / (this.height + TRAY_ROWS)));
    this.cell = Math.max(10, cell);
    const totalH = this.cell * (this.height + TRAY_ROWS);
    this.ox = Math.floor((w - this.cell * this.width) / 2);
    // Tall screens: keep the board near the HUD rather than floating it mid-screen.
    this.oy = Math.floor(pad + Math.min((h - totalH) / 2, this.cell * 0.6));
    this.trayY = this.oy + this.cell * this.height + this.cell * 0.3;
    this.trayH = this.cell * (TRAY_ROWS - 0.3);
    const W = this.cell * this.width;
    const gap = W * 0.02;
    const slotW = (W - gap * 2) / 3;
    this.slotRects = [0, 1, 2].map((i) => ({ x: this.ox + i * (slotW + gap), y: this.trayY, w: slotW, h: this.trayH }));
    this.drawHull();
    this.drawHoles();
    this.drawPlanks();
    this.drawTrayFrame();
    this.drawTrayPieces();
    this.syncCursor();
    this.drawGhost();
    this.holeFxDirty = true;
  }

  private drawHull(): void {
    const g = this.hull;
    const s = this.cell;
    const W = this.width * s;
    const H = this.height * s;
    g.clear();
    g.roundRect(this.ox - 6, this.oy - 6, W + 12, H + 12, 10).fill({ color: 0x000000, alpha: 0.45 });
    // Planking: staggered boards two cells long, with nail heads.
    for (let r = 0; r < this.height; r++) {
      const y = this.oy + r * s;
      g.rect(this.ox, y, W, s).fill(this.hullColor(r));
      const offset = r % 2 === 0 ? 0 : s;
      for (let x = this.ox - offset; x < this.ox + W; x += s * 2) {
        const x0 = Math.max(this.ox, x);
        const x1 = Math.min(this.ox + W, x + s * 2);
        g.rect(x0, y + 1, x1 - x0, s - 2).stroke({ width: 1, color: COLORS.hullEdge, alpha: 0.55 });
        if (x + s * 0.3 > this.ox && x + s * 0.3 < this.ox + W) g.circle(x + s * 0.3, y + s * 0.5, Math.max(1, s * 0.05)).fill({ color: 0x000000, alpha: 0.4 });
      }
    }
    g.rect(this.ox, this.oy, W, H).stroke({ width: 2, color: COLORS.hullEdge, alpha: 0.9 });
    // Tray well.
    g.roundRect(this.ox - 4, this.trayY - 4, W + 8, this.trayH + 8, 8).fill({ color: COLORS.ink, alpha: 0.75 });
  }

  /** The hull's colour on a row: darker toward the keel, with alternate rows shaded. */
  private hullColor(row: number): number {
    const base = mix(COLORS.hullA, COLORS.hullB, row / Math.max(1, this.height - 1));
    return row % 2 === 0 ? mix(base, 0x000000, 0.06) : base;
  }

  private drawHoles(): void {
    const g = this.holesG;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    for (const h of this.state.holes) {
      const set = new Set(h.cells);
      for (const c of h.cells) {
        const col = c % this.width;
        const row = Math.floor(c / this.width);
        const x = this.ox + col * s;
        const y = this.oy + row * s;
        g.rect(x, y, s, s).fill(this.holeFill);
        // Splintered rim: light chips where broken boards face in, a shadow under the far edges.
        const edge = (cc: number, rr: number): boolean => cc < 0 || cc >= this.width || rr < 0 || rr >= this.height || !set.has(rr * this.width + cc);
        if (edge(col, row - 1)) {
          g.rect(x, y, s, 3).fill({ color: 0xc98a4b, alpha: 0.4 });
          for (let k = 0.15; k < 1; k += 0.35) g.rect(x + s * k, y + 3, s * 0.08, s * 0.14).fill({ color: 0xc98a4b, alpha: 0.3 });
        }
        if (edge(col - 1, row)) g.rect(x, y, 3, s).fill({ color: 0xc98a4b, alpha: 0.28 });
        if (edge(col, row + 1)) g.rect(x, y + s - 3, s, 3).fill({ color: 0x000000, alpha: 0.5 });
        if (edge(col + 1, row)) g.rect(x + s - 3, y, 3, s).fill({ color: 0x000000, alpha: 0.35 });
      }
      this.strokeRegion(g, set, 0, { width: 2, color: 0x2a170a, alpha: 0.9 });
    }
  }

  /** Per-frame hole overlays: an idle hole about to widen pulses amber, then red. */
  private drawHoleFx(): void {
    const g = this.holeFxG;
    if (!this.state) {
      g.clear();
      return;
    }
    const grow = this.state.config.growAfterMoves;
    const warn = this.state.holes.filter((h) => grow - h.idleMoves <= 2);
    if (warn.length === 0) {
      if (this.holeFxDirty) g.clear();
      this.holeFxDirty = false;
      return;
    }
    g.clear();
    for (const h of warn) {
      const left = grow - h.idleMoves;
      const urgent = left <= 1;
      const pulse = this.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(this.clock / (urgent ? 110 : 220));
      this.strokeRegion(g, new Set(h.cells), 2, { width: 3, color: urgent ? COLORS.illegal : COLORS.amber, alpha: 0.35 + 0.55 * pulse });
    }
  }

  private drawPlanks(): void {
    const g = this.planksG;
    g.clear();
    this.markLayer.removeChildren().forEach((c) => c.destroy());
    if (!this.state) return;
    const s = this.cell;
    const holeOf = carpentryHoleIndex(this.state);
    for (const p of this.state.planks) {
      if (this.landing && this.landing.plankId === p.id) continue;
      const r = relative(p.cells, this.width);
      this.paintPlank(g, r.cells, this.ox + r.col * s, this.oy + r.row * s, s, p.kind, p.grain, 1);
      if (this.showMarks) {
        const c0 = p.cells[Math.floor(p.cells.length / 2)]!;
        const t = new Text({ text: MARK_GLYPH[this.markByKind.get(p.kind) ?? "square"] ?? "■", style: { fontSize: s * 0.4, fill: 0xffffff } });
        t.alpha = 0.7;
        t.anchor.set(0.5);
        t.position.set(this.cx(c0 % this.width), this.cy(Math.floor(c0 / this.width)));
        this.markLayer.addChild(t);
      }
    }
    // Waste: hull covered by a plank, or hole cells covered twice. Hatched so it reads without color.
    for (let c = 0; c < this.state.covered.length; c++) {
      const n = this.state.covered[c]!;
      if (n === 0) continue;
      if (holeOf.has(c) ? n > 1 : n > 0) {
        if (this.landing && this.landing.cells.some(([dx, dy]) => this.landingCellAt(this.landing!, dx, dy) === c)) continue;
        this.paintWaste(g, this.ox + (c % this.width) * s, this.oy + Math.floor(c / this.width) * s, s, 0.5);
      }
    }
  }

  private paintWaste(g: Graphics, x: number, y: number, s: number, alpha: number): void {
    g.rect(x + 2, y + 2, s - 4, s - 4).fill({ color: COLORS.waste, alpha: alpha * 0.55 });
    g.setStrokeStyle({ width: 1.5, color: COLORS.waste, alpha });
    for (let k = -s; k < s; k += s / 3) g.moveTo(x + Math.max(2, k + 2), y + Math.max(2, 2 - k)).lineTo(x + Math.min(s - 2, k + s - 2), y + Math.min(s - 2, s - 2 - k)).stroke();
  }

  private paintPlankCell(g: Graphics, x: number, y: number, s: number, color: number, grain: Grain, alpha: number): void {
    g.rect(x, y, s, s).fill({ color, alpha });
    g.setStrokeStyle({ width: 1, color: mix(color, 0x000000, 0.35), alpha: 0.7 * alpha });
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const k = (i / (n + 1)) * s;
      if (grain === "h") g.moveTo(x + 2, y + k).lineTo(x + s - 2, y + k + (i % 2 ? 1 : -1)).stroke();
      else g.moveTo(x + k, y + 2).lineTo(x + k + (i % 2 ? 1 : -1), y + s - 2).stroke();
    }
    g.rect(x, y, s, s * 0.18).fill({ color: 0xffffff, alpha: 0.12 * alpha });
  }

  /** A whole plank: its cells with grain, and an outline around the outside only. */
  private paintPlank(g: Graphics, cells: Oriented, x0: number, y0: number, m: number, kind: number, grain: Grain, alpha: number): void {
    const color = this.colorByKind.get(kind) ?? 0xc98a4b;
    for (const [dx, dy] of cells) this.paintPlankCell(g, x0 + dx * m, y0 + dy * m, m, color, grain, alpha);
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    g.setStrokeStyle({ width: Math.max(1.5, m * 0.06), color: mix(color, 0x000000, 0.55), alpha: 0.9 * alpha });
    const inset = Math.max(1, m * 0.03);
    for (const [dx, dy] of cells) {
      const x = x0 + dx * m;
      const y = y0 + dy * m;
      if (!set.has(`${dx},${dy - 1}`)) g.moveTo(x, y + inset).lineTo(x + m, y + inset).stroke();
      if (!set.has(`${dx},${dy + 1}`)) g.moveTo(x, y + m - inset).lineTo(x + m, y + m - inset).stroke();
      if (!set.has(`${dx - 1},${dy}`)) g.moveTo(x + inset, y).lineTo(x + inset, y + m).stroke();
      if (!set.has(`${dx + 1},${dy}`)) g.moveTo(x + m - inset, y).lineTo(x + m - inset, y + m).stroke();
    }
  }

  /** A plank with a soft shadow under it, as if held above the hull. */
  private paintHeldPlank(g: Graphics, cells: Oriented, x0: number, y0: number, m: number, kind: number, grain: Grain, lift: number): void {
    const sh = m * 0.12 + lift;
    for (const [dx, dy] of cells) g.rect(x0 + dx * m + sh * 0.6, y0 + dy * m + sh, m, m).fill({ color: 0x000000, alpha: 0.35 });
    this.paintPlank(g, cells, x0, y0, m, kind, grain, 0.92);
  }

  /** Stroke the outside boundary of a set of board cells. */
  private strokeRegion(g: Graphics, set: ReadonlySet<number>, inset: number, style: { width: number; color: number; alpha: number }): void {
    const s = this.cell;
    g.setStrokeStyle(style);
    for (const c of set) {
      const col = c % this.width;
      const row = Math.floor(c / this.width);
      const x = this.ox + col * s;
      const y = this.oy + row * s;
      if (row === 0 || !set.has(c - this.width)) g.moveTo(x + inset, y + inset).lineTo(x + s - inset, y + inset).stroke();
      if (row === this.height - 1 || !set.has(c + this.width)) g.moveTo(x + inset, y + s - inset).lineTo(x + s - inset, y + s - inset).stroke();
      if (col === 0 || !set.has(c - 1)) g.moveTo(x + inset, y + inset).lineTo(x + inset, y + s - inset).stroke();
      if (col === this.width - 1 || !set.has(c + 1)) g.moveTo(x + s - inset, y + inset).lineTo(x + s - inset, y + s - inset).stroke();
    }
  }

  /** The ghost: the selected plank where it would go, green when it fits, red when it does not. */
  private drawGhost(): void {
    const g = this.ghostG;
    g.clear();
    if (this.state && this.interactive && !this.state.finished && this.cursor) {
      const check = this.check(this.cursor.col, this.cursor.row);
      this.paintGhost(g, check, this.cursor.col, this.cursor.row, this.drag?.moved ? 0.8 : 1);
    }
    this.drawHud();
  }

  /**
   * The toolbar under a plank set down by touch: Turn, Flip and Nail follow the plank, below it or
   * above it near the keel. Hidden while the plank is in hand and for a mouse, which hovers and clicks.
   */
  private drawHud(): void {
    const g = this.hudG;
    g.clear();
    this.hudRects = [];
    const fp = this.footprint();
    const show = this.state && this.interactive && !this.state.finished && this.cursor && fp && this.touchUI && !this.drag?.moved;
    if (!show) {
      for (const t of this.hudLabels) t.visible = false;
      return;
    }
    const s = this.cell;
    const cursor = this.cursor!;
    const legal = this.check(cursor.col, cursor.row)?.legal ?? false;
    const bh = Math.max(44, s * 1.2);
    const bw = Math.max(bh * 1.7, s * 2.2);
    const gap = Math.max(4, s * 0.12);
    const W = bw * 3 + gap * 4;
    const H = bh + gap * 2;
    const wanted = this.ox + (cursor.col + fp!.w / 2) * s - W / 2;
    const x0 = Math.max(this.ox - 4, Math.min(this.ox + this.width * s + 4 - W, wanted));
    let y0 = this.oy + (cursor.row + fp!.h) * s + s * 0.2;
    if (y0 + H > this.oy + this.height * s + 4) y0 = this.oy + cursor.row * s - s * 0.2 - H;
    g.roundRect(x0, y0 + 3, W, H, 12).fill({ color: 0x000000, alpha: 0.4 });
    g.roundRect(x0, y0, W, H, 12).fill({ color: COLORS.ink, alpha: 0.94 });
    g.roundRect(x0, y0, W, H, 12).stroke({ width: 1.5, color: COLORS.brass, alpha: 0.55 });
    const actions: HudAction[] = ["rotate", "flip", "nail"];
    actions.forEach((action, i) => {
      const x = x0 + gap + i * (bw + gap);
      const y = y0 + gap;
      const down = this.hudPressed?.action === action;
      const enabled = action !== "nail" || legal;
      const dy = down ? 1 : 0;
      if (action === "nail") {
        g.roundRect(x, y + dy, bw, bh, 9).fill({ color: enabled ? COLORS.legal : 0x2b3a4a, alpha: enabled ? (down ? 0.8 : 1) : 0.7 });
        g.roundRect(x, y + dy, bw, bh, 9).stroke({ width: 1.5, color: enabled ? 0xffffff : 0x5a6a7a, alpha: 0.7 });
      } else {
        g.roundRect(x, y + dy, bw, bh, 9).fill({ color: down ? 0x4a3018 : 0x2a1b10 });
        g.roundRect(x, y + dy, bw, bh, 9).stroke({ width: 1.5, color: down ? COLORS.brassLight : COLORS.brass, alpha: 0.85 });
      }
      this.hudRects.push({ x, y, w: bw, h: bh, action });
      const label = this.hudLabel(i, action);
      label.visible = true;
      label.style.fontSize = Math.max(12, Math.min(s * 0.42, bw / 4.4));
      label.style.fill = action === "nail" ? (enabled ? COLORS.ink : 0x8a96a4) : COLORS.brassLight;
      label.position.set(x + bw / 2, y + bh / 2 + dy);
    });
  }

  private hudLabel(i: number, action: HudAction): Text {
    let t = this.hudLabels[i];
    if (!t) {
      t = new Text({ text: "", style: { fontFamily: FONT, fontSize: 14, fontWeight: "700", fill: COLORS.brassLight } });
      t.anchor.set(0.5);
      this.hudText.addChild(t);
      this.hudLabels[i] = t;
    }
    const text = action === "rotate" ? `⟳ ${this.opts.turnLabel}` : action === "flip" ? `⇄ ${this.opts.flipLabel}` : `✓ ${this.opts.nailLabel}`;
    if (t.text !== text) t.text = text;
    return t;
  }

  private paintGhost(g: Graphics, check: CarpentryPlacementCheck | null, col: number, row: number, strength: number): void {
    const s = this.cell;
    const piece = this.state!.slots[this.slot];
    if (!piece) return;
    const cells = carpentryOrient(piece.shape, this.rot, this.flip);
    const legal = check?.legal ?? false;
    const color = legal ? COLORS.legal : COLORS.illegal;
    const kindColor = this.colorByKind.get(piece.kind) ?? 0xc98a4b;
    // The hole this plank would join, so the player sees which patch they are working.
    if (legal && check?.holeId !== null && check?.holeId !== undefined && this.state) {
      const hole = this.state.holes.find((h) => h.id === check.holeId);
      if (hole) this.strokeRegion(g, new Set(hole.cells), 1, { width: 2, color: COLORS.legal, alpha: 0.4 * strength });
    }
    const grain = carpentryEffectiveGrain(piece.grain, this.rot);
    for (const [dx, dy] of cells) {
      const cc = col + dx;
      const rr = row + dy;
      if (cc < 0 || cc >= this.width || rr < 0 || rr >= this.height) continue;
      const x = this.ox + cc * s;
      const y = this.oy + rr * s;
      if (legal) this.paintPlankCell(g, x + 1, y + 1, s - 2, kindColor, grain, 0.5 * strength);
      else g.rect(x + 2, y + 2, s - 4, s - 4).fill({ color: kindColor, alpha: 0.22 * strength });
    }
    const set = new Set(cells.map(([x, y]) => (row + y) * this.width + (col + x)).filter((c) => c >= 0));
    this.strokeRegion(g, set, 2, { width: 2.5, color, alpha: 0.95 * strength });
    if (check) for (const c of check.wasteCells) this.paintWaste(g, this.ox + (c % this.width) * s, this.oy + Math.floor(c / this.width) * s, s, 0.8 * strength);
  }

  private drawTrayFrame(): void {
    const g = this.trayG;
    g.clear();
    this.trayText.removeChildren().forEach((c) => c.destroy());
    this.slotLabels = [];
    this.slotRects.forEach((r, i) => {
      const selected = i === this.slot;
      g.roundRect(r.x, r.y, r.w, r.h, 6).fill({ color: COLORS.trayBg, alpha: selected ? 0.95 : 0.6 });
      if (selected) g.roundRect(r.x, r.y, r.w, r.h, 6).stroke({ width: 2, color: COLORS.brass, alpha: 0.95 });
      const label = new Text({ text: String(i + 1), style: { fontFamily: FONT, fontSize: Math.max(9, this.cell * 0.32), fill: selected ? COLORS.brassLight : 0xc9bb9a } });
      label.position.set(r.x + 5, r.y + 3);
      this.trayText.addChild(label);
      this.slotLabels.push(label);
    });
  }

  private drawTrayPieces(): void {
    const g = this.trayPiecesG;
    g.clear();
    if (!this.state) return;
    this.state.slots.forEach((piece, i) => {
      const r = this.slotRects[i]!;
      const selected = i === this.slot;
      const carried = this.drag?.moved && this.drag.slot === i && this.carries(this.drag);
      const resting = !carried && selected && this.anchor !== null;
      const rot = selected ? this.rot : 0;
      const flip = selected ? this.flip : false;
      let scale = 1;
      let alpha = carried ? 0.22 : resting ? 0.45 : 1;
      if (this.refill && this.refill.slot === i) {
        const k = easeOut(Math.min(1, this.refill.life / this.refill.max));
        scale = 0.55 + 0.45 * k;
        alpha *= 0.3 + 0.7 * k;
      }
      const m = (Math.min(r.w, r.h) / 5.6) * scale;
      this.paintMini(g, piece.shape, piece.kind, carpentryEffectiveGrain(piece.grain, rot), rot, flip, r.x + r.w / 2, r.y + r.h / 2, m, alpha);
    });
  }

  private paintMini(g: Graphics, shape: number, kind: number, grain: Grain, rot: number, flip: boolean, cx: number, cy: number, m: number, alpha: number): void {
    const cells = carpentryOrient(shape, rot, flip);
    const { w, h } = carpentryExtent(cells);
    this.paintPlank(g, cells, cx - (w * m) / 2, cy - (h * m) / 2, m, kind, grain, alpha);
    if (this.showMarks && alpha > 0.5) {
      // The wood's own mark on the mini, so the tray reads without color like the board planks do.
      const [mx, my] = cells[Math.floor(cells.length / 2)]!;
      g.circle(cx - (w * m) / 2 + (mx + 0.5) * m, cy - (h * m) / 2 + (my + 0.5) * m, m * 0.34).fill({ color: 0x000000, alpha: 0.45 * alpha });
      drawMark(g, cx - (w * m) / 2 + (mx + 0.5) * m, cy - (h * m) / 2 + (my + 0.5) * m, m * 0.26, this.markByKind.get(kind) ?? "square", 0xffffff);
    }
  }

  /** Top-left pixel of a mini plank in its slot, for flybacks. */
  private miniOrigin(slot: number, cells: Oriented): { x: number; y: number; m: number } {
    const r = this.slotRects[slot]!;
    const m = Math.min(r.w, r.h) / 5.6;
    const { w, h } = carpentryExtent(cells);
    return { x: r.x + r.w / 2 - (w * m) / 2, y: r.y + r.h / 2 - (h * m) / 2, m };
  }

  private cx(col: number): number {
    return this.ox + (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return this.oy + (row + 0.5) * this.cell;
  }

  private dur(ms: number): number {
    return this.reduced ? Math.min(ms, 90) : ms;
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push({ at: this.clock + (this.reduced ? Math.min(ms, 90) : ms), fn });
  }

  private clearEffects(): void {
    this.flashes.length = 0;
    this.lifts.length = 0;
    this.covers.length = 0;
    this.timers.length = 0;
    this.landing = null;
    this.flyback = null;
    this.shake = null;
    this.refill = null;
    for (const p of this.popups) p.t.destroy();
    this.popups.length = 0;
    this.fxG.clear();
    this.dragG.clear();
  }

  private flash(cells: readonly number[], color: number, max: number): void {
    this.flashes.push({ cells, color, life: 0, max: this.reduced ? Math.min(max, 120) : max });
  }

  private popup(x: number, y: number, text: string, color: number, size: number): void {
    const t = new Text({
      text,
      style: { fontFamily: DISPLAY, fontSize: Math.max(12, this.cell * size), fontWeight: "700", fill: color, stroke: { color: 0x000000, width: 3 } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 800, y0: y });
  }

  private callout(text: string, color: number, yFrac: number): void {
    const t = new Text({
      text,
      style: { fontFamily: DISPLAY, fontSize: Math.max(14, this.cell * 0.7), fontWeight: "900", fill: color, stroke: { color: 0x000000, width: 4 }, letterSpacing: 1 },
    });
    t.anchor.set(0.5);
    t.position.set(this.ox + (this.width * this.cell) / 2, this.oy + this.height * this.cell * yFrac);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 1100, y0: t.y });
  }

  // ---- per frame

  private tick(dt: number): void {
    this.clock += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]!;
      if (this.clock >= tm.at) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    const g = this.fxG;
    g.clear();
    const s = this.cell;

    // Hull covers: sound planking that cracks away to show a hole.
    for (let i = this.covers.length - 1; i >= 0; i--) {
      const c = this.covers[i]!;
      if (c.delay > 0) {
        c.delay -= dt;
        for (const cell of c.cells) {
          const row = Math.floor(cell / this.width);
          const x = this.ox + (cell % this.width) * s;
          const y = this.oy + row * s;
          g.rect(x, y, s, s).fill(this.hullColor(row));
          g.rect(x, y + 1, s, s - 2).stroke({ width: 1, color: COLORS.hullEdge, alpha: 0.55 });
        }
        if (c.delay <= 0) {
          this.flash(c.cells, c.grew ? COLORS.illegal : 0xffe0b0, c.grew ? 700 : 380);
          if (c.grew) this.cb.onGrew();
          else this.cb.onCracked(c.opening);
        }
        continue;
      }
      c.life += dt;
      const k = Math.min(1, c.life / c.max);
      if (k >= 1) {
        this.covers.splice(i, 1);
        continue;
      }
      // Each board splinters inward: the cover shrinks toward its centre and fades.
      const e = easeIn(k);
      for (const cell of c.cells) {
        const x = this.ox + (cell % this.width) * s;
        const y = this.oy + Math.floor(cell / this.width) * s;
        const inset = (s / 2) * e;
        g.rect(x + inset, y + inset, s - inset * 2, s - inset * 2).fill({ color: this.hullColor(Math.floor(cell / this.width)), alpha: 1 - e * 0.5 });
        g.rect(x + inset, y + inset, s - inset * 2, s - inset * 2).stroke({ width: 2, color: 0xc98a4b, alpha: 0.6 * (1 - k) });
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life += dt;
      const k = f.life / f.max;
      if (k >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      for (const c of f.cells) g.rect(this.ox + (c % this.width) * s, this.oy + Math.floor(c / this.width) * s, s, s).fill({ color: f.color, alpha: (1 - k) * 0.7 });
    }

    // Lifts: a patched hole's planks rise and fade.
    for (let i = this.lifts.length - 1; i >= 0; i--) {
      const l = this.lifts[i]!;
      if (l.delay > 0) {
        l.delay -= dt;
        this.paintPlank(g, l.cells, l.x, l.y, s, l.kind, l.grain, 1);
        continue;
      }
      l.life += dt;
      const k = Math.min(1, l.life / l.max);
      if (k >= 1) {
        this.lifts.splice(i, 1);
        continue;
      }
      const rise = easeOut(k) * s * 0.9;
      const grow = 1 + 0.08 * easeOut(k);
      const { w, h } = carpentryExtent(l.cells);
      const x = l.x - (w * s * (grow - 1)) / 2;
      const y = l.y - rise - (h * s * (grow - 1)) / 2;
      for (const [dx, dy] of l.cells) g.rect(x + dx * s * grow + 3, l.y + dy * s + 4, s * grow, s).fill({ color: 0x000000, alpha: 0.25 * (1 - k) });
      this.paintPlank(g, l.cells, x, y, s * grow, l.kind, l.grain, 1 - easeIn(k));
    }

    // Landing: the nailed plank slides home and settles with a knock.
    if (this.landing) {
      const l = this.landing;
      l.life += dt;
      const k = Math.min(1, l.life / l.max);
      if (k >= 1) {
        this.landing = null;
        this.flash(
          l.cells.map(([dx, dy]) => this.landingCellAt(l, dx, dy)),
          mix(this.colorByKind.get(l.kind) ?? 0xffffff, 0xffffff, 0.6),
          260,
        );
        this.cb.onNailed(l.waste);
        this.drawPlanks();
      } else {
        const e = easeOut(k);
        const x = l.x0 + (l.x1 - l.x0) * e;
        const y = l.y0 + (l.y1 - l.y0) * e;
        const lift = (1 - e) * s * 0.25;
        const grow = 1 + 0.08 * (1 - e);
        const { w, h } = carpentryExtent(l.cells);
        const gx = x - (w * s * (grow - 1)) / 2;
        const gy = y - (h * s * (grow - 1)) / 2;
        this.paintHeldPlank(g, l.cells, gx, gy, s * grow, l.kind, l.grain, lift);
      }
    }

    // Flyback: a refused plank returns to its slot.
    const dg = this.dragG;
    if (this.flyback) {
      const f = this.flyback;
      f.life += dt;
      const k = Math.min(1, f.life / f.max);
      dg.clear();
      if (k >= 1) {
        this.flyback = null;
        this.drawTrayPieces();
      } else {
        const e = easeOut(k);
        const m = f.m0 + (f.m1 - f.m0) * e;
        this.paintHeldPlank(dg, f.cells, f.x0 + (f.x1 - f.x0) * e, f.y0 + (f.y1 - f.y0) * e, m, f.kind, f.grain, (1 - e) * s * 0.3);
      }
    }

    if (this.shake) {
      this.shake.life += dt;
      const k = this.shake.life / this.shake.max;
      if (k >= 1) {
        this.shake = null;
        this.ghostG.x = 0;
      } else this.ghostG.x = Math.sin(k * Math.PI * 5) * (1 - k) * s * 0.18;
    }

    if (this.hudPressed) {
      this.hudPressed.life += dt;
      if (this.hudPressed.life > 110) {
        this.hudPressed = null;
        this.drawHud();
      }
    }

    if (this.refill) {
      this.refill.life += dt;
      if (this.refill.life >= this.refill.max) this.refill = null;
      this.drawTrayPieces();
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = p.life / p.max;
      p.t.y = p.y0 - k * this.cell * 0.7;
      p.t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }

    this.drawHoleFx();

    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
    if (this.viewStale) this.publishView();
  }

  private landingCellAt(l: Landing, dx: number, dy: number): number {
    const col = Math.round((l.x1 - this.ox) / this.cell) + dx;
    const row = Math.round((l.y1 - this.oy) / this.cell) + dy;
    return row * this.width + col;
  }

  /** Mirrors what the canvas shows, for the smoke test: h for an open hole cell, . for hull, else the cover count. */
  private publishView(): void {
    this.viewStale = false;
    if (!this.state) return;
    const holeOf = carpentryHoleIndex(this.state);
    const out: string[] = [];
    for (let c = 0; c < this.state.covered.length; c++) {
      const n = this.state.covered[c]!;
      out.push(n > 0 ? String(n) : holeOf.has(c) ? "h" : ".");
    }
    this.app.canvas.setAttribute("data-view", out.join(""));
    const fp = this.footprint();
    this.app.canvas.setAttribute("data-cursor", this.cursor ? `${this.cursor.col},${this.cursor.row}` : "");
    this.app.canvas.setAttribute("data-ghost", this.cursor && fp ? `${this.cursor.col},${this.cursor.row},${fp.w},${fp.h}` : "");
    this.app.canvas.setAttribute("data-geometry", `${this.ox},${this.oy},${this.cell}`);
    this.app.canvas.setAttribute("data-orient", `${this.slot},${this.rot},${this.flip ? 1 : 0}`);
    this.app.canvas.setAttribute("data-hud", this.hudRects.map((r) => `${r.action}:${Math.round(r.x + r.w / 2)},${Math.round(r.y + r.h / 2)}`).join(";"));
  }

  // ---- selection and placement

  private check(col: number, row: number): CarpentryPlacementCheck | null {
    if (!this.state) return null;
    return carpentryCheckPlacement(this.state, this.slot, this.rot, this.flip, col, row);
  }

  /** The selected plank's oriented cells and bounding box. */
  private footprint(): { cells: Oriented; w: number; h: number } | null {
    const piece = this.state?.slots[this.slot];
    if (!piece) return null;
    const cells = carpentryOrient(piece.shape, this.rot, this.flip);
    const { w, h } = carpentryExtent(cells);
    return { cells, w, h };
  }

  /** Derive the ghost's origin from the anchor, kept on the board. */
  private syncCursor(): void {
    const fp = this.footprint();
    if (!this.anchor || !fp) {
      this.cursor = null;
      this.viewStale = true;
      return;
    }
    const col = Math.max(0, Math.min(this.width - fp.w, Math.round(this.anchor.cx - fp.w / 2)));
    const row = Math.max(0, Math.min(this.height - fp.h, Math.round(this.anchor.cy - fp.h / 2)));
    this.cursor = { col, row };
    this.viewStale = true;
  }

  /** Point the anchor at an origin cell. */
  private anchorAt(col: number, row: number): void {
    const fp = this.footprint();
    if (!fp) return;
    this.anchor = { cx: col + fp.w / 2, cy: row + fp.h / 2 };
    this.syncCursor();
  }

  /**
   * Put the plank's centre at a point on the canvas. When the spot does not take the plank but a
   * neighbouring one does, it snaps there: dropping near a hole is enough.
   */
  private anchorNear(x: number, y: number, liftCells: number): void {
    const fp = this.footprint();
    if (!fp || !this.state) return;
    const cx = (x - this.ox) / this.cell;
    const cy = (y - this.oy) / this.cell - liftCells;
    if (cx < -0.6 || cx > this.width + 0.6 || cy < -0.6 || cy > this.height + 0.6) {
      this.anchor = null;
      this.syncCursor();
      return;
    }
    const col0 = Math.max(0, Math.min(this.width - fp.w, Math.round(cx - fp.w / 2)));
    const row0 = Math.max(0, Math.min(this.height - fp.h, Math.round(cy - fp.h / 2)));
    const holeOf = carpentryHoleIndex(this.state);
    let best: { col: number; row: number; d: number; waste: number } | null = null;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = col0 + dc;
        const row = row0 + dr;
        const check = carpentryCheckPlacement(this.state, this.slot, this.rot, this.flip, col, row, holeOf);
        if (!check.legal) continue;
        const d = Math.hypot(col + fp.w / 2 - cx, row + fp.h / 2 - cy);
        if (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) < 1e-6 && check.wasteCells.length < best.waste)) best = { col, row, d, waste: check.wasteCells.length };
      }
    }
    if (best) this.anchor = { cx: best.col + fp.w / 2, cy: best.row + fp.h / 2 };
    else this.anchor = { cx: col0 + fp.w / 2, cy: row0 + fp.h / 2 };
    this.syncCursor();
  }

  private select(slot: number): void {
    if (!this.state || slot < 0 || slot >= this.state.slots.length) return;
    if (this.slot !== slot) {
      this.slot = slot;
      this.cb.onNudge();
      this.drawTrayFrame();
    }
    this.syncCursor();
    this.drawTrayPieces();
    this.drawGhost();
  }

  /** Turn or flip the selected plank about its centre, so the ghost stays put. */
  private reorient(rot: number, flip: boolean): void {
    if (!this.state) return;
    this.rot = ((rot % 4) + 4) % 4;
    this.flip = flip;
    this.viewStale = true;
    this.cb.onNudge();
    if (this.drag?.moved && this.carries(this.drag)) this.followDrag();
    else this.syncCursor();
    this.drawTrayPieces();
    this.drawGhost();
  }

  private rotate(dir = 1): void {
    this.reorient(this.rot + dir, this.flip);
  }

  private doFlip(): void {
    this.reorient(this.rot, !this.flip);
  }

  private moveCursor(dc: number, dr: number): void {
    if (!this.state) return;
    const fp = this.footprint();
    if (!fp) return;
    if (!this.anchor) {
      const o = this.lastOrigin ?? { col: Math.floor((this.width - fp.w) / 2), row: Math.floor((this.height - fp.h) / 2) };
      this.anchorAt(o.col, o.row);
    } else if (this.cursor) {
      this.anchorAt(this.cursor.col + dc, this.cursor.row + dr);
    }
    this.drawGhost();
  }

  /**
   * Jump the ghost to the next spot where the plank fits best: the placements with the least waste,
   * cycled in reading order from the cursor.
   */
  private jumpToFit(): void {
    if (!this.state) return;
    const holeOf = carpentryHoleIndex(this.state);
    const total = this.width * this.height;
    let bestWaste = Infinity;
    const fits: Array<{ i: number; waste: number }> = [];
    for (let i = 0; i < total; i++) {
      const check = carpentryCheckPlacement(this.state, this.slot, this.rot, this.flip, i % this.width, Math.floor(i / this.width), holeOf);
      if (!check.legal) continue;
      fits.push({ i, waste: check.wasteCells.length });
      bestWaste = Math.min(bestWaste, check.wasteCells.length);
    }
    const best = fits.filter((f) => f.waste === bestWaste).map((f) => f.i);
    if (best.length === 0) return;
    const from = this.cursor ?? this.lastOrigin;
    const start = from ? from.row * this.width + from.col : -1;
    const next = best.find((i) => i > start) ?? best[0]!;
    this.anchorAt(next % this.width, Math.floor(next / this.width));
    this.cb.onNudge();
    this.drawGhost();
  }

  /** Nail the plank down at the ghost, or refuse with a shake. */
  private placeAt(col: number, row: number, from: { x: number; y: number } | null): boolean {
    const check = this.check(col, row);
    if (!check?.legal) {
      this.anchorAt(col, row);
      this.drawGhost();
      this.refuse();
      return false;
    }
    this.pendingLand = { x: from ? from.x : this.ox + col * this.cell, y: from ? from.y : this.oy + row * this.cell - this.cell * 0.45, slot: this.slot };
    this.cb.onPlace(this.slot, this.rot, this.flip, col, row);
    return true;
  }

  private refuse(): void {
    this.shake = { life: 0, max: this.dur(260) };
    this.cb.onBump();
  }

  // ---- input

  private boardCell(x: number, y: number): { col: number; row: number } | null {
    const col = Math.floor((x - this.ox) / this.cell);
    const row = Math.floor((y - this.oy) / this.cell);
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return { col, row };
  }

  private onBoard(x: number, y: number): boolean {
    const m = this.cell * 0.5;
    return x >= this.ox - m && x <= this.ox + this.width * this.cell + m && y >= this.oy - m && y <= this.oy + this.height * this.cell + m;
  }

  private slotAt(x: number, y: number): number | null {
    const i = this.slotRects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return i >= 0 ? i : null;
  }

  /** True when a point lies within the ghost's bounding box, so a notch in the plank still counts as the plank. */
  private onGhost(x: number, y: number): boolean {
    const cell = this.boardCell(x, y);
    const fp = this.footprint();
    if (!cell || !fp || !this.cursor) return false;
    return cell.col >= this.cursor.col && cell.col < this.cursor.col + fp.w && cell.row >= this.cursor.row && cell.row < this.cursor.row + fp.h;
  }

  /** Whether a drag carries the plank. A finger on bare hull only taps or swipes; a mouse always carries. */
  private carries(d: Drag): boolean {
    return d.from !== "board" || !d.touch;
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive || !this.state) return;
    const { x, y } = e.global;
    // One finger at a time; a right click turns the plank.
    if (this.drag && e.pointerId !== this.drag.id) return;
    if (e.button === 2) {
      this.rotate();
      return;
    }
    if (e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    if (this.touchUI !== touch) {
      this.touchUI = touch;
      this.drawGhost();
    }
    const button = this.hudRects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (button) {
      this.hudPressed = { action: button.action, life: 0 };
      if (button.action === "rotate") this.rotate();
      else if (button.action === "flip") this.doFlip();
      else if (this.cursor) this.placeAt(this.cursor.col, this.cursor.row, null);
      this.drawHud();
      return;
    }
    const base = { id: e.pointerId, x0: x, y0: y, x, y, moved: false, touch };
    const slot = this.slotAt(x, y);
    if (slot !== null) {
      this.select(slot);
      this.drag = { ...base, slot, from: "tray", offX: 0, offY: touch ? -LIFT_TOUCH : 0 };
      return;
    }
    if (!this.onBoard(x, y)) return;
    if (this.anchor && this.onGhost(x, y)) {
      // Grabbing the plank keeps it under the same point of the finger.
      this.drag = { ...base, slot: this.slot, from: "ghost", offX: this.anchor.cx - (x - this.ox) / this.cell, offY: this.anchor.cy - (y - this.oy) / this.cell };
      return;
    }
    this.drag = { ...base, slot: this.slot, from: "board", offX: 0, offY: 0 };
  }

  private pointerMove(e: FederatedPointerEvent): void {
    if (!this.interactive || !this.state) return;
    const { x, y } = e.global;
    const d = this.drag;
    if (!d) {
      // A mouse hovering over the hull carries the plank with it.
      if (e.pointerType === "mouse" && this.onBoard(x, y)) {
        this.touchUI = false;
        this.anchorNear(x, y, 0);
        this.drawGhost();
        this.drawTrayPieces();
      }
      return;
    }
    if (e.pointerId !== d.id) return;
    d.x = x;
    d.y = y;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > this.cell * 0.3) {
      d.moved = true;
      this.drawTrayPieces();
      this.drawHud();
    }
    if (d.moved && this.carries(d)) this.followDrag();
  }

  /** The plank in hand: drawn under the pointer (lifted on touch), with the ghost snapped beneath it. */
  private followDrag(): void {
    const d = this.drag;
    const fp = this.footprint();
    if (!d || !fp || !this.state) return;
    const px = d.x + d.offX * this.cell;
    const py = d.y + d.offY * this.cell;
    this.anchorNear(px, py, 0);
    this.drawGhost();
    const g = this.dragG;
    g.clear();
    const piece = this.state.slots[this.slot]!;
    const m = this.cell * 1.04;
    const x0 = px - (fp.w * m) / 2;
    const y0 = py - (fp.h * m) / 2;
    this.paintHeldPlank(g, fp.cells, x0, y0, m, piece.kind, carpentryEffectiveGrain(piece.grain, this.rot), this.cell * 0.3);
    // The verdict rides on top of the plank, since on touch the plank sits over its own ghost.
    const legal = this.cursor ? (this.check(this.cursor.col, this.cursor.row)?.legal ?? false) : false;
    const set = new Set(fp.cells.map(([x, y]) => `${x},${y}`));
    g.setStrokeStyle({ width: 2.5, color: legal ? COLORS.legal : COLORS.illegal, alpha: 0.9 });
    for (const [dx, dy] of fp.cells) {
      const x = x0 + dx * m;
      const y = y0 + dy * m;
      if (!set.has(`${dx},${dy - 1}`)) g.moveTo(x, y + 1).lineTo(x + m, y + 1).stroke();
      if (!set.has(`${dx},${dy + 1}`)) g.moveTo(x, y + m - 1).lineTo(x + m, y + m - 1).stroke();
      if (!set.has(`${dx - 1},${dy}`)) g.moveTo(x + 1, y).lineTo(x + 1, y + m).stroke();
      if (!set.has(`${dx + 1},${dy}`)) g.moveTo(x + m - 1, y).lineTo(x + m - 1, y + m).stroke();
    }
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const { x, y } = e.global;
    if (d.moved && this.state && this.interactive && this.carries(d)) {
      // Judge the plank where the finger lifted, not where the last processed move left it.
      d.x = x;
      d.y = y;
      this.followDrag();
    }
    this.drag = null;
    if (!this.state || !this.interactive) {
      this.dragG.clear();
      return;
    }
    const fp = this.footprint();
    if (d.moved) {
      this.dragG.clear();
      if (!fp || !this.carries(d)) {
        this.drawTrayPieces();
        this.drawGhost();
        return;
      }
      if (this.anchor) {
        // Let go over the hull: the plank rests there with its toolbar until it is moved or nailed.
        this.drawGhost();
        this.drawTrayPieces();
        this.viewStale = true;
        this.cb.onNudge();
        return;
      }
      // Let go off the hull: back to its slot.
      const piece = this.state.slots[this.slot]!;
      const home = this.miniOrigin(this.slot, fp.cells);
      const px = x + d.offX * this.cell - (fp.w * this.cell) / 2;
      const py = y + d.offY * this.cell - (fp.h * this.cell) / 2;
      this.flyback = { cells: fp.cells, kind: piece.kind, grain: carpentryEffectiveGrain(piece.grain, this.rot), x0: px, y0: py, x1: home.x, y1: home.y, m0: this.cell, m1: home.m, slot: this.slot, life: 0, max: this.dur(240) };
      this.syncCursor();
      this.drawGhost();
      return;
    }
    if (d.from === "tray") return;
    const cell = this.boardCell(x, y);
    if (!cell) return;
    if (!d.touch) {
      // Mouse: the ghost already follows the pointer, so a click nails it.
      this.anchorNear(x, y, 0);
      if (this.cursor) this.placeAt(this.cursor.col, this.cursor.row, null);
      return;
    }
    // Touch: a tap on the plank does nothing (its toolbar is right there); a tap on bare hull brings it.
    if (d.from === "ghost") return;
    this.anchorNear(x, y, 0);
    this.cb.onNudge();
    this.drawGhost();
    this.drawTrayPieces();
  }

  private pointerCancel(e: FederatedPointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.dragG.clear();
    if (d.moved) {
      this.anchor = null;
      this.syncCursor();
      this.drawTrayPieces();
      this.drawGhost();
    }
  }

  private wheel(e: FederatedWheelEvent): void {
    if (!this.interactive || !this.state) return;
    if (Math.abs(e.deltaY) < 1) return;
    this.rotate(e.deltaY > 0 ? 1 : -1);
  }

  /** Keyboard: 1-3 pick a plank, arrows move it, R or E turn, Q turns back, F flips, H finds a fit, Enter or Space nails it. */
  keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    switch (key) {
      case "1":
      case "2":
      case "3":
        this.select(Number(key) - 1);
        return true;
      case "ArrowLeft":
        this.moveCursor(-1, 0);
        return true;
      case "ArrowRight":
        this.moveCursor(1, 0);
        return true;
      case "ArrowUp":
        this.moveCursor(0, -1);
        return true;
      case "ArrowDown":
        this.moveCursor(0, 1);
        return true;
      case "r":
      case "R":
      case "e":
      case "E":
        this.rotate(1);
        return true;
      case "q":
      case "Q":
        this.rotate(-1);
        return true;
      case "f":
      case "F":
        this.doFlip();
        return true;
      case "h":
      case "H":
        this.jumpToFit();
        return true;
      case "Escape":
        this.anchor = null;
        this.syncCursor();
        this.drawGhost();
        this.drawTrayPieces();
        return true;
      case " ":
      case "Enter":
        if (this.cursor) this.placeAt(this.cursor.col, this.cursor.row, null);
        else this.jumpToFit();
        return true;
      default:
        return false;
    }
  }
}

/** Board cells of a plank as offsets from its top-left corner. */
function relative(cells: readonly number[], width: number): { col: number; row: number; cells: Oriented } {
  let col = Infinity;
  let row = Infinity;
  for (const c of cells) {
    col = Math.min(col, c % width);
    row = Math.min(row, Math.floor(c / width));
  }
  return { col, row, cells: cells.map((c) => [(c % width) - col, Math.floor(c / width) - row] as [number, number]) };
}

function linear(stops: number[]): FillGradient {
  const g = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: "local" });
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  return g;
}

