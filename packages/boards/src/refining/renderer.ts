import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  refiningDrawValue,
  refiningHint,
  refiningKindChar,
  refiningLinked,
  refiningPairOf,
  refiningPartner,
  refiningSwapIllegalReason,
  REFINING_DIRS,
  type RefiningDir,
  type RefiningEvent,
  type RefiningGrade,
  type RefiningKind,
  type RefiningPiece,
  type RefiningState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { MOTION } from "../look/tokens.js";
import { FONT_MONO, INK } from "../kit/art.js";
import { KitBoard } from "../kit/board.js";
import { HexGrid } from "./hex.js";
import { refiningKind } from "./pieces.js";

export interface RefiningCallbacks {
  /** The player swapped the piece at `cell` with the one below it, or one of the two in the column to its right. */
  onSwap(cell: number, dir: RefiningDir): void;
  /** The player drew the outlet early. */
  onDraw(): void;
  /** First settled frame after a new state. */
  onFrame(): void;
}

export interface RefiningLabels {
  /** How the outlet would go if drawn now. */
  preview(grade: RefiningGrade, run: number, points: number): string;
  clear(run: number): string;
  smooth: string;
  plain: string;
  foul: string;
  dump: string;
  spill: string;
  smoke: string;
  runLost: string;
}

export interface RefiningRendererOptions {
  /** Ring a swap worth making after a pause. Off for recorded rounds. */
  hints: boolean;
  labels: RefiningLabels;
}

interface PieceView {
  s: Sprite;
  kind: RefiningKind;
  cell: number;
}

/** The strip over the tower, in cells: the outlet's lamp, its clock and what it would be worth. */
const STRIP = 0.95;
const HINT_AFTER_MS = 6000;
const RING_W = 0.07;
/** A clear run this long is the puzzle's named compound move: it gets the beat. */
const BEAT_RUN = 3;

/**
 * Draws the refinery's tower, a honeycomb, and turns a drag, two taps or a key into a swap (a drag
 * carries its piece through as many swaps as it is dragged over), and a tap on the
 * outlet's lamp or enter into an early draw. Scores nothing: every number it shows is the engine's.
 * It is ticked (ADR 0015): it is handed a display state every tick and plays only the events it has
 * not shown, by their rising `seq`.
 */
export class RefiningRenderer extends KitBoard<RefiningState> {
  private readonly grid = new HexGrid(6, 5);
  private readonly bg = new Graphics();
  private readonly linkLayer = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly selectLayer = new Graphics();
  private readonly cursorLayer = new Graphics();
  private readonly lamp = new Graphics();
  private label: Text | null = null;
  private readonly pieces = new Map<number, PieceView>();
  /** The `seq` of the last engine event played. */
  private shownSeq = 0;
  private selected: number | null = null;
  /** A drag in progress: the dragged piece's cell, whether it has swapped or bumped yet, and the event it waits on before its next swap. */
  private drag: { cell: number; moved: boolean; bumped: number | null; waitSeq: number | null } | null = null;
  private cursor = 0;
  private cursorShown = false;
  /** Space picked the piece under the cursor: the next arrow swaps it that way. */
  private picked = false;
  private idle = 0;
  private hint: { cell: number; dir: RefiningDir } | null = null;
  private hintFor: readonly RefiningPiece[] | null = null;
  private hints: boolean;
  private lampDrawn = "";

  constructor(
    host: HTMLElement,
    private readonly cb: RefiningCallbacks,
    private readonly opts: RefiningRendererOptions,
  ) {
    super(host, "refining", cb.onFrame);
    this.hints = opts.hints;
  }

  setHints(on: boolean): void {
    this.hints = on;
  }

