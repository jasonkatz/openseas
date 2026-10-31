import { Application, CanvasSource, Container, FillGradient, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import { DX, DY, GunneryKind, cannonNeeds, gunneryCellAt, parseGunneryDeck, type Dir, type GunneryEvent, type GunneryState, type ParsedDeck } from "@openseas/engine";
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
  labels: { loaded: string; fouled: string; fired: string };
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
  dying: number | null;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

const COLORS = {
  plank: 0x7a5533,
  plankDark: 0x4e3419,
  plankLine: 0x2d1c0c,
  wall: 0x2a1b10,
  wallEdge: 0x6b4a2e,
  crate: 0xa87b45,
  barrel: 0x5c3d21,
  brass: 0xd4a548,
  iron: 0x3a3f47,
  ironLight: 0x7c8591,
  hatch: 0x0a1424,
  sea: 0x1a7f8a,
  danger: 0xf0604d,
  smoke: 0x1c1c22,
  arrow: 0xf5d58a,
  cursor: 0xf2f0e6,
};
const DIE_MS = 220;

/** One string that names what the deck shows: pieces by cell, cannon states, the tick. Shared with the page. */
export function gunneryViewString(state: GunneryState): string {
  const pieces = [...state.pieces].sort((a, b) => a.id - b.id).map((p) => `${p.id}:${p.kind}:${p.col}:${p.row}`);
  const cannons = state.cannons.map((c) => `${c.loaded}${c.fouled ? "f" : ""}`);
  return `t${state.tick}|${pieces.join(",")}|${cannons.join(",")}`;
}

export class GunneryRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  private readonly staticLayer = new Container();
  private readonly deckG = new Graphics();
  private readonly arrowLayer = new Graphics();
  private readonly cannonLayer = new Graphics();
  private readonly cursorG = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly pieces = new Map<number, PieceView>();
  private readonly popups: Popup[] = [];
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
  /** The deck from content; it never changes within a round, so it is painted once per layout. */
  private readonly deck: ParsedDeck;
  private state: GunneryState | null = null;
  private lastEventTick = -1;
  private interactive = false;
  private framePending = false;
  private destroyed = false;
  private time = 0;
  private cursor: { col: number; row: number } | null = null;
  private drag: { x: number; y: number; col: number; row: number } | null = null;
  /** Cannon glow after a load, keyed by cannon index: ms remaining. */
  private readonly glow: number[] = [];

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
    this.host.appendChild(this.app.canvas);
    this.staticLayer.addChild(this.deckG);
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    this.board.addChild(this.staticLayer, this.arrowLayer, this.cannonLayer, this.pieceLayer, this.cursorG, this.fxLayer);
    this.app.stage.addChild(this.board);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", () => (this.drag = null));
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
      this.drag = null;
      this.cursor = null;
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
    }
    const seen = new Set<number>();
    for (const p of state.pieces) {
      seen.add(p.id);
      const x = this.cx(p.col);
      const y = this.cy(p.row);
      let v = this.pieces.get(p.id);
      if (!v) {
        const s = new Sprite(this.textures.get(p.kind) ?? Texture.WHITE);
        s.anchor.set(0.5);
        const bx = this.cx(state.deck.barrel.col);
        const by = this.cy(state.deck.barrel.row);
        s.position.set(bx, by);
        s.scale.set(0.4);
        this.pieceLayer.addChild(s);
        v = { s, kind: p.kind, fx: bx, fy: by, tx: x, ty: y, k: 0, dying: null };
        this.pieces.set(p.id, v);
      } else if (v.tx !== x || v.ty !== y) {
        v.fx = v.s.x;
        v.fy = v.s.y;
        v.tx = x;
        v.ty = y;
        v.k = reset ? 1 : 0;
      }
      if (reset) {
        v.k = 1;
        v.s.position.set(x, y);
        v.s.scale.set(1);
      }
    }
    for (const [id, v] of this.pieces) if (!seen.has(id) && v.dying === null) v.dying = 0;

    const fresh = (state.lastMove?.events ?? []).filter((e) => e.tick > this.lastEventTick);
    if (fresh.length) {
      this.lastEventTick = Math.max(...fresh.map((e) => e.tick));
      for (const e of fresh) {
        if (e.cannon === undefined) continue;
        const c = state.cannons[e.cannon]!;
        if (e.type === "loaded") {
          this.glow[e.cannon] = 1200;
          this.popup(this.cx(c.col), this.cy(c.row), this.opts.labels.loaded, COLORS.brass);
        } else if (e.type === "foul") this.popup(this.cx(c.col), this.cy(c.row), this.opts.labels.fouled, COLORS.danger);
        else if (e.type === "fire") this.popup(this.cx(c.col), this.cy(c.row), this.opts.labels.fired, 0xffb347);
      }
      this.cb.onEvents(fresh);
    }
    this.drawArrows();
    this.drawCannons();
    this.app.canvas.setAttribute("data-view", gunneryViewString(state));
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
    this.board.position.set(Math.floor((w - this.cell * this.width) / 2), Math.floor((h - this.cell * this.height) / 2));
    this.drawDeck();
    this.bake();
    this.drawArrows();
    this.drawCannons();
    this.drawCursor();
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
    }
  }

  /** Walls, planks, crates, barrel, hatches and cannon barrels. Everything that never changes. */
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
        const kind = gunneryCellAt(deck, col, row);
        switch (kind) {
          case "deck":
            g.rect(x, y, s, s).fill(this.plankFill);
            g.moveTo(x, y + s * 0.5).lineTo(x + s, y + s * 0.5).stroke({ width: 1, color: COLORS.plankLine, alpha: 0.35 });
            g.rect(x, y, s, s).stroke({ width: 1, color: COLORS.plankLine, alpha: 0.5 });
            break;
          case "wall":
            g.rect(x, y, s, s).fill({ color: COLORS.wall });
            g.rect(x + 1, y + 1, s - 2, s - 2).stroke({ width: 1, color: COLORS.wallEdge, alpha: 0.35 });
            break;
          case "crate":
            g.rect(x, y, s, s).fill(this.plankFill);
            g.roundRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.08).fill({ color: COLORS.crate });
            g.roundRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.08).stroke({ width: 2, color: COLORS.plankLine, alpha: 0.8 });
            g.moveTo(x + s * 0.12, y + s * 0.12).lineTo(x + s * 0.88, y + s * 0.88).moveTo(x + s * 0.88, y + s * 0.12).lineTo(x + s * 0.12, y + s * 0.88).stroke({ width: 2, color: COLORS.plankLine, alpha: 0.6 });
            break;
          case "barrel":
            g.rect(x, y, s, s).fill(this.plankFill);
            g.circle(x + s / 2, y + s / 2, s * 0.44).fill({ color: COLORS.barrel });
            g.circle(x + s / 2, y + s / 2, s * 0.44).stroke({ width: 2, color: COLORS.plankLine });
            g.circle(x + s / 2, y + s / 2, s * 0.3).stroke({ width: 2, color: COLORS.brass, alpha: 0.8 });
            g.circle(x + s / 2, y + s / 2, s * 0.1).fill({ color: 0x000000, alpha: 0.6 });
            break;
          case "hatch":
            g.rect(x, y, s, s).fill({ color: COLORS.hatch });
            g.rect(x + s * 0.15, y + s * 0.15, s * 0.7, s * 0.7).fill({ color: COLORS.sea, alpha: 0.55 });
            g.rect(x + s * 0.15, y + s * 0.15, s * 0.7, s * 0.7).stroke({ width: 2, color: COLORS.brass, alpha: 0.6 });
            break;
          case "cannon": {
            g.rect(x, y, s, s).fill({ color: COLORS.wall });
            // The barrel points out through the gunwale; its breech faces the deck.
            const facingRight = col === 0;
            const bx = facingRight ? x + s * 0.05 : x + s * 0.35;
            g.roundRect(bx, y + s * 0.3, s * 0.6, s * 0.4, s * 0.12).fill({ color: COLORS.iron });
            g.roundRect(bx, y + s * 0.3, s * 0.6, s * 0.4, s * 0.12).stroke({ width: 1.5, color: COLORS.ironLight, alpha: 0.7 });
            g.circle(facingRight ? x + s * 0.68 : x + s * 0.32, y + s / 2, s * 0.22).fill({ color: COLORS.iron });
            g.circle(facingRight ? x + s * 0.68 : x + s * 0.32, y + s / 2, s * 0.12).fill({ color: 0x000000, alpha: 0.75 });
            break;
          }
        }
      }
    }
    this.staticLayer.updateCacheTexture();
  }

  private drawArrows(): void {
    const g = this.arrowLayer;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    const n = this.state.arrows.length;
    this.state.arrows.forEach((a, i) => {
      const x = this.cx(a.col);
      const y = this.cy(a.row);
      // The oldest arrow is drawn fainter: it goes first when a fourth is laid.
      const oldest = n >= this.state!.config.maxArrows && i === 0;
      g.roundRect(x - s * 0.42, y - s * 0.42, s * 0.84, s * 0.84, s * 0.14).fill({ color: COLORS.arrow, alpha: oldest ? 0.12 : 0.2 });
      drawArrowGlyph(g, x, y, s * 0.3, a.dir, COLORS.arrow, oldest ? 0.55 : 1);
    });
  }

  /** Load-order slots, need highlight, fouling smoke and the loaded glow on every cannon. */
  private drawCannons(): void {
    const g = this.cannonLayer;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    this.state.cannons.forEach((c, i) => {
      const x = c.col * s;
      const y = c.row * s;
      const slotW = s * 0.22;
      const need = cannonNeeds(c);
      const glow = this.glow[i] ?? 0;
      if (glow > 0 || c.loaded === 3) {
        g.rect(x, y, s, s).fill({ color: COLORS.brass, alpha: c.loaded === 3 ? 0.18 + 0.1 * Math.sin(this.time / 120) : (0.3 * glow) / 1200 });
      }
      for (let k = 0; k < 3; k++) {
        const sx = x + s * 0.11 + k * (slotW + s * 0.06);
        const sy = y + s * 0.78;
        const color = this.colorByKind.get(k) ?? 0xffffff;
        if (k < c.loaded) g.roundRect(sx, sy, slotW, s * 0.14, 2).fill({ color: mix(color, 0xffffff, 0.2) });
        else g.roundRect(sx, sy, slotW, s * 0.14, 2).fill({ color: 0x000000, alpha: 0.5 });
        if (need === k) {
          const pulse = 0.55 + 0.45 * Math.sin(this.time / 160);
          g.roundRect(sx - 1, sy - 1, slotW + 2, s * 0.14 + 2, 3).stroke({ width: 1.5, color: mix(color, 0xffffff, 0.5), alpha: pulse });
        }
      }
      if (need !== null) {
        // The piece this cannon wants next, as a small badge over the breech.
        const color = this.colorByKind.get(need) ?? 0xffffff;
        g.circle(x + s / 2, y + s * 0.18, s * 0.11).fill({ color: mix(color, 0xffffff, 0.15) });
        g.circle(x + s / 2, y + s * 0.18, s * 0.11).stroke({ width: 1.5, color: 0x000000, alpha: 0.6 });
      }
      if (c.fouled) {
        for (let k = 0; k < 3; k++) {
          const wob = Math.sin(this.time / 300 + k * 2) * s * 0.06;
          g.circle(x + s * (0.3 + k * 0.2) + wob, y + s * (0.35 - k * 0.08), s * (0.14 + k * 0.03)).fill({ color: COLORS.smoke, alpha: 0.55 });
        }
        g.rect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8).stroke({ width: 2, color: COLORS.danger, alpha: 0.6 });
      }
    });
  }

  private drawCursor(): void {
    const g = this.cursorG;
    g.clear();
    if (!this.cursor || !this.interactive) return;
    const s = this.cell;
    g.roundRect(this.cursor.col * s + 2, this.cursor.row * s + 2, s - 4, s - 4, s * 0.14).stroke({ width: 2.5, color: COLORS.cursor, alpha: 0.9 });
  }

  private bake(): void {
    const r = this.app.renderer;
    if (!r) return;
    const old = [...this.textures.values()];
    for (const kind of this.colorByKind.keys()) {
      const canvas = tileCanvas(Math.round(this.cell * 0.9), this.styleFor(kind), r.resolution);
      this.textures.set(kind, new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) }));
    }
    for (const v of this.pieces.values()) v.s.texture = this.textures.get(v.kind) ?? Texture.WHITE;
    for (const tex of old) tex.destroy(true);
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return (row + 0.5) * this.cell;
  }
  private cellAt(x: number, y: number): { col: number; row: number } | null {
    const col = Math.floor((x - this.board.x) / this.cell);
    const row = Math.floor((y - this.board.y) / this.cell);
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return { col, row };
  }

  private popup(x: number, y: number, text: string, color: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(12, this.cell * 0.42), fontWeight: "800", fill: color, stroke: { color: 0x000000, width: 3 } },
    });
    t.anchor.set(0.5);
    t.position.set(Math.min(Math.max(x, this.cell * 1.5), this.width * this.cell - this.cell * 1.5), y - this.cell * 0.3);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 1100, y0: t.y });
  }

  // ---- per frame

  private tick(dt: number): void {
    this.time += dt;
    const per = Math.max(60, this.opts.tickMs);
    for (const [id, v] of [...this.pieces]) {
      if (v.dying !== null) {
        v.dying += dt;
        const k = Math.min(1, v.dying / DIE_MS);
        v.s.alpha = 1 - k;
        v.s.scale.set(1 - k * 0.5);
        if (k >= 1) {
          v.s.destroy();
          this.pieces.delete(id);
        }
        continue;
      }
      if (v.k < 1) {
        v.k = this.reduced ? 1 : Math.min(1, v.k + dt / per);
        v.s.position.set(v.fx + (v.tx - v.fx) * v.k, v.fy + (v.ty - v.fy) * v.k);
        if (v.s.scale.x < 1) v.s.scale.set(Math.min(1, v.s.scale.x + dt / 160));
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = p.life / p.max;
      p.t.y = p.y0 - k * this.cell * 0.6;
      p.t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
    let redraw = false;
    for (let i = 0; i < this.glow.length; i++) {
      if ((this.glow[i] ?? 0) > 0) {
        this.glow[i] = Math.max(0, this.glow[i]! - dt);
        redraw = true;
      }
    }
    if (this.state && (redraw || this.state.cannons.some((c) => c.fouled || cannonNeeds(c) !== null))) this.drawCannons();
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
  }

  // ---- input

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const cell = this.cellAt(e.global.x, e.global.y);
    if (!cell) return;
    this.drag = { x: e.global.x, y: e.global.y, ...cell };
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.interactive || !this.state) return;
    if (!this.isDeck(d.col, d.row)) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    this.cursor = { col: d.col, row: d.row };
    this.drawCursor();
    if (Math.hypot(dx, dy) >= this.cell * 0.5) {
      const dir: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
      this.cb.onArrow(d.col, d.row, dir);
      return;
    }
    this.cycle(d.col, d.row);
  }

  /** Tap: lay an arrow pointing right, then turn it clockwise on each tap, then lift it. */
  private cycle(col: number, row: number): void {
    const existing = this.state?.arrows.find((a) => a.col === col && a.row === row);
    if (!existing) this.cb.onArrow(col, row, 0);
    else if (existing.dir === 3) this.cb.onArrow(col, row, null);
    else this.cb.onArrow(col, row, ((existing.dir + 1) % 4) as Dir);
  }

  private isDeck(col: number, row: number): boolean {
    return gunneryCellAt(this.deck, col, row) === "deck";
  }

  /** Keyboard: arrows move the cursor over deck cells; W A S D lay an arrow; Enter turns; Backspace lifts. */
  keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const c = this.cursor ?? this.firstDeckCell();
    const moveCursor = (dcol: number, drow: number): void => {
      let col = c.col + dcol;
      let row = c.row + drow;
      // Skip over non-deck cells (crates, the barrel) in the same direction.
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
      this.cb.onArrow(c.col, c.row, dir);
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
      case "Enter":
      case " ":
        this.cursor = c;
        this.drawCursor();
        this.cycle(c.col, c.row);
        return true;
      case "Backspace":
      case "Delete":
        this.cursor = c;
        this.drawCursor();
        this.cb.onArrow(c.col, c.row, null);
        return true;
      default:
        return false;
    }
  }

  private firstDeckCell(): { col: number; row: number } {
    for (let row = 1; row < this.height; row++) for (let col = 1; col < this.width; col++) if (this.isDeck(col, row)) return { col, row };
    return { col: 1, row: 1 };
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

export { GunneryKind };
