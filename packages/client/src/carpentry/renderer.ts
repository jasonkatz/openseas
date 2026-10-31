import { Application, Container, FillGradient, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
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

export interface CarpentryCallbacks {
  /** The player nailed down the plank in `slot` at this orientation and origin. */
  onPlace(slot: number, rot: number, flip: boolean, col: number, row: number): void;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** A hole was patched on screen, with its rating. */
  onPatched(rating: HoleRating, chain: number): void;
  /** A plank was nailed down on screen. */
  onNailed(waste: boolean): void;
  /** A hole widened on screen. */
  onGrew(): void;
  /** The player picked, turned or flipped a plank. */
  onNudge(): void;
}

export interface CarpentryRendererOptions {
  showMarks: boolean;
  ratingLabel(rating: HoleRating): string;
  streakLabel(count: number): string;
  grainLabel: string;
  grewLabel: string;
  turnLabel: string;
  flipLabel: string;
}

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

const COLORS = {
  hullA: 0x6b4423,
  hullB: 0x5e3b1e,
  hullEdge: 0x3a2412,
  holeTop: 0x120c08,
  holeBottom: 0x05030a,
  brass: 0xd4a548,
  brassLight: 0xf5d58a,
  legal: 0x5ed3b8,
  illegal: 0xf0604d,
  waste: 0xf0604d,
  trayBg: 0x1c2b48,
  ink: 0x0b1526,
};
const TRAY_ROWS = 3.2;
const MARK_GLYPH: Record<string, string> = { square: "■", diamond: "◆", triangle: "▲", hexagon: "⬢", circle: "●", star: "★" };

export class CarpentryRenderer {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly hull = new Graphics();
  private readonly holesG = new Graphics();
  private readonly planksG = new Graphics();
  private readonly ghostG = new Graphics();
  private readonly fxG = new Graphics();
  private readonly trayG = new Graphics();
  private readonly dragG = new Graphics();
  private readonly textLayer = new Container();
  private readonly trayText = new Container();
  private readonly colorByKind = new Map<number, number>();
  private readonly markByKind = new Map<number, string>();
  private readonly hullFill = linear([COLORS.hullA, COLORS.hullB]);
  private readonly holeFill = linear([COLORS.holeTop, COLORS.holeBottom]);
  private readonly reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private readonly flashes: Flash[] = [];
  private readonly popups: Popup[] = [];
  private showMarks: boolean;
  private cell = 36;
  private ox = 0;
  private oy = 0;
  private width = 9;
  private height = 12;
  private trayY = 0;
  private trayH = 0;
  private slotRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  private buttonRects: Array<{ x: number; y: number; w: number; h: number; action: "rotate" | "flip" }> = [];
  private state: CarpentryState | null = null;
  private interactive = false;
  private destroyed = false;
  private framePending = false;
  private viewStale = true;
  /** Selection: which tray slot, its orientation, and where the ghost sits. */
  private slot = 0;
  private rot = 0;
  private flip = false;
  private cursor: { col: number; row: number } | null = null;
  private drag: { slot: number; x0: number; y0: number; x: number; y: number; moved: boolean; fromTray: boolean; startedOnSelected: boolean } | null = null;
  private dragging = false;

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
    this.host.appendChild(this.app.canvas);
    this.root.addChild(this.hull, this.holesG, this.planksG, this.fxG, this.ghostG, this.trayG, this.trayText, this.dragG, this.textLayer);
    this.app.stage.addChild(this.root);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e) => this.pointerDown(e));
    this.app.stage.on("pointermove", (e) => this.pointerMove(e));
    this.app.stage.on("pointerup", (e) => this.pointerUp(e));
    this.app.stage.on("pointerupoutside", () => this.pointerCancel());
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((ticker) => this.tick(Math.min(50, ticker.deltaMS)));
    this.layout();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app.renderer) {
      this.app.destroy(true, { children: true });
      this.hullFill.destroy();
      this.holeFill.destroy();
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.drag = null;
      this.dragging = false;
      this.dragG.clear();
    }
    this.drawGhost();
  }

  setShowMarks(on: boolean): void {
    if (this.showMarks === on) return;
    this.showMarks = on;
    this.drawPlanks();
    this.drawTray();
  }

  /** A new engine state. Flashes what the last move did and redraws everything. */
  setState(state: CarpentryState): void {
    if (!this.app.renderer) return;
    const prev = this.state;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    const rep = state.lastMove;
    if (prev && rep && rep.move.type === "place" && rep.placed) {
      const kindColor = this.colorByKind.get(rep.placed.plank.kind) ?? 0xffffff;
      this.flash(rep.placed.plank.cells, mix(kindColor, 0xffffff, 0.6), 260);
      this.cb.onNailed(rep.placed.wasteCells.length > 0);
      if (rep.patched) {
        this.flash(rep.patched.cells, COLORS.brassLight, 600);
        const first = rep.patched.cells[Math.floor(rep.patched.cells.length / 2)]!;
        this.popup(this.cx(first % this.width), this.cy(Math.floor(first / this.width)), `+${rep.patched.points}`, COLORS.brassLight, 0.55);
        this.callout(this.opts.ratingLabel(rep.patched.rating), rep.patched.rating === "masterpiece" ? COLORS.brassLight : rep.patched.rating === "pig" ? COLORS.illegal : 0xefe3c6, 0.3);
        if (rep.patched.chain >= 2) this.callout(this.opts.streakLabel(rep.patched.chain), COLORS.brassLight, 0.42);
        if (rep.patched.grainBonus) this.callout(this.opts.grainLabel, COLORS.legal, rep.patched.chain >= 2 ? 0.52 : 0.42);
        this.cb.onPatched(rep.patched.rating, rep.patched.chain);
      }
      if (rep.grown) {
        this.flash([rep.grown.cell], COLORS.illegal, 700);
        this.callout(this.opts.grewLabel, COLORS.illegal, 0.62);
        this.cb.onGrew();
      }
      // The slot refilled under the player; keep the selection on it but drop the ghost if it no longer fits.
      if (rep.move.slot === this.slot) this.clampCursor();
    } else {
      this.cursor = null;
    }
    if (this.slot >= state.slots.length) this.slot = 0;
    this.drawHoles();
    this.drawPlanks();
    this.drawTray();
    this.drawGhost();
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
    this.trayY = this.oy + this.cell * this.height + this.cell * 0.25;
    this.trayH = this.cell * (TRAY_ROWS - 0.25);
    const W = this.cell * this.width;
    const slotW = W * 0.25;
    const gap = W * 0.02;
    this.slotRects = [0, 1, 2].map((i) => ({ x: this.ox + i * (slotW + gap), y: this.trayY, w: slotW, h: this.trayH }));
    const bx = this.ox + 3 * (slotW + gap);
    const bw = W - 3 * (slotW + gap);
    const bh = (this.trayH - gap) / 2;
    this.buttonRects = [
      { x: bx, y: this.trayY, w: bw, h: bh, action: "rotate" },
      { x: bx, y: this.trayY + bh + gap, w: bw, h: bh, action: "flip" },
    ];
    this.drawHull();
    this.drawHoles();
    this.drawPlanks();
    this.drawTray();
    this.drawGhost();
  }

  private drawHull(): void {
    const g = this.hull;
    const s = this.cell;
    const W = this.width * s;
    const H = this.height * s;
    g.clear();
    g.roundRect(this.ox - 6, this.oy - 6, W + 12, H + 12, 10).fill({ color: 0x000000, alpha: 0.45 });
    g.rect(this.ox, this.oy, W, H).fill(this.hullFill);
    // Planking: staggered boards two cells long, with nail heads.
    for (let r = 0; r < this.height; r++) {
      const y = this.oy + r * s;
      const shade = r % 2 === 0 ? 0.06 : 0.0;
      g.rect(this.ox, y, W, s).fill({ color: 0x000000, alpha: shade });
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

  private drawHoles(): void {
    const g = this.holesG;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    const holeOf = carpentryHoleIndex(this.state);
    for (const c of holeOf.keys()) {
      const x = this.ox + (c % this.width) * s;
      const y = this.oy + Math.floor(c / this.width) * s;
      g.rect(x, y, s, s).fill(this.holeFill);
      // Splintered rim: a lighter chip on edges that face hull.
      const col = c % this.width;
      const row = Math.floor(c / this.width);
      const edge = (cc: number, rr: number): boolean => cc < 0 || cc >= this.width || rr < 0 || rr >= this.height || !holeOf.has(rr * this.width + cc);
      if (edge(col, row - 1)) g.rect(x, y, s, 2).fill({ color: 0xc98a4b, alpha: 0.35 });
      if (edge(col - 1, row)) g.rect(x, y, 2, s).fill({ color: 0xc98a4b, alpha: 0.25 });
    }
  }

  private drawPlanks(): void {
    const g = this.planksG;
    g.clear();
    if (!this.state) return;
    const s = this.cell;
    const holeOf = carpentryHoleIndex(this.state);
    for (const p of this.state.planks) {
      const color = this.colorByKind.get(p.kind) ?? 0xc98a4b;
      const set = new Set(p.cells);
      for (const c of p.cells) {
        const x = this.ox + (c % this.width) * s;
        const y = this.oy + Math.floor(c / this.width) * s;
        this.paintPlankCell(g, x, y, s, color, p.grain);
        const col = c % this.width;
        const row = Math.floor(c / this.width);
        const own = (cc: number, rr: number): boolean => set.has(rr * this.width + cc);
        g.setStrokeStyle({ width: 2, color: mix(color, 0x000000, 0.55), alpha: 0.9 });
        if (!own(col, row - 1)) g.moveTo(x, y + 1).lineTo(x + s, y + 1).stroke();
        if (!own(col, row + 1)) g.moveTo(x, y + s - 1).lineTo(x + s, y + s - 1).stroke();
        if (!own(col - 1, row)) g.moveTo(x + 1, y).lineTo(x + 1, y + s).stroke();
        if (!own(col + 1, row)) g.moveTo(x + s - 1, y).lineTo(x + s - 1, y + s).stroke();
      }
      if (this.showMarks) {
        const c0 = p.cells[Math.floor(p.cells.length / 2)]!;
        const t = new Text({ text: MARK_GLYPH[this.markByKind.get(p.kind) ?? "square"] ?? "■", style: { fontSize: s * 0.4, fill: 0xffffff } });
        t.alpha = 0.7;
        t.anchor.set(0.5);
        t.position.set(this.cx(c0 % this.width), this.cy(Math.floor(c0 / this.width)));
        this.markTexts.push(t);
        this.textLayer.addChild(t);
      }
    }
    for (const t of this.markTexts.splice(0, this.showMarks ? 0 : this.markTexts.length)) t.destroy();
    // Waste: hull covered by a plank, or hole cells covered twice.
    for (let c = 0; c < this.state.covered.length; c++) {
      const n = this.state.covered[c]!;
      if (n === 0) continue;
      if (holeOf.has(c) ? n > 1 : n > 0) {
        g.rect(this.ox + (c % this.width) * s + 2, this.oy + Math.floor(c / this.width) * s + 2, s - 4, s - 4).fill({ color: COLORS.waste, alpha: 0.38 });
      }
    }
  }
  private markTexts: Text[] = [];

  private paintPlankCell(g: Graphics, x: number, y: number, s: number, color: number, grain: Grain): void {
    g.rect(x, y, s, s).fill(color);
    g.setStrokeStyle({ width: 1, color: mix(color, 0x000000, 0.35), alpha: 0.7 });
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const k = (i / (n + 1)) * s;
      if (grain === "h") g.moveTo(x + 2, y + k).lineTo(x + s - 2, y + k + (i % 2 ? 1 : -1)).stroke();
      else g.moveTo(x + k, y + 2).lineTo(x + k + (i % 2 ? 1 : -1), y + s - 2).stroke();
    }
    g.rect(x, y, s, s * 0.18).fill({ color: 0xffffff, alpha: 0.12 });
  }

  /** The ghost: the selected plank at the cursor, green when it fits, red when it does not. */
  private drawGhost(): void {
    const g = this.ghostG;
    g.clear();
    if (!this.state || !this.interactive || this.state.finished) return;
    if (this.dragging || !this.cursor) return;
    const check = this.check(this.cursor.col, this.cursor.row);
    this.paintGhost(g, check, this.cursor.col, this.cursor.row);
  }

  private paintGhost(g: Graphics, check: CarpentryPlacementCheck | null, col: number, row: number): void {
    const s = this.cell;
    const piece = this.state!.slots[this.slot];
    if (!piece) return;
    const cells = carpentryOrient(piece.shape, this.rot, this.flip);
    const legal = check?.legal ?? false;
    const color = legal ? COLORS.legal : COLORS.illegal;
    const kindColor = this.colorByKind.get(piece.kind) ?? 0xc98a4b;
    for (const [dx, dy] of cells) {
      const cc = col + dx;
      const rr = row + dy;
      if (cc < 0 || cc >= this.width || rr < 0 || rr >= this.height) continue;
      const x = this.ox + cc * s;
      const y = this.oy + rr * s;
      g.rect(x + 2, y + 2, s - 4, s - 4).fill({ color: kindColor, alpha: legal ? 0.55 : 0.3 });
      g.rect(x + 2, y + 2, s - 4, s - 4).stroke({ width: 2, color, alpha: 0.95 });
    }
    if (check) for (const c of check.wasteCells) {
      g.rect(this.ox + (c % this.width) * s + 5, this.oy + Math.floor(c / this.width) * s + 5, s - 10, s - 10).stroke({ width: 2, color: COLORS.waste, alpha: 0.9 });
    }
  }

  private drawTray(): void {
    const g = this.trayG;
    g.clear();
    this.trayText.removeChildren().forEach((c) => c.destroy());
    if (!this.state) return;
    this.state.slots.forEach((piece, i) => {
      const r = this.slotRects[i]!;
      const selected = i === this.slot;
      g.roundRect(r.x, r.y, r.w, r.h, 6).fill({ color: COLORS.trayBg, alpha: selected ? 0.95 : 0.6 });
      if (selected) g.roundRect(r.x, r.y, r.w, r.h, 6).stroke({ width: 2, color: COLORS.brass, alpha: 0.95 });
      if (this.dragging && this.drag?.slot === i) return;
      const rot = selected ? this.rot : 0;
      const flip = selected ? this.flip : false;
      this.paintMini(g, piece.shape, piece.kind, carpentryEffectiveGrain(piece.grain, rot), rot, flip, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 6);
      const label = new Text({ text: String(i + 1), style: { fontFamily: "Atkinson Hyperlegible, sans-serif", fontSize: Math.max(9, this.cell * 0.32), fill: selected ? COLORS.brassLight : 0xc9bb9a } });
      label.position.set(r.x + 5, r.y + 3);
      this.trayText.addChild(label);
    });
    for (const b of this.buttonRects) {
      g.roundRect(b.x, b.y, b.w, b.h, 6).fill({ color: 0x2a1b10 });
      g.roundRect(b.x, b.y, b.w, b.h, 6).stroke({ width: 1.5, color: COLORS.brass, alpha: 0.8 });
      const t = new Text({
        text: b.action === "rotate" ? `⟳ ${this.opts.turnLabel}` : `⇄ ${this.opts.flipLabel}`,
        style: { fontFamily: "Atkinson Hyperlegible, sans-serif", fontSize: Math.max(10, Math.min(this.cell * 0.38, b.w / 5)), fill: COLORS.brassLight, fontWeight: "700" },
      });
      t.anchor.set(0.5);
      t.position.set(b.x + b.w / 2, b.y + b.h / 2);
      this.trayText.addChild(t);
    }
  }

  private paintMini(g: Graphics, shape: number, kind: number, grain: Grain, rot: number, flip: boolean, cx: number, cy: number, m: number): void {
    const cells = carpentryOrient(shape, rot, flip);
    const { w, h } = carpentryExtent(cells);
    const x0 = cx - (w * m) / 2;
    const y0 = cy - (h * m) / 2;
    const color = this.colorByKind.get(kind) ?? 0xc98a4b;
    for (const [dx, dy] of cells) this.paintPlankCell(g, x0 + dx * m, y0 + dy * m, m, color, grain);
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    g.setStrokeStyle({ width: 1.5, color: mix(color, 0x000000, 0.55) });
    for (const [dx, dy] of cells) {
      const x = x0 + dx * m;
      const y = y0 + dy * m;
      if (!set.has(`${dx},${dy - 1}`)) g.moveTo(x, y).lineTo(x + m, y).stroke();
      if (!set.has(`${dx},${dy + 1}`)) g.moveTo(x, y + m).lineTo(x + m, y + m).stroke();
      if (!set.has(`${dx - 1},${dy}`)) g.moveTo(x, y).lineTo(x, y + m).stroke();
      if (!set.has(`${dx + 1},${dy}`)) g.moveTo(x + m, y).lineTo(x + m, y + m).stroke();
    }
  }

  private cx(col: number): number {
    return this.ox + (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return this.oy + (row + 0.5) * this.cell;
  }

  private flash(cells: readonly number[], color: number, max: number): void {
    this.flashes.push({ cells, color, life: 0, max: this.reduced ? Math.min(max, 120) : max });
  }

  private popup(x: number, y: number, text: string, color: number, size: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(12, this.cell * size), fontWeight: "700", fill: color, stroke: { color: 0x000000, width: 3 } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 800, y0: y });
  }

  private callout(text: string, color: number, yFrac: number): void {
    const t = new Text({
      text,
      style: { fontFamily: "Fraunces, Georgia, serif", fontSize: Math.max(14, this.cell * 0.7), fontWeight: "900", fill: color, stroke: { color: 0x000000, width: 4 }, letterSpacing: 1 },
    });
    t.anchor.set(0.5);
    t.position.set(this.ox + (this.width * this.cell) / 2, this.oy + this.height * this.cell * yFrac);
    this.textLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 1100, y0: t.y });
  }

  // ---- per frame

  private tick(dt: number): void {
    const g = this.fxG;
    g.clear();
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life += dt;
      const k = f.life / f.max;
      if (k >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      for (const c of f.cells) g.rect(this.ox + (c % this.width) * this.cell, this.oy + Math.floor(c / this.width) * this.cell, this.cell, this.cell).fill({ color: f.color, alpha: (1 - k) * 0.7 });
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
    if (this.framePending) {
      this.framePending = false;
      this.cb.onFrame();
    }
    if (this.viewStale) this.publishView();
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
    this.app.canvas.setAttribute("data-cursor", this.cursor ? `${this.cursor.col},${this.cursor.row}` : "");
    this.app.canvas.setAttribute("data-geometry", `${this.ox},${this.oy},${this.cell}`);
  }

  // ---- selection and placement

  private check(col: number, row: number): CarpentryPlacementCheck | null {
    if (!this.state) return null;
    return carpentryCheckPlacement(this.state, this.slot, this.rot, this.flip, col, row);
  }

  private select(slot: number): void {
    if (!this.state || slot < 0 || slot >= this.state.slots.length) return;
    if (this.slot !== slot) {
      this.slot = slot;
      this.cb.onNudge();
    }
    this.clampCursor();
    this.drawTray();
    this.drawGhost();
    this.viewStale = true;
  }

  private rotate(): void {
    if (!this.state) return;
    this.rot = (this.rot + 1) % 4;
    this.cb.onNudge();
    this.clampCursor();
    this.drawTray();
    this.drawGhost();
  }

  private doFlip(): void {
    if (!this.state) return;
    this.flip = !this.flip;
    this.cb.onNudge();
    this.clampCursor();
    this.drawTray();
    this.drawGhost();
  }

  /** Keep the ghost on the board after a turn or flip changed its footprint. */
  private clampCursor(): void {
    if (!this.cursor || !this.state) return;
    const piece = this.state.slots[this.slot];
    if (!piece) return;
    const { w, h } = carpentryExtent(carpentryOrient(piece.shape, this.rot, this.flip));
    this.cursor = { col: Math.max(0, Math.min(this.width - w, this.cursor.col)), row: Math.max(0, Math.min(this.height - h, this.cursor.row)) };
  }

  private moveCursor(dc: number, dr: number): void {
    if (!this.state) return;
    const piece = this.state.slots[this.slot];
    if (!piece) return;
    const { w, h } = carpentryExtent(carpentryOrient(piece.shape, this.rot, this.flip));
    const c = this.cursor ?? { col: Math.floor((this.width - w) / 2), row: Math.floor((this.height - h) / 2) };
    this.cursor = { col: Math.max(0, Math.min(this.width - w, c.col + dc)), row: Math.max(0, Math.min(this.height - h, c.row + dr)) };
    this.drawGhost();
    this.viewStale = true;
  }

  /** Jump the ghost to the first spot, scanning from the cursor in reading order, where the plank fits. */
  private jumpToFit(): void {
    if (!this.state) return;
    const start = this.cursor ? this.cursor.row * this.width + this.cursor.col + 1 : 0;
    const total = this.width * this.height;
    const holeOf = carpentryHoleIndex(this.state);
    for (let k = 0; k < total; k++) {
      const i = (start + k) % total;
      const col = i % this.width;
      const row = Math.floor(i / this.width);
      if (carpentryCheckPlacement(this.state, this.slot, this.rot, this.flip, col, row, holeOf).legal) {
        this.cursor = { col, row };
        this.cb.onNudge();
        this.drawGhost();
        this.viewStale = true;
        return;
      }
    }
  }

  private placeAt(col: number, row: number): boolean {
    const check = this.check(col, row);
    if (!check?.legal) {
      this.cursor = { col, row };
      this.clampCursor();
      this.drawGhost();
      this.viewStale = true;
      return false;
    }
    this.cursor = { col, row };
    this.cb.onPlace(this.slot, this.rot, this.flip, col, row);
    return true;
  }

  // ---- input

  private boardCell(x: number, y: number): { col: number; row: number } | null {
    const col = Math.floor((x - this.ox) / this.cell);
    const row = Math.floor((y - this.oy) / this.cell);
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) return null;
    return { col, row };
  }

  private slotAt(x: number, y: number): number | null {
    const i = this.slotRects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return i >= 0 ? i : null;
  }

  /** Origin for a dragged plank: centered under the pointer, lifted a cell so the finger does not hide it. */
  private dragOrigin(x: number, y: number): { col: number; row: number } {
    const piece = this.state!.slots[this.slot]!;
    const { w, h } = carpentryExtent(carpentryOrient(piece.shape, this.rot, this.flip));
    const col = Math.round((x - this.ox) / this.cell - w / 2);
    const row = Math.round((y - this.oy) / this.cell - h / 2 - (this.drag?.fromTray ? 0.9 : 0));
    return { col, row };
  }

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive || !this.state) return;
    const { x, y } = e.global;
    const button = this.buttonRects.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (button) {
      if (button.action === "rotate") this.rotate();
      else this.doFlip();
      return;
    }
    const slot = this.slotAt(x, y);
    if (slot !== null) {
      const startedOnSelected = slot === this.slot;
      this.select(slot);
      this.drag = { slot, x0: x, y0: y, x, y, moved: false, fromTray: true, startedOnSelected };
      return;
    }
    const cell = this.boardCell(x, y);
    if (cell) this.drag = { slot: this.slot, x0: x, y0: y, x, y, moved: false, fromTray: false, startedOnSelected: false };
  }

  private pointerMove(e: FederatedPointerEvent): void {
    const d = this.drag;
    if (!d || !this.state) return;
    const { x, y } = e.global;
    d.x = x;
    d.y = y;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > this.cell * 0.35) {
      d.moved = true;
      if (d.fromTray) {
        this.dragging = true;
        this.drawTray();
        this.ghostG.clear();
      }
    }
    if (!this.dragging) return;
    const g = this.dragG;
    g.clear();
    const o = this.dragOrigin(x, y);
    const check = this.check(o.col, o.row);
    const cells = check?.cells.length ? null : null;
    void cells;
    this.paintGhost(g, check, o.col, o.row);
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.state || !this.interactive) return;
    const { x, y } = e.global;
    if (this.dragging) {
      this.dragging = false;
      this.dragG.clear();
      const o = this.dragOrigin(x, y);
      if (this.boardCell(x, y) || this.check(o.col, o.row)?.legal) this.placeAt(o.col, o.row);
      this.drawTray();
      this.drawGhost();
      return;
    }
    if (d.fromTray) {
      if (d.startedOnSelected && !d.moved) this.rotate();
      return;
    }
    if (d.moved) return;
    const cell = this.boardCell(x, y);
    if (!cell) return;
    // Tap once to put the plank there, tap the same cell again to nail it down.
    if (this.cursor && this.cursor.col === cell.col && this.cursor.row === cell.row) this.placeAt(cell.col, cell.row);
    else {
      this.cursor = cell;
      this.clampCursor();
      this.cb.onNudge();
      this.drawGhost();
      this.viewStale = true;
    }
  }

  private pointerCancel(): void {
    this.drag = null;
    if (this.dragging) {
      this.dragging = false;
      this.dragG.clear();
      this.drawTray();
      this.drawGhost();
    }
  }

  /** Keyboard: 1-3 pick a plank, arrows move it, R turns, F flips, H finds a fit, Enter or Space nails it. */
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
        this.rotate();
        return true;
      case "f":
      case "F":
        this.doFlip();
        return true;
      case "h":
      case "H":
        this.jumpToFit();
        return true;
      case " ":
      case "Enter":
        if (this.cursor) this.placeAt(this.cursor.col, this.cursor.row);
        else this.moveCursor(0, 0);
        return true;
      default:
        return false;
    }
  }
}

function linear(stops: number[]): FillGradient {
  const g = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: "local" });
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  return g;
}
