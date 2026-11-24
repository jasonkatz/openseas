/**
 * The domain board (ADR 0085): one renderer for any puzzle of the domain engine that plays on a
 * grid. It knows no puzzle. It draws a round from its start and its events alone
 * (docs/puzzles/DOMAIN.md, "Board changes"): every piece that arrives, leaves, travels or changes
 * does so because an event said it did, and the board it ends on is held against the round's own
 * (`data-drift` says when the two differ, which is a bug in the rules or here). How anything
 * looks, moves and sounds is the skin's and the theme's: drawings, motion, cues, marks, points,
 * callouts and the beat on the puzzle's moment.
 *
 * It reports input as moves the puzzle declares and never decides what one does: the page asks
 * the engine (CLAUDE.md, "boards is presentation and transport only").
 */
import { Container, Graphics, Sprite } from "pixi.js";
import type { Drawing } from "@openseas/protocol";
import type { CueData } from "@openseas/protocol";
import { applyChanges, boardString, momentOf, type Board, type Change, type ChangeKind, type Direction, type GaugeRead, type Move, type PieceOn, type Place, type PuzzleDoc, type RoundEvent, type Skin, type SkinDrawing, type Theme } from "@openseas/puzzle";
import { playCueData } from "../audio.js";
import { INK } from "../kit/art.js";
import { Grid, KitBoard } from "../kit/board.js";
import { paintDrawing } from "../kit/drawing.js";
import { ease, type Ease } from "../kit/tween.js";
import { fill, inkOf, tokenOf } from "./theme.js";

/** What the board is shown: the round as it stands and what the last entry set off. */
export interface PlayFrame {
  /** Which round this is. A new number is a new round, drawn at once. */
  readonly round: number;
  /** Entries played so far. A frame one past the last plays its events; any other is drawn at once. */
  readonly seq: number;
  readonly board: Board;
  /** What the last entry set off, in order. */
  readonly events: readonly RoundEvent[];
  readonly gauges: Readonly<Record<string, GaugeRead>>;
  /** The round's settings, which size the moment. */
  readonly values: Readonly<Record<string, unknown>>;
}

export interface PlayHooks {
  /** The player made a move. True when the round took it. */
  onMove(move: Move): boolean;
  onFrame(): void;
}

/** The host's ceiling, in ms: what one entry sets off plays for at most this long, and is then snapped to its end. */
const CEILING = 1000;
/** How far into its event the last of many places starts, at most, in places. */
const STAGGER_CAP = 8;

const EASES = { linear: ease.linear, in: ease.inQuad, out: ease.outCubic, "in-out": ease.inOutCubic } as const satisfies Record<string, Ease>;
const STEP: Readonly<Record<Direction, readonly [number, number]>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS: Readonly<Record<string, Direction>> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };

const cellOf = (p: Place | undefined): number | null => (typeof p === "number" ? p : null);

/** What an event's cue is played with: its step, its points, every number it carries, and how many places each places field holds. */
function cueValues(e: RoundEvent): Record<string, number> {
  const out: Record<string, number> = { step: e.step, points: e.points };
  for (const [k, v] of Object.entries(e.fields)) {
    if (typeof v === "number") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.length;
  }
  return out;
}

export class PlayRenderer extends KitBoard<PlayFrame> {
  private readonly grid = new Grid(1, 1);
  private readonly ground = new Graphics();
  private readonly wash = new Graphics();
  private readonly pieces = new Container();
  private readonly clip = new Graphics();
  private readonly mark = new Graphics();
  private readonly sprites = new Map<number, Sprite>();
  /** The board as the events so far have made it. Never copied from the round after its start. */
  private drawn: Board | null = null;
  private cursor = 0;
  private armed: number | null = null;
  private keyed = false;
  private drag: { cell: number; x: number; y: number } | null = null;
  /** True while what is still playing is being finished for a new entry: its sounds and words are not played late. */
  private quiet = false;
  /** When what is playing is snapped to its end, on the board's own clock: the host's ceiling. */
  private deadline = Infinity;
  private readonly swipe: { id: string; place: string; direction: string } | null;
  private readonly tap: { id: string; place: string } | null;

