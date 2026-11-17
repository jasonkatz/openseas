import { sfx, soundsFor } from "../audio.js";
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent, type FederatedWheelEvent } from "pixi.js";
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
import type { PieceColor, PlatingContent } from "@openseas/content";
import { boardSurface } from "../surface.js";
import { FONT, MOTION, RADIUS, blend, ink } from "../look/tokens.js";
import { plateBox, plateCanvas, type PlateCells, type PlateCut } from "./pieces.js";

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
  ratingLabel(rating: BreachRating): string;
  streakLabel(count: number): string;
  brushLabel: string;
  grewLabel: string;
}

type Oriented = Array<[number, number]>;

/** The cell a breach just gained, ringed in danger for a moment so the player sees where it widened. */
interface Widened {
  cells: readonly number[];
  life: number;
  max: number;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

/** A plate going down: it slides from where it was held to its cells. */
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

/** A sealed breach's plate coming off the hull: it shrinks to nothing. Drawn in place while `delay` runs down. */
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

/** Sound hull over a breach that is about to open; shrinks away to reveal it. */
interface Cover {
  cells: readonly number[];
  delay: number;
  life: number;
  max: number;
  opening: boolean;
  grew: boolean;
}

/** A plate that would not go where it was dropped, on its way back to its tray slot. */
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

/**
 * Every colour the board draws, from the game's one palette (docs/BRAND.md section 2). The hull is
 * a raised slab and a breach is the ground showing through it. Amber is the player's own plate and
 * the beat; danger is waste, a refusal and a breach about to widen.
 */
const COLORS = {
  ground: ink("ground"),
  raised: ink("raised"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  amber: ink("amber"),
  danger: ink("danger"),
};
const TRAY_ROWS = 3.1;
const LIFT_TOUCH = 1.15;
const MOVE_MS = MOTION.move;
const CLEAR_MS = MOTION.clear;
const BEAT_MS = MOTION.beat;
/** A refused weld shows on the plate for this long. */
const DENIED_MS = 260;
/** A flawless seal of a breach this many plates big is a beat by itself. */
const BIG_SEAL_PLATES = 3;

/** Baked plates kept before the ones no longer on screen are dropped. */
const BAKED_MAX = 96;

const easeOut = (k: number): number => 1 - (1 - k) ** 3;

/**
 * Plates on one layer of the board, as sprites of baked textures. Whoever draws the layer resets
 * it and puts back what it shows now, as it would clear and repaint a Graphics.
 */
class PlateLayer extends Container {
  private used = 0;

  reset(): void {
    for (const c of this.children) {
      c.visible = false;
      (c as Sprite).texture = Texture.EMPTY;
    }
    this.used = 0;
  }

  put(texture: Texture, x: number, y: number, w: number, h: number, alpha: number): void {
    let sprite = this.children[this.used] as Sprite | undefined;
    if (!sprite) sprite = this.addChild(new Sprite());
    this.used++;
    sprite.texture = texture;
    sprite.visible = true;
    sprite.alpha = alpha;
    sprite.position.set(x, y);
    sprite.setSize(w, h);
  }

  /** The textures this layer is showing. */
  collect(into: Set<Texture>): void {
    for (const c of this.children) if (c.visible) into.add((c as Sprite).texture);
  }
}

export class PlatingRenderer {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly hull = new Graphics();
  private readonly breachesG = new Graphics();
  private readonly breachFxG = new Graphics();
  private readonly platesL = new PlateLayer();
  /** Waste marks, over the plates. */
  private readonly platesG = new Graphics();
  private readonly fxG = new Graphics();
  private readonly fxL = new PlateLayer();
  /** The rim of the breach the plate in hand would join. */
  private readonly joinG = new Graphics();
  /** The ghost's plate and its ring, together so a flip turns both over. */
  private readonly ghostWrap = new Container();
  private readonly ghostL = new PlateLayer();
  private readonly ghostG = new Graphics();
  private readonly trayG = new Graphics();
  private readonly trayL = new PlateLayer();
  private readonly trayText = new Container();
  private readonly hudG = new Graphics();
  private readonly dragL = new PlateLayer();
  private readonly dragG = new Graphics();
  private readonly beatLayer = new Graphics();
  private readonly textLayer = new Container();
  private readonly colorByKind = new Map<number, PieceColor>();
  private readonly cutByKind = new Map<number, PlateCut>();
  /** Each plate drawn so far, baked to a texture at the size it is shown (ADR 0062). */
  private readonly baked = new Map<string, Texture>();
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private readonly widened: Widened[] = [];
  private readonly popups: Popup[] = [];
  private readonly lifts: Lift[] = [];
  private readonly covers: Cover[] = [];
  private readonly timers: Timer[] = [];
  private landing: Landing | null = null;
  private flyback: Flyback | null = null;
  /** A weld the board refused: the plate shows in danger while this runs. */
  private denied: { life: number } | null = null;
  /** The beat: one amber pulse of the whole board for a big moment (docs/BRAND.md section 6). */
  private beatNow: { life: number; strength: number } | null = null;
  /** The ghost turning over on its vertical axis after a flip, so the button always answers. */
  private flipFx: { life: number; max: number; cx: number } | null = null;
  private refill: { slot: number; life: number; max: number } | null = null;
  private clock = 0;
  private cell = 36;
  /** A cell of a plate waiting in the tray, in pixels. */
  private mini = 18;
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
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, p.color);
      this.cutByKind.set(i, p.cut);
    });
    this.width = content.config.width;
    this.height = content.config.height;
  }

  /** This puzzle's picked samples play while the board is open (ADR 0041). */
  private readonly releaseSounds = soundsFor("plating");

  async init(): Promise<void> {
    // Points and callouts are drawn as text, so wait (briefly) for the webfont. Before the renderer
    // is made, not after: the board hands over a state as soon as there is one, and by then the layout must be in.
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
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
    // No atlas to wait for: the plates are drawn in code (ADR 0062). The studio's thumbnails read this.
    this.app.canvas.dataset.pieces = "drawn";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "plating-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    this.host.appendChild(this.app.canvas);
    this.ghostWrap.addChild(this.ghostL, this.ghostG);
    this.root.addChild(this.hull, this.breachesG, this.breachFxG, this.platesL, this.platesG, this.fxG, this.fxL, this.joinG, this.ghostWrap, this.trayG, this.trayL, this.trayText, this.hudG, this.dragL, this.dragG, this.beatLayer, this.textLayer);
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
    this.releaseSounds();
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      for (const tex of this.baked.values()) tex.destroy(true);
    }
  }

  private clearDrag(): void {
    this.dragG.clear();
    this.dragL.reset();
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.drag = null;
      this.clearDrag();
      this.drawTrayPieces();
    }
    this.drawGhost();
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
      // The round opens with the hull giving way: each breach opens in turn.
      if (prev !== state) {
        state.breaches.forEach((h, i) => this.covers.push({ cells: h.cells, delay: 120 + i * 140, life: 0, max: this.dur(CLEAR_MS), opening: true, grew: false }));
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
    this.sweep();
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
    const landMs = this.dur(MOVE_MS);
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
      for (const p of gone) {
        const r = relative(p.cells, this.width);
        this.lifts.push({ cells: r.cells, x: this.ox + r.col * this.cell, y: this.oy + r.row * this.cell, kind: p.kind, brush: p.brush, delay: t + 40, life: 0, max: this.dur(CLEAR_MS) });
      }
      this.at(t + 40, () => {
        const first = sealed.cells[Math.floor(sealed.cells.length / 2)]!;
        this.popup(this.cx(first % this.width), this.cy(Math.floor(first / this.width)), `+${sealed.points}`, 0.55);
        this.callout(this.opts.ratingLabel(sealed.rating), sealed.rating === "gum" ? COLORS.danger : COLORS.cream, 0.3);
        if (sealed.chain >= 2) this.callout(this.opts.streakLabel(sealed.chain), COLORS.cream, 0.42);
        if (sealed.brushBonus) this.callout(this.opts.brushLabel, COLORS.cream, sealed.chain >= 2 ? 0.52 : 0.42);
        // The beat is kept for flawless seals back to back, and for a flawless on the biggest breach.
        const big = gone.length >= BIG_SEAL_PLATES;
        if (sealed.rating === "flawless" && (sealed.chain >= 2 || big)) this.beat(0.5 + Math.min(0.5, Math.max(0, sealed.chain - 2) * 0.17 + (big ? 0.17 : 0)));
        this.cb.onSealed(sealed.rating, sealed.chain);
      });
      t += 40 + CLEAR_MS + 40;
    }
    for (const h of rep.spawned) {
      this.covers.push({ cells: h.cells, delay: t + 60, life: 0, max: this.dur(CLEAR_MS), opening: false, grew: false });
      t += 90;
    }
    if (rep.grown) {
      const grown = rep.grown;
      this.covers.push({ cells: [grown.cell], delay: landMs + 80, life: 0, max: this.dur(CLEAR_MS), opening: false, grew: true });
      this.at(landMs + 80, () => this.callout(this.opts.grewLabel, COLORS.danger, 0.62));
    }
    // The slot refills under the player, and nothing is in hand until they pick again.
    this.refill = { slot: rep.move.slot, life: 0, max: this.dur(MOVE_MS) };
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
    // Nothing frames the board, so it gets all of the screen but the hairline.
    const pad = 2;
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
    this.mini = Math.min(slotW, this.trayH) / 5.6;
    // Plates are baked at the size they are shown, so a new size bakes them afresh.
    const stale = [...this.baked.values()];
    this.baked.clear();
    this.fxL.reset();
    this.dragL.reset();
    // The beat swells the board about its middle.
    this.root.pivot.set(this.ox + W / 2, this.oy + totalH / 2);
    this.root.position.copyFrom(this.root.pivot);
    this.drawHull();
    this.drawBreaches();
    this.drawPlates();
    this.drawTrayFrame();
    this.drawTrayPieces();
    this.syncCursor();
    this.drawGhost();
    this.breachFxDirty = true;
    for (const tex of stale) tex.destroy(true);
  }

  /**
   * The hull is one flat raised slab with a hairline round it: no frame, no panels, no grid
   * (docs/BRAND.md section 3). The ground under it and the tray is painted, not left clear, so the
   * board is whole wherever it is shown (a thumbnail, a capture).
   */
  private drawHull(): void {
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    this.hull
      .clear()
      .rect(this.ox, this.oy, W, this.trayY + this.trayH - this.oy)
      .fill(COLORS.ground)
      .rect(this.ox, this.oy, W, H)
      .fill(COLORS.raised)
      .rect(this.ox - 0.5, this.oy - 0.5, W + 1, H + 1)
      .stroke({ width: 1, color: COLORS.line });
  }

  /** A breach is the ground showing through the hull. Each cell still open carries a dot. */
  private drawBreaches(): void {
    const g = this.breachesG;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    for (const h of this.state.breaches) {
      for (const c of h.cells) g.rect(this.ox + (c % this.width) * s, this.oy + Math.floor(c / this.width) * s, s, s).fill(COLORS.ground);
    }
    for (const h of this.state.breaches) {
      for (const c of h.cells) {
        if (this.state.covered[c]! > 0) continue;
        g.circle(this.cx(c % this.width), this.cy(Math.floor(c / this.width)), Math.max(1.5, s * 0.07)).fill(COLORS.line);
      }
    }
  }

  /**
   * Per-frame breach overlays: an idle breach about to widen is rimmed in danger. Two plates from
   * widening the rim is thin and still; one plate from it the rim is thick and beats slowly.
   */
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
    const s = this.cell;
    for (const h of warn) {
      const urgent = grow - h.idleMoves <= 1;
      const pulse = !urgent || this.reduced ? 1 : 0.5 + 0.5 * Math.sin(this.clock / 220);
      const width = urgent ? Math.max(3, s * 0.1) : Math.max(1.5, s * 0.04);
      // A flat tint that moves between the ground and danger: never a glow.
      this.strokeRegion(g, new Set(h.cells), width / 2, { width, color: blend("ground", "danger", 0.45 + 0.55 * pulse) });
    }
  }

  private drawPlates(): void {
    const g = this.platesG;
    g.clear();
    this.platesL.reset();
    if (!this.state) return;
    const s = this.cell;
    const breachOf = platingBreachIndex(this.state);
    for (const p of this.state.plates) {
      if (this.landing && this.landing.plateId === p.id) continue;
      const r = relative(p.cells, this.width);
      this.paintPlate(this.platesL, r.cells, this.ox + r.col * s, this.oy + r.row * s, s, p.kind, p.brush, 1);
    }
    // Waste: hull covered by a plate, or breach cells covered twice. Crossed out, so it reads without color.
    for (let c = 0; c < this.state.covered.length; c++) {
      const n = this.state.covered[c]!;
      if (n === 0) continue;
      if (breachOf.has(c) ? n > 1 : n > 0) {
        if (this.landing && this.landing.cells.some(([dx, dy]) => this.landingCellAt(this.landing!, dx, dy) === c)) continue;
        this.paintWaste(g, this.ox + (c % this.width) * s, this.oy + Math.floor(c / this.width) * s, s);
      }
    }
  }

  /** A wasted cell: a danger cross with a ground edge, so it reads on a plate of any colour. */
  private paintWaste(g: Graphics, x: number, y: number, s: number): void {
    const a = s * 0.16;
    const cx = x + s / 2;
    const cy = y + s / 2;
    for (const [color, width] of [[COLORS.ground, s * 0.24], [COLORS.danger, s * 0.12]] as const) {
      g.moveTo(cx - a, cy - a).lineTo(cx + a, cy + a).moveTo(cx - a, cy + a).lineTo(cx + a, cy - a).stroke({ width, color, cap: "round" });
    }
  }

  /** A whole plate in its metal's colour and cut-out, `m` pixels a cell, put on a layer. */
  private paintPlate(layer: PlateLayer, cells: PlateCells, x0: number, y0: number, m: number, kind: number, brush: Brush, alpha: number): void {
    if (cells.length === 0 || m <= 0) return;
    const box = plateBox(cells);
    layer.put(this.texture(cells, kind, brush, m), x0 + box.x * m, y0 + box.y * m, box.w * m, box.h * m, alpha);
  }

  /** A plate's texture, baked the first time it is asked for: at the hull's cell size, or the tray's for anything nearer that. */
  private texture(cells: PlateCells, kind: number, brush: Brush, m: number): Texture {
    const px = m > (this.cell + this.mini) / 2 ? this.cell : this.mini;
    const key = `${kind}:${brush}:${px}:${cells.join(";")}`;
    let tex = this.baked.get(key);
    if (!tex) {
      const resolution = this.app.renderer.resolution;
      const canvas = plateCanvas(cells, px, this.cutByKind.get(kind) ?? null, brush, this.colorByKind.get(kind) ?? "cream", resolution);
      tex = new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
      this.baked.set(key, tex);
    }
    return tex;
  }

  /** Drop the oldest baked plates no layer is showing, once there are many. */
  private sweep(): void {
    if (this.baked.size <= BAKED_MAX) return;
    const live = new Set<Texture>();
    for (const layer of [this.platesL, this.fxL, this.ghostL, this.trayL, this.dragL]) layer.collect(live);
    for (const [key, tex] of this.baked) {
      if (this.baked.size <= BAKED_MAX / 2) break;
      if (live.has(tex)) continue;
      this.baked.delete(key);
      tex.destroy(true);
    }
  }

  /**
   * Stroke the outside boundary of a shape made of cells, `m` pixels each, from (`x0`, `y0`).
   * `inset` moves the line into the shape; a negative one moves it off the shape.
   */
  private outline(g: Graphics, cells: ReadonlyArray<readonly [number, number]>, x0: number, y0: number, m: number, inset: number, style: { width: number; color: number }): void {
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    const has = (x: number, y: number): boolean => set.has(`${x},${y}`);
    // Where an edge stops short of its cell's corner: at an outside corner it turns in, at an inside one it runs on.
    const end = (side: boolean, diagonal: boolean): number => (!side ? inset : diagonal ? -inset : 0);
    for (const [cx, cy] of cells) {
      const x = x0 + cx * m;
      const y = y0 + cy * m;
      if (!has(cx, cy - 1)) g.moveTo(x + end(has(cx - 1, cy), has(cx - 1, cy - 1)), y + inset).lineTo(x + m - end(has(cx + 1, cy), has(cx + 1, cy - 1)), y + inset);
      if (!has(cx, cy + 1)) g.moveTo(x + end(has(cx - 1, cy), has(cx - 1, cy + 1)), y + m - inset).lineTo(x + m - end(has(cx + 1, cy), has(cx + 1, cy + 1)), y + m - inset);
      if (!has(cx - 1, cy)) g.moveTo(x + inset, y + end(has(cx, cy - 1), has(cx - 1, cy - 1))).lineTo(x + inset, y + m - end(has(cx, cy + 1), has(cx - 1, cy + 1)));
      if (!has(cx + 1, cy)) g.moveTo(x + m - inset, y + end(has(cx, cy - 1), has(cx + 1, cy - 1))).lineTo(x + m - inset, y + m - end(has(cx, cy + 1), has(cx + 1, cy + 1)));
    }
    g.stroke({ ...style, cap: "round" });
  }

  /** Stroke the outside boundary of a set of board cells. */
  private strokeRegion(g: Graphics, set: ReadonlySet<number>, inset: number, style: { width: number; color: number }): void {
    this.outline(g, [...set].map((c) => [c % this.width, Math.floor(c / this.width)] as const), this.ox, this.oy, this.cell, inset, style);
  }

  /** The ghost: the plate in hand where it would go, ringed amber when it fits and danger when it does not. */
  private drawGhost(): void {
    const g = this.ghostG;
    g.clear();
    this.joinG.clear();
    this.ghostL.reset();
    if (this.state && this.interactive && !this.state.finished && this.cursor) {
      const check = this.check(this.cursor.col, this.cursor.row);
      this.paintGhost(g, check, this.cursor.col, this.cursor.row);
    }
    this.drawHud();
    this.sweep();
  }

  /**
   * The toolbar under a plate set down by touch: turn either way, flip, and a welder to weld. It
   * follows the plate, below it or above it near the keel. Hidden while the plate is in hand and for a
   * mouse, which hovers and clicks. The welder is the one button that goes on, so it alone is amber.
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
    const gap = Math.max(4, s * 0.14);
    const actions: HudAction[] = ["ccw", "cw", "flip", "weld"];
    const W = b * actions.length + gap * (actions.length + 1);
    const H = b + gap * 2;
    const wanted = this.ox + (cursor.col + fp!.w / 2) * s - W / 2;
    const x0 = Math.max(this.ox - 4, Math.min(this.ox + this.width * s + 4 - W, wanted));
    let y0 = this.oy + (cursor.row + fp!.h) * s + s * 0.2;
    if (y0 + H > this.oy + this.height * s + 4) y0 = this.oy + cursor.row * s - s * 0.2 - H;
    g.roundRect(x0, y0, W, H, RADIUS + gap).fill(COLORS.ground).stroke({ width: 1, color: COLORS.line });
    actions.forEach((action, i) => {
      const x = x0 + gap + i * (b + gap);
      const y = y0 + gap;
      const down = this.hudPressed?.action === action;
      const enabled = action !== "weld" || legal;
      const on = action === "weld" && enabled;
      g.roundRect(x, y, b, b, RADIUS).fill(on ? (down ? blend("amber", "ground", 0.2) : COLORS.amber) : down ? COLORS.line : COLORS.raised);
      this.hudRects.push({ x, y, w: b, h: b, action });
      const cx = x + b / 2;
      const cy = y + b / 2;
      const r = b * 0.27;
      const icon = on ? COLORS.ground : enabled ? COLORS.cream : COLORS.dim;
      if (action === "ccw" || action === "cw") drawTurnIcon(g, cx, cy, r, action === "cw", icon);
      else if (action === "flip") drawFlipIcon(g, cx, cy, r, icon);
      else drawWelderIcon(g, cx, cy, r, icon);
    });
  }

  private paintGhost(g: Graphics, check: PlatingPlacementCheck | null, col: number, row: number): void {
    const s = this.cell;
    const piece = this.slot === null ? null : this.state!.slots[this.slot];
    if (!piece) return;
    const legal = check?.legal ?? false;
    // The breach this plate would join, so the player sees which patch they are working.
    if (legal && check?.breachId !== null && check?.breachId !== undefined && this.state) {
      const breach = this.state.breaches.find((h) => h.id === check.breachId);
      if (breach) this.strokeRegion(this.joinG, new Set(breach.cells), 1, { width: Math.max(1.5, s * 0.04), color: COLORS.dim });
    }
    // Only the part on the hull would be laid, so only that is drawn.
    const on = platingOrient(piece.shape, this.rot, this.flip).filter(([dx, dy]) => col + dx >= 0 && col + dx < this.width && row + dy >= 0 && row + dy < this.height);
    const x0 = this.ox + col * s;
    const y0 = this.oy + row * s;
    this.paintPlate(this.ghostL, on, x0, y0, s, piece.kind, platingEffectiveBrush(piece.brush, this.rot), legal ? 1 : 0.35);
    // The selection ring: 2 units wide, off the plate (docs/BRAND.md section 3).
    const refused = this.denied !== null;
    this.outline(g, on, x0, y0, s, -s / 24, { width: Math.max(2, s / (refused ? 6 : 12)), color: legal ? COLORS.amber : COLORS.danger });
    if (check) for (const c of check.wasteCells) this.paintWaste(g, this.ox + (c % this.width) * s, this.oy + Math.floor(c / this.width) * s, s);
  }

  private drawTrayFrame(): void {
    const g = this.trayG;
    g.clear();
    this.trayText.removeChildren().forEach((c) => c.destroy());
    this.slotLabels = [];
    const ring = Math.max(2, this.cell / 12);
    this.slotRects.forEach((r, i) => {
      const selected = i === this.slot;
      g.roundRect(r.x, r.y, r.w, r.h, RADIUS).fill(COLORS.raised);
      if (selected) g.roundRect(r.x + ring / 2, r.y + ring / 2, r.w - ring, r.h - ring, RADIUS - ring / 2).stroke({ width: ring, color: COLORS.amber });
      const label = new Text({ text: String(i + 1), style: { fontFamily: FONT.mono, fontWeight: "700", fontSize: Math.max(11, this.cell * 0.32), fill: COLORS.dim }, resolution: 2 });
      label.position.set(r.x + 8, r.y + 5);
      this.trayText.addChild(label);
      this.slotLabels.push(label);
    });
  }

  private drawTrayPieces(): void {
    this.trayL.reset();
    if (!this.state) return;
    this.state.slots.forEach((piece, i) => {
      const r = this.slotRects[i]!;
      const selected = i === this.slot;
      const carried = this.drag?.moved && this.drag.slot === i && this.carries(this.drag);
      const resting = !carried && selected && this.anchor !== null;
      const rot = selected ? this.rot : 0;
      const flip = selected ? this.flip : false;
      let scale = 1;
      const alpha = carried ? 0.22 : resting ? 0.45 : 1;
      // A new plate grows into its slot.
      if (this.refill && this.refill.slot === i) scale = easeOut(Math.min(1, this.refill.life / this.refill.max));
      if (scale <= 0) return;
      const m = (Math.min(r.w, r.h) / 5.6) * scale;
      this.paintMini(piece.shape, piece.kind, platingEffectiveBrush(piece.brush, rot), rot, flip, r.x + r.w / 2, r.y + r.h / 2, m, alpha);
    });
  }

  private paintMini(shape: number, kind: number, brush: Brush, rot: number, flip: boolean, cx: number, cy: number, m: number, alpha: number): void {
    const cells = platingOrient(shape, rot, flip);
    const { w, h } = platingExtent(cells);
    this.paintPlate(this.trayL, cells, Math.round(cx - (w * m) / 2), Math.round(cy - (h * m) / 2), m, kind, brush, alpha);
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
    this.widened.length = 0;
    this.lifts.length = 0;
    this.covers.length = 0;
    this.timers.length = 0;
    this.landing = null;
    this.flyback = null;
    this.denied = null;
    this.refill = null;
    for (const p of this.popups) p.t.destroy();
    this.popups.length = 0;
    this.fxG.clear();
    this.fxL.reset();
    this.clearDrag();
  }

  /** A seal's points, rising from the breach. Counted, so in the mono face. */
  private popup(x: number, y: number, text: string, size: number): void {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.mono,
        fontSize: Math.max(15, this.cell * size),
        fontWeight: "700",
        fill: COLORS.cream,
        // A ground edge keeps the number readable over any plate.
        stroke: { color: COLORS.ground, width: Math.max(3, this.cell * 0.09), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 800, y0: y });
  }

  private callout(text: string, color: number, yFrac: number): void {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.body,
        fontSize: Math.max(16, this.cell * 0.7),
        fontWeight: "700",
        fill: color,
        align: "center",
        stroke: { color: COLORS.ground, width: Math.max(4, this.cell * 0.12), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set(this.ox + (this.width * this.cell) / 2, this.oy + this.height * this.cell * yFrac);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 1100, y0: t.y });
  }

  /** Ask for the beat. A stronger moment while one is playing takes it over; it never stacks. */
  private beat(strength: number): void {
    // The pulse and its sound are asked for together, so they cannot drift apart.
    sfx.beat(strength);
    this.beatNow = { life: 0, strength: Math.max(strength, this.beatNow?.strength ?? 0) };
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
    this.fxL.reset();
    const s = this.cell;

    // Hull covers: sound plating that shrinks away to show a breach.
    for (let i = this.covers.length - 1; i >= 0; i--) {
      const c = this.covers[i]!;
      let k = 0;
      if (c.delay > 0) {
        c.delay -= dt;
        if (c.delay <= 0) {
          if (c.grew) {
            this.widened.push({ cells: c.cells, life: 0, max: this.reduced ? 300 : 700 });
            this.cb.onGrew();
          } else this.cb.onCracked(c.opening);
        }
      } else {
        c.life += dt;
        k = Math.min(1, c.life / c.max);
        if (k >= 1) {
          this.covers.splice(i, 1);
          continue;
        }
      }
      const inset = (s / 2) * k * k;
      for (const cell of c.cells) g.rect(this.ox + (cell % this.width) * s + inset, this.oy + Math.floor(cell / this.width) * s + inset, s - inset * 2, s - inset * 2).fill(COLORS.raised);
    }

    // The cell a breach just gained, ringed in danger while the callout is up. The fewest marks that say it.
    for (let i = this.widened.length - 1; i >= 0; i--) {
      const f = this.widened[i]!;
      f.life += dt;
      const k = f.life / f.max;
      if (k >= 1) {
        this.widened.splice(i, 1);
        continue;
      }
      const width = Math.max(2, s / 12);
      this.strokeRegion(g, new Set(f.cells), width / 2, { width, color: blend("danger", "ground", k * k) });
    }

    // Lifts: a sealed breach's plates shrink to nothing.
    for (let i = this.lifts.length - 1; i >= 0; i--) {
      const l = this.lifts[i]!;
      if (l.delay > 0) {
        l.delay -= dt;
        this.paintPlate(this.fxL, l.cells, l.x, l.y, s, l.kind, l.brush, 1);
        continue;
      }
      l.life += dt;
      const k = Math.min(1, l.life / l.max);
      if (k >= 1) {
        this.lifts.splice(i, 1);
        continue;
      }
      const scale = 1 - k * k;
      const { w, h } = platingExtent(l.cells);
      this.paintPlate(this.fxL, l.cells, l.x + (w * s * (1 - scale)) / 2, l.y + (h * s * (1 - scale)) / 2, s * scale, l.kind, l.brush, 1);
    }

    // Landing: the welded plate slides home.
    if (this.landing) {
      const l = this.landing;
      l.life += dt;
      const k = Math.min(1, l.life / l.max);
      if (k >= 1) {
        this.landing = null;
        this.cb.onNailed(l.waste);
        this.drawPlates();
      } else {
        const e = easeOut(k);
        this.paintPlate(this.fxL, l.cells, l.x0 + (l.x1 - l.x0) * e, l.y0 + (l.y1 - l.y0) * e, s, l.kind, l.brush, 1);
      }
    }

    // Flyback: a plate let go off the hull returns to its slot.
    if (this.flyback) {
      const f = this.flyback;
      f.life += dt;
      const k = Math.min(1, f.life / f.max);
      this.clearDrag();
      if (k >= 1) {
        this.flyback = null;
        this.drawTrayPieces();
      } else {
        const e = easeOut(k);
        this.paintPlate(this.dragL, f.cells, f.x0 + (f.x1 - f.x0) * e, f.y0 + (f.y1 - f.y0) * e, f.m0 + (f.m1 - f.m0) * e, f.kind, f.brush, 1);
      }
    }

    if (this.denied) {
      this.denied.life += dt;
      if (this.denied.life >= DENIED_MS) {
        this.denied = null;
        this.drawGhost();
      }
    }
    let ghostX = 0;
    if (this.flipFx) {
      // Squash to a sliver about the plate's centre and back out: a card turning over.
      this.flipFx.life += dt;
      const k = this.flipFx.life / this.flipFx.max;
      if (k >= 1) {
        this.flipFx = null;
        this.ghostWrap.scale.x = 1;
      } else {
        const sx = Math.max(0.06, Math.abs(Math.cos(k * Math.PI)));
        this.ghostWrap.scale.x = sx;
        ghostX += this.flipFx.cx * (1 - sx);
      }
    }
    this.ghostWrap.x = ghostX;

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
      p.t.y = p.y0 - easeOut(Math.min(1, k)) * this.cell * 0.7;
      p.t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }

    this.drawBreachFx();
    this.drawBeat(dt);

    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
    if (this.viewStale) this.publishView();
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
      this.root.scale.set(1);
      return;
    }
    // Up in the first quarter, down over the rest.
    const env = this.reduced ? 1 : t < 0.25 ? easeOut(t / 0.25) : 1 - easeOut((t - 0.25) / 0.75);
    g.rect(this.ox, this.oy, this.width * this.cell, this.trayY + this.trayH - this.oy).fill({ color: COLORS.amber, alpha: (0.14 + 0.16 * b.strength) * env });
    this.root.scale.set(this.reduced ? 1 : 1 + 0.012 * b.strength * env);
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
    if (this.cursor && fp) this.flipFx = { life: 0, max: this.dur(MOTION.panel), cx: this.ox + (this.cursor.col + fp.w / 2) * this.cell };
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

  /** Weld the plate down at the ghost, or refuse. */
  private placeAt(col: number, row: number, from: { x: number; y: number } | null): boolean {
    if (this.slot === null) return false;
    const check = this.check(col, row);
    if (!check?.legal) {
      this.anchorAt(col, row);
      this.refuse();
      return false;
    }
    this.pendingLand = { x: from ? from.x : this.ox + col * this.cell, y: from ? from.y : this.oy + row * this.cell - this.cell * 0.45, slot: this.slot };
    this.cb.onPlace(this.slot, this.rot, this.flip, col, row);
    return true;
  }

  /** A refusal: the plate's danger ring thickens for a moment, and the bump sounds. Nothing shakes. */
  private refuse(): void {
    this.denied = { life: 0 };
    this.drawGhost();
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
    this.clearDrag();
    if (this.slot === null) return;
    const piece = this.state.slots[this.slot]!;
    const m = this.cell;
    const x0 = px - (fp.w * m) / 2;
    const y0 = py - (fp.h * m) / 2;
    this.paintPlate(this.dragL, fp.cells, x0, y0, m, piece.kind, platingEffectiveBrush(piece.brush, this.rot), 1);
    // The verdict rides on the plate itself, since on touch the plate sits over its own ghost.
    const legal = this.cursor ? (this.check(this.cursor.col, this.cursor.row)?.legal ?? false) : false;
    this.outline(g, fp.cells, x0, y0, m, -m / 24, { width: Math.max(2, m / 12), color: legal ? COLORS.amber : COLORS.danger });
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
      this.clearDrag();
      return;
    }
    const fp = this.footprint();
    if (d.moved) {
      this.clearDrag();
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
      this.flyback = { cells: fp.cells, kind: piece.kind, brush: platingEffectiveBrush(piece.brush, this.rot), x0: px, y0: py, x1: home.x, y1: home.y, m0: this.cell, m1: home.m, slot: this.slot, life: 0, max: this.dur(MOVE_MS) };
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
    this.clearDrag();
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
  for (let y = -r; y < r; y += r * 0.5) g.moveTo(cx, cy + y).lineTo(cx, cy + Math.min(r, y + r * 0.25)).stroke({ width: w, color });
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
