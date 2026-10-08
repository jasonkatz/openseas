import { Application, Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import { Special, colOf, rowOf, type BilgingState, type MoveReport } from "@openseas/engine";
import type { BilgingContent } from "@openseas/content";
import { drawTile, type TileStyle } from "./tiles.js";

export interface RendererCallbacks {
  /** The player asked to swap (col,row) with (col+1,row). */
  onSwap(col: number, row: number): void;
  /** The player is considering a swap; the page can show a preview. Null clears it. */
  onHover(col: number, row: number): void;
  onHoverEnd(): void;
  /** Called after the first frame that reflects a new state has been drawn. */
  onFrame(): void;
}

interface PieceView {
  g: Graphics;
  kind: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  vy: number;
  dying: number | null;
}

export interface RendererOptions {
  showMarks: boolean;
  /** Labels drawn inside special tiles, from the message table. */
  labels: { keg: string; ink: string; barnacle: string };
}

const COLORS = {
  grid: 0x16213a,
  gridLine: 0x22304f,
  water: 0x1a7f8a,
  waterDeep: 0x0e4f5a,
  cursor: 0xd4a548,
  select: 0xf2f0e6,
  preview: 0x5ed3b8,
};

/**
 * PixiJS view of a Bilging state. Pure presentation: it never touches the engine. Pieces are
 * tracked by id so falls animate, water is a wavy band, and clears flash before they vanish.
 */
export class BilgingRenderer {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly waterLayer = new Graphics();
  private readonly gridLayer = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly overlay = new Graphics();
  private readonly pieces = new Map<number, PieceView>();
  private readonly colorByKind = new Map<number, number>();
  private readonly markByKind = new Map<number, string>();
  private showMarks: boolean;
  private cell = 48;
  private ox = 0;
  private oy = 0;
  private width = 6;
  private height = 12;
  private waterTarget = 0;
  private waterShown = 0;
  private phase = 0;
  private selected: { col: number; row: number } | null = null;
  private cursor: { col: number; row: number } | null = null;
  private previewCells: readonly number[] = [];
  private dragStart: { col: number; row: number; x: number; y: number } | null = null;
  private holdTimer: number | null = null;
  private dirty = false;
  private destroyed = false;
  private state: BilgingState | null = null;
  private interactive = true;

  constructor(
    private readonly host: HTMLElement,
    private readonly content: BilgingContent,
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
    switch (kind) {
      case Special.Keg:
        return { color, mark: null, special: "keg", label: this.opts.labels.keg, showMarks: this.showMarks };
      case Special.Ink:
        return { color, mark: null, special: "ink", label: this.opts.labels.ink, showMarks: this.showMarks };
      case Special.Barnacle:
        return { color, mark: null, special: "barnacle", label: this.opts.labels.barnacle, showMarks: this.showMarks };
      default:
        return { color, mark: this.markByKind.get(kind) ?? null, special: null, label: "", showMarks: this.showMarks };
    }
  }

  private redrawAll(): void {
    for (const [, v] of this.pieces) drawTile(v.g, this.cell, this.styleFor(v.kind));
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    if (this.app.renderer) this.redrawAll();
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
    this.app.canvas.setAttribute("data-testid", "bilging-canvas");
    this.host.appendChild(this.app.canvas);
    this.root.addChild(this.gridLayer, this.waterLayer, this.pieceLayer, this.fxLayer, this.overlay);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointermove", (e) => this.pointerMove(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", () => this.pointerCancel());
    this.app.stage.on("pointerleave", () => this.hoverEnd());
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.selected = null;
      this.dragStart = null;
      this.previewCells = [];
      this.drawOverlay();
    }
  }

  setPreview(cells: readonly number[]): void {
    this.previewCells = cells;
    this.drawOverlay();
  }

  setCursor(c: { col: number; row: number } | null): void {
    this.cursor = c;
    this.drawOverlay();
  }

  getCursor(): { col: number; row: number } | null {
    return this.cursor;
  }

  /** Apply a new engine state. Pieces that moved animate; cleared pieces flash out. */
  setState(state: BilgingState, report: MoveReport | null): void {
    const first = this.state === null;
    this.state = state;
    if (state.config.width !== this.width || state.config.height !== this.height) {
      this.width = state.config.width;
      this.height = state.config.height;
      this.layout();
    }
    this.waterTarget = state.waterRow;
    if (first) this.waterShown = state.waterRow;

    const live = new Set<number>();
    for (let i = 0; i < state.cells.length; i++) {
      const p = state.cells[i]!;
      live.add(p.id);
      const col = colOf(state.config, i);
      const row = rowOf(state.config, i);
      const tx = this.cx(col);
      const ty = this.cy(row);
      let v = this.pieces.get(p.id);
      if (!v) {
        const g = new Graphics();
        drawTile(g, this.cell, this.styleFor(p.kind));
        // New pieces float up from below the board.
        const spawnY = first ? ty : this.cy(-1 - row * 0.35);
        v = { g, kind: p.kind, x: tx, y: spawnY, tx, ty, vy: 0, dying: null };
        g.position.set(v.x, v.y);
        this.pieceLayer.addChild(g);
        this.pieces.set(p.id, v);
      }
      v.tx = tx;
      v.ty = ty;
    }
    for (const [id, v] of this.pieces) {
      if (!live.has(id) && v.dying === null) {
        v.dying = 0;
        v.g.zIndex = 10;
      }
    }
    if (report) this.flash(report);
    this.selected = null;
    this.previewCells = [];
    this.dirty = true;
    this.drawOverlay();
  }

  private flash(report: MoveReport): void {
    for (const round of report.rounds) {
      for (const group of round.groups) {
        const special = group.cause !== "match";
        for (const c of group.cells) {
          const col = c % this.width;
          const row = Math.floor(c / this.width);
          const ring = new Graphics();
          ring.circle(0, 0, this.cell * (special ? 0.55 : 0.45)).stroke({
            width: Math.max(2, this.cell * 0.08),
            color: special ? COLORS.cursor : COLORS.preview,
          });
          ring.position.set(this.cx(col), this.cy(row));
          ring.alpha = 0.9;
          (ring as Graphics & { life: number; delay: number }).life = 0;
          (ring as Graphics & { life: number; delay: number }).delay = (round.chain - 1) * 110;
          this.fxLayer.addChild(ring);
        }
      }
      if (round.points > 0) {
        const anchor = round.groups[0]?.cells[0] ?? 0;
        const label = new Text({
          text: round.chain > 1 ? `+${round.points}  x${round.chain}` : `+${round.points}`,
          style: {
            fontFamily: "Fraunces, Georgia, serif",
            fontSize: Math.max(14, this.cell * 0.45),
            fontWeight: "700",
            fill: round.chain > 1 ? 0xd4a548 : 0xf2f0e6,
            stroke: { color: 0x070e1a, width: 4 },
          },
        });
        label.anchor.set(0.5);
        label.position.set(Math.min(Math.max(this.cx(anchor % this.width), this.ox + 40), this.ox + this.width * this.cell - 40), this.cy(Math.floor(anchor / this.width)));
        (label as Text & { life: number; delay: number }).life = 0;
        (label as Text & { life: number; delay: number }).delay = (round.chain - 1) * 110;
        this.fxLayer.addChild(label);
      }
    }
  }

  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.cell = Math.floor(Math.min(w / this.width, h / this.height));
    this.ox = Math.floor((w - this.cell * this.width) / 2);
    this.oy = Math.floor((h - this.cell * this.height) / 2);
    this.gridLayer.clear();
    this.gridLayer.roundRect(this.ox - 6, this.oy - 6, this.cell * this.width + 12, this.cell * this.height + 12, 14).fill({ color: COLORS.grid, alpha: 0.9 });
    for (let c = 0; c <= this.width; c++) {
      this.gridLayer.moveTo(this.ox + c * this.cell, this.oy).lineTo(this.ox + c * this.cell, this.oy + this.height * this.cell);
    }
    for (let r = 0; r <= this.height; r++) {
      this.gridLayer.moveTo(this.ox, this.oy + r * this.cell).lineTo(this.ox + this.width * this.cell, this.oy + r * this.cell);
    }
    this.gridLayer.stroke({ width: 1, color: COLORS.gridLine, alpha: 0.8 });
    this.redrawAll();
    if (this.state) {
      for (let i = 0; i < this.state.cells.length; i++) {
        const v = this.pieces.get(this.state.cells[i]!.id);
        if (!v) continue;
        v.tx = v.x = this.cx(colOf(this.state.config, i));
        v.ty = v.y = this.cy(rowOf(this.state.config, i));
      }
    }
    this.drawOverlay();
  }

  private cx(col: number): number {
    return this.ox + (col + 0.5) * this.cell;
  }
  /** Row 0 is the bottom of the board. */
  private cy(row: number): number {
    return this.oy + (this.height - row - 0.5) * this.cell;
  }
  private cellAt(x: number, y: number): { col: number; row: number } | null {
    const col = Math.floor((x - this.ox) / this.cell);
    const row = this.height - 1 - Math.floor((y - this.oy) / this.cell);
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return { col, row };
  }

  private tick(dt: number): void {
    const k = Math.min(1, dt / 16.67);
    let moving = false;
    for (const [id, v] of this.pieces) {
      if (v.dying !== null) {
        v.dying += dt;
        const t = v.dying / 160;
        v.g.scale.set(1 + t * 0.6);
        v.g.alpha = Math.max(0, 1 - t);
        if (t >= 1) {
          this.pieceLayer.removeChild(v.g);
          v.g.destroy();
          this.pieces.delete(id);
        }
        continue;
      }
      const dy = v.ty - v.y;
      const dx = v.tx - v.x;
      if (Math.abs(dy) > 0.5 || Math.abs(dx) > 0.5) {
        moving = true;
        // Pieces float up with a buoyant acceleration; horizontal swaps slide.
        v.vy = dy !== 0 ? Math.min(v.vy + 1.6 * k, this.cell * 0.55) : 0;
        v.y += Math.sign(dy) * Math.min(Math.abs(dy), Math.abs(v.vy) * k);
        v.x += dx * Math.min(1, 0.35 * k);
        if (Math.abs(v.ty - v.y) < 0.5) {
          v.y = v.ty;
          v.vy = 0;
        }
        if (Math.abs(v.tx - v.x) < 0.5) v.x = v.tx;
        v.g.position.set(v.x, v.y);
      }
    }
    for (const child of [...this.fxLayer.children]) {
      const fx = child as Container & { life: number; delay: number };
      if (fx.delay > 0) {
        fx.delay -= dt;
        fx.visible = false;
        continue;
      }
      fx.visible = true;
      fx.life += dt;
      const t = fx.life / 520;
      fx.alpha = Math.max(0, 1 - t);
      fx.y -= dt * 0.03;
      if (fx instanceof Graphics) fx.scale.set(1 + t * 0.8);
      if (t >= 1) {
        this.fxLayer.removeChild(fx);
        fx.destroy();
      }
    }
    this.phase += dt * 0.0025;
    if (Math.abs(this.waterTarget - this.waterShown) > 0.005) this.waterShown += (this.waterTarget - this.waterShown) * Math.min(1, 0.08 * k);
    else this.waterShown = this.waterTarget;
    this.drawWater();
    if (this.dirty && !moving) {
      this.dirty = false;
      this.cb.onFrame();
    }
  }

  private drawWater(): void {
    const g = this.waterLayer;
    g.clear();
    if (this.waterShown <= 0) return;
    const top = this.oy + (this.height - this.waterShown) * this.cell;
    const bottom = this.oy + this.height * this.cell;
    const left = this.ox;
    const right = this.ox + this.width * this.cell;
    const pts: number[] = [left, bottom];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const x = left + ((right - left) * i) / steps;
      const y = top + Math.sin(this.phase * 2 + i * 0.55) * this.cell * 0.12 + Math.sin(this.phase * 3.1 + i * 1.3) * this.cell * 0.05;
      pts.push(x, y);
    }
    pts.push(right, bottom);
    g.poly(pts).fill({ color: COLORS.water, alpha: 0.42 });
    g.rect(left, Math.min(bottom, top + this.cell * 0.6), right - left, Math.max(0, bottom - top - this.cell * 0.6)).fill({ color: COLORS.waterDeep, alpha: 0.25 });
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const box = (col: number, row: number, color: number, width: number, alpha = 1): void => {
      g.roundRect(this.ox + col * this.cell + width, this.oy + (this.height - row - 1) * this.cell + width, this.cell - width * 2, this.cell - width * 2, 8).stroke({ width, color, alpha });
    };
    for (const c of this.previewCells) {
      const col = c % this.width;
      const row = Math.floor(c / this.width);
      g.roundRect(this.ox + col * this.cell + 3, this.oy + (this.height - row - 1) * this.cell + 3, this.cell - 6, this.cell - 6, 8).fill({ color: COLORS.preview, alpha: 0.22 });
      box(col, row, COLORS.preview, 2, 0.9);
    }
    if (this.cursor) box(this.cursor.col, this.cursor.row, COLORS.cursor, 3, 0.95);
    if (this.selected) box(this.selected.col, this.selected.row, COLORS.select, 3);
  }

  // ---- input: tap-then-tap, drag-swap, hold-to-preview, hover-to-preview

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive) return;
    const cell = this.cellAt(e.global.x, e.global.y);
    if (!cell) return;
    this.dragStart = { ...cell, x: e.global.x, y: e.global.y };
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
      if (Math.abs(dx) > this.cell * 0.45 && Math.abs(e.global.y - this.dragStart.y) < this.cell * 0.8) {
        const dir = dx > 0 ? 1 : -1;
        const col = dir > 0 ? this.dragStart.col : this.dragStart.col - 1;
        if (col >= 0 && col < this.width - 1) {
          const row = this.dragStart.row;
          this.cancelHold();
          this.dragStart = null;
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
    this.cursor = cell;
    this.drawOverlay();
    if (this.selected) this.cb.onHover(this.selected.col, this.selected.row);
    else this.cb.onHoverEnd();
  }

  private pointerCancel(): void {
    this.cancelHold();
    this.dragStart = null;
    this.hoverEnd();
  }

  private cancelHold(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private hover(cell: { col: number; row: number }): void {
    if (this.selected && this.selected.row === cell.row && Math.abs(this.selected.col - cell.col) === 1) {
      this.cb.onHover(Math.min(this.selected.col, cell.col), cell.row);
    } else {
      this.cb.onHover(Math.min(cell.col, this.width - 2), cell.row);
    }
  }

  private hoverEnd(): void {
    if (this.selected) return;
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
    this.cb.onHover(Math.min(cur.col, this.width - 2), cur.row);
    return true;
  }

}
