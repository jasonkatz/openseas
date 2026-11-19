import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  cuttingBestCut,
  cuttingCutPreview,
  cuttingPieceAt,
  cuttingViewString,
  type CuttingMoveReport,
  type CuttingOrder,
  type CuttingPiece,
  type CuttingPreview,
  type CuttingRect,
  type CuttingSlabReport,
  type CuttingState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { FONT, FONT_MONO, INK } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { MOTION, RADIUS } from "../look/tokens.js";
import { cuttingOre } from "./pieces.js";

export interface CuttingCallbacks {
  /** The player made a cut the engine would take. */
  onCut(piece: number, vertical: boolean, at: number): void;
  /** The player gave the slab up for the next one. */
  onDone(): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface CuttingLabels {
  /** The cuts left on this slab. */
  cuts(left: number): string;
  /** What has been banked from the slab against the best it could give. */
  banked(got: number, best: number): string;
  /** The chip that gives the slab up. */
  next: string;
  flawless(bonus: number): string;
  clean(bonus: number): string;
  rough: string;
  streak(count: number): string;
  /** Under the slab, beside the plate drawn to scale: what a piece of the order's size pays more. */
  order(bonus: number): string;
  /** Called out when a banked piece fills the order. */
  orderFilled(bonus: number): string;
}

export interface CuttingRendererOptions {
  /** Pulse a cut from a best plan after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: CuttingLabels;
}

/** A cut lined up but not made: the piece, the direction and the grid line. */
interface Aim {
  piece: number;
  vertical: boolean;
  at: number;
}

interface PieceView {
  root: Container;
  rect: CuttingRect;
  /** The ore in each cell of the rectangle, row by row: what this view was drawn from. */
  ores: number[];
  /** Where the view rests, in canvas pixels (its centre). */
  x: number;
  y: number;
}

interface Strip {
  cutsLeft: number;
  cutsAllowed: number;
  got: number;
  best: number;
}

const HINT_AFTER_MS = 7000;
/** A banked piece this big gets a bigger number. */
const BIG_PIECE = 9;
/** The row under the slab that shows the order, in cells. */
const ORDER_ROW = 0.8;

/**
 * Draws the slab and turns a swipe along a grid line into a cut. Scores nothing: every number it
 * shows is the engine's. Restyled to the brand book (docs/BRAND.md): ores drawn in code
 * (`pieces.ts`), bare ground with one hairline, amber for the cut being lined up and the beat.
 */
export class CuttingRenderer extends KitBoard<CuttingState> {
  private readonly grid = new Grid(6, 6);
  private readonly bg = new Graphics();
  private readonly stripLayer = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly hintLayer = new Graphics();
  private readonly lineLayer = new Graphics();
  private readonly orderLayer = new Graphics();
  private orderText: Text | null = null;
  /** True while the slab's layout holds the order's row: a lab that turns orders on or off lays out afresh. */
  private orderRow = false;
  private cutsText: Text | null = null;
  private yieldText: Text | null = null;
  private nextText: Text | null = null;
  private readonly gainTexts: Text[] = [];
  private readonly views = new Map<number, PieceView>();
  /** Pieces on their way off the table: banked ones and scrap, shrinking away. */
  private readonly leaving = new Set<Container>();
  /**
   * The slab the views were drawn from: the engine keeps one `ores` array for as long as a slab is on
   * the table, so the array itself says which slab this is. A state on any other slab is drawn afresh.
   */
  private shownOres: readonly number[] | null = null;
  private strip: Strip = { cutsLeft: 0, cutsAllowed: 0, got: 0, best: 0 };
  private chip = { x: 0, y: 0, w: 0, h: 0 };
  private aim: Aim | null = null;
  /** True when the aim stays without a finger down: set by a tap or a key, and made by the same again. */
  private armed = false;
  private preview: CuttingPreview | null = null;
  private drag: { piece: number; x: number; y: number; moved: boolean; vertical: boolean | null } | null = null;
  private idle = 0;
  private hint: Aim | null = null;
  private hintFor: CuttingState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: CuttingCallbacks,
    private readonly opts: CuttingRendererOptions,
  ) {
    super(host, "cutting", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    const text = (fontFamily: string, weight: "400" | "700", fill: number): Text => {
      const t = new Text({ text: "", style: { fontFamily, fontSize: 14, fontWeight: weight, fill }, resolution: 2 });
      t.anchor.set(0.5);
      return t;
    };
    this.cutsText = text(FONT, "400", INK.dim);
    this.yieldText = text(FONT_MONO, "700", INK.cream);
    this.nextText = text(FONT, "400", INK.cream);
    this.orderText = text(FONT_MONO, "700", INK.dim);
    for (let i = 0; i < 2; i++) {
      const t = text(FONT_MONO, "700", INK.cream);
            t.visible = false;
      this.gainTexts.push(t);
    }
    this.world.addChild(this.bg, this.stripLayer, this.orderLayer, this.pieceLayer, this.hintLayer, this.lineLayer, this.cutsText, this.yieldText, this.nextText, this.orderText, ...this.gainTexts);
  }

  /** The gap left round every piece, so a cut shows as a seam. */
  private get seam(): number {
    return Math.max(2, this.grid.cell * 0.07);
  }

  private get stripHeight(): number {
    return this.grid.cell * 1.05;
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    // With orders on, a row under the slab shows the slab's order.
    this.orderRow = this.state?.order != null;
    const below = this.orderRow ? ORDER_ROW : 0;
    g.fit(width, height, { top: 1.05, bottom: below, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = this.stripHeight;
    this.bg.clear();
    // Bare ground with one hairline round the strip, the slab and the order's row. The slab's grid is the gaps between its cells.
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + below * g.cell + pad * 2);
    const font = Math.max(12, Math.round(g.cell * 0.26));
    for (const t of [this.cutsText, this.yieldText, this.nextText, this.orderText]) if (t) t.style.fontSize = font;
    for (const t of this.gainTexts) t.style.fontSize = Math.max(14, Math.round(g.cell * 0.46));
    this.publishGeom(g.ox, g.oy, g.cell);
    this.clearAim();
    this.drag = null;
    this.forgetViews();
    if (this.state) this.snap(this.state);
    else this.drawStrip();
  }

  // ---- the strip over the slab: cuts left, banked against best, the chip that takes the next slab

  private showStrip(s: Strip): void {
    this.strip = s;
    this.drawStrip();
  }

  private drawStrip(): void {
    const g = this.grid;
    const l = this.stripLayer;
    const s = this.strip;
    const top = g.oy - this.stripHeight;
    const rowY = top + this.stripHeight * 0.36;
    l.clear();
    // Cuts: a dot for each one the slab came with, cream while it is still to be made.
    const r = Math.max(3, g.cell * 0.1);
    const gap = r * 2.7;
    const lampsX = g.ox + r + 2;
    for (let i = 0; i < s.cutsAllowed; i++) l.circle(lampsX + i * gap, rowY, r).fill({ color: i < s.cutsLeft ? INK.cream : INK.line });
    if (this.cutsText) {
      this.cutsText.text = this.opts.labels.cuts(s.cutsLeft);
      this.cutsText.anchor.set(0, 0.5);
      this.cutsText.position.set(g.ox + 1, top + this.stripHeight * 0.74);
    }
    // The chip on the right gives the slab up.
    const chipW = Math.max(54, g.cell * 1.15);
    const chipH = Math.max(22, g.cell * 0.44);
    this.chip = { x: g.ox + g.width - chipW, y: rowY - chipH / 2, w: chipW, h: chipH };
    l.roundRect(this.chip.x, this.chip.y, chipW, chipH, Math.min(RADIUS, chipH / 2)).fill({ color: INK.raised });
    if (this.nextText) {
      this.nextText.text = this.opts.labels.next;
      this.nextText.position.set(this.chip.x + chipW / 2, rowY);
      if (this.nextText.width > chipW - 8) this.nextText.scale.set((chipW - 8) / (this.nextText.width / this.nextText.scale.x));
    }
    // Banked against the best the slab could give: a bar, with a notch where clean begins.
    const barX = g.ox + g.width * 0.36;
    const barW = g.width * 0.64;
    const barY = top + this.stripHeight * 0.74;
    const barH = Math.max(5, g.cell * 0.1);
    const share = s.best > 0 ? Math.min(1, s.got / s.best) : 0;
    l.roundRect(barX, barY - barH / 2, barW, barH, barH / 2).fill({ color: INK.line });
    if (share > 0) l.roundRect(barX, barY - barH / 2, Math.max(barH, barW * share), barH, barH / 2).fill({ color: INK.cream });
    const clean = (this.state?.config.cleanPercent ?? 80) / 100;
    l.rect(barX + barW * clean - 1, barY - barH, 2, barH * 2).fill({ color: INK.dim });
    if (this.yieldText) {
      this.yieldText.text = this.opts.labels.banked(s.got, s.best);
      this.yieldText.anchor.set(0.5, 0.5);
      const mid = (lampsX + Math.max(0, s.cutsAllowed - 1) * gap + r + this.chip.x) / 2;
      this.yieldText.position.set(mid, rowY);
    }
  }

  // ---- the order, under the slab: the plate drawn to scale and what it pays more

  /**
   * The order's row: a plate of the order's size, long side across, in small cells, and what a
   * piece of that size pays more. The plate is dim, and cream while the cut lined up would fill it.
   */
  private drawOrder(): void {
    const l = this.orderLayer;
    l.clear();
    const order: CuttingOrder | null = this.state?.order ?? null;
    if (this.orderText) this.orderText.visible = order !== null && this.orderRow;
    if (!order || !this.orderRow || !this.state) return;
    const g = this.grid;
    const lit = this.preview?.halves.some((h) => h.filled) ?? false;
    const rowH = ORDER_ROW * g.cell;
    const midY = g.oy + g.height + rowH * 0.55;
    const long = Math.max(order.w, order.h);
    const short = Math.min(order.w, order.h);
    const mini = Math.min(g.cell * 0.2, (rowH * 0.62) / short);
    const gap = Math.max(1, mini * 0.12);
    const x0 = g.ox + 2;
    const y0 = midY - (short * mini) / 2;
    for (let i = 0; i < long; i++) {
      for (let j = 0; j < short; j++) l.roundRect(x0 + i * mini + gap / 2, y0 + j * mini + gap / 2, mini - gap, mini - gap, Math.max(1, mini * 0.15)).fill({ color: lit ? INK.cream : INK.dim });
    }
    if (this.orderText) {
      this.orderText.text = this.opts.labels.order(this.state.config.orderBonus);
      this.orderText.anchor.set(0, 0.5);
      this.orderText.style.fill = lit ? INK.cream : INK.dim;
      this.orderText.position.set(x0 + long * mini + mini * 0.8, midY);
    }
  }

  /**
   * A piece that fills the order is marked by its corners: a short stroke along each edge from every
   * corner, just outside it, like the corners of a plate marked out for the torch. Read without colour.
   */
  private corners(l: Graphics, x: number, y: number, w: number, h: number): void {
    const g = this.grid;
    const off = Math.max(2, g.cell * 0.05);
    const len = Math.max(6, Math.min(w, h) * 0.22);
    const width = Math.max(2, g.cell * 0.05);
    const x0 = x - off;
    const y0 = y - off;
    const x1 = x + w + off;
    const y1 = y + h + off;
    l.moveTo(x0, y0 + len).lineTo(x0, y0).lineTo(x0 + len, y0);
    l.moveTo(x1 - len, y0).lineTo(x1, y0).lineTo(x1, y0 + len);
    l.moveTo(x1, y1 - len).lineTo(x1, y1).lineTo(x1 - len, y1);
    l.moveTo(x0 + len, y1).lineTo(x0, y1).lineTo(x0, y1 - len);
    l.stroke({ width, color: INK.cream, cap: "round", join: "round" });
  }

  // ---- pieces

  /** One cell of an ore: a square in the ore's colour that fills its cell, with the ore's cut-out. */
  private tile(ore: number): Texture {
    const o = cuttingOre(ore);
    return this.piece(`ore:${o.id}`, this.grid.cell, o.color, o.paint, 1);
  }

  private makeView(piece: CuttingPiece, ores: readonly number[], slabWidth: number): PieceView {
    const g = this.grid;
    const w = piece.w * g.cell;
    const h = piece.h * g.cell;
    const seam = this.seam;
    const root = new Container();
    const inner = new Container();
    const own: number[] = [];
    for (let j = 0; j < piece.h; j++) {
      for (let i = 0; i < piece.w; i++) {
        const ore = ores[(piece.y + j) * slabWidth + piece.x + i]!;
        own.push(ore);
        const s = new Sprite(this.tile(ore));
        s.anchor.set(0.5);
        s.position.set((i + 0.5) * g.cell, (j + 0.5) * g.cell);
        inner.addChild(s);
      }
    }
    // The piece is drawn a seam smaller all round, so its neighbours never touch it.
    inner.position.set(seam, seam);
    inner.scale.set((w - seam * 2) / w, (h - seam * 2) / h);
    root.addChild(inner);
    root.pivot.set(w / 2, h / 2);
    const x = g.ox + piece.x * g.cell + w / 2;
    const y = g.oy + piece.y * g.cell + h / 2;
    root.position.set(x, y);
    this.pieceLayer.addChild(root);
    return { root, rect: { x: piece.x, y: piece.y, w: piece.w, h: piece.h }, ores: own, x, y };
  }

  private forgetViews(): void {
    for (const v of this.views.values()) v.root.destroy({ children: true });
    this.views.clear();
    for (const c of this.leaving) c.destroy({ children: true });
    this.leaving.clear();
    this.shownOres = null;
  }

  /** Put exactly the state's pieces on the table, each where it rests, with nothing in motion. */
  private snap(state: CuttingState): void {
    for (const c of this.leaving) c.destroy({ children: true });
    this.leaving.clear();
    const keep = new Set<number>();
    for (const p of state.pieces) {
      keep.add(p.id);
      let v = this.views.get(p.id);
      const same = v !== undefined && this.shownOres === state.ores && v.rect.x === p.x && v.rect.y === p.y && v.rect.w === p.w && v.rect.h === p.h;
      if (!same) {
        v?.root.destroy({ children: true });
        v = this.makeView(p, state.ores, state.config.width);
        this.views.set(p.id, v);
      }
      v!.root.position.set(v!.x, v!.y);
      v!.root.scale.set(1);
      v!.root.alpha = 1;
    }
    for (const [id, v] of this.views) {
      if (keep.has(id)) continue;
      v.root.destroy({ children: true });
      this.views.delete(id);
    }
    this.shownOres = state.ores;
    this.showStrip({ cutsLeft: state.cutsLeft, cutsAllowed: state.cutsAllowed, got: state.slabGot, best: state.slabBest });
    this.drawOrder();
    this.touchView();
  }

  protected onState(state: CuttingState, prev: CuttingState | null): void {
    this.clearAim();
    this.drag = null;
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height || this.orderRow !== (state.order !== null)) {
      // A different slab size, or orders turned on or off (a lab config): lay it out afresh.
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    const r = state.lastMove;
    const follows =
      prev !== null &&
      r !== null &&
      state.logLength === prev.logLength + 1 &&
      this.shownOres === prev.ores &&
      this.views.size === prev.pieces.length &&
      prev.pieces.every((p) => this.views.has(p.id)) &&
      (r.cut === null || this.views.has(r.cut.piece.id));
    if (!prev || !r || !follows) {
      this.snap(state);
      return;
    }
    let t = 0;
    if (r.cut) t = this.playCut(prev, r);
    if (r.slab) t = this.playSlabEnd(prev, r.slab, state, t);
    // Whatever the tweens did, the table ends as the engine holds it.
    this.tweens.after(t, () => this.snap(state));
  }

  /** The cut itself: the torch's line, the two sides easing apart, and each pure side banked: its points, then it shrinks away. Returns when it is over, in ms. */
  private playCut(prev: CuttingState, r: CuttingMoveReport): number {
    const c = r.cut!;
    const g = this.grid;
    const old = this.views.get(c.piece.id)!;
    this.views.delete(c.piece.id);
    old.root.destroy({ children: true });
    const px = (x: number): number => g.ox + x * g.cell;
    const py = (y: number): number => g.oy + y * g.cell;
    const line = c.vertical ? [px(c.at), py(c.piece.y), px(c.at), py(c.piece.y + c.piece.h)] : [px(c.piece.x), py(c.at), px(c.piece.x + c.piece.w), py(c.at)];
    sfx.zap();
    this.fx.beam(line, INK.amber, Math.max(3, g.cell * 0.07), 320);
    this.showStrip({ ...this.strip, cutsLeft: prev.cutsLeft - 1 });

    const apart = this.seam;
    let end: number = MOTION.move;
    let banked = 0;
    c.halves.forEach((half, i) => {
      const v = this.makeView(half.piece, prev.ores, prev.config.width);
      // Each side starts up against the line and eases back to where it rests.
      const toward = i === 0 ? 1 : -1;
      if (c.vertical) v.root.x = v.x + toward * apart;
      else v.root.y = v.y + toward * apart;
      this.tweens.move(v.root, { x: v.x, y: v.y });
      if (half.ore === null) {
        this.views.set(half.piece.id, v);
        return;
      }
      // A pure side: it pays, and shrinks away. One that fills the order keeps its corners marked as it goes.
      this.leaving.add(v.root);
      const area = half.piece.w * half.piece.h;
      const delay = MOTION.move + 60 + banked * 110;
      const nth = prev.banked.length + banked;
      banked++;
      if (half.filled) {
        const mark = new Graphics();
        this.corners(mark, 0, 0, half.piece.w * g.cell, half.piece.h * g.cell);
        v.root.addChild(mark);
      }
      this.tweens.after(delay, () => {
        if (half.filled) {
          // The order filled: called out, on the rising cue.
          sfx.rise();
          this.fx.say(this.opts.labels.orderFilled(prev.config.orderBonus));
        } else sfx.clear(Math.min(7, nth + 1), area);
        this.fx.popup(v.x, v.y, `+${half.points}`, INK.cream, Math.max(16, g.cell * (area >= BIG_PIECE ? 0.62 : 0.42)));
        this.showStrip({ ...this.strip, got: this.strip.got + half.points });
      });
      this.tweens.remove(v.root, {
        delay,
        done: () => {
          this.leaving.delete(v.root);
          v.root.destroy({ children: true });
        },
      });
      end = Math.max(end, delay + MOTION.clear);
    });
    return end;
  }

  /** The slab's end: scrap dims and shrinks away, the grade is called, and the next slab comes in. Returns when it is over, in ms. */
  private playSlabEnd(prev: CuttingState, slab: CuttingSlabReport, state: CuttingState, start: number): number {
    const g = this.grid;
    let t = start;
    this.tweens.after(t, () => {
      if (slab.scrap.length > 0) sfx.crack(false);
      for (const p of slab.scrap) {
        const v = this.views.get(p.id);
        if (!v) continue;
        this.views.delete(p.id);
        this.leaving.add(v.root);
        v.root.alpha = 0.4;
        this.tweens.remove(v.root, {
          done: () => {
            this.leaving.delete(v.root);
            v.root.destroy({ children: true });
          },
        });
      }
    });
    this.tweens.after(t + 140, () => {
      const labels = this.opts.labels;
      if (slab.grade === "flawless") {
        // The beat is kept for this: all of a slab's best, a little stronger with each slab of the streak.
        this.fx.say(labels.flawless(slab.bonus));
        this.beat(Math.min(1, 0.4 + (slab.streak - 1) * 0.15));
      } else if (slab.grade === "clean") {
        this.fx.say(labels.clean(slab.bonus));
        sfx.good();
      } else {
        // Rough pays nothing; one that breaks a streak is said in danger.
        this.fx.say(labels.rough, prev.combo >= 2 ? INK.danger : INK.dim);
        if (prev.combo >= 2) sfx.streakLost();
        else sfx.thud();
      }
      if (slab.streak >= 2) this.fx.popup(g.ox + g.width / 2, g.oy + g.height * 0.52, labels.streak(slab.streak), INK.cream, Math.max(14, g.cell * 0.34));
    });
    t += 760;
    this.tweens.after(t, () => {
      // The next slab comes in from just above where it rests.
      this.snap(state);
      sfx.whoosh();
      for (const v of this.views.values()) {
        v.root.alpha = 0;
        v.root.y = v.y - g.cell * 0.25;
        this.tweens.move(v.root, { y: v.y, alpha: 1 });
      }
    });
    return t + MOTION.move + 10;
  }

  protected view(): string {
    const g = this.grid;
    const ores = new Array<number>(g.cols * g.rows).fill(0);
    const rects: CuttingRect[] = [];
    for (const v of this.views.values()) {
      rects.push(v.rect);
      for (let j = 0; j < v.rect.h; j++) for (let i = 0; i < v.rect.w; i++) ores[(v.rect.y + j) * g.cols + v.rect.x + i] = v.ores[j * v.rect.w + i]!;
    }
    return cuttingViewString(ores, g.cols, rects);
  }

  protected override update(dt: number): void {
    if (this.aim) this.drawAim();
    // A cut from a best plan pulses after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.aim || this.drag || this.busy) {
      this.idle = 0;
      if (this.hint) {
        this.hint = null;
        this.hintLayer.clear();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== this.state || !this.hint) {
      this.hintFor = this.state;
      this.hint = cuttingBestCut(this.state);
    }
    this.hintLayer.clear();
    if (!this.hint) return;
    const p = cuttingCutPreview(this.state, this.hint.piece, this.hint.vertical, this.hint.at);
    if (!p) return;
    const g = this.grid;
    const pulse = 0.35 + 0.35 * Math.sin(this.time / 240);
    this.hintLayer
      .moveTo(g.ox + p.line[0] * g.cell, g.oy + p.line[1] * g.cell)
      .lineTo(g.ox + p.line[2] * g.cell, g.oy + p.line[3] * g.cell)
      .stroke({ width: Math.max(3, g.cell * 0.07), color: INK.cream, alpha: pulse, cap: "round" });
  }

  // ---- the cut being lined up

  private clearAim(): void {
    this.aim = null;
    this.armed = false;
    this.preview = null;
    this.lineLayer.clear();
    for (const t of this.gainTexts) t.visible = false;
    this.publishAim();
    this.drawOrder();
  }

  private publishAim(): void {
    this.app.canvas.setAttribute("data-cursor", this.aim ? `${this.aim.piece},${this.aim.vertical ? 1 : 0},${this.aim.at}` : "");
  }

  /** Line a cut up, if the engine would take it. Returns false when it would not. */
  private setAim(aim: Aim, armed: boolean): boolean {
    if (!this.state) return false;
    const preview = cuttingCutPreview(this.state, aim.piece, aim.vertical, aim.at);
    if (!preview) return false;
    const moved = !this.aim || this.aim.piece !== aim.piece || this.aim.vertical !== aim.vertical || this.aim.at !== aim.at;
    this.aim = aim;
    this.armed = armed;
    this.preview = preview;
    this.idle = 0;
    if (moved) {
      sfx.tick(false);
      const g = this.grid;
      preview.halves.forEach((h, i) => {
        const t = this.gainTexts[i]!;
        t.visible = h.ore !== null;
        if (h.ore === null) return;
        t.text = `+${h.points}`;
        t.position.set(g.ox + (h.x + h.w / 2) * g.cell, g.oy + (h.y + h.h / 2) * g.cell);
        // The number fits inside the side it belongs to.
        t.scale.set(1);
        const fit = Math.min(1, (h.w * g.cell - 18) / t.width, (h.h * g.cell - 8) / t.height);
        t.scale.set(Math.max(0.45, fit));
      });
    }
    this.publishAim();
    this.drawAim();
    if (moved) this.drawOrder();
    return true;
  }

  private drawAim(): void {
    const l = this.lineLayer;
    l.clear();
    const p = this.preview;
    if (!p) return;
    const g = this.grid;
    const seam = this.seam;
    for (const h of p.halves) {
      const x = g.ox + h.x * g.cell + seam;
      const y = g.oy + h.y * g.cell + seam;
      const w = h.w * g.cell - seam * 2;
      const hh = h.h * g.cell - seam * 2;
      const round = Math.max(3, g.cell * 0.1);
      // A side that would bank is ringed in cream, and marked by its corners when it fills the order; a side that would stay is dimmed.
      if (h.ore !== null) l.roundRect(x, y, w, hh, round).stroke({ width: Math.max(2, g.cell * 0.05), color: INK.cream, alignment: 1 });
      else l.roundRect(x, y, w, hh, round).fill({ color: INK.ground, alpha: 0.4 });
      if (h.filled) this.corners(l, x, y, w, hh);
    }
    // What a side would pay sits on a scrim of the ground, so it reads over the cut-outs.
    for (const t of this.gainTexts) {
      if (!t.visible) continue;
      const w = t.width + 10;
      const hh = t.height + 2;
      l.roundRect(t.x - w / 2, t.y - hh / 2, w, hh, Math.min(RADIUS, hh / 2)).fill({ color: INK.ground, alpha: 0.7 });
    }
    // The cut being lined up is the player's own: one amber line, steady under the finger, breathing while it waits for the second tap.
    const pulse = this.armed ? 0.75 + 0.25 * Math.sin(this.time / 150) : 1;
    l.moveTo(g.ox + p.line[0] * g.cell, g.oy + p.line[1] * g.cell)
      .lineTo(g.ox + p.line[2] * g.cell, g.oy + p.line[3] * g.cell)
      .stroke({ width: Math.max(4, g.cell * 0.09), color: INK.amber, alpha: pulse, cap: "round" });
  }

  private commit(): void {
    const aim = this.aim;
    if (!aim || !this.preview) return;
    this.clearAim();
    this.cb.onCut(aim.piece, aim.vertical, aim.at);
  }

  /** The grid line of one direction inside a piece that is nearest a point. Null when the piece has no line that way. */
  private nearestLine(piece: CuttingPiece, vertical: boolean, x: number, y: number): { at: number; dist: number } | null {
    const g = this.grid;
    if (vertical ? piece.w < 2 : piece.h < 2) return null;
    const raw = vertical ? (x - g.ox) / g.cell : (y - g.oy) / g.cell;
    const lo = (vertical ? piece.x : piece.y) + 1;
    const hi = (vertical ? piece.x + piece.w : piece.y + piece.h) - 1;
    const at = Math.max(lo, Math.min(hi, Math.round(raw)));
    return { at, dist: Math.abs(raw - at) };
  }

  // ---- pointer

  private inChip(x: number, y: number): boolean {
    const c = this.chip;
    return x >= c.x - 4 && x <= c.x + c.w + 4 && y >= c.y - 6 && y <= c.y + c.h + 6;
  }

  protected override pointerDown(x: number, y: number): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.inChip(x, y)) {
      this.clearAim();
      this.cb.onDone();
      return;
    }
    const at = this.grid.at(x, y);
    const piece = at ? cuttingPieceAt(state, at.col, at.row) : null;
    if (!piece) {
      this.clearAim();
      return;
    }
    if (this.busy) this.tweens.flush();
    this.idle = 0;
    this.drag = { piece: piece.id, x, y, moved: false, vertical: null };
  }

