import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  SALVAGE_COUPLER,
  SALVAGE_CRATE,
  salvageCanClose,
  salvageCanExtend,
  salvageFindLoop,
  salvageHint,
  salvageKindChar,
  salvageLineValue,
  salvageStreakPercentAt,
  type SalvageMoveReport,
  type SalvagePiece,
  type SalvageState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { FONT, INK, drawPanel, drawWell, kindStyle, mix } from "../kit/art.js";
import { Grid, GridCursor, KitBoard } from "../kit/board.js";
import { ease } from "../kit/tween.js";

export interface SalvageCallbacks {
  /** The player let go of a line the engine would take. */
  onTether(cells: readonly number[], loop: boolean): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface SalvageLabels {
  /** The line being drawn: its length and what it is worth now. */
  preview(pieces: number, points: number): string;
  /** A closed line: the crates it will net and what the haul is worth. */
  previewNet(crates: number, points: number): string;
  net(crates: number): string;
  netEmpty: string;
  longHaul: string;
  mightyHaul: string;
  streak(count: number): string;
  scrambled: string;
  crateFloor: string;
}

export interface SalvageRendererOptions {
  showMarks: boolean;
  labels: SalvageLabels;
}

interface PieceView {
  s: Sprite;
  kind: number;
  cell: number;
}

const HINT_AFTER_MS = 6000;
const TETHER = 0x7fd7ff;
const NET = 0xf5d58a;

/** Draws the salvage field and turns a drag into a tether. Scores nothing: every number it shows is the engine's. */
export class SalvageRenderer extends KitBoard<SalvageState> {
  private readonly grid = new Grid(7, 8);
  private readonly bg = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly pieceLayer = new Container();
  /** Pieces drifting in from above are hidden until they are inside the panel. */
  private readonly pieceMask = new Graphics();
  private readonly lineLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private readonly emitter = new Graphics();
  private label: Text | null = null;
  private readonly pieces = new Map<number, PieceView>();
  /** The line being drawn, as cell indexes, and whether it has been closed back onto its first piece. */
  private path: number[] = [];
  private closed = false;
  private dragging = false;
  private pointer = { x: 0, y: 0 };
  private readonly cursor = new GridCursor(this.grid, this.cursorLayer, true);
  /** A line worth drawing pulses after a pause, in rounds that allow hints. */
  private readonly hint = this.idleHint<{ cells: number[]; loop: boolean }>({
    after: HINT_AFTER_MS,
    layer: this.hintLayer,
    period: 260,
    held: () => this.path.length > 0,
    compute: (state) => {
      // With crates adrift, a line that closes is the better advice.
      const crates = state.cells.some((p) => p.kind === SALVAGE_CRATE);
      const loop = crates ? salvageFindLoop(state) : null;
      const line = loop ?? salvageHint(state);
      return line ? { cells: line, loop: loop !== null } : null;
    },
    draw: (hint, beat) => {
      const g = this.grid;
      for (const cell of hint.cells) this.hintLayer.circle(g.x(cell), g.y(cell), g.cell * 0.44).stroke({ width: 2.5, color: hint.loop ? NET : TETHER, alpha: 0.05 + 0.6 * beat });
    },
  });

