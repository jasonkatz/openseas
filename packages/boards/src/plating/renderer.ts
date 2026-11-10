import { loadPuzzleSprites, spritesReady, paintSprite } from "../sprites/atlas.js";
import { Application, Container, FillGradient, Graphics, Text, type FederatedPointerEvent, type FederatedWheelEvent } from "pixi.js";
import {
  platingCheckPlacement,
  platingEffectiveBrush,
  platingExtent,
  platingBreachIndex,
  platingOrient,
  type PlatingPlacementCheck,
  type PlatingState,
  type Brush,
  type BreachRating,
} from "@openseas/engine";
import type { PlatingContent } from "@openseas/content";
import { mix } from "../cooling/tiles.js";
import { drawMark } from "../engines/renderer.js";
import { boardSurface } from "../surface.js";
import { HULL, hullRivet, starField } from "../hull.js";
import type { BoardRenderer } from "../kit/useBoardHost.js";

export interface PlatingCallbacks {
  /** The player welded down the plate in `slot` at this orientation and origin. */
  onPlace(slot: number, rot: number, flip: boolean, col: number, row: number): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** A breach was sealed on screen, with its rating. */
  onSealed(rating: BreachRating, chain: number): void;
  /** A plate landed on screen. */
  onNailed(waste: boolean): void;
  /** A breach widened on screen. */
  onGrew(): void;
  /** A new breach cracked open on screen. `opening` is true for the round's first breaches. */
  onCracked(opening: boolean): void;
  /** The player picked, turned or flipped a plate, or moved the ghost by tap. */
  onNudge(): void;
  /** The player tried to weld a plate where it does not go. */
  onBump(): void;
}

