import { Application, CanvasSource, Container, FillGradient, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  DX,
  DY,
  cannonNeeds,
  gunneryCellAt,
  parseGunneryDeck,
  predictGunneryPath,
  type Arrow,
  type CannonOutcome,
  type Dir,
  type GunneryEvent,
  type GunneryPredictedPath,
  type GunneryState,
  type ParsedDeck,
} from "@openseas/engine";
import type { GunneryContent } from "@openseas/content";
import { mix, tileCanvas, type TileStyle, type TileTexture } from "../bilging/tiles.js";

export interface GunneryCallbacks {
  /** The player laid an arrow (`dir` set) or lifted one (`dir` null) on a deck cell. */
  onArrow(col: number, row: number, dir: Dir | null): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** Events newer than anything shown before, in tick order, for sound and callouts. */
  onEvents(events: readonly GunneryEvent[]): void;
}

export interface GunneryRendererOptions {
  showMarks: boolean;
  tickMs: number;
  labels: { fouled: string; clean: string; next: string };
}

interface PieceView {
  s: Sprite;
  kind: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** 0..1 progress from (fx,fy) to (tx,ty). */
  k: number;
  /** Heading for the chevron. */
  dir: Dir;
  /** ms since the piece left the deck; it slides to `exit` and fades. */
  dying: number | null;
  exit: { x: number; y: number } | null;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  color: number;
  alpha: number;
  life: number;
  max: number;
}

/** The arrow the pointer would lay (or lift) right now. */
interface Ghost {
  col: number;
  row: number;
  dir: Dir;
  lift: boolean;
}

const COLORS = {
  plank: 0x7a5533,
  plankDark: 0x5a3b1f,
  plankLine: 0x2d1c0c,
  wall: 0x2a1b10,
  wallEdge: 0x6b4a2e,
  crate: 0xa87b45,
  brass: 0xd4a548,
  iron: 0x30353d,
  ironLight: 0x7c8591,
  sea: 0x1a7f8a,
  good: 0x6fdc8c,
  danger: 0xf0604d,
  smoke: 0x2a2a30,
  flash: 0xffd27a,
  arrow: 0xf5d58a,
  cursor: 0xf2f0e6,
  water: 0x7fd0ff,
};
const DIE_MS = 200;
/** How many cells ahead the route preview looks. */
const LOOK_AHEAD = 12;

/** One string that names what the deck shows: pieces by cell, cannon states, arrows, the tick. Shared with the page. */
export function gunneryViewString(state: GunneryState): string {
  const pieces = [...state.pieces].sort((a, b) => a.id - b.id).map((p) => `${p.id}:${p.kind}:${p.col}:${p.row}`);
  const cannons = state.cannons.map((c) => `${c.loaded}${c.fouled ? "f" : ""}`);
  const arrows = [...state.arrows].sort((a, b) => a.row - b.row || a.col - b.col).map((a) => `${a.col}.${a.row}.${a.dir}`);
  return `t${state.tick}|${pieces.join(",")}|${cannons.join(",")}|${arrows.join(",")}`;
}

/** The arrows on deck if `ghost` were laid or lifted. */
function arrowsWith(arrows: readonly Arrow[], ghost: Ghost | null): readonly Arrow[] {
  if (!ghost) return arrows;
  const kept = arrows.filter((a) => a.col !== ghost.col || a.row !== ghost.row);
  return ghost.lift ? kept : [...kept, { col: ghost.col, row: ghost.row, dir: ghost.dir }];
}

/** Which way a point inside a cell leans: toward the nearest edge. */
function leanOf(fx: number, fy: number): Dir {
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 1 : 3;
}

const isGood = (o: CannonOutcome): boolean => o === "load" || o === "loaded" || o === "clean";