  protected override pointerMove(x: number, y: number): void {
    const d = this.drag;
    const state = this.state;
    if (!d || !state) return;
    const piece = state.pieces.find((p) => p.id === d.piece);
    if (!piece) return;
    const dx = x - d.x;
    const dy = y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < this.grid.cell * 0.28) return;
    d.moved = true;
    // A swipe across cuts across, a swipe down cuts down. Once the torch is moving one way it takes a clear turn to change it.
    const steep = Math.abs(dy) > Math.abs(dx);
    if (d.vertical === null) d.vertical = steep;
    else if (d.vertical && Math.abs(dx) > Math.abs(dy) * 1.5) d.vertical = false;
    else if (!d.vertical && Math.abs(dy) > Math.abs(dx) * 1.5) d.vertical = true;
    const line = this.nearestLine(piece, d.vertical, x, y) ?? this.nearestLine(piece, !d.vertical, x, y);
    if (!line) return;
    const vertical = this.nearestLine(piece, d.vertical, x, y) ? d.vertical : !d.vertical;
    this.setAim({ piece: piece.id, vertical, at: line.at }, false);
  }

  protected override pointerUp(x: number, y: number): void {
    const d = this.drag;
    this.drag = null;
    const state = this.state;
    if (!d || !state) return;
    if (d.moved) {
      if (this.aim && !this.armed) this.commit();
      return;
    }
    // A tap: line up the nearest line inside the piece; the same tap again makes the cut.
    const piece = state.pieces.find((p) => p.id === d.piece);
    if (!piece) return;
    const v = this.nearestLine(piece, true, x, y);
    const h = this.nearestLine(piece, false, x, y);
    const pick = v && (!h || v.dist <= h.dist) ? { vertical: true, at: v.at } : h ? { vertical: false, at: h.at } : null;
    if (!pick) return;
    if (this.aim && this.armed && this.aim.piece === piece.id && this.aim.vertical === pick.vertical && this.aim.at === pick.at) this.commit();
    else this.setAim({ piece: piece.id, ...pick }, true);
  }