  constructor(
    host: HTMLElement,
    private readonly cb: SalvageCallbacks,
    private readonly opts: SalvageRendererOptions,
  ) {
    super(host, "salvage", cb.onFrame, opts.showMarks);
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: INK.text, letterSpacing: 0.5 } });
    this.label.anchor.set(0.5);
    this.pieceLayer.sortableChildren = true;
    this.pieceLayer.mask = this.pieceMask;
    this.world.addChild(this.pieceMask, this.bg, this.emitter, this.hintLayer, this.pieceLayer, this.lineLayer, this.cursorLayer, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    g.fit(width, height, { top: 0.95, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = g.cell * 0.95;
    this.bg.clear();
    drawPanel(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, Math.max(10, g.cell * 0.28));
    for (let i = 0; i < g.cols * g.rows; i++) drawWell(this.bg, g.x(i) - g.cell / 2, g.y(i) - g.cell / 2, g.cell);
    // The floor: where a crate that has sunk is taken.
    this.bg.roundRect(g.ox, g.oy + g.height - 3, g.width, 4, 2).fill({ color: INK.brass, alpha: 0.55 });
    this.pieceMask.clear().rect(g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2).fill({ color: 0xffffff });
    this.drawEmitter(false);
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.36));
      this.label.position.set(g.ox + g.width / 2, g.oy - strip * 0.34);
    }
    this.publishGeom(g.ox, g.oy, g.cell);
    this.cancelLine();
    if (this.state) this.snap(this.state.cells);
    this.cursor.draw(this.app.canvas);
  }

  /** The tractor emitter in the strip over the field: where hauled pieces fly to. */
  private drawEmitter(active: boolean): void {
    const g = this.grid;
    const { x, y } = this.emitterAt();
    const r = g.cell * 0.2;
    this.emitter.clear();
    this.emitter.roundRect(x - r * 2.4, y - r * 0.5, r * 4.8, r, r * 0.5).fill({ color: active ? mix(INK.brass, INK.white, 0.25) : INK.brass, alpha: active ? 1 : 0.75 });
    this.emitter.circle(x, y, r * 0.55).fill({ color: active ? TETHER : INK.edge });
    if (active) this.emitter.circle(x, y, r * 1.1).fill({ color: TETHER, alpha: 0.18 });
  }

  private emitterAt(): { x: number; y: number } {
    const g = this.grid;
    return { x: g.ox + g.width / 2, y: g.oy - g.cell * 0.95 * 0.82 };
  }

  private texture(kind: number): Texture {
    const cell = this.grid.cell;
    if (kind !== SALVAGE_CRATE && kind !== SALVAGE_COUPLER) return this.kindPiece("debris", kind, cell);
    // The painted crate or coupler where the sheet has one, the code-drawn one where it does not.
    return this.bake(`${kind}:${cell}`, cell, (g) => {
      const art = cell * 0.84;
      if (kind === SALVAGE_CRATE) this.sprite(g, "crate", 0, 0, art) || drawCrate(g, cell * 0.34);
      else this.sprite(g, "coupler", 0, 0, art) || drawCoupler(g, cell * 0.36);
    });
  }

  private colorOf(kind: number): number {
    return kind === SALVAGE_CRATE ? 0xc98a4b : kind === SALVAGE_COUPLER ? INK.white : kindStyle(kind).color;
  }

  /** Put exactly these pieces on the field, each on its cell, with nothing in motion. */
  private snap(cells: readonly SalvagePiece[]): void {
    const seen = new Set<number>();
    cells.forEach((p, cell) => {
      seen.add(p.id);
      let v = this.pieces.get(p.id);
      if (!v) v = this.spawn(p, cell);
      v.cell = cell;
      v.kind = p.kind;
      v.s.texture = this.texture(p.kind);
      v.s.position.set(this.grid.x(cell), this.grid.y(cell));
      v.s.scale.set(1);
      v.s.alpha = 1;
      v.s.rotation = 0;
    });
    for (const [id, v] of this.pieces) {
      if (seen.has(id)) continue;
      v.s.destroy();
      this.pieces.delete(id);
    }
    this.touchView();
  }

  private spawn(p: SalvagePiece, cell: number): PieceView {
    const s = new Sprite(this.texture(p.kind));
    s.anchor.set(0.5);
    s.position.set(this.grid.x(cell), this.grid.y(cell));
    this.pieceLayer.addChild(s);
    const v: PieceView = { s, kind: p.kind, cell };
    this.pieces.set(p.id, v);
    return v;
  }

  protected onState(state: SalvageState, prev: SalvageState | null): void {
    this.cancelLine();
    this.hint.restart();
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different field (a lab config): lay it out afresh.
      this.relayout();
      return;
    }
    const report = state.lastMove;
    const known = report !== null && prev !== null && report.line.every((h) => this.pieces.get(h.id)?.cell === h.cell);
    if (!report || !known) {
      this.snap(state.cells);
      return;
    }
    this.play(state, report);
  }

  /** Play a haul out: the line reeled in, the net, then each round of falling and floor crates. */
  private play(state: SalvageState, r: SalvageMoveReport): void {
    const g = this.grid;
    const em = this.emitterAt();
    const n = r.line.length;
    const step = Math.min(46, 340 / n);
    this.drawEmitter(true);

    const reel = (id: number, delay: number, ms = 240): void => {
      const v = this.pieces.get(id);
      if (!v) return;
      this.pieces.delete(id);
      v.s.zIndex = 2;
      this.tweens.to(v.s, { x: em.x, y: em.y, scale: 0.25, alpha: 0.2 }, ms, { delay, ease: ease.inBack, done: () => v.s.destroy() });
    };

    r.line.forEach((h, i) => {
      const x = g.x(h.cell);
      const y = g.y(h.cell);
      this.tweens.after(i * step, () => {
        sfx.pop(Math.min(9, i));
        this.fx.burst(x, y, this.colorOf(h.kind), 4, 0.16, 3);
      });
      reel(h.id, i * step);
    });
    let t = (n - 1) * step + 150;
    const last = r.line[n - 1]!;
    this.tweens.after(t - 60, () => {
      this.fx.popup(g.x(last.cell), g.y(last.cell) - g.cell * 0.2, `+${r.haulPoints}`, r.loop ? NET : INK.gold, Math.max(16, g.cell * (n >= 8 ? 0.6 : 0.46)));
      if (n >= 12) this.fx.say(this.opts.labels.mightyHaul, INK.gold);
      else if (n >= 8) this.fx.say(this.opts.labels.longHaul, INK.gold);
      else if (r.streak >= 3 && !r.loop) this.fx.say(this.opts.labels.streak(r.streak), TETHER);
      if (n >= 8) this.fx.shake(Math.min(10, n * 0.6), 220);
    });

    if (r.loop) {
      const cx = r.line.reduce((a, h) => a + g.x(h.cell), 0) / n;
      const cy = r.line.reduce((a, h) => a + g.y(h.cell), 0) / n;
      this.tweens.after(t - 40, () => {
        this.fx.ring(cx, cy, NET, g.cell * 0.4, g.cell * 2.6, 520, 4);
        this.fx.flash(NET, 0.14, 260);
        this.fx.say(r.netted.length > 0 ? this.opts.labels.net(r.netted.length) : this.opts.labels.netEmpty, NET);
        if (r.netted.length > 0) sfx.streak(r.netted.length * 4);
        else sfx.good();
      });
      r.enclosed.forEach((h, i) => reel(h.id, t + i * 40));
      r.netted.forEach((h, i) => {
        const x = g.x(h.cell);
        const y = g.y(h.cell);
        this.tweens.after(t + i * 110, () => {
          this.fx.beam([cx, cy, x, y], NET, 3, 300);
          this.fx.burst(x, y, 0xc98a4b, 10, 0.24, 4);
          sfx.slag();
        });
        reel(h.id, t + i * 110 + 60, 300);
      });
      t += 200 + r.netted.length * 110 + r.enclosed.length * 40;
    }

    r.rounds.forEach((round) => {
      if (round.floor.length > 0) {
        const at = t;
        for (const h of round.floor) {
          const v = this.pieces.get(h.id);
          if (!v) continue;
          this.pieces.delete(h.id);
          this.tweens.to(v.s, { y: g.oy + g.height + g.cell * 0.6, alpha: 0 }, 220, { delay: at, ease: ease.inCubic, done: () => v.s.destroy() });
        }
        this.tweens.after(at, () => {
          sfx.thud();
          const each = Math.round(round.points / round.floor.length);
          for (const h of round.floor) this.fx.popup(g.x(h.cell), g.oy + g.height - g.cell * 0.3, `+${each}`, 0xc98a4b, Math.max(14, g.cell * 0.4));
        });
        t += 200;
      }
      let longest = 0;
      for (const f of round.falls) {
        const v = this.pieces.get(f.id);
        if (!v) continue;
        v.cell = f.to;
        const rows = Math.round((f.to - f.from) / g.cols);
        const ms = 150 + rows * 45;
        longest = Math.max(longest, ms);
        this.tweens.to(v.s, { y: g.y(f.to) }, ms, { delay: t, ease: ease.outBack });
      }
      for (const sp of round.spawned) {
        const piece = { id: sp.id, kind: sp.kind };
        const v = this.spawn(piece, sp.cell);
        v.s.y = g.y(sp.cell) - sp.drop * g.cell;
        v.s.alpha = 0;
        const ms = 170 + sp.drop * 45;
        longest = Math.max(longest, ms);
        this.tweens.to(v.s, { y: g.y(sp.cell), alpha: 1 }, ms, { delay: t, ease: ease.outBack });
      }
      t += longest + 30;
    });

    if (r.shuffled) {
      this.tweens.after(t, () => {
        this.fx.say(this.opts.labels.scrambled, INK.dim);
        sfx.whoosh();
      });
      t += 120;
    }
    // Whatever the tweens did, the field ends as the engine holds it.
    this.tweens.after(t, () => {
      this.snap(state.cells);
      this.drawEmitter(false);
    });
  }

  protected view(): string {
    const g = this.grid;
    const chars = new Array<string>(g.cols * g.rows).fill(".");
    for (const v of this.pieces.values()) {
      const at = g.at(v.s.x, v.s.y);
      if (at) chars[at.index] = salvageKindChar(v.kind);
    }
    return chars.join("");
  }

  protected override update(): void {
    if (this.dragging) this.drawLine();
  }

  // ---- the line

  private cancelLine(): void {
    if (this.path.length === 0 && !this.dragging) return;
    for (const cell of this.path) this.lift(cell, false);
    this.path = [];
    this.closed = false;
    this.dragging = false;
    this.lineLayer.clear();
    this.setLabel("");
    this.drawEmitter(false);
  }

  private viewAt(cell: number): PieceView | null {
    for (const v of this.pieces.values()) if (v.cell === cell) return v;
    return null;
  }

  private lift(cell: number, up: boolean): void {
    const v = this.viewAt(cell);
    if (v) v.s.scale.set(up ? 1.14 : 1);
  }

  private begin(cell: number): boolean {
    if (!this.state || this.state.finished) return false;
    if (this.busy) this.tweens.flush();
    if (this.state.cells[cell]!.kind === SALVAGE_CRATE) {
      sfx.bump();
      return false;
    }
    this.path = [cell];
    this.closed = false;
    this.lift(cell, true);
    this.hint.restart();
    sfx.pop(0);
    this.drawEmitter(true);
    this.refreshLine();
    return true;
  }

  /** The line's head moved onto `cell`: step back, close, open again or extend, as the engine allows. Returns false when it may not go there. */
  private visit(cell: number): boolean {
    const state = this.state;
    if (!state || this.path.length === 0) return false;
    const n = this.path.length;
    const last = this.path[n - 1]!;
    if (this.closed) {
      // The loop is shut on its first piece: stepping back onto the last piece opens it again.
      if (cell === last) {
        this.closed = false;
        this.refreshLine();
        return true;
      }
      return cell === this.path[0];
    }
    if (cell === last) return true;
    if (n >= 2 && cell === this.path[n - 2]) {
      this.lift(last, false);
      this.path.pop();
      sfx.pop(Math.min(9, this.path.length - 1));
      this.refreshLine();
      return true;
    }
    if (cell === this.path[0] && salvageCanClose(state, this.path)) {
      this.closed = true;
      sfx.good();
      this.refreshLine();
      return true;
    }
    if (!salvageCanExtend(state, this.path, cell)) return false;
    this.path.push(cell);
    this.lift(cell, true);
    sfx.pop(Math.min(9, this.path.length - 1));
    this.refreshLine();
    return true;
  }

  private release(): void {
    const state = this.state;
    const cells = this.path.slice();
    const loop = this.closed;
    const ok = state !== null && cells.length >= state.config.minLine;
    this.cancelLine();
    if (ok) this.cb.onTether(cells, loop);
    else if (cells.length > 1) sfx.bump();
  }

  private refreshLine(): void {
    this.drawLine();
    const state = this.state;
    if (!state || this.path.length < 2) {
      this.setLabel("");
      return;
    }
    const value = salvageLineValue(state, this.path, this.closed);
    // The streak a line this long would be scored at, so the number shown is the number scored.
    const long = value.length >= state.config.streakMin;
    const streak = long ? state.combo + 1 : state.combo > 0 && state.grace ? state.combo : 0;
    const points = Math.floor((value.base * salvageStreakPercentAt(state.config, streak)) / 100);
    const enough = this.path.length >= state.config.minLine;
    this.setLabel(value.loop ? this.opts.labels.previewNet(value.netted.length, points) : this.opts.labels.preview(value.length, enough ? points : 0), value.loop ? NET : enough ? INK.text : INK.dim);
  }

  private setLabel(text: string, color: number = INK.text): void {
    if (!this.label) return;
    this.label.text = text;
    this.label.style.fill = color;
  }

  private drawLine(): void {
    const g = this.grid;
    const l = this.lineLayer;
    l.clear();
    if (this.path.length === 0 || !this.state) return;
    const pts: number[] = [];
    for (const cell of this.path) pts.push(g.x(cell), g.y(cell));
    if (this.closed) pts.push(g.x(this.path[0]!), g.y(this.path[0]!));
    else if (this.dragging) pts.push(this.pointer.x, this.pointer.y);
    const color = this.closed ? NET : TETHER;
    const width = Math.max(4, g.cell * 0.16);
    if (this.closed) {
      // The net: a wash inside the loop, and a ring on every crate it will bring in.
      const poly: number[] = [];
      for (const cell of this.path) poly.push(g.x(cell), g.y(cell));
      l.poly(poly).fill({ color: NET, alpha: 0.16 });
      const value = salvageLineValue(this.state, this.path, true);
      const pulse = 0.6 + 0.4 * Math.sin(this.time / 140);
      for (const cell of value.netted) l.circle(g.x(cell), g.y(cell), g.cell * 0.46).stroke({ width: 3, color: NET, alpha: pulse });
      for (const cell of value.enclosed) l.circle(g.x(cell), g.y(cell), g.cell * 0.4).stroke({ width: 2, color: NET, alpha: 0.7 });
    }
    const stroke = (w: number, c: number, a: number): void => {
      l.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i + 1 < pts.length; i += 2) l.lineTo(pts[i]!, pts[i + 1]!);
      l.stroke({ width: w, color: c, alpha: a, cap: "round", join: "round" });
    };
    stroke(width * 2.2, color, 0.22);
    stroke(width, color, 0.95);
    stroke(width * 0.35, INK.white, 0.9);
    for (let i = 0; i < this.path.length; i++) {
      const cell = this.path[i]!;
      l.circle(g.x(cell), g.y(cell), g.cell * 0.13).fill({ color: i === 0 ? INK.white : color });
    }
    // The first piece shows it can be closed onto.
    if (!this.closed && salvageCanClose(this.state, this.path)) {
      const first = this.path[0]!;
      l.circle(g.x(first), g.y(first), g.cell * 0.46).stroke({ width: 2.5, color: NET, alpha: 0.5 + 0.4 * Math.sin(this.time / 160) });
    }
  }

  // ---- pointer

  /** The cell whose centre the point is near enough to mean: a circle, so a diagonal drag does not clip the cells beside it. */
  private cellNear(x: number, y: number, reach: number): number | null {
    const at = this.grid.at(x, y);
    if (!at) return null;
    const dx = x - this.grid.cx(at.col);
    const dy = y - this.grid.cy(at.row);
    return dx * dx + dy * dy <= (this.grid.cell * reach) ** 2 ? at.index : null;
  }

  protected override pointerDown(x: number, y: number): void {
    const cell = this.cellNear(x, y, 0.62);
    if (cell === null) return;
    this.cancelLine();
    this.cursor.shown = false;
    this.cursor.draw(this.app.canvas);
    this.pointer = { x, y };
    if (this.begin(cell)) this.dragging = true;
  }

  protected override pointerMove(x: number, y: number): void {
    if (!this.dragging) return;
    // A fast drag is walked in short steps, so no piece under the finger's path is skipped.
    const from = this.pointer;
    const dist = Math.hypot(x - from.x, y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (this.grid.cell * 0.2)));
    for (let i = 1; i <= steps; i++) {
      const cell = this.cellNear(from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps, 0.4);
      if (cell !== null) this.visit(cell);
    }
    this.pointer = { x, y };
  }

  protected override pointerUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.release();
  }

  protected override pointerCancel(): void {
    this.cancelLine();
  }

  // ---- keyboard

  /**
   * Arrows or WASD move the cursor, Q E Z C move it diagonally. Space or enter starts a line on the
   * cursor's piece; with a line begun the cursor draws it, enter or space hauls it and escape drops it.
   */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const next = this.cursor.target(k);
    if (next !== null) {
      this.cursor.shown = true;
      // With a line begun from the keys, the cursor draws it, and goes only where the line may.
      if (next !== this.cursor.index) {
        if (this.path.length === 0 || this.dragging || this.visit(next)) this.cursor.index = next;
        else sfx.bump();
      }
      this.hint.restart();
      this.cursor.draw(this.app.canvas);
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursor.shown = true;
      if (this.dragging) return true;
      if (this.path.length === 0) this.begin(this.cursor.index);
      else this.release();
      this.cursor.draw(this.app.canvas);
      return true;
    }
    if (k === "Escape" && this.path.length > 0) {
      this.cancelLine();
      return true;
    }
    return false;
  }
}

