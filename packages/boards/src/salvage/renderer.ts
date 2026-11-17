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
import { MOTION } from "../look/tokens.js";
import { FONT_MONO, INK } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { SALVAGE_COUPLER_COLOR, SALVAGE_COUPLER_PAINT, SALVAGE_CRATE_COLOR, SALVAGE_CRATE_PAINT, salvageKind } from "./pieces.js";

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
  /** Pulse a line worth drawing after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: SalvageLabels;
}

interface PieceView {
  s: Sprite;
  kind: number;
  cell: number;
}

/** The strip over the field, in cells: what the line being drawn is worth. */
const STRIP = 0.95;
const HINT_AFTER_MS = 6000;
/** Lines this long are called out; the longer one is the beat. */
const LONG = 8;
const MIGHTY = 12;
/** A ring round a piece: 2 units wide, 2 units off it. */
const RING_R = 0.45;
const RING_W = 0.07;
/** A piece on the line stands a little larger than the rest. */
const LIFT = 1.1;

/** Draws the salvage field and turns a drag into a tether. Scores nothing: every number it shows is the engine's. */
export class SalvageRenderer extends KitBoard<SalvageState> {
  private readonly grid = new Grid(7, 8);
  private readonly bg = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly pieceLayer = new Container();
  /** Pieces drifting in from above are hidden until they are inside the field. */
  private readonly pieceMask = new Graphics();
  private readonly lineLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private label: Text | null = null;
  private readonly pieces = new Map<number, PieceView>();
  /** The line being drawn, as cell indexes, and whether it has been closed back onto its first piece. */
  private path: number[] = [];
  private closed = false;
  private dragging = false;
  private pointer = { x: 0, y: 0 };
  /** The keyboard's cell. Drawn once a key has been used. */
  private cursor = 0;
  private cursorShown = false;
  private idle = 0;
  private hint: { cells: number[]; loop: boolean } | null = null;
  private hintFor: SalvageState | null = null;
  private hints: boolean;