export interface PlatingRendererOptions {
  showMarks: boolean;
  ratingLabel(rating: BreachRating): string;
  streakLabel(count: number): string;
  brushLabel: string;
  grewLabel: string;
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

/** A plate dropping onto the board: slides from where it was held to its cells and settles. */
interface Landing {
  plateId: number;
  cells: Oriented;
  kind: number;
  brush: Brush;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  waste: boolean;
  life: number;
  max: number;
}

/** A sealed breach's plate lifting off the hull. Drawn in place while `delay` runs down. */
interface Lift {
  cells: Oriented;
  x: number;
  y: number;
  kind: number;
  brush: Brush;
  delay: number;
  life: number;
  max: number;
}

/** Sound hull over a breach that is about to crack open; shrinks away to reveal it. */
interface Cover {
  cells: readonly number[];
  delay: number;
  life: number;
  max: number;
  opening: boolean;
  grew: boolean;
}

/** A plate that would not go where it was dropped, flying back to its tray slot. */
interface Flyback {
  cells: Oriented;
  kind: number;
  brush: Brush;
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
  slot: number | null;
  /** Where the finger went down: a tray slot, the resting ghost, or bare hull. */
  from: "tray" | "ghost" | "board";
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
  touch: boolean;
  /** Anchor minus pointer, in cells, once the plate is in hand. */
  offX: number;
  offY: number;
}

type HudAction = "ccw" | "cw" | "flip" | "weld";

const COLORS = {
  // The hull is riveted gunmetal panels; a breach opens onto space through torn metal.
  hullA: 0x3a4250,
  hullB: 0x2a303b,
  hullEdge: 0x0e1218,
  breachTop: 0x0c1428,
  breachBottom: 0x03050a,
  tornMetal: 0xb4bcc8,
  breachEdge: 0x050709,
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

export class PlatingRenderer implements BoardRenderer<PlatingState> {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly hull = new Graphics();
  private readonly breachesG = new Graphics();
  private readonly breachFxG = new Graphics();
  private readonly platesG = new Graphics();
  private readonly markLayer = new Container();
  private readonly fxG = new Graphics();
  private readonly ghostG = new Graphics();
  private readonly trayG = new Graphics();
  private readonly trayPiecesG = new Graphics();
  private readonly trayText = new Container();
  private readonly hudG = new Graphics();
  private readonly dragG = new Graphics();
  private readonly textLayer = new Container();
  private readonly colorByKind = new Map<number, number>();
  private readonly markByKind = new Map<number, string>();
  private readonly breachFill = linear([COLORS.breachTop, COLORS.breachBottom]);
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private readonly flashes: Flash[] = [];
  private readonly popups: Popup[] = [];
  private readonly lifts: Lift[] = [];
  private readonly covers: Cover[] = [];
  private readonly timers: Timer[] = [];
  private landing: Landing | null = null;
  private flyback: Flyback | null = null;
  private shake: { life: number; max: number } | null = null;
  /** The ghost turning over on its vertical axis after a flip, so the button always answers. */
  private flipFx: { life: number; max: number; cx: number } | null = null;
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
  private state: PlatingState | null = null;
  private interactive = false;
  private destroyed = false;
  private framePending = false;
  private viewStale = true;
  private breachFxDirty = true;
  /**
   * The tray slot in hand, or null until the player picks one. A round starts with none. Only
   * `takeSlot` changes it, so a plate always comes out of the tray the way the tray shows it.
   */
  private slot: number | null = null;
  /** The orientation of the plate in hand. Unheld plates always show unturned in the tray. */
  private rot = 0;
  private flip = false;
  private anchor: { cx: number; cy: number } | null = null;
  private cursor: { col: number; row: number } | null = null;
  private drag: Drag | null = null;
  /** The toolbar's buttons, in canvas pixels, while it shows. */
  private hudRects: Array<{ x: number; y: number; w: number; h: number; action: HudAction }> = [];
  private hudPressed: { action: HudAction; life: number } | null = null;
  /** True after touch input: the toolbar shows for a plate set down. A mouse hovers and clicks instead. */
  private touchUI = false;
  /** Where the plate was when the player welded it, so the landing starts from there. */
  private pendingLand: { x: number; y: number; slot: number } | null = null;
  /** Where the last plate went, so the keyboard picks up from there after the ghost clears. */
  private lastOrigin: { col: number; row: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: PlatingContent,
    private readonly cb: PlatingCallbacks,
    private readonly opts: PlatingRendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, parseInt(p.color.slice(1), 16));
      this.markByKind.set(i, p.mark);
    });
    this.width = content.config.width;
    this.height = content.config.height;
  }

  /** True once the canvas exists, until `destroy` (the host's contract, ADR 0040). */
  get isReady(): boolean {
    return Boolean(this.app.renderer);
  }

  async init(): Promise<void> {
    await loadPuzzleSprites("plating");
    if (this.destroyed) return;
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      ...boardSurface(),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.dataset.spriteAtlas = spritesReady("plating") ? "plating" : "fallback";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "plating-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    this.host.appendChild(this.app.canvas);
    this.root.addChild(this.hull, this.breachesG, this.breachFxG, this.platesG, this.markLayer, this.fxG, this.ghostG, this.trayG, this.trayPiecesG, this.trayText, this.hudG, this.dragG, this.textLayer);
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
      this.breachFill.destroy();
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
    this.drawPlates();
    this.drawTrayPieces();
  }

  /** A new engine state. Plays what the last move did and redraws everything. */
  setState(state: PlatingState): void {
    if (!this.app.renderer) return;
    const prev = this.state;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    this.breachFxDirty = true;
    const rep = state.lastMove;
    const reset = !prev || prev === state || state.moveCount < prev.moveCount || (state.moveCount === prev.moveCount && state.lastMove === null);
    if (reset) {
      this.clearEffects();
      this.anchor = null;
      this.cursor = null;
      this.lastOrigin = null;
      this.pendingLand = null;
      // The round opens with the hull cracking: each breach breaks in turn.
      if (prev !== state) {
        state.breaches.forEach((h, i) => this.covers.push({ cells: h.cells, delay: 120 + i * 140, life: 0, max: this.dur(320), opening: true, grew: false }));
      }
    } else if (prev && rep && rep.move.type === "place" && rep.placed) {
      this.playMove(prev, state);
    }
    if (reset || (this.slot !== null && this.slot >= state.slots.length)) {
      this.takeSlot(null);
      this.drawTrayFrame();
    }
    this.syncCursor();
    this.drawBreaches();
    this.drawPlates();
    this.drawTrayPieces();
    this.drawGhost();
  }

  private playMove(prev: PlatingState, state: PlatingState): void {
    const rep = state.lastMove!;
    if (rep.move.type !== "place" || !rep.placed) return;
    const plate = rep.placed.plate;
    const waste = rep.placed.wasteCells.length > 0;
    const rel = relative(plate.cells, this.width);
    const x1 = this.ox + rel.col * this.cell;
    const y1 = this.oy + rel.row * this.cell;
    const from = this.pendingLand && this.pendingLand.slot === rep.move.slot ? this.pendingLand : null;
    this.pendingLand = null;
    const landMs = this.dur(from && Math.hypot(from.x - x1, from.y - y1) > this.cell ? 170 : 110);
    if (this.landing) this.cb.onNailed(this.landing.waste);
    this.landing = {
      plateId: plate.id,
      cells: rel.cells,
      kind: plate.kind,
      brush: plate.brush,
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
    if (rep.sealed) {
      const sealed = rep.sealed;
      const gone = [...prev.plates.filter((p) => p.breachId === sealed.breachId), plate];
      gone.forEach((p, i) => {
        const r = relative(p.cells, this.width);
        this.lifts.push({ cells: r.cells, x: this.ox + r.col * this.cell, y: this.oy + r.row * this.cell, kind: p.kind, brush: p.brush, delay: t + 60 + i * 50, life: 0, max: this.dur(460) });
      });
      this.at(t + 40, () => {
        this.flash(sealed.cells, COLORS.brassLight, 650);
        const first = sealed.cells[Math.floor(sealed.cells.length / 2)]!;
        this.popup(this.cx(first % this.width), this.cy(Math.floor(first / this.width)), `+${sealed.points}`, COLORS.brassLight, 0.55);
        const tone = sealed.rating === "flawless" ? COLORS.brassLight : sealed.rating === "gum" ? COLORS.illegal : 0xefe3c6;
        this.callout(this.opts.ratingLabel(sealed.rating), tone, 0.3);
        if (sealed.chain >= 2) this.callout(this.opts.streakLabel(sealed.chain), COLORS.brassLight, 0.42);
        if (sealed.brushBonus) this.callout(this.opts.brushLabel, COLORS.legal, sealed.chain >= 2 ? 0.52 : 0.42);
        this.cb.onSealed(sealed.rating, sealed.chain);
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
    // The slot refills under the player, and nothing is in hand until they pick again.
    this.refill = { slot: rep.move.slot, life: 0, max: this.dur(220) };
    this.lastOrigin = this.cursor;
    this.anchor = null;
    this.takeSlot(null);
    this.drawTrayFrame();
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
    this.drawBreaches();
    this.drawPlates();
    this.drawTrayFrame();
    this.drawTrayPieces();
    this.syncCursor();
    this.drawGhost();
    this.breachFxDirty = true;
  }

  private drawHull(): void {
    const g = this.hull;
    const s = this.cell;
    const W = this.width * s;
    const H = this.height * s;
    g.clear();
    g.roundRect(this.ox - 6, this.oy - 6, W + 12, H + 12, 10).fill({ color: 0x000000, alpha: 0.45 });
    // Plating: staggered panels two cells long, riveted at each end.
    for (let r = 0; r < this.height; r++) {
      const y = this.oy + r * s;
      g.rect(this.ox, y, W, s).fill(this.hullColor(r));
      const offset = r % 2 === 0 ? 0 : s;
      for (let x = this.ox - offset; x < this.ox + W; x += s * 2) {
        const x0 = Math.max(this.ox, x);
        const x1 = Math.min(this.ox + W, x + s * 2);
        g.rect(x0, y + 1, x1 - x0, s - 2).stroke({ width: 1, color: COLORS.hullEdge, alpha: 0.55 });
        g.rect(x0 + 1, y + 2, x1 - x0 - 2, 1).fill({ color: HULL.sheen, alpha: 0.12 });
        for (const rx of [x + s * 0.18, x + s * 1.82]) if (rx > this.ox && rx < this.ox + W) hullRivet(g, rx, y + s * 0.5, Math.max(1, s * 0.055));
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

  private drawBreaches(): void {
    const g = this.breachesG;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    for (const h of this.state.breaches) {
      const set = new Set(h.cells);
      for (const c of h.cells) {
        const col = c % this.width;
        const row = Math.floor(c / this.width);
        const x = this.ox + col * s;
        const y = this.oy + row * s;
        g.rect(x, y, s, s).fill(this.breachFill);
        starField(g, x, y, s, s, 2.2, c + 1);
        // Torn rim: bright metal where the plating was ripped inward, a shadow under the far edges.
        const edge = (cc: number, rr: number): boolean => cc < 0 || cc >= this.width || rr < 0 || rr >= this.height || !set.has(rr * this.width + cc);
        if (edge(col, row - 1)) {
          g.rect(x, y, s, 3).fill({ color: COLORS.tornMetal, alpha: 0.45 });
          for (let k = 0.15; k < 1; k += 0.35) g.poly([x + s * k, y + 3, x + s * (k + 0.1), y + 3, x + s * (k + 0.04), y + 3 + s * 0.16]).fill({ color: COLORS.tornMetal, alpha: 0.35 });
        }
        if (edge(col - 1, row)) g.rect(x, y, 3, s).fill({ color: COLORS.tornMetal, alpha: 0.3 });
        if (edge(col, row + 1)) g.rect(x, y + s - 3, s, 3).fill({ color: 0x000000, alpha: 0.5 });
        if (edge(col + 1, row)) g.rect(x + s - 3, y, 3, s).fill({ color: 0x000000, alpha: 0.35 });
      }
      this.strokeRegion(g, set, 0, { width: 2, color: COLORS.breachEdge, alpha: 0.9 });
    }
  }

  /** Per-frame breach overlays: an idle breach about to widen pulses amber, then red. */
  private drawBreachFx(): void {
    const g = this.breachFxG;
    if (!this.state) {
      g.clear();
      return;
    }
    const grow = this.state.config.growAfterMoves;
    const warn = this.state.breaches.filter((h) => grow - h.idleMoves <= 2);
    if (warn.length === 0) {
      if (this.breachFxDirty) g.clear();
      this.breachFxDirty = false;
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

  private drawPlates(): void {
    const g = this.platesG;
    g.clear();
    this.markLayer.removeChildren().forEach((c) => c.destroy());
    if (!this.state) return;
    const s = this.cell;
    const breachOf = platingBreachIndex(this.state);
    for (const p of this.state.plates) {
      if (this.landing && this.landing.plateId === p.id) continue;
      const r = relative(p.cells, this.width);
      this.paintPlate(g, r.cells, this.ox + r.col * s, this.oy + r.row * s, s, p.kind, p.brush, 1);
      if (this.showMarks) {
        const c0 = p.cells[Math.floor(p.cells.length / 2)]!;
        const t = new Text({ text: MARK_GLYPH[this.markByKind.get(p.kind) ?? "square"] ?? "■", style: { fontSize: s * 0.4, fill: 0xffffff } });
        t.alpha = 0.7;
        t.anchor.set(0.5);
        t.position.set(this.cx(c0 % this.width), this.cy(Math.floor(c0 / this.width)));
        this.markLayer.addChild(t);
      }
    }
    // Waste: hull covered by a plate, or breach cells covered twice. Hatched so it reads without color.
    for (let c = 0; c < this.state.covered.length; c++) {
      const n = this.state.covered[c]!;
      if (n === 0) continue;
      if (breachOf.has(c) ? n > 1 : n > 0) {
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

  private paintPlateCell(g: Graphics, x: number, y: number, s: number, color: number, brush: Brush, alpha: number): void {
    const kind = [...this.colorByKind].find(([, c]) => c === color)?.[0];
    const metal = kind === undefined ? undefined : ["tin", "copper", "steel", "brass"][kind];
    if (metal && paintSprite(g, "plating", `${metal}-${brush}`, x, y, s, s, alpha)) return;
    g.rect(x, y, s, s).fill({ color, alpha });
    g.setStrokeStyle({ width: 1, color: mix(color, 0x000000, 0.35), alpha: 0.7 * alpha });
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const k = (i / (n + 1)) * s;
      if (brush === "h") g.moveTo(x + 2, y + k).lineTo(x + s - 2, y + k + (i % 2 ? 1 : -1)).stroke();
      else g.moveTo(x + k, y + 2).lineTo(x + k + (i % 2 ? 1 : -1), y + s - 2).stroke();
    }
    g.rect(x, y, s, s * 0.18).fill({ color: 0xffffff, alpha: 0.12 * alpha });
  }

  /** A whole plate: its cells with their brushing, and an outline around the outside only. */
  private paintPlate(g: Graphics, cells: Oriented, x0: number, y0: number, m: number, kind: number, brush: Brush, alpha: number): void {
    const color = this.colorByKind.get(kind) ?? COLORS.tornMetal;
    for (const [dx, dy] of cells) this.paintPlateCell(g, x0 + dx * m, y0 + dy * m, m, color, brush, alpha);
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

  /** A plate with a soft shadow under it, as if held above the hull. */
  private paintHeldPlate(g: Graphics, cells: Oriented, x0: number, y0: number, m: number, kind: number, brush: Brush, lift: number): void {
    const sh = m * 0.12 + lift;
    for (const [dx, dy] of cells) g.rect(x0 + dx * m + sh * 0.6, y0 + dy * m + sh, m, m).fill({ color: 0x000000, alpha: 0.35 });
    this.paintPlate(g, cells, x0, y0, m, kind, brush, 0.92);
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

  /** The ghost: the selected plate where it would go, green when it fits, red when it does not. */
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
   * The toolbar under a plate set down by touch: turn either way, flip, and a welder to weld. It
   * follows the plate, below it or above it near the keel. Hidden while the plate is in hand and for a
   * mouse, which hovers and clicks.
   */
  private drawHud(): void {
    const g = this.hudG;
    g.clear();
    this.hudRects = [];
    const fp = this.footprint();
    const show = this.state && this.interactive && !this.state.finished && this.cursor && fp && this.touchUI && !this.drag?.moved;
    if (!show) return;
    const s = this.cell;
    const cursor = this.cursor!;
    const legal = this.check(cursor.col, cursor.row)?.legal ?? false;
    const b = Math.max(46, s * 1.25);
    const gap = Math.max(5, s * 0.14);
    const actions: HudAction[] = ["ccw", "cw", "flip", "weld"];
    const W = b * actions.length + gap * (actions.length + 1);
    const H = b + gap * 2;
    const wanted = this.ox + (cursor.col + fp!.w / 2) * s - W / 2;
    const x0 = Math.max(this.ox - 4, Math.min(this.ox + this.width * s + 4 - W, wanted));
    let y0 = this.oy + (cursor.row + fp!.h) * s + s * 0.2;
    if (y0 + H > this.oy + this.height * s + 4) y0 = this.oy + cursor.row * s - s * 0.2 - H;
    g.roundRect(x0, y0 + 3, W, H, 12).fill({ color: 0x000000, alpha: 0.4 });
    g.roundRect(x0, y0, W, H, 12).fill({ color: COLORS.ink, alpha: 0.94 });
    g.roundRect(x0, y0, W, H, 12).stroke({ width: 1.5, color: COLORS.brass, alpha: 0.55 });
    actions.forEach((action, i) => {
      const x = x0 + gap + i * (b + gap);
      const y = y0 + gap;
      const down = this.hudPressed?.action === action;
      const enabled = action !== "weld" || legal;
      const dy = down ? 1 : 0;
      if (action === "weld") {
        g.roundRect(x, y + dy, b, b, 9).fill({ color: enabled ? COLORS.legal : 0x2b3a4a, alpha: enabled ? (down ? 0.8 : 1) : 0.7 });
        g.roundRect(x, y + dy, b, b, 9).stroke({ width: 1.5, color: enabled ? 0xffffff : 0x5a6a7a, alpha: 0.7 });
      } else {
        g.roundRect(x, y + dy, b, b, 9).fill({ color: down ? 0x4a3018 : 0x2a1b10 });
        g.roundRect(x, y + dy, b, b, 9).stroke({ width: 1.5, color: down ? COLORS.brassLight : COLORS.brass, alpha: 0.85 });
      }
      this.hudRects.push({ x, y, w: b, h: b, action });
      const cx = x + b / 2;
      const cy = y + b / 2 + dy;
      const r = b * 0.27;
      if (action === "ccw" || action === "cw") drawTurnIcon(g, cx, cy, r, action === "cw", COLORS.brassLight);
      else if (action === "flip") drawFlipIcon(g, cx, cy, r, COLORS.brassLight);
      else drawWelderIcon(g, cx, cy, r, enabled ? COLORS.ink : 0x8a96a4);
    });
  }

  private paintGhost(g: Graphics, check: PlatingPlacementCheck | null, col: number, row: number, strength: number): void {
    const s = this.cell;
    const piece = this.slot === null ? null : this.state!.slots[this.slot];
    if (!piece) return;
    const cells = platingOrient(piece.shape, this.rot, this.flip);
    const legal = check?.legal ?? false;
    const color = legal ? COLORS.legal : COLORS.illegal;
    const kindColor = this.colorByKind.get(piece.kind) ?? COLORS.tornMetal;
    // The breach this plate would join, so the player sees which patch they are working.
    if (legal && check?.breachId !== null && check?.breachId !== undefined && this.state) {
      const breach = this.state.breaches.find((h) => h.id === check.breachId);
      if (breach) this.strokeRegion(g, new Set(breach.cells), 1, { width: 2, color: COLORS.legal, alpha: 0.4 * strength });
    }
    const brush = platingEffectiveBrush(piece.brush, this.rot);
    for (const [dx, dy] of cells) {
      const cc = col + dx;
      const rr = row + dy;
      if (cc < 0 || cc >= this.width || rr < 0 || rr >= this.height) continue;
      const x = this.ox + cc * s;
      const y = this.oy + rr * s;
      if (legal) this.paintPlateCell(g, x + 1, y + 1, s - 2, kindColor, brush, 0.5 * strength);
      else g.rect(x + 2, y + 2, s - 4, s - 4).fill({ color: kindColor, alpha: 0.22 * strength });
    }
    const set = new Set(cells.filter(([x, y]) => col + x >= 0 && col + x < this.width && row + y >= 0 && row + y < this.height).map(([x, y]) => (row + y) * this.width + (col + x)));
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
      this.paintMini(g, piece.shape, piece.kind, platingEffectiveBrush(piece.brush, rot), rot, flip, r.x + r.w / 2, r.y + r.h / 2, m, alpha);
    });
  }

  private paintMini(g: Graphics, shape: number, kind: number, brush: Brush, rot: number, flip: boolean, cx: number, cy: number, m: number, alpha: number): void {
    const cells = platingOrient(shape, rot, flip);
    const { w, h } = platingExtent(cells);
    this.paintPlate(g, cells, cx - (w * m) / 2, cy - (h * m) / 2, m, kind, brush, alpha);
    if (this.showMarks && alpha > 0.5) {
      // The metal's own mark on the mini, so the tray reads without color like the board plates do.
      const [mx, my] = cells[Math.floor(cells.length / 2)]!;
      g.circle(cx - (w * m) / 2 + (mx + 0.5) * m, cy - (h * m) / 2 + (my + 0.5) * m, m * 0.34).fill({ color: 0x000000, alpha: 0.45 * alpha });
      drawMark(g, cx - (w * m) / 2 + (mx + 0.5) * m, cy - (h * m) / 2 + (my + 0.5) * m, m * 0.26, this.markByKind.get(kind) ?? "square", 0xffffff);
    }
  }

  /** Top-left pixel of a mini plate in its slot, for flybacks. */
  private miniOrigin(slot: number, cells: Oriented): { x: number; y: number; m: number } {
    const r = this.slotRects[slot]!;
    const m = Math.min(r.w, r.h) / 5.6;
    const { w, h } = platingExtent(cells);
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

    // Hull covers: sound plating that cracks away to show a breach.
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
      // Each panel tears inward: the cover shrinks toward its centre and fades.
      const e = easeIn(k);
      for (const cell of c.cells) {
        const x = this.ox + (cell % this.width) * s;
        const y = this.oy + Math.floor(cell / this.width) * s;
        const inset = (s / 2) * e;
        g.rect(x + inset, y + inset, s - inset * 2, s - inset * 2).fill({ color: this.hullColor(Math.floor(cell / this.width)), alpha: 1 - e * 0.5 });
        g.rect(x + inset, y + inset, s - inset * 2, s - inset * 2).stroke({ width: 2, color: COLORS.tornMetal, alpha: 0.6 * (1 - k) });
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

    // Lifts: a sealed breach's plates rise and fade.
    for (let i = this.lifts.length - 1; i >= 0; i--) {
      const l = this.lifts[i]!;
      if (l.delay > 0) {
        l.delay -= dt;
        this.paintPlate(g, l.cells, l.x, l.y, s, l.kind, l.brush, 1);
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
      const { w, h } = platingExtent(l.cells);
      const x = l.x - (w * s * (grow - 1)) / 2;
      const y = l.y - rise - (h * s * (grow - 1)) / 2;
      for (const [dx, dy] of l.cells) g.rect(x + dx * s * grow + 3, l.y + dy * s + 4, s * grow, s).fill({ color: 0x000000, alpha: 0.25 * (1 - k) });
      this.paintPlate(g, l.cells, x, y, s * grow, l.kind, l.brush, 1 - easeIn(k));
    }

    // Landing: the welded plate slides home and settles with a knock.
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
        this.drawPlates();
      } else {
        const e = easeOut(k);
        const x = l.x0 + (l.x1 - l.x0) * e;
        const y = l.y0 + (l.y1 - l.y0) * e;
        const lift = (1 - e) * s * 0.25;
        const grow = 1 + 0.08 * (1 - e);
        const { w, h } = platingExtent(l.cells);
        const gx = x - (w * s * (grow - 1)) / 2;
        const gy = y - (h * s * (grow - 1)) / 2;
        this.paintHeldPlate(g, l.cells, gx, gy, s * grow, l.kind, l.brush, lift);
      }
    }

    // Flyback: a refused plate returns to its slot.
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
        this.paintHeldPlate(dg, f.cells, f.x0 + (f.x1 - f.x0) * e, f.y0 + (f.y1 - f.y0) * e, m, f.kind, f.brush, (1 - e) * s * 0.3);
      }
    }

    let ghostX = 0;
    if (this.shake) {
      this.shake.life += dt;
      const k = this.shake.life / this.shake.max;
      if (k >= 1) this.shake = null;
      else ghostX += Math.sin(k * Math.PI * 5) * (1 - k) * s * 0.18;
    }
    if (this.flipFx) {
      // Squash to a sliver about the plate's centre and back out: a card turning over.
      this.flipFx.life += dt;
      const k = this.flipFx.life / this.flipFx.max;
      if (k >= 1) {
        this.flipFx = null;
        this.ghostG.scale.x = 1;
      } else {
        const sx = Math.max(0.06, Math.abs(Math.cos(k * Math.PI)));
        this.ghostG.scale.x = sx;
        ghostX += this.flipFx.cx * (1 - sx);
      }
    }
    this.ghostG.x = ghostX;

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

    this.drawBreachFx();

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

  /** Mirrors what the canvas shows, for the smoke test: h for an open breach cell, . for hull, else the cover count. */
  private publishView(): void {
    this.viewStale = false;
    if (!this.state) return;
    const breachOf = platingBreachIndex(this.state);
    const out: string[] = [];
    for (let c = 0; c < this.state.covered.length; c++) {
      const n = this.state.covered[c]!;
      out.push(n > 0 ? String(n) : breachOf.has(c) ? "h" : ".");
    }
    this.app.canvas.setAttribute("data-view", out.join(""));
    const fp = this.footprint();
    this.app.canvas.setAttribute("data-cursor", this.cursor ? `${this.cursor.col},${this.cursor.row}` : "");
    this.app.canvas.setAttribute("data-ghost", this.cursor && fp ? `${this.cursor.col},${this.cursor.row},${fp.w},${fp.h}` : "");
    this.app.canvas.setAttribute("data-geometry", `${this.ox},${this.oy},${this.cell}`);
    this.app.canvas.setAttribute("data-orient", `${this.slot ?? -1},${this.rot},${this.flip ? 1 : 0}`);
    this.app.canvas.setAttribute("data-hud", this.hudRects.map((r) => `${r.action}:${Math.round(r.x + r.w / 2)},${Math.round(r.y + r.h / 2)}`).join(";"));
  }

  // ---- selection and placement

  private check(col: number, row: number): PlatingPlacementCheck | null {
    if (!this.state || this.slot === null) return null;
    return platingCheckPlacement(this.state, this.slot, this.rot, this.flip, col, row);
  }

  /** The selected plate's oriented cells and bounding box. */
  private footprint(): { cells: Oriented; w: number; h: number } | null {
    const piece = this.slot === null ? null : this.state?.slots[this.slot];
    if (!piece) return null;
    const cells = platingOrient(piece.shape, this.rot, this.flip);
    const { w, h } = platingExtent(cells);
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
    // A plate may hang off the hull (the overhang is waste), as long as one cell of its box stays on it.
    const col = Math.max(1 - fp.w, Math.min(this.width - 1, Math.round(this.anchor.cx - fp.w / 2)));
    const row = Math.max(1 - fp.h, Math.min(this.height - 1, Math.round(this.anchor.cy - fp.h / 2)));
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
   * Put the plate's centre at a point on the canvas. When the spot does not take the plate but a
   * neighbouring one does, it snaps there: dropping near a breach is enough.
   */
  private anchorNear(x: number, y: number, liftCells: number): void {
    const fp = this.footprint();
    const slot = this.slot;
    if (!fp || !this.state || slot === null) return;
    const cx = (x - this.ox) / this.cell;
    const cy = (y - this.oy) / this.cell - liftCells;
    if (cx < -0.6 || cx > this.width + 0.6 || cy < -0.6 || cy > this.height + 0.6) {
      this.anchor = null;
      this.syncCursor();
      return;
    }
    const col0 = Math.max(1 - fp.w, Math.min(this.width - 1, Math.round(cx - fp.w / 2)));
    const row0 = Math.max(1 - fp.h, Math.min(this.height - 1, Math.round(cy - fp.h / 2)));
    const breachOf = platingBreachIndex(this.state);
    let best: { col: number; row: number; d: number; waste: number } | null = null;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = col0 + dc;
        const row = row0 + dr;
        const check = platingCheckPlacement(this.state, slot, this.rot, this.flip, col, row, breachOf);
        if (!check.legal) continue;
        const d = Math.hypot(col + fp.w / 2 - cx, row + fp.h / 2 - cy);
        if (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) < 1e-6 && check.wasteCells.length + check.overhang < best.waste)) best = { col, row, d, waste: check.wasteCells.length + check.overhang };
      }
    }
    if (best) this.anchor = { cx: best.col + fp.w / 2, cy: best.row + fp.h / 2 };
    else this.anchor = { cx: col0 + fp.w / 2, cy: row0 + fp.h / 2 };
    this.syncCursor();
  }

  /**
   * Change the plate in hand. A newly picked plate starts unturned, exactly as its slot showed it,
   * rather than inheriting the turn of whichever plate was held before.
   */
  private takeSlot(slot: number | null): void {
    if (slot === this.slot) return;
    this.slot = slot;
    this.rot = 0;
    this.flip = false;
    this.viewStale = true;
  }

  private select(slot: number): void {
    if (!this.state || slot < 0 || slot >= this.state.slots.length) return;
    if (this.slot !== slot) {
      this.takeSlot(slot);
      this.cb.onNudge();
      this.drawTrayFrame();
    }
    this.syncCursor();
    this.drawTrayPieces();
    this.drawGhost();
  }

  /** Turn or flip the selected plate about its centre, so the ghost stays put. */
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

  /**
   * Mirror the plate left to right as it appears. The engine mirrors the base shape before turning
   * it, so a mirror of the turned plate is the base mirror with the turn reversed. The ghost turns
   * over on its vertical axis as it does, so a plate symmetric on screen still answers the press.
   */
  private doFlip(): void {
    const fp = this.footprint();
    if (this.cursor && fp) this.flipFx = { life: 0, max: this.dur(280), cx: this.ox + (this.cursor.col + fp.w / 2) * this.cell };
    this.reorient((4 - this.rot) % 4, !this.flip);
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
   * Jump the ghost to the next spot where the plate fits best: the placements with the least waste,
   * cycled in reading order from the cursor.
   */
  private jumpToFit(): void {
    if (!this.state || this.slot === null) return;
    const breachOf = platingBreachIndex(this.state);
    const total = this.width * this.height;
    let bestWaste = Infinity;
    const fits: Array<{ i: number; waste: number }> = [];
    for (let i = 0; i < total; i++) {
      const check = platingCheckPlacement(this.state, this.slot, this.rot, this.flip, i % this.width, Math.floor(i / this.width), breachOf);
      if (!check.legal) continue;
      const waste = check.wasteCells.length + check.overhang;
      fits.push({ i, waste });
      bestWaste = Math.min(bestWaste, waste);
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

  /** Weld the plate down at the ghost, or refuse with a shake. */
  private placeAt(col: number, row: number, from: { x: number; y: number } | null): boolean {
    if (this.slot === null) return false;
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

  /** True when a point lies within the ghost's bounding box, so a notch in the plate still counts as the plate. */
  private onGhost(x: number, y: number): boolean {
    const cell = this.boardCell(x, y);
    const fp = this.footprint();
    if (!cell || !fp || !this.cursor) return false;
    return cell.col >= this.cursor.col && cell.col < this.cursor.col + fp.w && cell.row >= this.cursor.row && cell.row < this.cursor.row + fp.h;
  }

  /** Whether a drag carries the plate. A finger on bare hull only taps or swipes; a mouse always carries. */
  private carries(d: Drag): boolean {
    return d.from !== "board" || !d.touch;
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive || !this.state) return;
    const { x, y } = e.global;
    // One finger at a time; a right click turns the plate.
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
      if (button.action === "cw") this.rotate(1);
      else if (button.action === "ccw") this.rotate(-1);
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
      // Grabbing the plate keeps it under the same point of the finger.
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
      // A mouse hovering over the hull carries the plate with it.
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

  /** The plate in hand: drawn under the pointer (lifted on touch), with the ghost snapped beneath it. */
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
    if (this.slot === null) return;
    const piece = this.state.slots[this.slot]!;
    const m = this.cell * 1.04;
    const x0 = px - (fp.w * m) / 2;
    const y0 = py - (fp.h * m) / 2;
    this.paintHeldPlate(g, fp.cells, x0, y0, m, piece.kind, platingEffectiveBrush(piece.brush, this.rot), this.cell * 0.3);
    // The verdict rides on top of the plate, since on touch the plate sits over its own ghost.
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
      // Judge the plate where the finger lifted, not where the last processed move left it.
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
        // Let go over the hull: the plate rests there with its toolbar until it is moved or welded.
        this.drawGhost();
        this.drawTrayPieces();
        this.viewStale = true;
        this.cb.onNudge();
        return;
      }
      // Let go off the hull: back to its slot.
      if (this.slot === null) return;
      const piece = this.state.slots[this.slot]!;
      const home = this.miniOrigin(this.slot, fp.cells);
      const px = x + d.offX * this.cell - (fp.w * this.cell) / 2;
      const py = y + d.offY * this.cell - (fp.h * this.cell) / 2;
      this.flyback = { cells: fp.cells, kind: piece.kind, brush: platingEffectiveBrush(piece.brush, this.rot), x0: px, y0: py, x1: home.x, y1: home.y, m0: this.cell, m1: home.m, slot: this.slot, life: 0, max: this.dur(240) };
      this.syncCursor();
      this.drawGhost();
      return;
    }
    if (d.from === "tray") return;
    const cell = this.boardCell(x, y);
    if (!cell) return;
    if (!d.touch) {
      // Mouse: the ghost already follows the pointer, so a click welds it.
      this.anchorNear(x, y, 0);
      if (this.cursor) this.placeAt(this.cursor.col, this.cursor.row, null);
      return;
    }
    // Touch: a tap on the plate does nothing (its toolbar is right there); a tap on bare hull brings it.
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

  /** Keyboard: 1-3 pick a plate, arrows move it, R or E turn, Q turns back, F flips, H finds a fit, Enter or Space welds it. */
  keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    // Anything done to a plate needs one in hand; the keyboard starts with the first slot.
    if (this.slot === null && !["1", "2", "3", "Escape"].includes(key)) this.select(0);
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
        // Put the plate back and let go of it entirely.
        this.anchor = null;
        this.takeSlot(null);
        this.syncCursor();
        this.drawTrayFrame();
        this.drawTrayPieces();
        this.drawGhost();
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

/** A three-quarter arc with an arrowhead, curling clockwise or back. */
function drawTurnIcon(g: Graphics, cx: number, cy: number, r: number, clockwise: boolean, color: number): void {
  const start = clockwise ? Math.PI * 0.75 : Math.PI * 0.25;
  const end = clockwise ? Math.PI * 0.25 : Math.PI * 0.75;
  // The arc continues the current path, so start it at its own first point.
  g.moveTo(cx + r * Math.cos(start), cy + r * Math.sin(start));
  g.arc(cx, cy, r, start, end, !clockwise).stroke({ width: Math.max(2, r * 0.28), color, cap: "round" });
  // Arrowhead along the tangent at the end of the arc.
  const ex = cx + r * Math.cos(end);
  const ey = cy + r * Math.sin(end);
  const dir = clockwise ? 1 : -1;
  const tx = -Math.sin(end) * dir;
  const ty = Math.cos(end) * dir;
  const k = r * 0.75;
  g.poly([ex + tx * k * 0.9, ey + ty * k * 0.9, ex - tx * k * 0.3 + ty * k * 0.6, ey - ty * k * 0.3 - tx * k * 0.6, ex - tx * k * 0.3 - ty * k * 0.6, ey - ty * k * 0.3 + tx * k * 0.6]).fill(color);
}

/** Two triangles mirrored across a dashed axis. */
function drawFlipIcon(g: Graphics, cx: number, cy: number, r: number, color: number): void {
  const w = Math.max(1.5, r * 0.2);
  for (let y = -r; y < r; y += r * 0.5) g.moveTo(cx, cy + y).lineTo(cx, cy + Math.min(r, y + r * 0.25)).stroke({ width: w, color, alpha: 0.8 });
  const gapX = r * 0.3;
  g.poly([cx - gapX, cy - r * 0.8, cx - gapX, cy + r * 0.8, cx - r * 1.1, cy + r * 0.8]).stroke({ width: w, color, join: "round" });
  g.poly([cx + gapX, cy - r * 0.8, cx + gapX, cy + r * 0.8, cx + r * 1.1, cy + r * 0.8]).fill(color);
}

/** A mallet: a broad head on a tilted handle. */
function drawWelderIcon(g: Graphics, cx: number, cy: number, r: number, color: number): void {
  const a = -Math.PI / 5;
  const rot = (x: number, y: number): [number, number] => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
  const head = [rot(-r * 1.0, -r * 1.05), rot(r * 1.0, -r * 1.05), rot(r * 1.0, -r * 0.4), rot(-r * 1.0, -r * 0.4)].flat();
  const handle = [rot(-r * 0.17, -r * 0.4), rot(r * 0.17, -r * 0.4), rot(r * 0.17, r * 1.3), rot(-r * 0.17, r * 1.3)].flat();
  g.poly(handle).fill(color);
  g.poly(head).fill(color);
}

/** Board cells of a plate as offsets from its top-left corner. */
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