  constructor(
    host: HTMLElement,
    private readonly doc: PuzzleDoc,
    private readonly skin: Skin,
    private readonly theme: Theme,
    private readonly hooks: PlayHooks,
  ) {
    super(host, doc.id, () => hooks.onFrame());
    const field = (m: { fields: Readonly<Record<string, string>> }, type: string): string | undefined => Object.keys(m.fields).find((k) => m.fields[k] === type);
    const swipe = doc.moves.find((m) => m.gesture === "swipe" && Object.keys(m.fields).length === 2 && field(m, "place") && field(m, "direction"));
    const tap = doc.moves.find((m) => m.gesture === "tap" && Object.keys(m.fields).length === 1 && field(m, "place"));
    this.swipe = swipe ? { id: swipe.id, place: field(swipe, "place")!, direction: field(swipe, "direction")! } : null;
    this.tap = tap ? { id: tap.id, place: field(tap, "place")! } : null;
  }

  override setState(state: PlayFrame): void {
    if (this.isReady) {
      this.quiet = true;
      this.tweens.flush();
      this.quiet = false;
    }
    super.setState(state);
  }

  protected build(): void {
    this.pieces.mask = this.clip;
    this.world.addChild(this.ground, this.wash, this.pieces, this.clip, this.mark);
  }

  protected layout(width: number, height: number): void {
    const board = this.drawn ?? this.state?.board;
    if (!board) return;
    this.grid.cols = board.width;
    this.grid.rows = board.height;
    this.grid.fit(width, height, { margin: 10 });
    const { ox, oy } = this.grid;
    this.ground.clear();
    this.paintGround(this.ground, ox, oy, this.grid.width, this.grid.height);
    this.clip.clear().rect(ox, oy, this.grid.width, this.grid.height).fill({ color: INK.cream });
    this.publishGeom(ox, oy, this.grid.cell);
    this.lay(board);
    this.paintWash();
    this.paintMark();
  }

  protected onState(state: PlayFrame, prev: PlayFrame | null): void {
    const next = prev !== null && this.drawn !== null && prev.round === state.round && state.seq === prev.seq + 1;
    if (next) this.playOut(state);
    else if (!(prev !== null && this.drawn !== null && prev.round === state.round && state.seq === prev.seq)) this.snap(state.board);
    this.paintWash();
  }

  /** What is drawn: the board the events made, as one line, with a `!` where a piece is not standing in its cell. */
  protected view(): string {
    if (!this.drawn) return "";
    let adrift = this.sprites.size !== this.drawn.cells.filter(Boolean).length;
    this.drawn.cells.forEach((p, i) => {
      if (!p) return;
      const s = this.sprites.get(p.id);
      if (!s || !s.visible || Math.abs(s.x - this.grid.x(i)) > 0.5 || Math.abs(s.y - this.grid.y(i)) > 0.5) adrift = true;
    });
    return boardString(this.drawn) + (adrift ? "!" : "");
  }

  // ---- drawing

  private texture(piece: PieceOn) {
    const key = piece.kind === undefined ? piece.piece : `${piece.piece}_${piece.kind}`;
    const entry = this.skin.pieces[key];
    let drawing: SkinDrawing | undefined;
    if (entry && "layers" in entry) drawing = entry as SkinDrawing;
    else if (entry && piece.state !== undefined) drawing = (entry as Readonly<Record<string, SkinDrawing>>)[String(piece.state)];
    const size = this.grid.cell;
    if (!drawing) return this.piece(`missing:${key}`, size, "dim", (ctx) => ctx.fillRect(8, 8, 8, 8));
    const d = drawing as unknown as Drawing;
    return this.piece(`${this.doc.id}:${key}:${piece.state ?? ""}`, size, tokenOf(drawing.tint), (ctx) => paintDrawing(ctx, d));
  }

  private sprite(piece: PieceOn): Sprite {
    const s = new Sprite(this.texture(piece));
    s.anchor.set(0.5);
    this.pieces.addChild(s);
    this.sprites.set(piece.id, s);
    return s;
  }

