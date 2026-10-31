import { Application, Container, FillGradient, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import { Special, type BilgingState, type ClearRound, type MoveReport, type Piece } from "@openseas/engine";
import type { BilgingContent } from "@openseas/content";
import { buildFlash, buildTile, mix, type TileStyle } from "./tiles.js";

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
}

export interface RendererOptions {
  showMarks: boolean;
  /** Labels drawn inside special tiles, from the message table. */
  labels: { keg: string; ink: string; barnacle: string };
  /** Formats the callout shown for cascade step `chain` (2 and up), from the message table. */
  chainLabel(chain: number): string;
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
  woodTop: 0x4a3322,
  woodBottom: 0x2a1b10,
  woodEdge: 0x1a0f07,
  wellTop: 0x15253f,
  wellBottom: 0x070f1c,
  water: 0x1fa0a8,
  waterDeep: 0x0b4d5e,
  foam: 0xc9fbef,
  danger: 0xf0604d,
  brass: 0xd4a548,
  brassLight: 0xf5d58a,
  select: 0xf2f0e6,
  preview: 0x5ed3b8,
  ink: 0x070e1a,
};

const SWAP_MS = 120;
const CLEAR_MS = 190;
const DIE_MS = 230;

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
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * PixiJS view of a Bilging state. Pure presentation: it never touches the engine. A move plays out
 * as a timeline (swap, then each cascade step: clear, rise, settle) built from the move report, so
 * the player sees every chain. A new move fast-forwards whatever is still playing, so input never
 * waits on animation.
 */