  protected override pointerCancel(): void {
    this.drag = null;
    if (!this.armed) this.clearAim();
  }

  // ---- keyboard

  /** A cut to start from on a piece: its middle line, down if it has one. */
  private middleOf(piece: CuttingPiece, vertical: boolean): Aim | null {
    if (vertical ? piece.w < 2 : piece.h < 2) return null;
    return { piece: piece.id, vertical, at: vertical ? piece.x + Math.ceil(piece.w / 2) : piece.y + Math.ceil(piece.h / 2) };
  }

  /**
   * Left and right move a cut that runs down; up and down move one that runs across. Tab or N takes
   * the next piece. Space or enter makes the cut, escape drops it, D gives the slab up.
   */
  override keyboard(key: string): boolean {
    const state = this.state;
    if (!this.interactive || !state || state.finished) return false;
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === "d") {
      this.clearAim();
      this.cb.onDone();
      return true;
    }
    if (state.pieces.length === 0) return false;
    const start = (): boolean => {
      const piece = state.pieces[0]!;
      const aim = this.middleOf(piece, true) ?? this.middleOf(piece, false);
      return aim !== null && this.setAim(aim, true);
    };
    const moves: Record<string, readonly [boolean, number]> = { ArrowLeft: [true, -1], ArrowRight: [true, 1], ArrowUp: [false, -1], ArrowDown: [false, 1] };
    const move = moves[k];
    if (move) {
      if (this.busy) this.tweens.flush();
      if (!this.aim) return start();
      const piece = state.pieces.find((p) => p.id === this.aim!.piece);
      if (!piece) return start();
      const [vertical, step] = move;
      if (this.aim.vertical !== vertical) {
        // Turning the cut: the line that way nearest the middle of the piece.
        const turned = this.middleOf(piece, vertical);
        if (!turned || !this.setAim(turned, true)) sfx.bump();
      } else if (!this.setAim({ ...this.aim, at: this.aim.at + step }, true)) sfx.bump();
      return true;
    }
    if (k === "Tab" || k === "n") {
      if (this.busy) this.tweens.flush();
      const i = this.aim ? state.pieces.findIndex((p) => p.id === this.aim!.piece) : -1;
      const piece = state.pieces[(i + 1) % state.pieces.length]!;
      const aim = this.middleOf(piece, this.aim?.vertical ?? true) ?? this.middleOf(piece, !(this.aim?.vertical ?? true));
      if (aim) this.setAim(aim, true);
      return true;
    }
    if (k === " " || k === "Enter") {
      if (!this.aim) return start();
      this.commit();
      return true;
    }
    if (k === "Escape" && this.aim) {
      this.clearAim();
      return true;
    }
    return false;
  }
}