  /** Lay a board out as it stands, with nothing moving. */
  private lay(board: Board): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.drawn = board;
    board.cells.forEach((p, i) => {
      if (p) this.sprite(p).position.set(this.grid.x(i), this.grid.y(i));
    });
    this.touchView();
  }

  private snap(board: Board): void {
    if (board.width !== this.grid.cols || board.height !== this.grid.rows) {
      this.drawn = board;
      this.layout(this.app.screen.width, this.app.screen.height);
    } else this.lay(board);
    this.cursor = Math.min(this.cursor, board.cells.length - 1);
    this.armed = null;
    this.paintMark();
  }

  /** The gauges the skin shows on the board: rows washed in a colour, stronger past the gauge's danger. */
  private paintWash(): void {
    this.wash.clear();
    const gauges = this.skin.board?.gauges;
    if (!gauges || !this.state) return;
    const { ox, oy, cell } = this.grid;
    for (const [id, how] of Object.entries(gauges)) {
      const g = this.state.gauges[id];
      if (!g) continue;
      const rows = Math.max(0, Math.min(this.grid.rows, g.value));
      if (rows === 0) continue;
      const y = how.rows === "bottom" ? oy + (this.grid.rows - rows) * cell : oy;
      const hot = g.danger !== undefined && g.value >= g.danger;
      this.wash.rect(ox, y, this.grid.width, rows * cell).fill({ color: inkOf(how.color), alpha: hot ? 0.22 : 0.1 });
      const edge = how.rows === "bottom" ? y : y + rows * cell;
      this.wash.moveTo(ox, edge).lineTo(ox + this.grid.width, edge).stroke({ width: hot ? 2 : 1, color: inkOf(how.color), alpha: hot ? 1 : 0.6 });
    }
  }

  /** The player's own mark: the cell the keys are on, heavier while a piece is picked up. */
  private paintMark(): void {
    this.mark.clear();
    if (!this.interactive) return;
    const at = this.armed ?? (this.keyed ? this.cursor : null);
    if (at === null) return;
    const { cell } = this.grid;
    const inset = this.armed !== null ? 1.5 : 2.5;
    this.mark
      .roundRect(this.grid.x(at) - cell / 2 + inset, this.grid.y(at) - cell / 2 + inset, cell - inset * 2, cell - inset * 2, Math.max(3, cell * 0.14))
      .stroke({ width: this.armed !== null ? 3 : 1.5, color: inkOf("yours") });
  }

  // ---- playing an entry's events

  private playOut(state: PlayFrame): void {
    const m = this.skin.motion;
    const cut = this.reduced && m.reduced.changes === "cut";
    const ms = (kind: ChangeKind): number => (cut ? 0 : m.changes[kind].ms);
    const stagger = cut ? 0 : m.stagger;

    // When each event starts. Everything in one cascade step plays together, except that an event
    // waits for whatever was last done to a piece or a cell it touches; the next step waits for
    // the whole of the one before.
    const free = new Map<string, number>();
    const plan: { e: RoundEvent; start: number }[] = [];
    let step = state.events[0]?.step ?? 0;
    let stepStart = 0;
    let end = 0;
    for (const e of state.events) {
      if (e.step !== step) {
        step = e.step;
        stepStart = end;
      }
      const keys: string[] = [];
      let leaves = 0;
      let dur = 0;
      for (const c of e.changes) {
        if (c.change === "travel") keys.push(`p${c.id}`, `c${c.from}`, `c${c.to}`);
        else if (c.change === "arrive") keys.push(`c${cellOf(c.at)}`);
        else keys.push(`p${c.id}`, `c${cellOf(c.at)}`);
        dur = Math.max(dur, ms(c.change) + (c.change === "leave" ? Math.min(leaves++, STAGGER_CAP) * stagger : 0));
      }
      let start = stepStart;
      for (const k of keys) start = Math.max(start, free.get(k) ?? 0);
      for (const k of keys) free.set(k, start + dur);
      end = Math.max(end, start + dur);
      plan.push({ e, start });
    }
    const rate = 1;
    this.deadline = end > CEILING ? this.time + CEILING : Infinity;

    // An entry shows at most one callout: the highest ranked it earned.
    let said: RoundEvent | null = null;
    for (const { e } of plan) {
      const rank = this.skin.events[e.id]?.callout;
      if (rank !== undefined && this.skin.texts[`event.${e.id}`] && (said === null || rank < this.skin.events[said.id]!.callout!)) said = e;
    }

    let board = this.drawn!;
    try {
      for (const { e, start } of plan) {
        const at = start * rate;
        this.animate(e.changes, at, rate, ms, stagger);
        this.tweens.after(at, () => this.dress(e, e === said, state.values));
        board = applyChanges(board, e.changes);
      }
    } catch {
      board = state.board;
    }
    this.drawn = board;
    // The board the events made is the round's board, or something is wrong: say so and show the round's.
    if (boardString(board) !== boardString(state.board)) {
      this.app.canvas.dataset.drift = "1";
      this.tweens.clear();
      this.lay(state.board);
    }
  }

  /** One event's board changes, all starting `at` ms from now. */
  private animate(changes: readonly Change[], at: number, rate: number, ms: (kind: ChangeKind) => number, stagger: number): void {
    const m = this.skin.motion.changes;
    const { cell } = this.grid;
    // Pieces that come in over one edge of the same line start in a queue outside it, so they enter in order.
    const queued = new Map<string, number>();
    for (const c of changes) {
      if (c.change !== "arrive" || typeof c.from !== "object" || !("off" in c.from)) continue;
      const cellAt = cellOf(c.at);
      if (cellAt === null) continue;
      const line = c.from.off === "up" || c.from.off === "down" ? `${c.from.off}${cellAt % this.grid.cols}` : `${c.from.off}${Math.floor(cellAt / this.grid.cols)}`;
      queued.set(line, (queued.get(line) ?? 0) + 1);
    }
    let leaves = 0;
    for (const c of changes) {
      if (c.change === "travel") {
        const s = this.sprites.get(c.id);
        if (s) this.tweens.to(s, { x: this.grid.x(c.to), y: this.grid.y(c.to) }, ms("travel") * rate, { delay: at, ease: EASES[m.travel.ease ?? "out"] });
      } else if (c.change === "leave") {
        const s = this.sprites.get(c.id);
        if (!s) continue;
        this.sprites.delete(c.id);
        const delay = at + Math.min(leaves++, STAGGER_CAP) * stagger * rate;
        this.tweens.to(s, m.leave.as === "fade" ? { alpha: 0 } : { scale: 0 }, ms("leave") * rate, { delay, ease: EASES[m.leave.ease ?? "out"], done: () => s.destroy() });
      } else if (c.change === "arrive") {
        const cellAt = cellOf(c.at);
        if (cellAt === null) continue;
        const s = this.sprite(c.piece);
        const x = this.grid.x(cellAt);
        const y = this.grid.y(cellAt);
        s.visible = false;
        if (typeof c.from === "object" && "off" in c.from) {
          const line = c.from.off === "up" || c.from.off === "down" ? `${c.from.off}${cellAt % this.grid.cols}` : `${c.from.off}${Math.floor(cellAt / this.grid.cols)}`;
          const n = queued.get(line) ?? 1;
          const [dx, dy] = STEP[c.from.off];
          s.position.set(x + dx * n * cell, y + dy * n * cell);
        } else {
          s.position.set(x, y);
          s.scale.set(0);
        }
        this.tweens.after(at, () => (s.visible = true));
        this.tweens.to(s, { x, y, scale: 1 }, ms("arrive") * rate, { delay: at, ease: EASES[m.arrive.ease ?? "out"] });
      } else {
        const s = this.sprites.get(c.id);
        const was = cellOf(c.at) === null ? null : this.drawn?.cells[cellOf(c.at)!];
        if (!s || !was) continue;
        // The piece as it will be once this change and those before it are made.
        const becomes: PieceOn = { ...was, ...c.becomes };
        this.tweens.after(at, () => (s.texture = this.texture(becomes)));
      }
    }
  }

  /** What an event looks and sounds like as it starts, besides its board changes: the skin's cues, marks, points and callout, and the beat on the moment. */
  private dress(e: RoundEvent, say: boolean, values: Readonly<Record<string, unknown>>): void {
    this.touchView();
    if (this.quiet) return;
    const how = this.skin.events[e.id];
    const { cell } = this.grid;
    const places = (field: string | undefined): number[] => {
      const v = field === undefined ? undefined : e.fields[field];
      return (Array.isArray(v) ? v : [v]).filter((p): p is number => typeof p === "number");
    };
    for (const name of how?.cues ?? []) {
      const cue = this.skin.cues[name];
      if (cue) playCueData(name, cue as unknown as CueData, cueValues(e));
    }
    for (const mark of how?.marks ?? []) {
      const at = places("ring" in mark ? mark.ring : mark.line);
      if ("ring" in mark) for (const p of at) this.fx.ring(this.grid.x(p), this.grid.y(p), INK.cream, cell * 0.35, cell * 1.2);
      else this.fx.beam(at.flatMap((p) => [this.grid.x(p), this.grid.y(p)]), INK.cream);
    }
    if (e.points > 0 && how?.points !== undefined) {
      const at = places(how.points);
      if (at.length > 0) {
        const x = at.reduce((sum, p) => sum + this.grid.x(p), 0) / at.length;
        const y = at.reduce((sum, p) => sum + this.grid.y(p), 0) / at.length;
        this.fx.popup(x, y, `+${e.points}`, INK.cream, Math.max(16, cell * 0.42));
      }
    }
    if (say) this.fx.say(fill(this.skin.texts[`event.${e.id}`]!, e.fields));
    const size = momentOf(this.doc, values, e);
    if (size !== null) {
      const b = this.skin.motion.beat;
      const beat = this.skin.cues["beat"] as unknown as CueData | undefined;
      this.fx.beatAs(size, {
        ms: b.ms,
        color: inkOf(b.color),
        from: b.strength.from,
        to: b.strength.to,
        sound: (strength) => beat && playCueData("beat", beat, { strength }),
      });
    }
  }

  /** Past the ceiling, whatever is still playing is snapped to its end, without its sounds and words. */
  protected override update(): void {
    if (this.time < this.deadline) return;
    this.deadline = Infinity;
    this.quiet = true;
    this.tweens.flush();
    this.quiet = false;
    this.touchView();
  }

  // ---- input

  private neighbour(cell: number, to: Direction): number | null {
    const [dx, dy] = STEP[to];
    const c = (cell % this.grid.cols) + dx;
    const r = Math.floor(cell / this.grid.cols) + dy;
    return c < 0 || c >= this.grid.cols || r < 0 || r >= this.grid.rows ? null : r * this.grid.cols + c;
  }

  private swipeFrom(cell: number, to: Direction): void {
    this.armed = null;
    // A board that is still settling takes no touch: the move is dropped.
    if (!this.busy && this.swipe && this.hooks.onMove({ id: this.swipe.id, [this.swipe.place]: cell, [this.swipe.direction]: to })) {
      // The cursor follows the piece it moved.
      this.cursor = this.neighbour(cell, to) ?? cell;
    }
    this.paintMark();
  }

  /** A cell was pressed and let go, by a tap or the pick key. */
  private pick(cell: number): void {
    this.cursor = cell;
    if (!this.swipe) {
      if (this.tap && !this.busy) this.hooks.onMove({ id: this.tap.id, [this.tap.place]: cell });
    } else if (this.armed !== null && this.armed !== cell) {
      // A piece picked up and then its neighbour: the swipe from one to the other.
      const to = (Object.keys(STEP) as Direction[]).find((d) => this.neighbour(this.armed!, d) === cell);
      if (to) return this.swipeFrom(this.armed, to);
      this.armed = cell;
    } else this.armed = this.armed === cell ? null : cell;
    this.paintMark();
  }

  protected override pointerDown(x: number, y: number): void {
    const hit = this.grid.at(x, y);
    this.keyed = false;
    this.drag = hit ? { cell: hit.index, x, y } : null;
    if (!hit) {
      this.armed = null;
      this.paintMark();
    }
  }

  protected override pointerMove(x: number, y: number): void {
    const d = this.drag;
    if (!d || !this.swipe) return;
    const dx = x - d.x;
    const dy = y - d.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.grid.cell * 0.35) return;
    this.drag = null;
    this.swipeFrom(d.cell, Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  }

  protected override pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (d && this.interactive) this.pick(d.cell);
  }

  protected override pointerCancel(): void {
    this.drag = null;
  }

  protected override onInteractive(on: boolean): void {
    if (!on) this.armed = null;
    this.paintMark();
  }

  override keyboard(key: string): boolean {
    if (!this.interactive || !this.drawn) return false;
    const to = KEYS[key];
    if (to) {
      this.keyed = true;
      if (this.armed !== null) this.swipeFrom(this.armed, to);
      else {
        this.cursor = this.neighbour(this.cursor, to) ?? this.cursor;
        this.paintMark();
      }
      return true;
    }
    if (key === " " || key === "Enter") {
      this.keyed = true;
      this.pick(this.cursor);
      return true;
    }
    if (key === "Escape" && this.armed !== null) {
      this.armed = null;
      this.paintMark();
      return true;
    }
    return false;
  }
}