  constructor(
    host: HTMLElement,
    private readonly cb: SalvageCallbacks,
    private readonly opts: SalvageRendererOptions,
  ) {
    super(host, "salvage", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(0.5);
    this.pieceLayer.sortableChildren = true;
    this.pieceLayer.mask = this.pieceMask;
    this.world.addChild(this.pieceMask, this.bg, this.hintLayer, this.pieceLayer, this.lineLayer, this.cursorLayer, this.label);
  }

  protected layout(width: number, height: number): void {
    const g = this.grid;
    if (this.state) {
      g.cols = this.state.config.width;
      g.rows = this.state.config.height;
    }
    g.fit(width, height, { top: STRIP, margin: 8 });
    const pad = Math.max(4, g.cell * 0.12);
    const strip = g.cell * STRIP;
    // Bare ground under the strip and the field. The field is always full, so no cell needs a dot,
    // and the one hairline is the edge that matters: the floor, where a crate that has sunk is taken.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, false);
    const floor = g.oy + g.height + pad / 2;
    this.bg
      .moveTo(g.ox, floor)
      .lineTo(g.ox + g.width, floor)
      .stroke({ width: 1, color: INK.line });
    this.pieceMask
      .clear()
      .rect(g.ox - pad, g.oy, g.width + pad * 2, g.height + pad)
      .fill({ color: INK.cream });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.34));
      this.label.position.set(g.ox + g.width / 2, g.oy - strip * 0.5);
    }
    this.cursor = Math.min(this.cursor, g.cols * g.rows - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.cancelLine();
    if (this.state) this.snap(this.state.cells);
    this.drawCursor();
  }

  /** A piece's picture: its outline says which kind of debris it is, or that it is a crate or a coupler. */
  private texture(kind: number): Texture {
    const cell = this.grid.cell;
    if (kind === SALVAGE_CRATE) return this.piece("crate", cell, SALVAGE_CRATE_COLOR, SALVAGE_CRATE_PAINT);
    if (kind === SALVAGE_COUPLER) return this.piece("coupler", cell, SALVAGE_COUPLER_COLOR, SALVAGE_COUPLER_PAINT);
    const k = salvageKind(kind);
    return this.piece(`debris:${k.id}`, cell, k.color, k.paint);
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
    this.hint = null;
    this.idle = 0;
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different field (a lab config): lay it out afresh.
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.layout(this.app.screen.width, this.app.screen.height);
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

  /** Play a haul out: the line hauled piece by piece, the net, then each round of falling and floor crates. */
  private play(state: SalvageState, r: SalvageMoveReport): void {
    const g = this.grid;
    const L = this.opts.labels;
    const n = r.line.length;
    const step = Math.min(46, 340 / n);

    /** A hauled piece shrinks to nothing where it is. */
    const haul = (id: number, delay: number): void => {
      const v = this.pieces.get(id);
      if (!v) return;
      this.pieces.delete(id);
      this.tweens.remove(v.s, { delay, done: () => v.s.destroy() });
    };

    // The line goes in the order it was drawn, each piece a step higher than the last.
    r.line.forEach((h, i) => {
      this.tweens.after(i * step, () => sfx.pop(Math.min(9, i)));
      haul(h.id, i * step);
    });
    let t = (n - 1) * step + MOTION.clear;
    const last = r.line[n - 1]!;
    const netted = r.netted.length;
    this.tweens.after(t - 60, () => {
      this.fx.popup(g.x(last.cell), g.y(last.cell) - g.cell * 0.2, `+${r.haulPoints}`, INK.cream, Math.max(16, g.cell * (n >= LONG ? 0.6 : 0.46)));
      // One callout a haul, and the beat for the two rare things: a net that brings crates in,
      // stronger for each crate, and a mighty line.
      if (r.loop) {
        this.fx.say(netted > 0 ? L.net(netted) : L.netEmpty);
        if (netted > 0) {
          this.beat(Math.min(1, 0.35 + netted * 0.2));
          sfx.streak(netted * 4);
        } else sfx.good();
      } else if (n >= MIGHTY) {
        this.fx.say(L.mightyHaul);
        this.beat(0.6);
      } else if (n >= LONG) this.fx.say(L.longHaul);
      else if (r.streak >= 3) this.fx.say(L.streak(r.streak));
    });

    if (r.loop) {
      const cx = r.line.reduce((a, h) => a + g.x(h.cell), 0) / n;
      const cy = r.line.reduce((a, h) => a + g.y(h.cell), 0) / n;
      r.enclosed.forEach((h, i) => haul(h.id, t + i * 40));
      r.netted.forEach((h, i) => {
        const x = g.x(h.cell);
        const y = g.y(h.cell);
        this.tweens.after(t + i * 110, () => {
          // The net reaches each crate wherever it is: one line from the loop to it.
          this.fx.beam([cx, cy, x, y], INK.cream, Math.max(2, g.cell * RING_W), 300);
          sfx.slag();
        });
        haul(h.id, t + i * 110 + 60);
      });
      t += 200 + netted * 110 + r.enclosed.length * 40;
    }

    r.rounds.forEach((round) => {
      if (round.floor.length > 0) {
        const at = t;
        for (const h of round.floor) haul(h.id, at);
        this.tweens.after(at, () => {
          sfx.thud();
          const each = Math.round(round.points / round.floor.length);
          for (const h of round.floor) this.fx.popup(g.x(h.cell), g.oy + g.height - g.cell * 0.3, `+${each}`, INK.cream, Math.max(14, g.cell * 0.4));
        });
        t += MOTION.clear + 40;
      }
      for (const f of round.falls) {
        const v = this.pieces.get(f.id);
        if (!v) continue;
        v.cell = f.to;
        this.tweens.move(v.s, { y: g.y(f.to) }, { delay: t });
      }
      for (const sp of round.spawned) {
        const v = this.spawn({ id: sp.id, kind: sp.kind }, sp.cell);
        // It starts above the field, behind the mask, and drifts in.
        v.s.y = g.y(sp.cell) - sp.drop * g.cell;
        this.tweens.move(v.s, { y: g.y(sp.cell) }, { delay: t });
      }
      t += MOTION.move + 30;
    });

    if (r.shuffled) {
      this.tweens.after(t, () => {
        this.fx.say(L.scrambled, INK.dim);
        sfx.whoosh();
      });
      t += 120;
    }
    // Whatever the tweens did, the field ends as the engine holds it.
    this.tweens.after(t, () => this.snap(state.cells));
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

  protected override update(dt: number): void {
    if (this.dragging) this.drawLine();
    // A line worth drawing pulses after a pause, in rounds that allow hints.
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.path.length > 0 || this.busy) {
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
      // With crates adrift, a line that closes is the better advice.
      const crates = this.state.cells.some((p) => p.kind === SALVAGE_CRATE);
      const loop = crates ? salvageFindLoop(this.state) : null;
      const line = loop ?? salvageHint(this.state);
      this.hint = line ? { cells: line, loop: loop !== null } : null;
    }
    this.hintLayer.clear();
    if (!this.hint) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own line.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    const g = this.grid;
    for (const cell of this.hint.cells) this.hintLayer.circle(g.x(cell), g.y(cell), g.cell * RING_R).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.cream, alpha: pulse });
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
  }

  private viewAt(cell: number): PieceView | null {
    for (const v of this.pieces.values()) if (v.cell === cell) return v;
    return null;
  }

  private lift(cell: number, up: boolean): void {
    const v = this.viewAt(cell);
    if (v) v.s.scale.set(up ? LIFT : 1);
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
    this.idle = 0;
    sfx.pop(0);
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
    this.setLabel(value.loop ? this.opts.labels.previewNet(value.netted.length, points) : this.opts.labels.preview(value.length, enough ? points : 0), enough ? INK.cream : INK.dim);
  }

  private setLabel(text: string, color: number = INK.cream): void {
    if (!this.label) return;
    this.label.text = text;
    this.label.style.fill = color;
  }

  /**
   * The tether: one flat line through the pieces on it. It is amber while it is the line in the
   * player's hand, and cream once it is closed into a net, with a ring on every crate it will bring in.
   */
  private drawLine(): void {
    const g = this.grid;
    const l = this.lineLayer;
    l.clear();
    if (this.path.length === 0 || !this.state) return;
    const pts: number[] = [];
    for (const cell of this.path) pts.push(g.x(cell), g.y(cell));
    if (this.closed) pts.push(g.x(this.path[0]!), g.y(this.path[0]!));
    else if (this.dragging) pts.push(this.pointer.x, this.pointer.y);
    const ring = Math.max(2, g.cell * RING_W);
    if (pts.length >= 4) {
      l.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i + 1 < pts.length; i += 2) l.lineTo(pts[i]!, pts[i + 1]!);
      l.stroke({ width: Math.max(4, g.cell * 0.13), color: this.closed ? INK.cream : INK.amber, cap: "round", join: "round" });
    } else l.circle(pts[0]!, pts[1]!, g.cell * RING_R).stroke({ width: ring, color: INK.amber });
    if (this.closed) {
      // A crate is square, so its ring is: the same 2 units off it.
      const half = g.cell * RING_R;
      for (const cell of salvageLineValue(this.state, this.path, true).netted) l.roundRect(g.x(cell) - half, g.y(cell) - half, half * 2, half * 2, g.cell * 0.2).stroke({ width: ring, color: INK.cream });
    } else if (salvageCanClose(this.state, this.path)) {
      // The first piece shows it can be closed onto.
      const first = this.path[0]!;
      const pulse = this.reduced ? 0.9 : 0.6 + 0.4 * Math.sin(this.time / 160);
      l.circle(g.x(first), g.y(first), g.cell * RING_R).stroke({ width: ring, color: INK.cream, alpha: pulse });
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
    this.cursorShown = false;
    this.drawCursor();
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

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    // The keyboard's cell is the player's selection: an amber ring round the piece.
    this.cursorLayer.circle(g.x(this.cursor), g.y(this.cursor), g.cell * RING_R).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
  }

  /**
   * Arrows or WASD move the cursor, Q E Z C move it diagonally. Space or enter starts a line on the
   * cursor's piece; with a line begun the cursor draws it, enter or space hauls it and escape drops it.
   */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const steps: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      a: [-1, 0],
      d: [1, 0],
      w: [0, -1],
      s: [0, 1],
      q: [-1, -1],
      e: [1, -1],
      z: [-1, 1],
      c: [1, 1],
    };
    const step = steps[k];
    if (step) {
      const col = (this.cursor % g.cols) + step[0];
      const row = Math.floor(this.cursor / g.cols) + step[1];
      this.cursorShown = true;
      if (col >= 0 && col < g.cols && row >= 0 && row < g.rows) {
        const next = row * g.cols + col;
        if (this.path.length === 0 || this.dragging) this.cursor = next;
        else if (this.visit(next)) this.cursor = next;
        else sfx.bump();
      }
      this.idle = 0;
      this.drawCursor();
      return true;
    }
    if (k === " " || k === "Enter") {
      this.cursorShown = true;
      if (this.dragging) return true;
      if (this.path.length === 0) this.begin(this.cursor);
      else this.release();
      this.drawCursor();
      return true;
    }
    if (k === "Escape" && this.path.length > 0) {
      this.cancelLine();
      return true;
    }
    return false;
  }
}