export class GunneryRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  private readonly staticLayer = new Container();
  private readonly deckG = new Graphics();
  private readonly hoverG = new Graphics();
  private readonly pathG = new Graphics();
  private readonly arrowG = new Graphics();
  private readonly cannonG = new Graphics();
  private readonly needLayer = new Container();
  private readonly cannonFxG = new Graphics();
  private readonly queueLayer = new Container();
  private readonly pieceLayer = new Container();
  private readonly headG = new Graphics();
  private readonly ghostG = new Graphics();
  private readonly cursorG = new Graphics();
  private readonly fxG = new Graphics();
  private readonly textLayer = new Container();
  private readonly pieces = new Map<number, PieceView>();
  private readonly popups: Popup[] = [];
  private readonly particles: Particle[] = [];
  private readonly textures = new Map<number, Texture>();
  private readonly colorByKind = new Map<number, number>();
  private readonly markByKind = new Map<number, string>();
  private readonly textureByKind = new Map<number, TileTexture>();
  private readonly plankFill = linear(true, [COLORS.plank, COLORS.plankDark]);
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private showMarks: boolean;
  private cell = 40;
  private pad = 8;
  private width = 9;
  private height = 11;
  private origin = { x: 0, y: 0 };
  /** The deck from content; it never changes within a round, so it is painted once per layout. */
  private readonly deck: ParsedDeck;
  private state: GunneryState | null = null;
  private lastEventTick = -1;
  private interactive = false;
  private framePending = false;
  private destroyed = false;
  private time = 0;
  private shake = 0;
  private cursor: { col: number; row: number } | null = null;
  private hover: { col: number; row: number; fx: number; fy: number } | null = null;
  private press: { x: number; y: number; col: number; row: number; touch: boolean; dragged: boolean; dir: Dir } | null = null;
  private ghost: Ghost | null = null;
  private paths: Array<{ id: number; kind: number; path: GunneryPredictedPath }> = [];
  /** For each cannon, what the soonest piece headed into it will do, and in how many ticks. */
  private incoming: Array<{ outcome: CannonOutcome; eta: number; kind: number } | null> = [];
  private needSprites: Sprite[] = [];
  private queueSprites: Sprite[] = [];
  private nextLabel: Text | null = null;
  /** Per cannon: ms left on the loaded glow, the fire recoil, and the foul flash. */
  private readonly glow: number[] = [];
  private readonly recoil: number[] = [];
  private readonly hit: number[] = [];

  constructor(
    private readonly host: HTMLElement,
    content: GunneryContent,
    private readonly cb: GunneryCallbacks,
    private readonly opts: GunneryRendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, parseInt(p.color.slice(1), 16));
      this.markByKind.set(i, p.mark);
      this.textureByKind.set(i, p.texture);
    });
    this.deck = parseGunneryDeck(content.config.deck);
    this.width = this.deck.width;
    this.height = this.deck.height;
  }

  private styleFor(kind: number): TileStyle {
    return {
      color: this.colorByKind.get(kind) ?? 0xffffff,
      texture: this.textureByKind.get(kind) ?? null,
      mark: this.markByKind.get(kind) ?? null,
      special: null,
      label: "",
      showMarks: this.showMarks,
    };
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
    this.app.canvas.setAttribute("data-testid", "gunnery-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      if (!this.press) this.setGhost(null);
    });
    this.host.appendChild(this.app.canvas);
    this.staticLayer.addChild(this.deckG);
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    for (let i = 0; i < this.deck.cannons.length; i++) {
      const s = new Sprite(Texture.WHITE);
      s.anchor.set(0.5);
      this.needLayer.addChild(s);
      this.needSprites.push(s);
    }
    this.board.addChild(
      this.staticLayer,
      this.hoverG,
      this.pathG,
      this.arrowG,
      this.cannonG,
      this.needLayer,
      this.cannonFxG,
      this.queueLayer,
      this.pieceLayer,
      this.headG,
      this.ghostG,
      this.cursorG,
      this.fxG,
      this.textLayer,
    );
    this.app.stage.addChild(this.board);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointermove", (e) => this.pointerMove(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", () => {
      this.press = null;
      this.setGhost(null);
    });
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      for (const tex of this.textures.values()) tex.destroy(true);
      this.plankFill.destroy();
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.press = null;
      this.cursor = null;
      this.hover = null;
      this.setGhost(null);
      this.drawCursor();
    }
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    if (this.app.renderer) this.bake();
  }

  /** A new displayed state, usually one tick on. Pieces glide to their new cells over tickMs. */
  setState(state: GunneryState): void {
    if (!this.app.renderer) return;
    const reset = !this.state || state.tick < this.state.tick || state.deck !== this.state.deck;
    this.state = state;
    this.framePending = true;
    if (reset) {
      this.lastEventTick = state.tick;
      for (const v of this.pieces.values()) v.s.destroy();
      this.pieces.clear();
      this.glow.fill(0);
      this.recoil.fill(0);
      this.hit.fill(0);
    }

    const fresh = (state.lastMove?.events ?? []).filter((e) => e.tick > this.lastEventTick);
    // Where pieces that left the deck went, so they slide into a cannon or over the side.
    const exits = new Map<number, { x: number; y: number }>();
    for (const e of fresh) {
      if (e.pieceId === undefined) continue;
      if (e.cannon !== undefined) {
        const c = state.cannons[e.cannon]!;
        exits.set(e.pieceId, { x: this.cx(c.col), y: this.cy(c.row) });
      } else if (e.type === "exit") {
        const v = this.pieces.get(e.pieceId);
        if (v) exits.set(e.pieceId, { x: v.tx + DX[v.dir]! * this.cell, y: v.ty + DY[v.dir]! * this.cell });
      }
    }

    const seen = new Set<number>();
    const { barrel } = state.deck;
    for (const p of state.pieces) {
      seen.add(p.id);
      const x = this.cx(p.col);
      const y = this.cy(p.row);
      let v = this.pieces.get(p.id);
      if (!v) {
        const s = new Sprite(this.textures.get(p.kind) ?? Texture.WHITE);
        s.anchor.set(0.5);
        const bx = this.cx(barrel.col);
        const by = this.cy(barrel.row);
        s.position.set(bx, by);
        s.scale.set(0.5);
        this.pieceLayer.addChild(s);
        v = { s, kind: p.kind, fx: bx, fy: by, tx: x, ty: y, k: 0, dir: p.dir, dying: null, exit: null };
        this.pieces.set(p.id, v);
      } else if (v.tx !== x || v.ty !== y) {
        v.fx = v.s.x;
        v.fy = v.s.y;
        v.tx = x;
        v.ty = y;
        v.k = 0;
      }
      v.dir = p.dir;
      if (reset) {
        v.k = 1;
        v.s.position.set(x, y);
        v.s.scale.set(1);
      }
    }
    for (const [id, v] of this.pieces) {
      if (seen.has(id) || v.dying !== null) continue;
      v.dying = 0;
      v.fx = v.s.x;
      v.fy = v.s.y;
      v.exit = exits.get(id) ?? null;
    }

    if (fresh.length) {
      this.lastEventTick = Math.max(...fresh.map((e) => e.tick));
      for (const e of fresh) this.eventFx(state, e);
      this.cb.onEvents(fresh);
    }
    this.refreshPreview();
    this.drawArrows();
    this.drawQueue();
    this.app.canvas.setAttribute("data-view", gunneryViewString(state));
  }

  private eventFx(state: GunneryState, e: GunneryEvent): void {
    if (e.cannon === undefined) return;
    const i = e.cannon;
    const c = state.cannons[i]!;
    const x = this.cx(c.col);
    const y = this.cy(c.row);
    const outward = c.col === 0 ? -1 : 1;
    switch (e.type) {
      case "load":
        this.glow[i] = 500;
        this.popup(x - outward * this.cell * 1.2, y, `+${e.points ?? 0}`, COLORS.good, 0.38);
        this.burst(x, y, this.colorByKind.get(e.kind ?? 0) ?? 0xffffff, 6, 0.6);
        break;
      case "loaded":
        this.glow[i] = 1400;
        this.popup(x - outward * this.cell * 1.6, y, `+${e.points ?? 0}`, COLORS.brass, 0.6);
        this.burst(x, y, COLORS.brass, 12, 1);
        break;
      case "fire": {
        this.recoil[i] = 380;
        this.shake = Math.max(this.shake, 220);
        const mx = c.col === 0 ? -this.pad : this.width * this.cell + this.pad;
        for (let k = 0; k < (this.reduced ? 0 : 14); k++) {
          const a = (Math.random() - 0.5) * 1.2;
          const sp = 0.05 + Math.random() * 0.12;
          this.particles.push({ x: mx, y, vx: Math.cos(a) * sp * outward, vy: Math.sin(a) * sp, r: this.cell * (0.12 + Math.random() * 0.12), grow: 0.02, color: COLORS.smoke, alpha: 0.6, life: 0, max: 700 + Math.random() * 500 });
        }
        this.particles.push({ x: mx, y, vx: 0, vy: 0, r: this.cell * 0.55, grow: 0.06, color: COLORS.flash, alpha: 0.95, life: 0, max: 180 });
        break;
      }
      case "foul":
        this.hit[i] = 700;
        this.popup(x - outward * this.cell * 1.6, y, this.opts.labels.fouled, COLORS.danger, 0.45);
        for (let k = 0; k < (this.reduced ? 0 : 8); k++) {
          this.particles.push({ x, y, vx: (Math.random() - 0.5) * 0.04, vy: -0.03 - Math.random() * 0.04, r: this.cell * 0.12, grow: 0.012, color: COLORS.smoke, alpha: 0.7, life: 0, max: 900 });
        }
        break;
      case "clean":
        this.glow[i] = 400;
        this.popup(x - outward * this.cell * 1.4, y, this.opts.labels.clean, COLORS.water, 0.42);
        this.burst(x, y, COLORS.water, 12, 0.9);
        break;
      case "splash":
        this.burst(x, y, COLORS.water, 6, 0.5);
        break;
      default:
        break;
    }
  }

  private burst(x: number, y: number, color: number, n: number, power: number): void {
    if (this.reduced) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.04 + Math.random() * 0.08) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: this.cell * 0.06, grow: -0.0001, color, alpha: 1, life: 0, max: 380 + Math.random() * 200 });
    }
  }

  // ---- preview

  private setGhost(g: Ghost | null): void {
    const same = g === this.ghost || (g && this.ghost && g.col === this.ghost.col && g.row === this.ghost.row && g.dir === this.ghost.dir && g.lift === this.ghost.lift);
    if (same) return;
    this.ghost = g;
    this.refreshPreview();
    this.drawArrows();
  }

  /** Routes for every piece over the arrows as they would be with the ghost laid, and what each cannon has coming. */
  private refreshPreview(): void {
    const s = this.state;
    this.paths = [];
    this.incoming = [];
    if (!s) return;
    const arrows = arrowsWith(s.arrows, this.interactive ? this.ghost : null);
    for (const p of s.pieces) {
      const path = predictGunneryPath(s, p, LOOK_AHEAD, arrows);
      this.paths.push({ id: p.id, kind: p.kind, path });
      if (path.end?.type === "cannon") {
        const eta = path.cells.length + 1;
        const cur = this.incoming[path.end.cannon];
        if (!cur || eta < cur.eta) this.incoming[path.end.cannon] = { outcome: path.end.outcome, eta, kind: p.kind };
      }
    }
    this.drawPaths();
  }

  // ---- drawing

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const padFor = (cell: number): number => Math.max(6, Math.round(cell * 0.12));
    let cell = Math.floor(Math.min(w / this.width, h / this.height));
    cell = Math.floor(Math.min((w - padFor(cell) * 2 - 2) / this.width, (h - padFor(cell) * 2 - 2) / this.height));
    this.cell = Math.max(12, cell);
    this.pad = padFor(this.cell);
    this.origin = { x: Math.floor((w - this.cell * this.width) / 2), y: Math.floor((h - this.cell * this.height) / 2) };
    this.board.position.set(this.origin.x, this.origin.y);
    this.drawDeck();
    this.bake();
    this.layoutQueue();
    this.refreshPreview();
    this.drawArrows();
    this.drawCursor();
    this.drawHover();
    if (this.state) {
      for (const p of this.state.pieces) {
        const v = this.pieces.get(p.id);
        if (!v) continue;
        v.tx = this.cx(p.col);
        v.ty = this.cy(p.row);
        v.fx = v.tx;
        v.fy = v.ty;
        v.k = 1;
        v.s.position.set(v.tx, v.ty);
      }
      this.drawQueue();
    }
  }

  /** Rails, planks, the chute, the scupper and the gun ports. Everything that never changes. */
  private drawDeck(): void {
    const g = this.deckG;
    const s = this.cell;
    const p = this.pad;
    const W = this.width * s;
    const H = this.height * s;
    g.clear();
    g.roundRect(-p - 2, -p + 4, W + p * 2 + 4, H + p * 2, p + 6).fill({ color: 0x000000, alpha: 0.45 });
    g.roundRect(-p, -p, W + p * 2, H + p * 2, p + 4).fill({ color: COLORS.wall });
    g.roundRect(-p, -p, W + p * 2, H + p * 2, p + 4).stroke({ width: 1.5, color: COLORS.wallEdge, alpha: 0.9 });
    const deck = this.deck;
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const x = col * s;
        const y = row * s;
        switch (gunneryCellAt(deck, col, row)) {
          case "deck":
            g.rect(x, y, s, s).fill(this.plankFill);
            g.moveTo(x, y + s * 0.5).lineTo(x + s, y + s * 0.5).stroke({ width: 1, color: COLORS.plankLine, alpha: 0.25 });
            g.rect(x, y, s, s).stroke({ width: 1, color: COLORS.plankLine, alpha: 0.45 });
            break;
          case "wall":
            g.rect(x, y, s, s).fill({ color: COLORS.wall });
            g.rect(x + 1, y + 1, s - 2, s - 2).stroke({ width: 1, color: COLORS.wallEdge, alpha: 0.25 });
            break;
          case "crate":
            g.rect(x, y, s, s).fill(this.plankFill);
            g.roundRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.08).fill({ color: COLORS.crate });
            g.roundRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.08).stroke({ width: 2, color: COLORS.plankLine, alpha: 0.8 });
            g.moveTo(x + s * 0.12, y + s * 0.12).lineTo(x + s * 0.88, y + s * 0.88).moveTo(x + s * 0.88, y + s * 0.12).lineTo(x + s * 0.12, y + s * 0.88).stroke({ width: 2, color: COLORS.plankLine, alpha: 0.6 });
            break;
          case "barrel": {
            // The chute: a brass-rimmed mouth in the rail with a chevron showing which way pieces drop.
            g.rect(x, y, s, s).fill({ color: COLORS.wall });
            g.roundRect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.76, s * 0.18).fill({ color: 0x0d0805 });
            g.roundRect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.76, s * 0.18).stroke({ width: 2.5, color: COLORS.brass, alpha: 0.9 });
            drawArrowGlyph(g, x + s / 2, y + s / 2, s * 0.22, deck.drop.dir, COLORS.brass, 0.55);
            break;
          }
          case "hatch":
            // The scupper: an opening in the rail to the sea.
            g.rect(x, y, s, s).fill({ color: COLORS.wall });
            g.roundRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76, s * 0.14).fill({ color: COLORS.sea, alpha: 0.65 });
            for (let k = 0; k < 3; k++) {
              const wy = y + s * (0.32 + k * 0.18);
              g.moveTo(x + s * 0.22, wy).quadraticCurveTo(x + s * 0.36, wy - s * 0.06, x + s * 0.5, wy).quadraticCurveTo(x + s * 0.64, wy + s * 0.06, x + s * 0.78, wy).stroke({ width: 1.5, color: 0xbfe9ef, alpha: 0.5 });
            }
            g.roundRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76, s * 0.14).stroke({ width: 1.5, color: COLORS.wallEdge });
            break;
          case "cannon":
            // The gun port: the cannon itself is drawn live so it can recoil and glow.
            g.rect(x, y, s, s).fill({ color: COLORS.wall });
            g.roundRect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88, s * 0.16).fill({ color: 0x120b06 });
            break;
        }
      }
    }
    this.staticLayer.updateCacheTexture();
  }

  /**
   * Routes only for pieces headed into a cannon: green when the cannon wants the piece (or water
   * for a fouled one), red when it will foul it. Everything else is left plain; the heading
   * chevron on each piece is enough there.
   */
  private drawPaths(): void {
    const g = this.pathG;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    for (const { path } of this.paths) {
      if (path.end?.type !== "cannon" || path.end.outcome === "splash" || path.end.outcome === "blocked") continue;
      const color = isGood(path.end.outcome) ? COLORS.good : COLORS.danger;
      const pts = path.cells;
      for (let i = 0; i < pts.length; i++) {
        const c = pts[i]!;
        g.circle(this.cx(c.col), this.cy(c.row), s * 0.1).fill({ color, alpha: 0.85 - 0.04 * i });
      }
    }
  }

  private drawArrows(): void {
    const g = this.arrowG;
    g.clear();
    this.ghostG.clear();
    if (!this.state) return;
    const s = this.cell;
    for (const a of this.state.arrows) {
      const x = this.cx(a.col);
      const y = this.cy(a.row);
      const lifting = this.ghost && this.ghost.col === a.col && this.ghost.row === a.row;
      const alpha = lifting ? 0.35 : 1;
      g.roundRect(x - s * 0.44, y - s * 0.44, s * 0.88, s * 0.88, s * 0.16).fill({ color: COLORS.arrow, alpha: 0.18 * alpha });
      g.roundRect(x - s * 0.44, y - s * 0.44, s * 0.88, s * 0.88, s * 0.16).stroke({ width: 1.5, color: COLORS.arrow, alpha: 0.55 * alpha });
      drawArrowGlyph(g, x, y, s * 0.3, a.dir, COLORS.arrow, alpha);
      if (lifting && this.ghost!.lift) {
        // This arrow goes if the pointer commits: a cross over it.
        const r = s * 0.22;
        g.moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x + r, y - r).lineTo(x - r, y + r).stroke({ width: Math.max(2, s * 0.07), color: COLORS.danger, alpha: 0.9, cap: "round" });
      }
    }
    const gh = this.interactive ? this.ghost : null;
    if (gh && !gh.lift) {
      const x = this.cx(gh.col);
      const y = this.cy(gh.row);
      this.ghostG.roundRect(x - s * 0.44, y - s * 0.44, s * 0.88, s * 0.88, s * 0.16).stroke({ width: 2, color: COLORS.cursor, alpha: 0.55 });
      drawArrowGlyph(this.ghostG, x, y, s * 0.3, gh.dir, COLORS.cursor, 0.6);
    }
  }

  /** The cannons, their need badges and load pips, and rings for what is headed their way. Redrawn every frame. */
  private drawCannons(): void {
    const g = this.cannonG;
    const fx = this.cannonFxG;
    g.clear();
    fx.clear();
    if (!this.state) return;
    const s = this.cell;
    this.state.cannons.forEach((c, i) => {
      const x = c.col * s;
      const y = c.row * s;
      const cx = x + s / 2;
      const cy = y + s / 2;
      const outward = c.col === 0 ? -1 : 1;
      const rec = this.recoil[i] ?? 0;
      const kick = rec > 0 ? Math.sin((rec / 380) * Math.PI) * s * 0.18 : 0;
      const ready = c.firesAt !== null;
      const glow = this.glow[i] ?? 0;

      // Barrel: breech toward the deck, muzzle out through the rail.
      const bx0 = cx - outward * kick;
      const len = s * 0.62;
      const muzzleX = bx0 + outward * len;
      const left = Math.min(bx0, muzzleX);
      g.roundRect(left, cy - s * 0.17, len, s * 0.34, s * 0.12).fill({ color: ready ? mix(COLORS.iron, COLORS.brass, 0.35) : COLORS.iron });
      g.roundRect(left, cy - s * 0.17, len, s * 0.34, s * 0.12).stroke({ width: 1.5, color: COLORS.ironLight, alpha: 0.7 });
      g.circle(muzzleX, cy, s * 0.2).fill({ color: COLORS.iron });
      g.circle(muzzleX, cy, s * 0.11).fill({ color: 0x000000, alpha: 0.8 });

      if (ready) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time / 70);
        fx.roundRect(x + 2, y + 2, s - 4, s - 4, s * 0.16).stroke({ width: 3, color: COLORS.brass, alpha: 0.5 + 0.5 * pulse });
        // A lit fuse spark at the breech.
        fx.circle(bx0 - outward * s * 0.02, cy - s * 0.2, s * (0.05 + 0.04 * pulse)).fill({ color: COLORS.flash, alpha: 0.9 });
      } else if (glow > 0) {
        fx.roundRect(x + 2, y + 2, s - 4, s - 4, s * 0.16).fill({ color: COLORS.brass, alpha: Math.min(0.45, glow / 1400) });
      }

      // Need badge: the piece this cannon wants next, over the breech.
      const need = cannonNeeds(c);
      const sprite = this.needSprites[i]!;
      if (need !== null) {
        sprite.visible = true;
        sprite.texture = this.textures.get(need) ?? Texture.WHITE;
        const bob = this.reduced ? 0 : Math.sin(this.time / 260 + i) * s * 0.02;
        sprite.position.set(cx - outward * s * 0.04, cy + bob);
        sprite.scale.set(0.6);
        sprite.alpha = 1;
        // A pale backing so a dark piece (powder) still reads against the gun port.
        g.roundRect(cx - s * 0.33 - outward * s * 0.04, cy - s * 0.33 + bob, s * 0.66, s * 0.66, s * 0.12).fill({ color: 0xefe3c6, alpha: 0.85 });
        const ringColor = c.fouled ? COLORS.danger : COLORS.cursor;
        const pulse = 0.45 + 0.35 * Math.sin(this.time / 220 + i);
        fx.roundRect(cx - s * 0.33 - outward * s * 0.04, cy - s * 0.33 + bob, s * 0.66, s * 0.66, s * 0.12).stroke({ width: 2, color: ringColor, alpha: pulse });
      } else sprite.visible = false;

      if (c.fouled) {
        for (let k = 0; k < 3; k++) {
          const wob = this.reduced ? 0 : Math.sin(this.time / 300 + k * 2) * s * 0.05;
          fx.circle(x + s * (0.3 + k * 0.2) + wob, y + s * (0.16 - k * 0.04), s * (0.1 + k * 0.025)).fill({ color: COLORS.smoke, alpha: 0.7 });
        }
      }
      const hit = this.hit[i] ?? 0;
      if (hit > 0) fx.roundRect(x + 1, y + 1, s - 2, s - 2, s * 0.16).stroke({ width: 3, color: COLORS.danger, alpha: hit / 700 });

      // Load pips in the rail below: powder, wad, shot.
      const py = y + s * 1.12;
      const pw = s * 0.24;
      const gap = s * 0.06;
      const px0 = x + (s - pw * 3 - gap * 2) / 2;
      for (let k = 0; k < 3; k++) {
        const kc = this.colorByKind.get(k) ?? 0xffffff;
        const px = px0 + k * (pw + gap);
        const filled = k < c.loaded;
        g.roundRect(px, py, pw, pw, s * 0.05).fill(filled ? { color: mix(kc, 0xffffff, 0.15) } : { color: 0x000000, alpha: 0.45 });
        g.roundRect(px, py, pw, pw, s * 0.05).stroke({ width: filled ? 1.5 : 1, color: filled ? 0xffffff : mix(kc, 0xffffff, 0.3), alpha: filled ? 0.7 : 0.55 });
      }

      // Something is on its way in: green if it is what the cannon wants, red if it will foul it.
      const inc = this.incoming[i];
      if (inc && inc.outcome !== "splash") {
        const good = isGood(inc.outcome);
        const near = Math.max(0, 1 - (inc.eta - 1) / LOOK_AHEAD);
        const pulse = 0.6 + 0.4 * Math.sin(this.time / (good ? 140 : 90));
        fx.roundRect(x - 1, y - 1, s + 2, s + 2, s * 0.18).stroke({ width: 2 + 2 * near, color: good ? COLORS.good : COLORS.danger, alpha: (0.35 + 0.65 * near) * pulse });
      }
    });
  }

  /** The next pieces in the rail beside the chute, soonest nearest. */
  private layoutQueue(): void {
    if (!this.state) return;
    const want = this.state.queue.length;
    while (this.queueSprites.length < want) {
      const sp = new Sprite(Texture.WHITE);
      sp.anchor.set(0.5);
      this.queueLayer.addChild(sp);
      this.queueSprites.push(sp);
    }
    if (!this.nextLabel) {
      this.nextLabel = new Text({ text: this.opts.labels.next, style: { fontFamily: "Inter, system-ui, sans-serif", fontWeight: "700", fill: COLORS.brass, fontSize: 12, letterSpacing: 1 } });
      this.nextLabel.anchor.set(1, 0.5);
      this.queueLayer.addChild(this.nextLabel);
    }
    const { barrel } = this.deck;
    this.nextLabel.style.fontSize = Math.max(9, this.cell * 0.22);
    this.nextLabel.position.set(this.cx(barrel.col) - this.cell * 0.62, this.cy(barrel.row));
  }

  private drawQueue(): void {
    if (!this.state) return;
    if (this.queueSprites.length !== this.state.queue.length || !this.nextLabel) this.layoutQueue();
    const { barrel } = this.deck;
    this.state.queue.forEach((kind, i) => {
      const sp = this.queueSprites[i]!;
      sp.texture = this.textures.get(kind) ?? Texture.WHITE;
      const scale = i === 0 ? 0.62 : 0.5;
      sp.scale.set(scale);
      sp.alpha = i === 0 ? 1 : 0.7 - i * 0.12;
      sp.position.set(this.cx(barrel.col + 1 + i), this.cy(barrel.row));
    });
  }

  private drawCursor(): void {
    const g = this.cursorG;
    g.clear();
    if (!this.cursor || !this.interactive) return;
    const s = this.cell;
    g.roundRect(this.cursor.col * s + 2, this.cursor.row * s + 2, s - 4, s - 4, s * 0.14).stroke({ width: 2.5, color: COLORS.cursor, alpha: 0.9 });
  }

  private drawHover(): void {
    const g = this.hoverG;
    g.clear();
    const h = this.press ?? this.hover;
    if (!h || !this.interactive || !this.isDeck(h.col, h.row)) return;
    const s = this.cell;
    g.rect(h.col * s, h.row * s, s, s).fill({ color: COLORS.cursor, alpha: 0.08 });
  }

  /** A chevron on each piece's leading edge so its heading reads at a glance. */
  private drawHeadings(): void {
    const g = this.headG;
    g.clear();
    const s = this.cell;
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const dx = DX[v.dir]!;
      const dy = DY[v.dir]!;
      const tip = s * 0.5;
      const back = s * 0.36;
      const w = s * 0.12;
      const x = v.s.x;
      const y = v.s.y;
      g.poly([x + dx * tip, y + dy * tip, x + dx * back - dy * w, y + dy * back + dx * w, x + dx * back + dy * w, y + dy * back - dx * w]).fill({ color: COLORS.cursor, alpha: 0.85 });
    }
  }

  private bake(): void {
    const r = this.app.renderer;
    if (!r) return;
    const old = [...this.textures.values()];
    for (const kind of this.colorByKind.keys()) {
      const canvas = tileCanvas(Math.round(this.cell * 0.86), this.styleFor(kind), r.resolution);
      this.textures.set(kind, new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) }));
    }
    for (const v of this.pieces.values()) v.s.texture = this.textures.get(v.kind) ?? Texture.WHITE;
    this.drawQueue();
    for (const tex of old) tex.destroy(true);
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return (row + 0.5) * this.cell;
  }
  private local(x: number, y: number): { col: number; row: number; fx: number; fy: number } | null {
    const lx = (x - this.origin.x) / this.cell;
    const ly = (y - this.origin.y) / this.cell;
    const col = Math.floor(lx);
    const row = Math.floor(ly);
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return { col, row, fx: lx - col, fy: ly - row };
  }

  private popup(x: number, y: number, text: string, color: number, size: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(12, this.cell * size), fontWeight: "800", fill: color, stroke: { color: 0x000000, width: 3 } },
    });
    t.anchor.set(0.5);
    t.position.set(Math.min(Math.max(x, this.cell * 1.3), this.width * this.cell - this.cell * 1.3), y - this.cell * 0.2);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 500 : 1000, y0: t.y });
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    const per = Math.max(60, this.opts.tickMs);
    for (const [id, v] of [...this.pieces]) {
      if (v.dying !== null) {
        v.dying += dt;
        const k = Math.min(1, v.dying / DIE_MS);
        if (v.exit) v.s.position.set(v.fx + (v.exit.x - v.fx) * k, v.fy + (v.exit.y - v.fy) * k);
        v.s.alpha = 1 - k * k;
        v.s.scale.set(1 - k * 0.55);
        if (k >= 1) {
          v.s.destroy();
          this.pieces.delete(id);
        }
        continue;
      }
      if (v.k < 1) {
        v.k = this.reduced ? 1 : Math.min(1, v.k + dt / per);
        v.s.position.set(v.fx + (v.tx - v.fx) * v.k, v.fy + (v.ty - v.fy) * v.k);
      }
      if (v.s.scale.x < 1) v.s.scale.set(Math.min(1, v.s.scale.x + dt / 180));
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = p.life / p.max;
      p.t.y = p.y0 - k * this.cell * 0.7;
      p.t.alpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
      p.t.scale.set(k < 0.12 ? 0.6 + (k / 0.12) * 0.4 : 1);
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
    const fx = this.fxG;
    fx.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      p.x += p.vx * dt * (this.cell / 40);
      p.y += p.vy * dt * (this.cell / 40);
      p.r = Math.max(0.5, p.r + p.grow * dt);
      const k = p.life / p.max;
      if (k >= 1) {
        this.particles.splice(i, 1);
        continue;
      }
      fx.circle(p.x, p.y, p.r).fill({ color: p.color, alpha: p.alpha * (1 - k) });
    }
    for (const arr of [this.glow, this.recoil, this.hit]) for (let i = 0; i < arr.length; i++) if ((arr[i] ?? 0) > 0) arr[i] = Math.max(0, arr[i]! - dt);
    if (this.shake > 0 && !this.reduced) {
      this.shake = Math.max(0, this.shake - dt);
      const a = (this.shake / 220) * this.cell * 0.08;
      this.board.position.set(this.origin.x + (Math.random() - 0.5) * a, this.origin.y + (Math.random() - 0.5) * a);
    } else this.board.position.set(this.origin.x, this.origin.y);
    this.drawCannons();
    this.drawHeadings();
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
  }

  // ---- input

  /** The arrow a press or hover on this cell would lay: the way it leans, or lift if that arrow is already there. */
  private ghostFor(col: number, row: number, dir: Dir, canLift: boolean): Ghost | null {
    if (!this.isDeck(col, row)) return null;
    const existing = this.state?.arrows.find((a) => a.col === col && a.row === row);
    return { col, row, dir, lift: canLift && existing?.dir === dir };
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const at = this.local(e.global.x, e.global.y);
    if (!at || !this.isDeck(at.col, at.row)) return;
    if (e.button === 2) {
      // Right click lifts the arrow under the pointer.
      if (this.state?.arrows.some((a) => a.col === at.col && a.row === at.row)) this.cb.onArrow(at.col, at.row, null);
      return;
    }
    const dir = leanOf(at.fx, at.fy);
    this.press = { x: e.global.x, y: e.global.y, col: at.col, row: at.row, touch: e.pointerType !== "mouse", dragged: false, dir };
    this.cursor = null;
    this.drawCursor();
    this.setGhost(this.ghostFor(at.col, at.row, dir, true));
    this.drawHover();
  }

  private pointerMove(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const pr = this.press;
    if (pr) {
      const dx = e.global.x - pr.x;
      const dy = e.global.y - pr.y;
      if (Math.hypot(dx, dy) >= this.cell * 0.3) {
        pr.dragged = true;
        pr.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
        this.setGhost(this.ghostFor(pr.col, pr.row, pr.dir, false));
      }
      return;
    }
    if (e.pointerType !== "mouse") return;
    const at = this.local(e.global.x, e.global.y);
    const prev = this.hover;
    this.hover = at;
    if (!prev || !at || prev.col !== at.col || prev.row !== at.row) this.drawHover();
    this.setGhost(at ? this.ghostFor(at.col, at.row, leanOf(at.fx, at.fy), true) : null);
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const pr = this.press;
    this.press = null;
    if (!pr || !this.interactive || !this.state) return;
    const g = this.ghost;
    if (g && g.col === pr.col && g.row === pr.row) {
      if (g.lift) this.cb.onArrow(g.col, g.row, null);
      else {
        const existing = this.state.arrows.find((a) => a.col === g.col && a.row === g.row);
        if (existing?.dir !== g.dir) this.cb.onArrow(g.col, g.row, g.dir);
      }
    }
    // After a commit the hover ghost reflects the new arrow (a second click lifts it); touch has no hover.
    if (e.pointerType === "mouse") {
      const at = this.local(e.global.x, e.global.y);
      this.ghost = null;
      this.setGhost(at ? this.ghostFor(at.col, at.row, leanOf(at.fx, at.fy), true) : null);
    } else this.setGhost(null);
    this.drawHover();
  }

  private isDeck(col: number, row: number): boolean {
    return gunneryCellAt(this.deck, col, row) === "deck";
  }

  /** Keyboard: arrows move the cursor over deck cells; W A S D lay an arrow; Backspace, Delete or Space lifts. */
  keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const c = this.cursor ?? this.firstDeckCell();
    const moveCursor = (dcol: number, drow: number): void => {
      let col = c.col + dcol;
      let row = c.row + drow;
      // Skip over non-deck cells in the same direction.
      for (let i = 0; i < Math.max(this.width, this.height); i++) {
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) return;
        if (this.isDeck(col, row)) break;
        col += dcol;
        row += drow;
      }
      if (!this.isDeck(col, row)) return;
      this.cursor = { col, row };
      this.drawCursor();
    };
    const lay = (dir: Dir): void => {
      this.cursor = c;
      this.drawCursor();
      const existing = this.state?.arrows.find((a) => a.col === c.col && a.row === c.row);
      if (existing?.dir !== dir) this.cb.onArrow(c.col, c.row, dir);
    };
    switch (key) {
      case "ArrowLeft":
        moveCursor(-1, 0);
        return true;
      case "ArrowRight":
        moveCursor(1, 0);
        return true;
      case "ArrowUp":
        moveCursor(0, -1);
        return true;
      case "ArrowDown":
        moveCursor(0, 1);
        return true;
      case "d":
      case "D":
        lay(0);
        return true;
      case "s":
      case "S":
        lay(1);
        return true;
      case "a":
      case "A":
        lay(2);
        return true;
      case "w":
      case "W":
        lay(3);
        return true;
      case " ":
      case "Backspace":
      case "Delete":
        this.cursor = c;
        this.drawCursor();
        if (this.state.arrows.some((a) => a.col === c.col && a.row === c.row)) this.cb.onArrow(c.col, c.row, null);
        return true;
      default:
        return false;
    }
  }

  /** The keyboard cursor starts on the drop cell, where the stream begins. */
  private firstDeckCell(): { col: number; row: number } {
    const { drop } = this.deck;
    return { col: drop.col, row: drop.row };
  }
}

function linear(vertical: boolean, stops: number[]): FillGradient {
  const g = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 }, textureSpace: "local" });
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  return g;
}

export function drawArrowGlyph(g: Graphics, x: number, y: number, r: number, dir: Dir, color: number, alpha: number): void {
  const dx = DX[dir]!;
  const dy = DY[dir]!;
  // Shaft from tail to head, then a chevron at the head.
  const tx = x - dx * r;
  const ty = y - dy * r;
  const hx = x + dx * r;
  const hy = y + dy * r;
  g.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: Math.max(2, r * 0.3), color, alpha, cap: "round" });
  const px = -dy;
  const py = dx;
  const w = r * 0.6;
  g.poly([hx, hy, hx - dx * w + px * w, hy - dy * w + py * w, hx - dx * w - px * w, hy - dy * w - py * w]).fill({ color, alpha });
}