/** A loot crate: a strapped box with a brass lock, nothing like any debris. */
function drawCrate(g: Graphics, r: number): void {
  const wood = 0xb9793c;
  g.roundRect(-r, -r + r * 0.12, r * 2, r * 2, r * 0.18).fill({ color: INK.black, alpha: 0.35 });
  g.roundRect(-r, -r, r * 2, r * 2, r * 0.18).fill({ color: wood });
  g.roundRect(-r, -r, r * 2, r * 2, r * 0.18).stroke({ width: Math.max(1.5, r * 0.14), color: mix(wood, INK.black, 0.55) });
  // Planks, then two straps.
  for (const y of [-r * 0.36, r * 0.36]) g.rect(-r * 0.9, y - 0.75, r * 1.8, 1.5).fill({ color: mix(wood, INK.black, 0.4), alpha: 0.8 });
  for (const x of [-r * 0.52, r * 0.52]) g.rect(x - r * 0.12, -r, r * 0.24, r * 2).fill({ color: mix(wood, INK.black, 0.5) });
  g.circle(0, 0, r * 0.3).fill({ color: INK.brass });
  g.circle(0, 0, r * 0.3).stroke({ width: Math.max(1, r * 0.08), color: mix(INK.brass, INK.black, 0.5) });
  g.rect(-r * 0.06, -r * 0.14, r * 0.12, r * 0.3).fill({ color: mix(INK.brass, INK.black, 0.6) });
}

/** A coupler: a pale ring with four lugs, so it reads as a joint and as no kind of debris. */
function drawCoupler(g: Graphics, r: number): void {
  const pale = 0xe9eef7;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    g.circle(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.26).fill({ color: pale });
    g.circle(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.26).stroke({ width: Math.max(1, r * 0.08), color: mix(pale, INK.black, 0.5) });
  }
  g.circle(0, r * 0.1, r * 0.8).fill({ color: INK.black, alpha: 0.3 });
  g.circle(0, 0, r * 0.8).fill({ color: pale });
  g.circle(0, 0, r * 0.8).stroke({ width: Math.max(1.2, r * 0.11), color: mix(pale, INK.black, 0.5) });
  g.circle(0, 0, r * 0.42).fill({ color: INK.well });
  g.circle(0, 0, r * 0.42).stroke({ width: Math.max(1, r * 0.09), color: mix(pale, INK.black, 0.5) });
}