export class BilgingRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  /** Frame and well never change between layouts, so they render once into a cached texture. */
  private readonly staticLayer = new Container();
  private readonly frame = new Graphics();
  private readonly glow = new Graphics();
  private readonly well = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly waterBack = new Graphics();
  private readonly waterLayer = new Graphics();
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
  private readonly textures = new Map<number, Texture>();
  private readonly woodFill = linear(false, [COLORS.woodBottom, COLORS.woodTop, COLORS.woodBottom]);
  private readonly wellFill = linear(true, [COLORS.wellTop, COLORS.wellBottom]);
  private readonly waterFill = linear(true, [COLORS.water, COLORS.waterDeep]);
  private readonly dangerFill = linear(true, [mix(COLORS.water, COLORS.danger, 0.35), COLORS.waterDeep]);
  private flashTex: Texture = Texture.WHITE;
  private sparkTex: Texture = Texture.WHITE;
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private showMarks: boolean;
  private cell = 48;
  private pad = 10;
  private ox = 0;
  private oy = 0;
  private width = 6;
  private height = 12;
  private waterTarget = 0;
  private waterShown = 0;
  private time = 0;
  private shake = 0;
  private combo = 0;
  private comboShown = 0;
  private selected: { col: number; row: number } | null = null;
  private cursor: { col: number; row: number } | null = null;
  private hoverPair: { col: number; row: number } | null = null;
  private previewCells: readonly number[] = [];
  private dragStart: { col: number; row: number; x: number; y: number } | null = null;
  private dragDx = 0;
  private holdTimer: number | null = null;
  private steps: Step[] = [];
  private waitMs = 0;
  private waitSettle = 0;
  private moving = false;
  private framePending = false;
  private destroyed = false;
  private state: BilgingState | null = null;
  private interactive = true;

  constructor(
    private readonly host: HTMLElement,
    content: BilgingContent,
    private readonly cb: RendererCallbacks,
    private readonly opts: RendererOptions,
  ) {
    this.showMarks = opts.showMarks;
    content.pieces.forEach((p, i) => {
      this.colorByKind.set(i, parseInt(p.color.slice(1), 16));
      this.markByKind.set(i, p.mark);
    });
    this.colorByKind.set(Special.Keg, parseInt(content.specials.keg.color.slice(1), 16));
    this.colorByKind.set(Special.Ink, parseInt(content.specials.ink.color.slice(1), 16));
    this.colorByKind.set(Special.Barnacle, parseInt(content.specials.barnacle.color.slice(1), 16));
  }

  private styleFor(kind: number): TileStyle {
    const color = this.colorByKind.get(kind) ?? 0xffffff;
    const special = kind === Special.Keg ? "keg" : kind === Special.Ink ? "ink" : kind === Special.Barnacle ? "barnacle" : null;
    return {
      color,
      mark: special ? null : (this.markByKind.get(kind) ?? null),
      special,
      label: special ? this.opts.labels[special] : "",
      showMarks: this.showMarks,
    };
  }

  /** Fx color for a kind: specials burst in their accent rather than their dark body. */
  private fxColor(kind: number): number {
    if (kind === Special.Keg) return 0xffb347;
    if (kind === Special.Ink) return 0xc084fc;
    if (kind === Special.Barnacle) return 0xf2f0e6;
    return this.colorByKind.get(kind) ?? 0xffffff;
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    if (this.app.renderer) this.bake();
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
    // Special labels are baked into textures, so wait (briefly) for the webfont.
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "bilging-canvas");
    this.host.appendChild(this.app.canvas);
    this.pieceLayer.sortableChildren = true;
    this.staticLayer.addChild(this.frame, this.well);
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    this.board.addChild(this.staticLayer, this.glow, this.waterBack, this.pieceLayer, this.waterLayer, this.gauge, this.overlay, this.fxLayer, this.calloutLayer);
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
      this.flashTex.destroy(true);
      this.sparkTex.destroy(true);
      for (const f of [this.woodFill, this.wellFill, this.waterFill, this.dangerFill]) f.destroy();
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
  setState(state: BilgingState, report: MoveReport | null): void {
    const prev = this.state;
    this.state = state;
    this.combo = state.combo;
    if (state.config.width !== this.width || state.config.height !== this.height) {
      this.width = state.config.width;
      this.height = state.config.height;
      this.layout();
    }
    this.waterTarget = state.waterRow;
    this.framePending = true;
    this.selected = null;
    this.previewCells = [];
    this.hoverPair = null;

    if (!prev || !report || report.move.type !== "swap" || prev.config !== state.config) {
      this.steps = [];
      this.waitMs = 0;
      this.place(state.cells, prev === null || !report);
      if (!prev) this.waterShown = state.waterRow;
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
    this.steps.push(() => {
      this.place(swapped, false);
      return report.rounds.length ? SWAP_MS : 0;
    });
    for (const round of report.rounds) {
      this.steps.push(() => {
        this.clear(round);
        return CLEAR_MS;
      });
      this.steps.push(() => {
        this.place(round.settled, false);
        return "settle";
      });
    }
    this.steps.push(() => {
      this.place(state.cells, false);
      return 0;
    });
    this.runSteps(0);
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
      if (!v || v.dying !== null) {
        if (v) this.remove(p.id);
        v = this.spawn(p, tx, snap ? ty : this.cy(row - fresh[col]!));
      } else if (!snap && v.tx !== tx) {
        v.sx = v.x;
        v.slide = 0;
        v.slideDir = tx > v.x ? -1 : 1;
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
    const v: PieceView = { c, tile, flash, kind: p.kind, x, y, tx: x, ty: y, vy: 0, sx: x, slide: 1, slideDir: 0, squash: 0, dying: null, quiet: false };
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
        this.burst(v.x, v.y, this.fxColor(v.kind), group.cause === "match" ? 6 : 9);
      }
      if (group.cause === "keg" && group.ids.length) {
        const center = this.centerOf(group.ids);
        this.ring(center.x, center.y, this.cell * 0.3, this.cell * 2.1, 0xffb347, 420, 0.14);
        this.ring(center.x, center.y, this.cell * 0.2, this.cell * 1.4, 0xfff1c9, 260, 0.08);
        this.kick(0.22);
      } else if (group.cause === "ink" && group.ids.length) {
        const center = this.centerOf(group.ids);
        this.ring(center.x, center.y, this.cell * 0.4, this.cell * 4.5, 0xc084fc, 620, 0.1);
        this.kick(0.12);
      } else if (group.cause === "barnacle") {
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
    if (round.chain >= 2) this.callout(this.opts.chainLabel(round.chain), round.chain);
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

  private burst(x: number, y: number, color: number, count: number): void {
    if (this.reduced) count = Math.ceil(count / 3);
    for (let k = 0; k < count; k++) {
      const s = new Sprite(this.sparkTex);
      s.anchor.set(0.5);
      s.tint = mix(color, 0xffffff, Math.random() * 0.35);
      const a = rand(0, Math.PI * 2);
      const speed = this.cell * rand(0.0025, 0.007);
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
        stroke: { color: COLORS.ink, width: Math.max(3, this.cell * 0.09), join: "round" },
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

  private callout(text: string, chain: number): void {
    for (const p of this.popups) if (p.t.parent === this.calloutLayer) p.life = Math.max(p.life, p.max - 120);
    const t = new Text({
      text,
      style: {
        fontFamily: "Fraunces, Georgia, serif",
        fontStyle: "italic",
        fontSize: Math.max(26, this.cell * (0.8 + Math.min(0.5, chain * 0.08))),
        fontWeight: "900",
        fill: chain >= 4 ? 0xff9a6b : COLORS.brassLight,
        stroke: { color: COLORS.ink, width: Math.max(4, this.cell * 0.12), join: "round" },
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

  private kick(amount: number): void {
    if (this.reduced) return;
    this.shake = Math.min(0.35, Math.max(this.shake, amount));
  }

  // ---- layout and baking

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const padFor = (cell: number): number => Math.max(8, Math.round(cell * 0.22));
    let cell = Math.floor(Math.min(w / this.width, h / this.height));
    cell = Math.floor(Math.min((w - padFor(cell) * 2 - 14) / this.width, (h - padFor(cell) * 2) / this.height));
    this.cell = Math.max(12, cell);
    this.pad = padFor(this.cell);
    this.ox = Math.floor((w - this.cell * this.width) / 2);
    this.oy = Math.floor((h - this.cell * this.height) / 2);
    this.board.position.set(this.ox, this.oy);
    this.drawFrame();
    this.bake();
    if (this.state) this.place(this.state.cells, true);
    this.steps = [];
    this.bubbles.length = 0;
  }

  private drawFrame(): void {
    const g = this.frame;
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    const p = this.pad;
    g.clear();
    // Hull planking around the well, with brass rivets.
    g.roundRect(-p - 2, -p + 4, W + p * 2 + 4, H + p * 2, p + 6).fill({ color: 0x000000, alpha: 0.45 });
    g.roundRect(-p, -p, W + p * 2, H + p * 2, p + 4).fill(this.woodFill);
    for (let r = 1; r < this.height; r += 2) {
      const y = r * this.cell;
      g.moveTo(-p, y).lineTo(0, y).moveTo(W, y).lineTo(W + p, y);
    }
    g.stroke({ width: 1, color: COLORS.woodEdge, alpha: 0.7 });
    g.roundRect(-p, -p, W + p * 2, H + p * 2, p + 4).stroke({ width: 1.5, color: 0x6b4a2e, alpha: 0.9 });
    const rivet = (x: number, y: number): void => {
      const r = Math.max(1.5, p * 0.2);
      g.circle(x, y + 0.8, r).fill({ color: 0x000000, alpha: 0.5 });
      g.circle(x, y, r).fill(COLORS.brass);
      g.circle(x - r * 0.3, y - r * 0.3, r * 0.45).fill({ color: 0xffffff, alpha: 0.55 });
    };
    for (let r = 0; r <= this.height; r += 2) {
      rivet(-p / 2, r * this.cell + (r === 0 ? p * 0.1 : r === this.height ? -p * 0.1 : 0));
      rivet(W + p / 2, r * this.cell + (r === 0 ? p * 0.1 : r === this.height ? -p * 0.1 : 0));
    }

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
  private bake(): void {
    const r = this.app.renderer;
    if (!r) return;
    const old = [...this.textures.values(), this.flashTex, this.sparkTex];
    const s = this.cell;
    const frame = new Rectangle(-s / 2, -s / 2, s, s);
    const kinds = [...this.colorByKind.keys()];
    for (const kind of kinds) {
      const view = buildTile(s, this.styleFor(kind));
      this.textures.set(kind, r.generateTexture({ target: view, frame, resolution: r.resolution, antialias: true }));
      view.destroy({ children: true });
    }
    const flash = buildFlash(s);
    this.flashTex = r.generateTexture({ target: flash, frame, resolution: r.resolution, antialias: true });
    flash.destroy();
    const k = Math.max(3, s * 0.1);
    const spark = new Graphics().roundRect(-k, -k, k * 2, k * 2, k * 0.5).fill(0xffffff);
    this.sparkTex = r.generateTexture({ target: spark, frame: new Rectangle(-k, -k, k * 2, k * 2), resolution: r.resolution, antialias: true });
    spark.destroy();
    for (const v of this.pieces.values()) {
      v.tile.texture = this.textures.get(v.kind) ?? Texture.WHITE;
      v.flash.texture = this.flashTex;
    }
    for (const p of this.particles) p.s.texture = this.sparkTex;
    for (const tex of old) if (tex !== Texture.WHITE) tex.destroy(true);
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
    this.moveFx(dt);
    if (this.shake > 0.002) {
      const a = this.shake * this.cell * 0.5;
      this.board.position.set(this.ox + rand(-a, a), this.oy + rand(-a, a));
      this.shake *= Math.pow(0.82, dt / 16.67);
    } else if (this.shake !== 0) {
      this.shake = 0;
      this.board.position.set(this.ox, this.oy);
    }
    const k = Math.min(1, dt / 16.67);
    this.waterShown += (this.waterTarget - this.waterShown) * Math.min(1, 0.06 * k);
    if (Math.abs(this.waterTarget - this.waterShown) < 0.003) this.waterShown = this.waterTarget;
    this.comboShown += (Math.min(8, this.combo) - this.comboShown) * Math.min(1, 0.1 * k);
    this.drawWater(dt);
    this.drawGlow();
    this.drawOverlay();
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
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
        v.slide = Math.min(1, v.slide + dt / (this.reduced ? 60 : SWAP_MS));
        const e = easeOutBack(v.slide);
        v.x = v.sx + (v.tx - v.sx) * e;
        arc = Math.sin(Math.PI * v.slide) * this.cell * 0.1 * v.slideDir;
        pop = Math.sin(Math.PI * v.slide) * 0.08;
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
      v.c.position.set(v.x + nudge, v.y + arc + sq * this.cell * 0.3);
      // Pieces rising from below the board fade in out of the murk instead of being masked.
      const below = (v.y - (this.height - 0.5) * this.cell) / this.cell;
      v.c.visible = below < 1;
      v.c.alpha = below > 0 ? 1 - below : 1;
      v.c.scale.set(1 + pop + lifted + sq * 0.5, 1 + pop + lifted - sq);
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

  private drawWater(dt: number): void {
    const g = this.waterLayer;
    const back = this.waterBack;
    const gauge = this.gauge;
    g.clear();
    back.clear();
    gauge.clear();
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    const danger = this.waterShown >= this.height * 0.5;
    if (this.waterShown <= 0.01) return;
    const top = (this.height - this.waterShown) * this.cell;
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
    // The body sits behind the tiles and only a light film in front, so kinds stay readable underwater.
    back.poly(pts).fill({ fill: danger ? this.dangerFill : this.waterFill, alpha: 0.75 });
    g.poly(pts).fill({ color: danger ? mix(COLORS.water, COLORS.danger, 0.4) : COLORS.water, alpha: 0.13 });
    // A lagging second crest gives the surface depth, then a bright foam line on top.
    const crest: number[] = [];
    for (let i = 0; i <= steps; i++) crest.push((W * i) / steps, Math.max(2, wave(i, 1.9) - amp * 0.6));
    g.poly(crest, false).stroke({ width: Math.max(1, this.cell * 0.035), color: COLORS.foam, alpha: 0.22 });
    g.poly(line, false).stroke({ width: Math.max(1.5, this.cell * 0.05), color: COLORS.foam, alpha: 0.75 });

    // Bubbles drift up from the bilge and pop at the surface.
    const want = this.reduced ? 0 : Math.round(4 + this.waterShown * 1.2);
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
      g.circle(x, b.y, b.r).stroke({ width: 1, color: COLORS.foam, alpha: 0.45 });
      g.circle(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.3).fill({ color: 0xffffff, alpha: 0.5 });
    }

    // Water-line markers on the planking, red once the bilge is half full.
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

  // ---- input: tap-then-tap, drag-swap, hold-to-preview, hover-to-preview

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
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
          this.cb.onSwap(col, row);
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
    // Tap.
    if (this.selected && this.selected.row === cell.row && Math.abs(this.selected.col - cell.col) === 1) {
      const col = Math.min(this.selected.col, cell.col);
      this.selected = null;
      this.cb.onSwap(col, cell.row);
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
        this.cb.onSwap(col, c.row);
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