  protected build(): void {
    this.label = new Text({ text: "", style: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: "700", fill: INK.cream }, resolution: 2 });
    this.label.anchor.set(1, 0.5);
    this.pieceLayer.sortableChildren = true;
    this.world.addChild(this.bg, this.linkLayer, this.hintLayer, this.pieceLayer, this.selectLayer, this.cursorLayer, this.lamp, this.label);
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
    // Bare ground under the strip and the tower. The outlet is a raised panel from its lamp down the
    // whole rightmost column, with one hairline down its far edge, where columns leave.
    this.bg.clear();
    this.paintGround(this.bg, g.ox - pad, g.oy - strip - pad, g.width + pad * 2, g.height + strip + pad * 2, false);
    const ow = g.cell + pad;
    const ox = g.cx(g.cols - 1) - ow / 2;
    this.bg.roundRect(ox, g.oy - strip, ow, g.height + strip, 10).fill({ color: INK.raised });
    const edge = g.ox + g.width + pad / 2;
    this.bg
      .moveTo(edge, g.oy - strip)
      .lineTo(edge, g.oy + g.height)
      .stroke({ width: 1, color: INK.line });
    if (this.label) {
      this.label.style.fontSize = Math.max(12, Math.round(g.cell * 0.32));
      this.label.position.set(g.cx(g.cols - 1) - ow / 2 - g.cell * 0.12, g.oy - strip * 0.5);
    }
    this.cursor = Math.min(this.cursor, g.cols * g.rows - 1);
    this.publishGeom(g.ox, g.oy, g.cell);
    this.select(null);
    this.lampDrawn = "";
    if (this.state) this.snap(this.state);
    this.drawCursor();
  }

  private texture(kind: RefiningKind): Texture {
    const k = refiningKind(kind);
    return this.piece(k.id, this.grid.cell, k.color, k.paint);
  }

  /** Put exactly this tower's pieces on the board, each on its cell, with nothing in motion. */
  private snap(state: RefiningState): void {
    const cells = state.cells;
    this.setPhase(state.draws);
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
    this.drawLinks(state);
    this.touchView();
  }

  /** Which columns sit low: the parity of the draws so far, as the engine has it. Published for the smoke. */
  private setPhase(draws: number): void {
    this.grid.phase = draws & 1;
    this.app.canvas.setAttribute("data-phase", String(this.grid.phase));
  }

  private spawn(p: RefiningPiece, cell: number): PieceView {
    const s = new Sprite(this.texture(p.kind));
    s.anchor.set(0.5);
    s.position.set(this.grid.x(cell), this.grid.y(cell));
    this.pieceLayer.addChild(s);
    const v: PieceView = { s, kind: p.kind, cell };
    this.pieces.set(p.id, v);
    return v;
  }

  /** A small dot on the edge between every two pieces that can swap: the links, so a player sees every move there is. */
  private drawLinks(state: RefiningState): void {
    const g = this.grid;
    const l = this.linkLayer;
    const cells = state.cells;
    l.clear();
    const r = Math.max(2, g.cell * 0.06);
    for (let c = 0; c < cells.length; c++) {
      for (const dir of REFINING_DIRS) {
        const o = refiningPartner(state, c, dir);
        if (o !== null && refiningLinked(cells[c]!.kind, cells[o]!.kind)) l.circle((g.x(c) + g.x(o)) / 2, (g.y(c) + g.y(o)) / 2, r);
      }
    }
    l.fill({ color: INK.dim });
  }

  /** Only the clock moved, or a logged wait repeats what was shown: nothing new to play. */
  protected override keepsPlaying(state: RefiningState, prev: RefiningState | null): boolean {
    return prev !== null && state.eventSeq === prev.eventSeq && state.eventSeq === this.shownSeq;
  }

  protected onState(state: RefiningState, prev: RefiningState | null): void {
    const g = this.grid;
    if (g.cols !== state.config.width || g.rows !== state.config.height) {
      // A different tower (a lab config): lay it out afresh.
      g.cols = state.config.width;
      g.rows = state.config.height;
      this.shownSeq = state.eventSeq;
      this.layout(this.app.screen.width, this.app.screen.height);
      return;
    }
    if (state.eventSeq === this.shownSeq && prev !== null) {
      this.refreshLabel();
      return;
    }
    const events = state.events.filter((e) => e.seq > this.shownSeq);
    // Played when the first new event follows what is drawn; anything else (a new round, a jump) is shown as it stands.
    const follows = prev !== null && events.length > 0 && events[0]!.seq === this.shownSeq + 1 && this.drawnMatches(prev.cells);
    this.shownSeq = state.eventSeq;
    // A draw moves every piece: a drag in progress lets go rather than swap a piece it did not pick up.
    if (events.some((e) => e.type === "draw")) this.drag = null;
    this.select(null);
    this.picked = false;
    this.drawCursor();
    this.hint = null;
    this.hintLayer.clear();
    this.idle = 0;
    if (!follows) {
      this.snap(state);
      this.refreshLabel();
      return;
    }
    this.play(state, prev!, events);
  }

  private drawnMatches(cells: readonly RefiningPiece[]): boolean {
    return cells.every((p, c) => this.pieces.get(p.id)?.cell === c);
  }

  /** Play the new events in order, from the tower `from`: swaps slide, draws carry the outlet off and move the tower right. */
  private play(state: RefiningState, prev: RefiningState, events: readonly RefiningEvent[]): void {
    const g = this.grid;
    const L = this.opts.labels;
    const ids = prev.cells.map((p) => p.id);
    let run = prev.run;
    let t = 0;
    this.linkLayer.clear();
    this.setPhase(prev.draws);
    for (const e of events) {
      if (e.type === "swap") {
        const ia = ids[e.a]!;
        const ib = ids[e.b]!;
        ids[e.a] = ib;
        ids[e.b] = ia;
        for (const [id, to] of [
          [ia, e.b],
          [ib, e.a],
        ] as const) {
          const v = this.pieces.get(id);
          if (!v) continue;
          v.cell = to;
          this.tweens.move(v.s, { x: g.x(to), y: g.y(to) }, { delay: t });
        }
        this.tweens.after(t, () => sfx.swap());
        t += MOTION.move;
        continue;
      }
      // A draw: the outlet rises to the tank or sinks to the sump, the rest move right, fresh feed comes in.
      const up = e.value.up;
      const at = t;
      for (const p of e.column) {
        const v = this.pieces.get(p.id);
        if (!v) continue;
        this.pieces.delete(p.id);
        this.tweens.to(v.s, { y: v.s.y + (up ? -1 : 1) * g.cell * 0.7, alpha: 0 }, MOTION.clear + 60, { delay: at, done: () => v.s.destroy() });
      }
      // Each column keeps its height as it moves right: which columns sit low turns over.
      this.grid.phase ^= 1;
      const next = new Array<number>(ids.length);
      for (let r = 0; r < g.rows; r++) {
        next[r * g.cols] = e.fresh[r]!.id;
        for (let c = 1; c < g.cols; c++) next[r * g.cols + c] = ids[r * g.cols + c - 1]!;
      }
      for (let c = 0; c < next.length; c++) {
        if (c % g.cols === 0) continue;
        const v = this.pieces.get(next[c]!);
        if (!v) continue;
        v.cell = c;
        this.tweens.move(v.s, { x: g.x(c), y: g.y(c) }, { delay: at + 60 });
      }
      e.fresh.forEach((p, r) => {
        const cell = r * g.cols;
        const v = this.spawn(p, cell);
        v.s.x = g.x(cell) - g.cell * 0.6;
        v.s.y = g.y(cell);
        v.s.alpha = 0;
        this.tweens.to(v.s, { x: g.x(cell), alpha: 1 }, MOTION.move, { delay: at + 60 });
      });
      for (const sm of e.smoke) {
        const old = this.pieces.get(sm.was);
        if (old) {
          this.pieces.delete(sm.was);
          this.tweens.remove(old.s, { delay: at + 200, done: () => old.s.destroy() });
        }
        next[sm.cell] = sm.id;
        const v = this.spawn({ id: sm.id, kind: 3 }, sm.cell);
        v.s.scale.set(0);
        this.tweens.to(v.s, { scale: 1 }, MOTION.clear, { delay: at + 260 });
      }
      for (let c = 0; c < next.length; c++) ids[c] = next[c]!;
      const was = run;
      run = e.value.run;
      this.tweens.after(at, () => this.sayDraw(e, was));
      if (e.smoke.length > 0) this.tweens.after(at + 260, () => this.fx.say(L.smoke, INK.dim));
      t += MOTION.clear + 220;
    }
    // Whatever the tweens did, the tower ends as the engine holds it.
    this.tweens.after(t, () => {
      this.snap(state);
      this.refreshLabel();
    });
  }

  /** The draw's points, its callout and its sound. A clear run of three or more is the beat. */
  private sayDraw(e: Extract<RefiningEvent, { type: "draw" }>, was: number): void {
    const g = this.grid;
    const L = this.opts.labels;
    const x = g.cx(g.cols - 1);
    const y = e.value.up ? g.oy + g.cell * 0.4 : g.oy + g.height - g.cell * 0.4;
    const grade = e.value.grade;
    const run = e.value.run;
    if (e.points !== 0 || e.value.points !== 0) {
      const pts = e.value.points;
      this.fx.popup(x, y, pts > 0 ? `+${pts}` : `${pts}`, pts > 0 ? INK.cream : INK.danger, Math.max(16, g.cell * (grade === "clear" && run >= BEAT_RUN ? 0.56 : 0.44)));
    }
    if (grade === "clear") {
      this.fx.say(L.clear(run));
      // The beat has one sound of its own, so a long run plays no cue over it.
      if (run >= BEAT_RUN) this.beat(Math.min(1, 0.25 + run * 0.12));
      else if (run >= 2) sfx.streak(run);
      else sfx.clear(1, g.rows);
      return;
    }
    // A run that was going and is now lost says so, dim, in place of the grade.
    if (run === 0 && was > 0) {
      this.fx.say(L.runLost, INK.dim);
      sfx.streakLost();
      return;
    }
    if (grade === "smooth") {
      this.fx.say(L.smooth);
      sfx.good();
    } else if (grade === "plain") {
      this.fx.say(L.plain, INK.dim);
      sfx.whoosh();
    } else if (grade === "foul") {
      this.fx.say(L.foul, INK.danger);
      sfx.bad();
    } else if (grade === "dump") {
      this.fx.say(L.dump, INK.dim);
      sfx.thud();
    } else {
      this.fx.say(L.spill, INK.danger);
      sfx.thud();
    }
  }

  protected view(): string {
    const g = this.grid;
    const chars = new Array<string>(g.cols * g.rows).fill(".");
    for (const v of this.pieces.values()) {
      const at = g.at(v.s.x, v.s.y);
      if (at) chars[at.index] = refiningKindChar(v.kind);
    }
    return chars.join("");
  }

  protected override update(dt: number): void {
    this.drawLamp();
    if (!this.interactive || !this.hints || !this.state || this.state.finished || this.drag || this.busy) {
      this.idle = 0;
      if (this.hint !== null) {
        this.hint = null;
        this.hintLayer.clear();
      }
      return;
    }
    this.idle += dt;
    if (this.idle < HINT_AFTER_MS) return;
    if (this.hintFor !== this.state.cells) {
      this.hintFor = this.state.cells;
      this.hint = refiningHint(this.state);
    }
    this.hintLayer.clear();
    if (this.hint === null) return;
    // A hint is cream, never amber: it is the board's advice, not the player's own pick.
    const pulse = this.reduced ? 0.8 : 0.55 + 0.4 * Math.sin(this.time / 240);
    this.framePair(this.hintLayer, this.hint.cell, this.hint.dir, INK.cream, pulse);
  }

  /** The outlet's lamp over the rightmost column: a dial that fills towards the clock's draw. Tapping it draws now. */
  private drawLamp(): void {
    const s = this.state;
    const g = this.grid;
    if (!s) return;
    const left = Math.max(0, s.nextDraw - s.tick);
    const frac = s.finished ? 0 : 1 - Math.min(1, left / s.config.pulseTicks);
    const key = `${Math.round(frac * 60)}:${s.finished}:${g.cell}`;
    if (key === this.lampDrawn) return;
    this.lampDrawn = key;
    const x = g.cx(g.cols - 1);
    const y = g.oy - g.cell * STRIP * 0.5;
    const r = g.cell * 0.3;
    const w = Math.max(2, g.cell * RING_W);
    const l = this.lamp;
    l.clear();
    l.circle(x, y, r).stroke({ width: w, color: INK.line });
    if (frac > 0) {
      const a0 = -Math.PI / 2;
      l.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r)
        .arc(x, y, r, a0, a0 + frac * Math.PI * 2)
        .stroke({ width: w, color: INK.cream });
    }
    // The heart of the lamp is the outlet's grade now: lit when drawing it would be clear.
    const v = refiningDrawValue(s);
    l.circle(x, y, r * 0.45).fill({ color: v.grade === "clear" ? INK.cream : INK.line });
  }

  /** The strip says how the outlet would go if drawn now. */
  private refreshLabel(): void {
    const s = this.state;
    if (!s || !this.label) return;
    if (s.finished) {
      this.label.text = "";
      return;
    }
    const v = refiningDrawValue(s);
    this.label.text = this.opts.labels.preview(v.grade, v.run, v.points);
    this.label.style.fill = v.grade === "clear" ? INK.cream : v.grade === "foul" || v.grade === "spill" ? INK.danger : INK.dim;
    this.lampDrawn = "";
  }

  /** A capsule round a pair: `cell` and its partner going `dir`. */
  private framePair(l: Graphics, cell: number, dir: RefiningDir, color: number, alpha = 1): void {
    const g = this.grid;
    const state = this.state;
    const other = state ? refiningPartner(state, cell, dir) : null;
    if (other === null) return;
    const ax = g.x(cell);
    const ay = g.y(cell);
    const bx = g.x(other);
    const by = g.y(other);
    const r = g.cell * 0.46;
    const th = Math.atan2(by - ay, bx - ax);
    l.moveTo(ax + Math.cos(th + Math.PI / 2) * r, ay + Math.sin(th + Math.PI / 2) * r)
      .arc(ax, ay, r, th + Math.PI / 2, th + (Math.PI * 3) / 2)
      .lineTo(bx + Math.cos(th - Math.PI / 2) * r, by + Math.sin(th - Math.PI / 2) * r)
      .arc(bx, by, r, th - Math.PI / 2, th + Math.PI / 2)
      .closePath()
      .stroke({ width: Math.max(2, g.cell * RING_W), color, alpha });
  }

  // ---- moves

  /** Swap `a` with its neighbour `b`, whichever way round they lie. True when the swap was made. */
  private trySwapPair(a: number, b: number): boolean {
    const state = this.state;
    if (!state || state.finished) return false;
    if (this.busy) this.tweens.flush();
    this.select(null);
    this.idle = 0;
    const pair = refiningPairOf(state, a, b);
    if (pair === null || refiningSwapIllegalReason(state, pair.cell, pair.dir) !== null) {
      sfx.bump();
      return false;
    }
    this.cb.onSwap(pair.cell, pair.dir);
    return true;
  }

  private touching(a: number, b: number): boolean {
    return this.state !== null && refiningPairOf(this.state, a, b) !== null;
  }

  private tryDraw(): void {
    const state = this.state;
    if (!state || state.finished) return;
    if (this.busy) this.tweens.flush();
    this.select(null);
    this.idle = 0;
    this.cb.onDraw();
  }

  private select(cell: number | null): void {
    this.selected = cell;
    this.selectLayer.clear();
    if (cell === null) return;
    const g = this.grid;
    // The picked piece is the player's: an amber ring round it.
    this.selectLayer.circle(g.x(cell), g.y(cell), g.cell * 0.45).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
  }

  // ---- pointer

  private onLamp(x: number, y: number): boolean {
    const g = this.grid;
    const lx = g.cx(g.cols - 1);
    const ly = g.oy - g.cell * STRIP * 0.5;
    return Math.hypot(x - lx, y - ly) <= g.cell * 0.48;
  }

  protected override pointerDown(x: number, y: number): void {
    if (!this.interactive || !this.state || this.state.finished) return;
    if (this.onLamp(x, y)) {
      this.tryDraw();
      return;
    }
    const at = this.grid.at(x, y);
    if (!at) return;
    this.cursorShown = false;
    this.picked = false;
    this.drawCursor();
    this.drag = { cell: at.index, moved: false, bumped: null, waitSeq: null };
  }

  /**
   * A drag carries its piece: each time the pointer comes over a neighbour the piece can swap with,
   * it swaps and goes on from there. A neighbour it cannot swap with bumps once, and the piece stays.
   */
  protected override pointerMove(x: number, y: number): void {
    const d = this.drag;
    const state = this.state;
    if (!d || !state || state.finished) return;
    // The last swap has not come back yet: the tower as held is not the one the piece is on.
    if (d.waitSeq !== null) {
      if (state.eventSeq === d.waitSeq) return;
      d.waitSeq = null;
    }
    const at = this.grid.at(x, y);
    if (!at || at.index === d.cell || !this.touching(d.cell, at.index)) return;
    if (d.bumped === at.index) return;
    d.moved = true;
    const seq = state.eventSeq;
    if (this.trySwapPair(d.cell, at.index)) {
      d.cell = at.index;
      d.bumped = null;
      d.waitSeq = seq;
    } else {
      d.bumped = at.index;
    }
  }

  protected override pointerUp(x: number, y: number): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    const at = this.grid.at(x, y);
    if (!at || at.index !== d.cell) return;
    // A tap picks a piece; a tap on a neighbour swaps the two.
    const s = this.selected;
    if (s !== null && this.touching(s, at.index)) {
      this.trySwapPair(s, at.index);
      return;
    }
    if (s === at.index) {
      this.select(null);
      return;
    }
    if (this.state?.cells[at.index]?.kind === 4) {
      sfx.bump();
      this.select(null);
      return;
    }
    sfx.pop(0);
    this.select(at.index);
  }

  protected override pointerCancel(): void {
    this.drag = null;
  }

  // ---- keyboard

  private drawCursor(): void {
    const g = this.grid;
    this.cursorLayer.clear();
    this.app.canvas.setAttribute("data-cursor", `${this.cursor % g.cols},${Math.floor(this.cursor / g.cols)}`);
    if (!this.cursorShown) return;
    const pad = g.cell * 0.06;
    const x = g.x(this.cursor) - g.cell / 2 + pad;
    const y = g.y(this.cursor) - g.cell / 2 + pad;
    // The cursor is the player's: amber, filled faintly once space has picked its piece.
    if (this.picked) this.cursorLayer.roundRect(x, y, g.cell - pad * 2, g.cell - pad * 2, g.cell * 0.22).fill({ color: INK.amber, alpha: 0.18 });
    this.cursorLayer.roundRect(x, y, g.cell - pad * 2, g.cell - pad * 2, g.cell * 0.22).stroke({ width: Math.max(2, g.cell * RING_W), color: INK.amber });
  }

  /**
   * Arrows move the cursor: up and down within a column, left and right to the same row of the next.
   * Q, E, A and D step up-left, up-right, down-left and down-right across the honeycomb, W and S up
   * and down. Space picks the piece under the cursor and the next step swaps it that way. Enter draws now.
   */
  override keyboard(key: string): boolean {
    if (!this.interactive || !this.state) return false;
    const g = this.grid;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const c0 = this.cursor % g.cols;
    const r0 = Math.floor(this.cursor / g.cols);
    const low = g.lowered(c0);
    const diag = (dc: number, up: boolean): readonly [number, number] => [dc, up ? (low ? 0 : -1) : low ? 1 : 0];
    const steps: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      w: [0, -1],
      s: [0, 1],
      q: diag(-1, true),
      e: diag(1, true),
      a: diag(-1, false),
      d: diag(1, false),
    };
    const step = steps[k];
    if (step) {
      const col = c0 + step[0];
      const row = r0 + step[1];
      this.cursorShown = true;
      this.idle = 0;
      this.select(null);
      const inside = col >= 0 && col < g.cols && row >= 0 && row < g.rows;
      if (this.picked) {
        this.picked = false;
        this.drawCursor();
        if (inside) this.trySwapPair(this.cursor, row * g.cols + col);
        else sfx.bump();
        return true;
      }
      if (inside) this.cursor = row * g.cols + col;
      else sfx.bump();
      this.drawCursor();
      return true;
    }
    if (k === " ") {
      this.cursorShown = true;
      this.picked = !this.picked;
      if (this.picked) sfx.pop(0);
      this.drawCursor();
      return true;
    }
    if (k === "Enter") {
      this.tryDraw();
      return true;
    }
    if (k === "Escape" && (this.selected !== null || this.picked)) {
      this.select(null);
      this.picked = false;
      this.drawCursor();
      return true;
    }
    return false;
  }
}
