import { sfx } from "../audio.js";
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  swordfightBoardString,
  swordfightIdx,
  swordfightLandingCells,
  swordfightSpawnCol,
  type Slab,
  type SwordBoard,
  type SwordCell,
  type SwordPair,
  type SwordRotation,
  type SwordfightConfig,
  type SwordfightEvent,
  type SwordfightState,
} from "@openseas/engine";
import type { SwordfightContent } from "@openseas/content";
import { FONT, MOTION, ink, type PieceColor } from "../look/tokens.js";
import { blockCanvas, paintBlock, scrapStage, type BlockCut, type BlockStyle } from "./art.js";
import { boardSurface } from "../surface.js";

/** A board in the melee that is not in this fight's state: another pirate's, or a raider's run by the server. */
export interface RemoteBoard {
  readonly key: string;
  readonly name: string;
  readonly side: 0 | 1;
  /** Row-major, top row first: `.` empty, 0-5 a color, A-F a breaker, `#` scrap. */
  readonly cells: string;
  readonly pending: number;
  readonly out: boolean;
  readonly points: number;
}

/** What the engine said to a rest: taken, not yet (too soon after the pair appeared), or never there. */
export type PlaceAnswer = "placed" | "wait" | "refused";

export interface SwordfightCallbacks {
  /** The player's pair came to rest. "wait" means the engine will take it shortly and the board asks again. */
  onPlace(col: number, rot: SwordRotation): PlaceAnswer;
  /** First frame drawn after a new state arrived. */
  onFrame(): void;
  /** Fresh events as they are shown, for sound. */
  onEvents(events: readonly SwordfightEvent[]): void;
  /** The pair moved or turned: a soft tick. */
  onNudge(): void;
}

export interface SwordfightRendererOptions {
  /** Ms per row while the player hurries the pair. Free fall is the config's fallTicks * tickMs. */
  softDropMs: number;
  labels: {
    you: string;
    foe(n: number): string;
    ally(n: number): string;
    next: string;
    incoming: string;
    shatter: string;
    slab: string;
    chain(chain: number): string;
    scrapOver(scrap: number): string;
    scrapIn: string;
    out: string;
    won: string;
    lost: string;
  };
}

/** What the board shows, for the smoke test: the player's board. */
export function swordfightViewString(state: SwordfightState): string {
  return state.config.player ? swordfightBoardString(state.config, state.boards[0]!.cells) : "";
}

/** Something that slides to where it belongs: a move is one eased slide of `MOVE_MS`, however far. */
interface Slider {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** The slide under way: where it began, where it is bound, and how long it has run. */
  sx: number;
  sy: number;
  gx: number;
  gy: number;
  t: number;
}

interface PieceView extends Slider {
  s: Sprite;
  kind: SwordCell["kind"];
  color: number;
  /** Scrap: the drops left before it ripens, which picks its look. 0 otherwise. */
  ripen: number;
  dying: number | null;
}

/** A slab's `x` and `y` are its top-left corner; its sprite is anchored at its middle so it shrinks there. */
interface SlabView extends Slider {
  s: Sprite;
  color: number;
  w: number;
  h: number;
  dying: number | null;
}

/** A board beside the player's as a snapshot: its cells as a string, and its slabs where the fight's state knows them. */
interface MiniModel {
  key: string;
  name: string;
  side: 0 | 1;
  cells: string;
  /** Slabs with `row` counted from the top. Absent for a board from outside this state, whose slabs are read off its cells. */
  slabs?: ReadonlyArray<{ col: number; row: number; w: number; h: number }>;
  pending: number;
  out: boolean;
  points: number;
}

interface Mini extends MiniModel {
  g: Graphics;
  s: Sprite;
  over: Graphics;
  label: Text;
  pendingLabel: Text;
  /** What the sprite's texture was painted from, so it is repainted only when the board changed. */
  painted: string;
  x: number;
  y: number;
  cell: number;
}

interface Popup {
  t: Text;
  life: number;
  max: number;
  y0: number;
}

/** One mark crossing from a board to another: scrap on its way. */
interface Mark {
  x: number;
  y: number;
  to: { x: number; y: number };
  life: number;
}

type Step = () => number | "settle";

/** Every colour the board draws, from the game's one palette (docs/BRAND.md section 2). */
const COLORS = {
  ground: ink("ground"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  amber: ink("amber"),
  danger: ink("danger"),
  slate: ink("slate"),
};
const MOVE_MS = MOTION.move;
const CLEAR_MS = MOTION.clear;
const DIE_MS = MOTION.clear;
const BEAT_MS = MOTION.beat;
/** A mark of scrap crossing to another board. */
const MARK_MS = MOTION.panel * 2;
const LOCK_MS = 350;
/** A finger held still this long hurries the pair: long enough that the start of a swipe or a drag does not. */
const HOLD_MS = 60;
const MAX_LOCK_RESETS = 3;
/** The strip above the well, in cells: tall enough for the next pair stacked the way it falls. */
const STRIP_ROWS = 1.6;
/** A mini board's cell as a share of the player's: the other boards sit small in the margin so the player's board is the thing. */
const MINI_SCALE = 0.3;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** A slider at rest at (`x`, `y`). */
const at = (x: number, y: number): Slider => ({ x, y, tx: x, ty: y, sx: x, sy: y, gx: x, gy: y, t: 0 });

/** Where the two halves sit for a pivot column (a's column), rotation and a's row. */
function halves(pc: number, rot: SwordRotation, row: number): { a: [number, number]; b: [number, number] } {
  switch (rot) {
    case 0:
      return { a: [pc, row], b: [pc + 1, row] };
    case 1:
      return { a: [pc, row], b: [pc, row + 1] };
    case 2:
      return { a: [pc, row], b: [pc - 1, row] };
    default:
      return { a: [pc, row], b: [pc, row - 1] };
  }
}
const anchorOf = (pc: number, rot: SwordRotation): number => (rot === 2 ? pc - 1 : pc);

/**
 * The slabs in a board seen only as its cells, rows from the top. Blocks of one colour in a two by
 * two always fuse and a slab takes a full strip beside it, so a rectangle of one colour grown from
 * its top-left corner is a slab; two slabs of one colour side by side read as one, which is close enough at this size.
 */
function slabsIn(rows: string, width: number, height: number): Array<{ col: number; row: number; w: number; h: number }> {
  const used = new Set<number>();
  const out: Array<{ col: number; row: number; w: number; h: number }> = [];
  const is = (c: number, r: number, ch: string): boolean => c < width && r < height && rows[r * width + c] === ch && !used.has(r * width + c);
  for (let r = 0; r < height - 1; r++) {
    for (let c = 0; c < width - 1; c++) {
      const ch = rows[r * width + c]!;
      if (ch < "0" || ch > "9" || !is(c, r, ch) || !is(c + 1, r, ch) || !is(c, r + 1, ch) || !is(c + 1, r + 1, ch)) continue;
      let w = 2;
      let h = 2;
      while (is(c + w, r, ch) && is(c + w, r + 1, ch)) w++;
      const full = (rr: number): boolean => Array.from({ length: w }, (_, k) => is(c + k, rr, ch)).every(Boolean);
      while (full(r + h)) h++;
      for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) used.add(rr * width + cc);
      out.push({ col: c, row: r, w, h });
    }
  }
  return out;
}

export class SwordfightRenderer {
  readonly app = new Application();
  private readonly board = new Container();
  private readonly well = new Graphics();
  /** The entry's warning, over the pieces: a ring once the stack is near it. */
  private readonly entryG = new Graphics();
  private readonly ghost = new Graphics();
  private readonly pieceLayer = new Container();
  private readonly slabLayer = new Container();
  private readonly fallingLayer = new Container();
  private readonly fxG = new Graphics();
  private readonly fxLayer = new Container();
  private readonly stripLayer = new Container();
  private readonly stripG = new Graphics();
  private readonly beatLayer = new Graphics();
  /** The well's shape: the falling pair is clipped to it, so a pair slides in from above the board. */
  private readonly wellMask = new Graphics();
  /** Ms without a pair in hand while one is due, and ms a taken pair has waited for its state. */
  private idleMs = 0;
  private placedMs = 0;
  private readonly nextA = new Sprite(Texture.WHITE);
  private readonly nextB = new Sprite(Texture.WHITE);
  private nextText: Text | null = null;
  private incomingText: Text | null = null;
  private readonly miniLayer = new Container();
  private readonly textures = new Map<string, Texture>();
  private readonly pieces = new Map<number, PieceView>();
  private readonly slabs = new Map<number, SlabView>();
  private minis: Mini[] = [];
  private remote: readonly RemoteBoard[] = [];
  private popups: Popup[] = [];
  private marks: Mark[] = [];
  /** The beat: one amber pulse of the whole board for a big moment (docs/BRAND.md section 6). */
  private beatNow: { life: number; strength: number } | null = null;
  private readonly styles: Array<{ color: PieceColor; cut: BlockCut }> = [];
  private readonly reduced = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  private cell = 40;
  private pad = 8;
  private ox = 0;
  private oy = 0;
  private strip = 0;
  private width = 6;
  private height = 12;
  private state: SwordfightState | null = null;
  /** The player's board as shown: cells and slabs as of the last played step. */
  private cells: Array<SwordCell | null> = [];
  private shownSlabs: Slab[] = [];
  private steps: Step[] = [];
  private waitMs = 0;
  private waitSettle = 0;
  private moving = false;
  private framePending = false;
  private viewStale = true;
  private destroyed = false;
  private interactive = false;
  private shownTick = -1;
  private shownMoves = -1;
  /** Events already shown, per tick and board: how many of that pair's events have been played. */
  private seen = new Map<string, number>();
  /** `placed` is set once the engine took the pair: it then waits for the state that replaces it, so a rest is never logged twice. */
  private falling: { pair: SwordPair; pc: number; rot: SwordRotation; row: number; a: Sprite; b: Sprite; lock: number; resets: number; low: number; refused: number; placed: boolean; drops: number } | null = null;
  private softDrop = false;
  private drag: { x: number; y: number; pc: number; moved: boolean; hurried: boolean; turned: boolean; touch: boolean; held: number; far: boolean } | null = null;

  constructor(
    private readonly host: HTMLElement,
    content: SwordfightContent,
    private readonly cb: SwordfightCallbacks,
    private readonly opts: SwordfightRendererOptions,
  ) {
    for (const p of content.pieces) this.styles.push({ color: p.color, cut: p.cut });
    this.width = content.config.width;
    this.height = content.config.height;
  }

  private styleFor(color: number, kind: SwordCell["kind"], ripen?: number): BlockStyle {
    const st = this.styles[Math.max(0, color)] ?? { color: "cream" as const, cut: "dot" as const };
    return { color: st.color, cut: st.cut, kind, ...(ripen === undefined ? {} : { ripen }) };
  }

  async init(): Promise<void> {
    // Points and callouts are drawn as text, so wait (briefly) for the webfont. Before the renderer
    // is made, not after: the board hands over a state as soon as there is one, and by then the layout must be in.
    await Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 800))]).catch(() => undefined);
    if (this.destroyed) return;
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      ...boardSurface(),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    // No atlas to wait for: the pieces are drawn in code (ADR 0062). The studio's thumbnails read this.
    this.app.canvas.dataset.pieces = "drawn";
    this.app.canvas.style.touchAction = "none";
    this.app.canvas.setAttribute("data-testid", "swordfight-canvas");
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.host.appendChild(this.app.canvas);
    this.nextA.anchor.set(0.5);
    this.nextB.anchor.set(0.5);
    this.nextText = new Text({ text: this.opts.labels.next, style: { fontFamily: FONT.body, fontSize: 13, fill: COLORS.dim }, resolution: 2 });
    this.nextText.anchor.set(0, 0.5);
    this.incomingText = new Text({ text: "", style: { fontFamily: FONT.mono, fontSize: 16, fontWeight: "700", fill: COLORS.danger }, resolution: 2 });
    this.incomingText.anchor.set(1, 0.5);
    this.stripLayer.addChild(this.stripG, this.nextText, this.nextA, this.nextB, this.incomingText);
    this.fallingLayer.mask = this.wellMask;
    this.fxLayer.addChild(this.fxG);
    this.board.addChild(this.well, this.ghost, this.pieceLayer, this.slabLayer, this.wellMask, this.fallingLayer, this.entryG, this.beatLayer, this.fxLayer, this.stripLayer);
    this.app.stage.addChild(this.board, this.miniLayer);
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
      for (const tex of this.textures.values()) tex.destroy(true);
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.drag = null;
      this.softDrop = false;
      this.dropFalling();
    } else if (this.state && !this.falling && this.steps.length === 0) this.spawnFalling();
  }

  /** Boards from outside this fight's state, beside the player's. */
  setRemote(boards: readonly RemoteBoard[]): void {
    this.remote = boards;
    if (this.app.renderer) this.syncMinis();
  }

  // ---- state

  setState(state: SwordfightState): void {
    if (!this.app.renderer) return;
    const first = !this.state;
    const sizeChanged = this.state !== null && (this.state.config.width !== state.config.width || this.state.config.height !== state.config.height);
    // A different fight at the same tick and move count (a practice page swaps its placeholder for
    // the real round at tick 0) still resets: with no move logged, the player's pair in hand only
    // changes when the fight does, and a pair already falling would keep the old fight's colors.
    const prevPlayer = this.state?.config.player ? this.state.boards[0] : null;
    const otherFight = prevPlayer !== null && prevPlayer !== undefined && state.config.player && state.moveCount === 0 && this.shownMoves === 0 && state.boards[0]!.current !== prevPlayer.current;
    const reset = first || sizeChanged || otherFight || state.tick < this.shownTick || state.moveCount < this.shownMoves;
    this.state = state;
    this.framePending = true;
    this.viewStale = true;
    if (sizeChanged) {
      this.width = state.config.width;
      this.height = state.config.height;
      this.layout();
    }
    const player = state.config.player ? state.boards[0]! : null;
    if (reset) {
      this.finishSteps();
      this.steps = [];
      this.seen.clear();
      this.popups.forEach((p) => p.t.destroy());
      this.popups = [];
      this.marks = [];
      this.beatNow = null;
      this.cells = player ? player.cells.slice() : [];
      this.shownSlabs = player ? player.slabs.slice() : [];
      this.place(true);
      this.dropFalling();
      this.shownTick = state.tick;
      this.shownMoves = state.moveCount;
      this.syncMinis();
      this.updateStrip();
      if (this.interactive && player && !player.out && !state.finished) this.spawnFalling();
      return;
    }
    // Which of the report's events are new: the display is advanced every tick between logged
    // moves, and a logged move's report repeats what those advances already showed.
    const fresh: SwordfightEvent[] = [];
    const counts = new Map<string, number>();
    for (const e of state.lastMove?.events ?? []) {
      const key = `${e.tick}:${e.board}`;
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      if (n >= (this.seen.get(key) ?? 0)) fresh.push(e);
    }
    for (const [key, n] of counts) this.seen.set(key, Math.max(n, this.seen.get(key) ?? 0));
    for (const key of [...this.seen.keys()]) if (Number(key.split(":")[0]) < state.tick - 100) this.seen.delete(key);
    this.shownTick = state.tick;
    this.shownMoves = state.moveCount;
    if (fresh.length) this.cb.onEvents(fresh);
    this.enqueue(state, fresh);
    this.syncMinis();
    this.updateStrip();
  }

  /** Steps for the player's board, in the order things happened. Other boards are shown from the state. */
  private enqueue(state: SwordfightState, fresh: readonly SwordfightEvent[]): void {
    const player = state.config.player ? state.boards[0]! : null;
    if (!player) return;
    const own = fresh.filter((e) => e.board === 0 || (e.type === "attack" && e.to === 0));
    if (own.length === 0 && this.steps.length === 0) {
      // Nothing happened on the player's board; keep what is shown but refresh textures that may have changed.
      this.cells = player.cells.slice();
      this.shownSlabs = player.slabs.slice();
      this.place(false);
      if (this.interactive && !this.falling && !player.out && !state.finished) this.spawnFalling();
      return;
    }
    for (const e of own) {
      switch (e.type) {
        case "placed": {
          const ev = e;
          this.steps.push(() => {
            this.landFalling(ev.cells, ev.ids, player);
            sfx.cue("drop", sfx.bump);
            return "settle";
          });
          break;
        }
        case "fused": {
          const ev = e;
          this.steps.push(() => {
            for (const s of ev.slabs) {
              this.shownSlabs = [...this.shownSlabs.filter((x) => x.id !== s.id), s];
              for (let r = s.row; r < s.row + s.h; r++) {
                for (let c = s.col; c < s.col + s.w; c++) {
                  const i = swordfightIdx(state.config, c, r);
                  const cell = this.cells[i];
                  if (cell) this.cells[i] = { ...cell, slab: s.id };
                }
              }
            }
            this.place(false);
            if (ev.slabs.some((s) => s.w * s.h >= 6)) this.callout(this.opts.labels.slab, COLORS.cream);
            return this.reduced ? 40 : MOVE_MS;
          });
          break;
        }
        case "broke": {
          const ev = e;
          this.steps.push(() => {
            // The largest slab this break takes: the puzzle's compound move is a big one shattered.
            let slabCells = 0;
            for (const g of ev.groups) {
              const slabsHit = new Set<number>();
              for (let k = 0; k < g.cells.length; k++) {
                const cell = this.cells[g.cells[k]!];
                if (cell?.slab) slabsHit.add(cell.slab);
                const v = this.pieces.get(g.ids[k]!);
                if (v) v.dying = 0;
              }
              for (const id of slabsHit) {
                const v = this.slabs.get(id);
                if (!v) continue;
                v.dying = 0;
                slabCells = Math.max(slabCells, v.w * v.h);
              }
              const mid = g.cells[Math.floor(g.cells.length / 2)]!;
              this.popup(this.cx(mid % this.width), this.cy(Math.floor(mid / this.width)) - this.cell * 0.2, `+${Math.round((g.points * ev.groups.length * ev.chain) || g.points)}`);
            }
            const big = ev.chain >= 2 || ev.groups.reduce((n, g) => n + g.cells.length, 0) >= 6;
            if (ev.chain >= 2) this.callout(this.opts.labels.chain(ev.chain), COLORS.cream);
            else if (big) this.callout(this.opts.labels.shatter, COLORS.cream);
            // The beat: a slab of six or more shattered, or a chain. A bigger slab or a longer chain is a stronger pulse.
            if (slabCells >= 6 || ev.chain >= 2) this.beat(0.5 + Math.min(0.5, Math.max((slabCells - 6) / 12, (ev.chain - 2) * 0.25)));
            // The beat has one sound of its own: where this break is the beat, these give way to it.
            if (big) sfx.cue("heavy", () => { sfx.zap(); sfx.thud(); });
            else sfx.cue("clash", sfx.zap);
            return this.reduced ? 60 : CLEAR_MS;
          });
          break;
        }
        case "settled": {
          const ev = e;
          this.steps.push(() => {
            for (const g of this.pieces.values()) if (g.dying !== null) this.kill(g);
            for (const v of this.slabs.values()) if (v.dying !== null) this.killSlab(v);
            this.cells = ev.cells.slice();
            this.shownSlabs = ev.slabs.slice();
            this.place(false);
            return "settle";
          });
          break;
        }
        case "ripened": {
          const ev = e;
          this.steps.push(() => {
            for (let k = 0; k < ev.ids.length; k++) {
              const id = ev.ids[k]!;
              const color = ev.colors[k]!;
              const i = this.cells.findIndex((c) => c?.id === id);
              if (i >= 0) this.cells[i] = { ...this.cells[i]!, kind: "block", color, ripen: 0 };
              const v = this.pieces.get(id);
              if (v) {
                v.kind = "block";
                v.color = color;
                v.ripen = 0;
                v.s.texture = this.texture(color, "block", 1, 1);
              }
            }
            return this.reduced ? 40 : CLEAR_MS;
          });
          break;
        }
        case "attack": {
          const ev = e;
          if (ev.board !== 0) {
            // Scrap coming our way from a board in the fight.
            this.steps.push(() => {
              this.callout(this.opts.labels.scrapIn, COLORS.danger);
              const from = this.minis.find((m) => m.key === `board:${ev.board}`);
              if (from) this.fly(from.x + (from.cell * this.width) / 2 - this.ox, from.y - this.oy, this.width * this.cell * 0.8, -this.strip / 2);
              return 0;
            });
            break;
          }
          this.steps.push(() => {
            if (ev.scrap > 0) {
              this.callout(this.opts.labels.scrapOver(ev.scrap), COLORS.cream, true);
              sfx.cue("swing", sfx.whoosh);
              const to = ev.to >= 0 ? this.minis.find((m) => m.key === `board:${ev.to}`) : null;
              const target = to ? { x: to.x + (to.cell * this.width) / 2 - this.ox, y: to.y + (to.cell * this.height) / 2 - this.oy } : { x: (this.width * this.cell) / 2, y: -this.strip * 3 };
              this.fly((this.width * this.cell) / 2, (this.height * this.cell) * 0.4, target.x, target.y);
            }
            return 0;
          });
          break;
        }
        case "landed": {
          const ev = e;
          this.steps.push(() => {
            for (let k = 0; k < ev.cells.length; k++) {
              const i = ev.cells[k]!;
              const col = i % this.width;
              const row = Math.floor(i / this.width);
              const cell: SwordCell = { id: ev.ids[k]!, color: ev.colors[k] ?? 0, kind: "scrap", ripen: state.config.ripenMoves, slab: 0 };
              this.cells[i] = cell;
              const v = this.spawn(cell, this.cx(col), this.cy(this.height + 1 + (k % 3)));
              v.tx = this.cx(col);
              v.ty = this.cy(row);
            }
            this.moving = true;
            this.drawEntry();
            sfx.cue("scrap", sfx.thud);
            return "settle";
          });
          break;
        }
        case "out": {
          this.steps.push(() => {
            this.callout(this.opts.labels.out, COLORS.danger);
            sfx.cue("out", sfx.bad);
            this.dropFalling();
            return this.reduced ? 100 : 500;
          });
          break;
        }
        case "ended": {
          const ev = e;
          this.steps.push(() => {
            this.callout(ev.outcome === "won" ? this.opts.labels.won : this.opts.labels.lost, ev.outcome === "won" ? COLORS.cream : COLORS.danger);
            // Winning the fight is the beat at its strongest.
            if (ev.outcome === "won") this.beat(1);
            if (ev.outcome === "won") sfx.cue("won", sfx.end);
            else sfx.cue("lost", sfx.streakLost);
            this.dropFalling();
            return 0;
          });
          break;
        }
        default:
          break;
      }
    }
    // Finally the state's own truth, in case a step was skipped.
    this.steps.push(() => {
      this.cells = player.cells.slice();
      this.shownSlabs = player.slabs.slice();
      this.place(false);
      this.refitFalling();
      if (this.interactive && !this.falling && !player.out && !state.finished) this.spawnFalling();
      return 0;
    });
  }

  private finishSteps(): void {
    while (this.steps.length) this.steps.shift()!();
    this.waitMs = 0;
    this.waitSettle = 0;
    for (const v of this.pieces.values()) {
      v.x = v.tx;
      v.y = v.ty;
      v.s.position.set(v.x, v.y);
      if (v.dying !== null) this.kill(v);
    }
    for (const v of this.slabs.values()) {
      v.x = v.tx;
      v.y = v.ty;
      this.putSlab(v);
      if (v.dying !== null) this.killSlab(v);
    }
  }

  // ---- views of the player's board

  /** Put a sprite on every loose cell and a slab sprite on every slab, moving existing ones toward their new cells. */
  private place(snap: boolean): void {
    const seen = new Set<number>();
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (!c || c.slab) continue;
      seen.add(c.id);
      const x = this.cx(i % this.width);
      const y = this.cy(Math.floor(i / this.width));
      let v = this.pieces.get(c.id);
      if (!v) v = this.spawn(c, x, y);
      else if (v.kind !== c.kind || v.color !== c.color || v.ripen !== c.ripen) {
        // Scrap a drop closer to ripening changes its look: the texture is keyed on the drops left too.
        v.kind = c.kind;
        v.color = c.color;
        v.ripen = c.ripen;
        v.s.texture = this.texture(c.color, c.kind, 1, 1, c.ripen);
      }
      v.tx = x;
      v.ty = y;
      if (snap) {
        v.x = x;
        v.y = y;
        v.s.position.set(x, y);
      } else if (v.x !== x || v.y !== y) this.moving = true;
    }
    for (const [id, v] of this.pieces) if (!seen.has(id) && v.dying === null) this.kill(v);
    const seenSlabs = new Set<number>();
    for (const s of this.shownSlabs) {
      seenSlabs.add(s.id);
      const x = s.col * this.cell;
      const y = (this.height - s.row - s.h) * this.cell;
      let v = this.slabs.get(s.id);
      if (!v) {
        // A slab that has just fused appears where its blocks were.
        const sprite = new Sprite(this.texture(s.color, "block", s.w, s.h));
        sprite.anchor.set(0.5);
        this.slabLayer.addChild(sprite);
        v = { ...at(x, y), s: sprite, color: s.color, w: s.w, h: s.h, dying: null };
        this.slabs.set(s.id, v);
        this.putSlab(v);
      } else if (v.w !== s.w || v.h !== s.h || v.color !== s.color) {
        v.w = s.w;
        v.h = s.h;
        v.color = s.color;
        v.s.texture = this.texture(s.color, "block", s.w, s.h);
      }
      v.tx = x;
      v.ty = y;
      if (snap) {
        v.x = x;
        v.y = y;
        this.putSlab(v);
      } else if (v.x !== x || v.y !== y) this.moving = true;
    }
    for (const [id, v] of this.slabs) if (!seenSlabs.has(id) && v.dying === null) this.killSlab(v);
    this.drawEntry();
  }

  private putSlab(v: SlabView): void {
    v.s.position.set(v.x + (v.w * this.cell) / 2, v.y + (v.h * this.cell) / 2);
  }

  private spawn(c: SwordCell, x: number, y: number): PieceView {
    const sprite = new Sprite(this.texture(c.color, c.kind, 1, 1, c.ripen));
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    this.pieceLayer.addChild(sprite);
    const v: PieceView = { ...at(x, y), s: sprite, kind: c.kind, color: c.color, ripen: c.ripen, dying: null };
    this.pieces.set(c.id, v);
    return v;
  }

  private kill(v: PieceView): void {
    for (const [id, p] of this.pieces) if (p === v) this.pieces.delete(id);
    v.s.destroy({ children: true });
  }

  private killSlab(v: SlabView): void {
    for (const [id, p] of this.slabs) if (p === v) this.slabs.delete(id);
    v.s.destroy();
  }

  /** The texture for a block; `ripen` is the drops left on scrap, which picks its look. */
  private texture(color: number, kind: SwordCell["kind"], w: number, h: number, ripen = 0): Texture {
    const scrap = kind === "scrap";
    const stage = !scrap ? "" : scrapStage(ripen) === "hint" ? "hint" : `stone${ripen}`;
    // Stone counting down has no colour yet, so one texture serves every colour.
    const key = `${scrap && stage !== "hint" ? "" : color}:${kind}:${stage}:${w}x${h}:${this.cell}`;
    let t = this.textures.get(key);
    if (!t) {
      const r = this.app.renderer;
      const canvas = blockCanvas(this.cell, w, h, this.styleFor(color, kind, scrap ? ripen : undefined), r.resolution);
      t = new Texture({ source: new CanvasSource({ resource: canvas, resolution: r.resolution }) });
      this.textures.set(key, t);
    }
    return t;
  }

  /** Repaint every sprite at the current cell size. */
  private bake(): void {
    const old = [...this.textures.values()];
    this.textures.clear();
    for (const v of this.pieces.values()) v.s.texture = this.texture(v.color, v.kind, 1, 1, v.ripen);
    for (const v of this.slabs.values()) v.s.texture = this.texture(v.color, "block", v.w, v.h);
    this.paintFalling();
    this.updateStrip();
    for (const t of old) t.destroy(true);
  }

  // ---- the falling pair

  private spawnFalling(): void {
    const s = this.state;
    if (!s || !s.config.player || this.falling || s.finished) return;
    const b = s.boards[0]!;
    if (b.out) return;
    const pc = swordfightSpawnCol(s.config);
    // The pair starts above the well and slides in; only the top cell of its column can bar it.
    const row = this.height;
    if (!this.fits(pc, 1, row)) return;
    const a = new Sprite(this.texture(b.current.a.color, b.current.a.breaker ? "breaker" : "block", 1, 1));
    const bb = new Sprite(this.texture(b.current.b.color, b.current.b.breaker ? "breaker" : "block", 1, 1));
    a.anchor.set(0.5);
    bb.anchor.set(0.5);
    this.fallingLayer.addChild(a, bb);
    this.falling = { pair: b.current, pc, rot: 1, row, a, b: bb, lock: 0, resets: 0, low: row, refused: 0, placed: false, drops: b.drops };
    this.softDrop = false;
    this.idleMs = 0;
    this.placedMs = 0;
    this.positionFalling();
  }

  /** Dress the falling sprites in the pair they were dealt, with textures that are alive. */
  private paintFalling(): void {
    const f = this.falling;
    if (!f) return;
    const a = this.texture(f.pair.a.color, f.pair.a.breaker ? "breaker" : "block", 1, 1);
    const b = this.texture(f.pair.b.color, f.pair.b.breaker ? "breaker" : "block", 1, 1);
    if (f.a.texture !== a) f.a.texture = a;
    if (f.b.texture !== b) f.b.texture = b;
    f.a.visible = f.b.visible = true;
  }

  private dropFalling(): void {
    if (!this.falling) return;
    this.falling.a.destroy();
    this.falling.b.destroy();
    this.falling = null;
    this.ghost.clear();
    this.app.canvas.setAttribute("data-falling", "");
  }

  /** The falling sprites become the two placed cells and slide into them. */
  private landFalling(cells: readonly [number, number], ids: readonly [number, number], player: SwordBoard): void {
    const f = this.falling;
    const prevA = f ? { x: f.a.x, y: f.a.y } : null;
    const prevB = f ? { x: f.b.x, y: f.b.y } : null;
    this.falling = null;
    this.fallingLayer.removeChildren();
    f?.a.destroy();
    f?.b.destroy();
    this.ghost.clear();
    // The pair the state says was just placed is the previous `current`; its kinds are in the placed cells of the state's board,
    // or, if a cascade moved them, in the cells by id.
    const find = (id: number): SwordCell | null => player.cells.find((c) => c?.id === id) ?? null;
    const pending = [
      [cells[0], ids[0], prevA],
      [cells[1], ids[1], prevB],
    ] as const;
    for (const [i, id, prev] of pending) {
      // A half that fell away over the top: it was above the well and is simply gone.
      if (i < 0) continue;
      const col = i % this.width;
      const row = Math.floor(i / this.width);
      const known = find(id);
      const cell: SwordCell = known ? { ...known, slab: 0 } : { id, color: 0, kind: "block", ripen: 0, slab: 0 };
      this.cells[i] = cell;
      const v = this.spawn(cell, prev?.x ?? this.cx(col), prev?.y ?? this.cy(row));
      v.tx = this.cx(col);
      v.ty = this.cy(row);
      if (!known) {
        // The state no longer has it (shattered at once): draw it from the move's pair.
        const pair = this.lastPair;
        if (pair) {
          const p = id === ids[0] ? pair.a : pair.b;
          v.kind = p.breaker ? "breaker" : "block";
          v.color = p.color;
          v.s.texture = this.texture(p.color, v.kind, 1, 1);
          this.cells[i] = { ...cell, color: p.color, kind: v.kind };
        }
      }
    }
    this.moving = true;
    if (this.interactive && !player.out && !this.state?.finished) this.spawnFalling();
  }

  /** The pair in hand when the last placement was made, for a half that shattered at once. */
  private lastPair: { a: { color: number; breaker: boolean }; b: { color: number; breaker: boolean } } | null = null;

  /**
   * The pair may sit at (pc, rot, row): inside the board and over free cells. Two rows above the
   * well are open sky, but only over a column whose top cell is free: a pair never passes over a
   * full column, which is the engine's "no way through" refusal.
   */
  private fits(pc: number, rot: SwordRotation, row: number): boolean {
    const h = halves(pc, rot, row);
    for (const [c, r] of [h.a, h.b]) {
      if (c < 0 || c >= this.width || r < 0 || r >= this.height + 2) return false;
      if (this.cells[Math.min(r, this.height - 1) * this.width + c]) return false;
    }
    return true;
  }

  /** The pair can fall a row from a's row `row`: the cells under its lowest halves are free. */
  private canDrop(pc: number, rot: SwordRotation, row: number): boolean {
    const h = halves(pc, rot, row);
    const lows = rot === 1 ? [h.a] : rot === 3 ? [h.b] : [h.a, h.b];
    for (const [c, r] of lows) {
      if (r <= 0) return false;
      if (this.cells[(r - 1) * this.width + c]) return false;
    }
    return true;
  }

  private mayOccupy(pc: number, rot: SwordRotation, row: number): boolean {
    const f = this.falling;
    if (!f) return false;
    const R = Math.ceil(f.row);
    if (!this.fits(pc, rot, row)) return false;
    return f.row === R || !this.canDrop(pc, rot, row) || this.fits(pc, rot, row - 1);
  }

  /** After scrap landed under it, lift the pair clear; if there is no room at all it waits for the engine's word. */
  private refitFalling(): void {
    const f = this.falling;
    if (!f) return;
    let R = Math.ceil(f.row);
    while (R < this.height + 1 && !this.fits(f.pc, f.rot, R)) R += 1;
    if (!this.fits(f.pc, f.rot, R)) {
      this.dropFalling();
      return;
    }
    if (R !== Math.ceil(f.row)) {
      f.row = R;
      f.lock = 0;
    }
    this.positionFalling();
  }

  private settleIfResting(): void {
    const f = this.falling;
    if (!f) return;
    const R = Math.ceil(f.row);
    if (f.row !== R && !this.canDrop(f.pc, f.rot, R)) {
      f.row = R;
      f.lock = 0;
    }
  }

  private resetLock(): void {
    const f = this.falling;
    if (!f || f.lock === 0 || f.resets >= MAX_LOCK_RESETS) return;
    f.lock = 0;
    f.resets++;
  }

  private tryMove(d: number): void {
    const f = this.falling;
    if (!f || !this.interactive || f.placed) return;
    const R = Math.ceil(f.row);
    if (!this.mayOccupy(f.pc + d, f.rot, R)) return;
    f.pc += d;
    this.resetLock();
    this.settleIfResting();
    this.cb.onNudge();
    this.positionFalling();
  }

  /**
   * Turn the loose half around the pivot: clockwise is 1 → 0 → 3 → 2. A turn that does not fit
   * tries a kick either way, then a lift of one row (the other half would go through the floor
   * or a block), and when the pair is boxed into one column it turns twice instead, so the halves
   * swap ends.
   */
  private tryRotate(dir: 1 | -1): void {
    const f = this.falling;
    if (!f || !this.interactive || f.placed) return;
    const R = Math.ceil(f.row);
    const once = ((f.rot + (dir === 1 ? 3 : 1)) % 4) as SwordRotation;
    const twice = ((f.rot + 2) % 4) as SwordRotation;
    for (const rot of [once, twice]) {
      for (const lift of [0, 1]) {
        for (const kick of [0, -1, 1]) {
          const row = R + lift;
          if (!this.mayOccupy(f.pc + kick, rot, row)) continue;
          f.pc += kick;
          f.rot = rot;
          if (lift) f.row = row;
          this.resetLock();
          this.settleIfResting();
          this.cb.onNudge();
          this.positionFalling();
          return;
        }
      }
    }
  }

  private commit(): void {
    const f = this.falling;
    const s = this.state;
    if (!f || !s) return;
    const R = Math.ceil(f.row);
    f.row = R;
    this.positionFalling();
    if (s.config.player) this.lastPair = s.boards[0]!.current;
    const answer = this.cb.onPlace(anchorOf(f.pc, f.rot), f.rot);
    if (answer === "placed") {
      f.placed = true;
      this.placedMs = 0;
      // Taken: the pair is the engine's now, not the player's to steer, until its state lands it.
      this.positionFalling();
    } else if (answer === "wait") f.refused = 120;
    else {
      // The engine's board is not the one shown: take its word, lift the pair clear and carry on.
      this.cells = s.config.player ? s.boards[0]!.cells.slice() : this.cells;
      this.shownSlabs = s.config.player ? s.boards[0]!.slabs.slice() : this.shownSlabs;
      this.place(false);
      f.refused = 0;
      f.lock = 0;
      f.resets = 0;
      this.refitFalling();
    }
  }

  private positionFalling(): void {
    const f = this.falling;
    const g = this.ghost;
    g.clear();
    // Only a pair in hand is published: a taken one waits for its state and no longer turns.
    this.app.canvas.setAttribute("data-falling", f && !f.placed ? `${f.pc},${f.rot},${Math.ceil(f.row)}` : "");
    if (!f || !this.state) return;
    this.paintFalling();
    const R = Math.ceil(f.row);
    const h = halves(f.pc, f.rot, R);
    const dy = (R - f.row) * this.cell;
    f.a.position.set(this.cx(h.a[0]), this.cy(h.a[1]) + dy);
    f.b.position.set(this.cx(h.b[0]), this.cy(h.b[1]) + dy);
    const land = swordfightLandingCells(this.state.config, this.cells, anchorOf(f.pc, f.rot), f.rot);
    if (!land) return;
    const cur = f.pair;
    for (const [i, piece] of [
      [land[0], cur.a],
      [land[1], cur.b],
    ] as const) {
      if (i < 0) continue;
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      // Where the pair will land: an amber ring a half, in the half's own outline. Amber is the player's own.
      const s = this.cell;
      const u = s / 24;
      const width = Math.max(1.5, 2 * u);
      const left = x * s;
      const top = (this.height - y - 1) * s;
      if (piece.breaker) g.poly([left + s / 2, top + 2 * u, left + s - 2 * u, top + s / 2, left + s / 2, top + s - 2 * u, left + 2 * u, top + s / 2]).stroke({ width, color: COLORS.amber, join: "round" });
      else g.roundRect(left + 3 * u, top + 3 * u, 18 * u, 18 * u, 3 * u).stroke({ width, color: COLORS.amber });
    }
  }

  // ---- layout and drawing

  private layout(): void {
    if (!this.app.renderer) return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const n = this.miniCount();
    const padFor = (cell: number): number => Math.max(6, Math.round(cell * 0.15));
    const rows = this.height + STRIP_ROWS;
    // The player's board is centred. With other boards in the fight each side keeps a margin wide
    // enough for a column of minis a little under their full share (a phone's width is the bound
    // there, and the board matters more), and the minis take the right one.
    const sideCells = n > 0 ? this.width * MINI_SCALE * 0.8 + 0.7 : 0;
    const cols = this.width + sideCells * 2;
    let cell = Math.floor(Math.min(w / cols, h / rows));
    cell = Math.floor(Math.min((w - padFor(cell) * 2 - 2) / cols, (h - padFor(cell) * 2 - 2) / rows));
    this.cell = Math.max(12, cell);
    this.pad = padFor(this.cell);
    this.strip = Math.round(this.cell * STRIP_ROWS);
    const boardW = this.cell * this.width;
    this.ox = Math.floor((w - boardW) / 2);
    this.oy = Math.floor((h - this.cell * this.height - this.strip) / 2) + this.strip;
    // The board turns about the middle of its well, so the beat swells from there.
    this.board.pivot.set(boardW / 2, (this.cell * this.height) / 2);
    this.board.position.set(this.ox + this.board.pivot.x, this.oy + this.board.pivot.y);
    this.wellMask.clear().rect(0, 0, this.cell * this.width, this.cell * this.height).fill(COLORS.cream);
    this.drawWell();
    this.bake();
    this.layoutStrip();
    this.layoutMinis(w, h);
    this.place(true);
    this.positionFalling();
    this.steps = [];
  }

  /** The next pair stands in the strip the way it will fall: upright, with b above a (`spawnFalling` starts at rotation 1). */
  private layoutStrip(): void {
    const s = this.cell;
    const y = -this.strip / 2 - 1;
    const scale = 0.62;
    this.nextA.scale.set(scale);
    this.nextB.scale.set(scale);
    if (this.nextText) {
      this.nextText.style.fontSize = Math.max(11, Math.min(13, Math.round(s * 0.45)));
      this.nextText.position.set(0, y);
    }
    const x = this.nextText ? this.nextText.width + s * 0.6 : s * 0.5;
    this.nextB.position.set(x, y - (s * scale) / 2 - 1);
    this.nextA.position.set(x, y + (s * scale) / 2 + 1);
    if (this.incomingText) {
      this.incomingText.style.fontSize = Math.max(13, Math.round(s * 0.6));
      this.incomingText.position.set(this.width * s, y);
    }
  }

  private updateStrip(): void {
    const s = this.state;
    if (!s || !s.config.player) return;
    const b = s.boards[0]!;
    this.nextA.texture = this.texture(b.next.a.color, b.next.a.breaker ? "breaker" : "block", 1, 1);
    this.nextB.texture = this.texture(b.next.b.color, b.next.b.breaker ? "breaker" : "block", 1, 1);
    const pending = b.pending.reduce((n, p) => n + p.scrap, 0);
    const g = this.stripG;
    g.clear();
    const cs = this.cell;
    const y = -this.strip / 2 - 1;
    // Scrap waiting to land: a row of small stones and their count. It is coming for the player, so the count is danger.
    if (this.incomingText) this.incomingText.text = pending > 0 ? String(pending) : "";
    const show = Math.min(pending, 6);
    const bw = cs * 0.34;
    const right = this.width * cs - (this.incomingText && pending > 0 ? this.incomingText.width + cs * 0.25 : 0);
    for (let i = 0; i < show; i++) this.stone(g, right - (i + 0.5) * (bw + 3), y, bw);
  }

  /** A small stone, as a mark: stone's cut-cornered outline in slate. */
  private stone(g: Graphics, cx: number, cy: number, size: number): void {
    const h = size / 2;
    const c = size * 0.3;
    g.poly([cx - h + c, cy - h, cx + h - c, cy - h, cx + h, cy - h + c, cx + h, cy + h - c, cx + h - c, cy + h, cx - h + c, cy + h, cx - h, cy + h - c, cx - h, cy - h + c]).fill(COLORS.slate);
  }

  /** The playfield is bare ground with one hairline round it: no frame, no grid (docs/BRAND.md section 3). */
  private drawWell(): void {
    const W = this.width * this.cell;
    const H = this.height * this.cell;
    // The ground is painted, not left clear, so the board is whole wherever it is shown (a thumbnail, a capture).
    this.well.clear().rect(0, 0, W, H).fill(COLORS.ground).rect(-0.5, -0.5, W + 1, H + 1).stroke({ width: 1, color: COLORS.line });
    // The entry, the one empty cell that matters: the top of the column pairs come in down.
    const col = swordfightSpawnCol({ width: this.width } as SwordfightConfig);
    this.well.circle((col + 0.5) * this.cell, this.cell / 2, Math.max(2, (2 * this.cell) / 24)).fill(COLORS.line);
    this.drawEntry();
  }

  /**
   * The board near its top is the one thing on it that is bad for the player: once any column
   * stands within three rows of the top, the entry is ringed in danger, over the pair coming in,
   * and the well's top edge is drawn in danger too.
   */
  private drawEntry(): void {
    const g = this.entryG;
    g.clear();
    const s = this.cell;
    const u = s / 24;
    const col = swordfightSpawnCol({ width: this.width } as SwordfightConfig);
    let top = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i]) top = Math.max(top, Math.floor(i / this.width) + 1);
    if (top < this.height - 3) return;
    const width = Math.max(1.5, 2 * u);
    g.roundRect(col * s + u, u, 22 * u, 22 * u, 5 * u).stroke({ width, color: COLORS.danger });
    g.rect(0, -width, this.width * s, width).fill(COLORS.danger);
  }

  private cx(col: number): number {
    return (col + 0.5) * this.cell;
  }
  private cy(row: number): number {
    return (this.height - row - 0.5) * this.cell;
  }

  // ---- the other boards

  private miniCount(): number {
    const s = this.state;
    const inState = s ? s.boards.length - (s.config.player ? 1 : 0) : 0;
    return inState + this.remote.length;
  }

  /** The boards beside the player's, as snapshots: foes first, then allies. */
  private miniModels(): MiniModel[] {
    const s = this.state;
    const out: MiniModel[] = [];
    if (s) {
      let foe = 0;
      let ally = 0;
      s.boards.forEach((b, i) => {
        if (s.config.player && i === 0) return;
        const name = b.side === 1 ? this.opts.labels.foe(++foe) : this.opts.labels.ally(++ally);
        const slabs = b.slabs.map((sl) => ({ col: sl.col, row: s.config.height - sl.row - sl.h, w: sl.w, h: sl.h }));
        out.push({ key: `board:${i}`, name, side: b.side, cells: swordfightBoardString(s.config, b.cells), slabs, pending: b.pending.reduce((n, p) => n + p.scrap, 0), out: b.out, points: b.points });
      });
    }
    for (const r of this.remote) out.push({ key: r.key, name: r.name, side: r.side, cells: r.cells, pending: r.pending, out: r.out, points: r.points });
    out.sort((a, b) => b.side - a.side);
    return out;
  }

  private syncMinis(): void {
    const models = this.miniModels();
    const before = this.minis.length;
    const keep = new Map(this.minis.map((m) => [m.key, m]));
    const next: Mini[] = [];
    for (const m of models) {
      let mini = keep.get(m.key);
      if (!mini) {
        const g = new Graphics();
        const sprite = new Sprite(Texture.EMPTY);
        const over = new Graphics();
        const label = new Text({ text: m.name, style: { fontFamily: FONT.body, fontSize: 11, fill: COLORS.dim }, resolution: 2 });
        label.anchor.set(0, 1);
        const pendingLabel = new Text({ text: "", style: { fontFamily: FONT.mono, fontSize: 11, fontWeight: "700", fill: COLORS.dim }, resolution: 2 });
        pendingLabel.anchor.set(1, 0);
        this.miniLayer.addChild(g, sprite, over, label, pendingLabel);
        mini = { ...m, g, s: sprite, over, label, pendingLabel, painted: "", x: 0, y: 0, cell: 8 };
      } else {
        // A board whose slabs are no longer known must not keep the last ones it had.
        delete mini.slabs;
        Object.assign(mini, m);
      }
      keep.delete(m.key);
      next.push(mini);
    }
    for (const gone of keep.values()) {
      gone.g.destroy();
      if (gone.s.texture !== Texture.EMPTY) gone.s.texture.destroy(true);
      gone.s.destroy();
      gone.over.destroy();
      gone.label.destroy();
      gone.pendingLabel.destroy();
    }
    this.minis = next;
    if (next.length !== before) this.layout();
    else this.drawMinis();
  }

  /**
   * The other boards, small, in the margin right of the player's board: a column from the top of
   * the well, more columns beside it when there is room and the fight has many, and smaller still
   * when the column would not fit the height.
   */
  private layoutMinis(w: number, h: number): void {
    const n = this.minis.length;
    if (n === 0) return;
    const left = this.ox + this.width * this.cell + this.pad + 6;
    const avail = Math.max(10, w - left - this.pad);
    const gap = 8;
    // A name above each board and its waiting scrap below it, so neither crowds the other on a narrow board.
    const label = 18;
    const foot = 14;
    const want = Math.max(5, Math.floor(this.cell * MINI_SCALE));
    const perRow = Math.max(1, Math.min(n, Math.floor((avail + gap) / (want * this.width + gap))));
    const rowsN = Math.ceil(n / perRow);
    let mc = Math.floor(Math.min(want, (avail - (perRow - 1) * gap) / perRow / this.width, (h - this.oy - this.pad - rowsN * (label + foot) - (rowsN - 1) * gap) / rowsN / this.height));
    mc = Math.max(5, mc);
    const bw = mc * this.width;
    const bh = mc * this.height;
    const y0 = this.oy + label;
    this.minis.forEach((m, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      m.x = left + c * (bw + gap);
      m.y = y0 + r * (bh + label + foot + gap);
      m.cell = mc;
      m.label.style.fontSize = Math.max(9, Math.min(13, mc * 1.3));
      m.pendingLabel.style.fontSize = m.label.style.fontSize;
      m.label.position.set(m.x, m.y - 4);
      m.pendingLabel.position.set(m.x + bw, m.y + bh + 3);
    });
    this.drawMinis();
  }

  /**
   * The other boards are the player's board again, smaller and quieter: the same pieces from the
   * same painter on bare ground inside a hairline, with their names in dim. None is tinted for its
   * side; a board that is out fades and is crossed through.
   */
  private drawMinis(): void {
    for (const m of this.minis) {
      const s = m.cell;
      const W = s * this.width;
      const H = s * this.height;
      m.g.clear().rect(0, 0, W, H).fill(COLORS.ground).rect(-0.5, -0.5, W + 1, H + 1).stroke({ width: 1, color: COLORS.line });
      m.g.position.set(m.x, m.y);
      m.s.position.set(m.x, m.y);
      m.over.position.set(m.x, m.y);
      const key = `${s}:${m.cells}:${JSON.stringify(m.slabs ?? null)}`;
      if (m.painted !== key) {
        m.painted = key;
        const old = m.s.texture;
        const r = this.app.renderer;
        m.s.texture = new Texture({ source: new CanvasSource({ resource: this.miniCanvas(m, r.resolution), resolution: r.resolution }) });
        if (old !== Texture.EMPTY) old.destroy(true);
      }
      m.s.alpha = m.out ? 0.3 : 1;
      m.over.clear();
      if (m.out) m.over.moveTo(W * 0.25, H * 0.42).lineTo(W * 0.75, H * 0.58).moveTo(W * 0.75, H * 0.42).lineTo(W * 0.25, H * 0.58).stroke({ width: Math.max(2, s * 0.3), color: COLORS.dim, cap: "round" });
      m.label.text = m.name;
      m.pendingLabel.text = m.pending > 0 ? `+${m.pending}` : "";
    }
  }

  /** A board's snapshot painted with the pieces' own drawing, at its small cell size. */
  private miniCanvas(m: Mini, resolution: number): HTMLCanvasElement {
    const s = m.cell;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(s * this.width * resolution);
    canvas.height = Math.ceil(s * this.height * resolution);
    const ctx = canvas.getContext("2d");
    const rows = m.cells.length === this.width * this.height ? m.cells : "";
    if (!ctx || !rows) return canvas;
    ctx.scale(resolution, resolution);
    const slabs = m.slabs ?? slabsIn(rows, this.width, this.height);
    const inSlab = new Set<number>();
    for (const sl of slabs) {
      for (let r = sl.row; r < sl.row + sl.h; r++) for (let c = sl.col; c < sl.col + sl.w; c++) inSlab.add(r * this.width + c);
      const color = Number(rows[sl.row * this.width + sl.col]);
      ctx.save();
      ctx.translate(sl.col * s, sl.row * s);
      paintBlock(ctx, s, sl.w, sl.h, this.styleFor(Number.isFinite(color) ? color : 0, "block"));
      ctx.restore();
    }
    for (let i = 0; i < rows.length; i++) {
      const ch = rows[i]!;
      if (ch === "." || inSlab.has(i)) continue;
      const breaker = ch >= "A" && ch <= "F";
      ctx.save();
      ctx.translate((i % this.width) * s, Math.floor(i / this.width) * s);
      // A snapshot does not say how far stone has ripened, so it is plain stone.
      paintBlock(ctx, s, 1, 1, ch === "#" ? this.styleFor(0, "scrap") : this.styleFor(breaker ? ch.charCodeAt(0) - 65 : Number(ch), breaker ? "breaker" : "block"));
      ctx.restore();
    }
    return canvas;
  }

  // ---- fx

  private popup(x: number, y: number, text: string): void {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.mono,
        fontSize: Math.max(14, this.cell * 0.55),
        fontWeight: "700",
        fill: COLORS.cream,
        // A ground edge keeps the number readable over any piece.
        stroke: { color: COLORS.ground, width: Math.max(3, this.cell * 0.09), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    const margin = t.width / 2 + 4;
    t.position.set(Math.min(Math.max(x, margin), this.width * this.cell - margin), y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 300 : 700, y0: y });
  }

  /**
   * A moment named over the board: cream for the player's good news, danger for what is bad for
   * them. What a break sent over is said on a second, smaller line under the break's own name.
   */
  private callout(text: string, color: number, second = false): void {
    const t = new Text({
      text,
      style: {
        fontFamily: FONT.body,
        fontSize: second ? Math.max(15, this.cell * 0.6) : Math.max(18, this.cell * 0.8),
        fontWeight: "700",
        fill: color,
        align: "center",
        stroke: { color: COLORS.ground, width: Math.max(4, this.cell * 0.12), join: "round" },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set((this.width * this.cell) / 2, this.height * this.cell * 0.35 + (second ? this.cell * 1.1 : 0));
    this.fxLayer.addChild(t);
    this.popups.push({ t, life: 0, max: this.reduced ? 400 : 900, y0: t.y });
  }

  /** Ask for the beat. A stronger moment while one is playing takes it over; it never stacks. */
  private beat(strength: number): void {
    // The pulse and its sound are asked for together, so they cannot drift apart.
    sfx.beat(strength);
    this.beatNow = { life: 0, strength: Math.max(strength, this.beatNow?.strength ?? 0) };
  }

  /**
   * Scrap crossing from one board to another, in board coordinates: one mark an attack, the fewest
   * that say where it went (docs/BRAND.md section 6).
   */
  private fly(x0: number, y0: number, x1: number, y1: number): void {
    if (this.reduced) return;
    this.marks.push({ x: x0, y: y0, to: { x: x1, y: y1 }, life: 0 });
  }

  // ---- per frame

  private tick(dt: number): void {
    this.runSteps(dt);
    this.movePieces(dt);
    this.moveFx(dt);
    this.hold(dt);
    this.fall(dt);
    this.drawBeat(dt);
    this.watch(dt);
    if (this.framePending && this.steps.length === 0 && !this.moving) {
      this.framePending = false;
      this.cb.onFrame();
    }
    if (this.viewStale && this.steps.length === 0 && !this.moving) this.publishView();
  }

  /**
   * Nothing on screen may ever leave the player without a pair: if one is due and missing for long,
   * deal it; if a taken pair has waited too long for its state, let it be asked for again.
   */
  private watch(dt: number): void {
    const s = this.state;
    if (!s || !s.config.player || !this.interactive || s.finished || s.boards[0]!.out || this.steps.length > 0) {
      this.idleMs = 0;
      return;
    }
    const f = this.falling;
    if (!f) {
      this.idleMs += dt;
      if (this.idleMs > 700) {
        this.idleMs = 0;
        this.cells = s.boards[0]!.cells.slice();
        this.shownSlabs = s.boards[0]!.slabs.slice();
        this.place(false);
        this.spawnFalling();
      }
      return;
    }
    this.idleMs = 0;
    if (f.placed) {
      this.placedMs += dt;
      if (this.placedMs > 1500) {
        this.placedMs = 0;
        if (s.boards[0]!.drops > f.drops) {
          // The state has the pair, but its report never reached this board: show the state's board
          // and deal the next pair, rather than offering the engine the next pair where this one lay.
          this.dropFalling();
          this.cells = s.boards[0]!.cells.slice();
          this.shownSlabs = s.boards[0]!.slabs.slice();
          this.place(false);
          this.spawnFalling();
          return;
        }
        f.placed = false;
        f.lock = 0;
        this.positionFalling();
      }
    } else this.placedMs = 0;
  }

  private runSteps(dt: number): void {
    if (this.waitSettle > 0) {
      if (this.moving) return;
      this.waitSettle = 0;
    }
    this.waitMs -= dt;
    while (this.waitMs <= 0 && this.steps.length) {
      const r = this.steps.shift()!();
      if (r === "settle") {
        this.waitSettle = 1;
        this.waitMs = 0;
        return;
      }
      this.waitMs = r;
    }
  }

  /** Slides are `MOVE_MS`, eased out, with no overshoot; a broken block shrinks to nothing in `DIE_MS`. Reduced motion cuts both. */
  private movePieces(dt: number): void {
    let moving = false;
    const step = (v: Slider): boolean => {
      if (!Number.isFinite(v.tx) || !Number.isFinite(v.ty) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
        v.x = Number.isFinite(v.tx) ? v.tx : 0;
        v.y = Number.isFinite(v.ty) ? v.ty : 0;
        return false;
      }
      if (v.y === v.ty && v.x === v.tx) return false;
      if (v.gx !== v.tx || v.gy !== v.ty) {
        v.sx = v.x;
        v.sy = v.y;
        v.gx = v.tx;
        v.gy = v.ty;
        v.t = 0;
      }
      v.t += dt;
      const k = this.reduced ? 1 : Math.min(1, v.t / MOVE_MS);
      const e = easeOutCubic(k);
      v.x = k >= 1 ? v.tx : v.sx + (v.gx - v.sx) * e;
      v.y = k >= 1 ? v.ty : v.sy + (v.gy - v.sy) * e;
      return k < 1;
    };
    const shrink = (v: { dying: number | null; s: Sprite }): boolean => {
      v.dying = (v.dying ?? 0) + dt;
      const k = this.reduced ? 1 : Math.min(1, v.dying / DIE_MS);
      v.s.scale.set(1 - k);
      return k >= 1;
    };
    for (const v of [...this.pieces.values()]) {
      if (v.dying !== null) {
        if (shrink(v)) this.kill(v);
        continue;
      }
      if (step(v)) moving = true;
      v.s.position.set(v.x, v.y);
    }
    for (const v of [...this.slabs.values()]) {
      if (v.dying !== null) {
        if (shrink(v)) this.killSlab(v);
        continue;
      }
      if (step(v)) moving = true;
      this.putSlab(v);
    }
    this.moving = moving;
  }

  private moveFx(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.life += dt;
      const k = p.life / p.max;
      p.t.y = p.y0 - easeOutCubic(Math.min(1, k)) * this.cell * 0.6;
      p.t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
    const g = this.fxG;
    g.clear();
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]!;
      m.life += dt;
      const k = m.life / MARK_MS;
      if (k >= 1) {
        this.marks.splice(i, 1);
        continue;
      }
      const e = easeOutCubic(k);
      this.stone(g, m.x + (m.to.x - m.x) * e, m.y + (m.to.y - m.y) * e, this.cell * 0.4);
    }
  }

  /**
   * The beat: the whole board pulses once in amber and swells a hair, in `BEAT_MS`. Reduced motion
   * keeps it as a still flash.
   */
  private drawBeat(dt: number): void {
    const g = this.beatLayer;
    g.clear();
    const b = this.beatNow;
    if (!b) return;
    b.life += dt;
    const t = b.life / BEAT_MS;
    if (t >= 1) {
      this.beatNow = null;
      this.board.scale.set(1);
      return;
    }
    // Up in the first quarter, down over the rest.
    const env = this.reduced ? 1 : t < 0.25 ? easeOutCubic(t / 0.25) : 1 - easeOutCubic((t - 0.25) / 0.75);
    g.rect(0, 0, this.width * this.cell, this.height * this.cell).fill({ color: COLORS.amber, alpha: (0.14 + 0.16 * b.strength) * env });
    this.board.scale.set(this.reduced ? 1 : 1 + 0.012 * b.strength * env);
  }

  /** Gravity on the falling pair; a short lock once it rests, then the engine is asked. */
  private fall(dt: number): void {
    const f = this.falling;
    if (!f || !this.interactive || !this.state || f.placed) return;
    if (this.steps.length) {
      // Animations are running (an attack landing, say). The pair may still slide in from above the
      // well, so it is never left hidden there under its shadow, but it does not fall further.
      if (f.row > this.height - 1) {
        f.row = Math.max(this.height - 1, f.row - dt / (this.state.config.fallTicks * this.state.config.tickMs / 5));
        this.positionFalling();
      }
      return;
    }
    if (f.refused > 0) {
      // The engine said too soon: hold the pair where it rests and ask again shortly.
      f.refused -= dt;
      if (f.refused <= 0) this.commit();
      return;
    }
    const R = Math.ceil(f.row);
    if (!this.canDrop(f.pc, f.rot, R)) {
      f.row = R;
      f.lock += dt;
      this.positionFalling();
      if (f.lock >= LOCK_MS) this.commit();
      return;
    }
    const fallMs = this.state.config.fallTicks * this.state.config.tickMs;
    // Sliding in from above the well is quick; the fall proper starts once the pair is on the board.
    const entering = f.row > this.height - 1;
    const per = this.softDrop ? this.opts.softDropMs : entering ? fallMs / 5 : fallMs;
    f.row = Math.max(R - 1, f.row - dt / per);
    if (Math.ceil(f.row) < f.low) {
      f.low = Math.ceil(f.row);
      f.lock = 0;
      f.resets = 0;
    }
    this.positionFalling();
  }

  /** Mirrors what the canvas shows, for the smoke test: the player's board as drawn. */
  private publishView(): void {
    this.viewStale = false;
    if (!this.state) return;
    const cfg = this.state.config;
    const chars: string[] = new Array<string>(this.width * this.height).fill(".");
    for (const v of this.pieces.values()) {
      if (v.dying !== null) continue;
      const col = Math.round(v.tx / this.cell - 0.5);
      const row = this.height - 1 - Math.round(v.ty / this.cell - 0.5);
      if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue;
      chars[row * this.width + col] = v.kind === "scrap" ? "#" : v.kind === "breaker" ? String.fromCharCode(65 + v.color) : String(v.color);
    }
    for (const v of this.slabs.values()) {
      if (v.dying !== null) continue;
      const col0 = Math.round(v.tx / this.cell);
      const rowTop = this.height - Math.round(v.ty / this.cell) - v.h;
      for (let r = 0; r < v.h; r++) for (let c = 0; c < v.w; c++) chars[(rowTop + r) * this.width + col0 + c] = String(v.color);
    }
    let out = "";
    for (let r = cfg.height - 1; r >= 0; r--) for (let c = 0; c < cfg.width; c++) out += chars[r * this.width + c];
    this.app.canvas.setAttribute("data-view", out);
  }

  // ---- input

  private pointerDown(e: FederatedPointerEvent): void {
    if (!this.interactive || !this.falling) return;
    this.drag = { x: e.global.x, y: e.global.y, pc: this.falling.pc, moved: false, hurried: false, turned: false, touch: e.pointerType !== "mouse", held: 0, far: false };
  }

  private pointerMove(e: FederatedPointerEvent): void {
    const d = this.drag;
    const f = this.falling;
    if (!d || !f) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (d.touch) {
      // A finger that leaves where it came down is swiping or steering, not holding: the hurry ends.
      if (Math.abs(dx) > this.cell * 0.4 || Math.abs(dy) > this.cell * 0.4) {
        d.far = true;
        if (d.hurried) {
          d.hurried = false;
          this.softDrop = false;
        }
      }
      // A swipe down turns the pair clockwise, a swipe up counter-clockwise, once: the finger lifts before it can turn again.
      if (!d.moved && !d.turned && Math.abs(dy) > this.cell * 0.9 && Math.abs(dx) < this.cell * 1.5) {
        d.turned = true;
        this.tryRotate(dy > 0 ? 1 : -1);
      }
      if (d.turned) return;
      this.steer(d, dx);
      return;
    }
    if (dy > this.cell * 0.9 && Math.abs(dx) < this.cell * 1.5) {
      d.hurried = true;
      this.softDrop = true;
    } else if (dy < this.cell * 0.4) this.softDrop = false;
    // A swipe up turns the pair counter-clockwise, once: the finger lifts before it can turn again.
    if (!d.moved && !d.hurried && !d.turned && dy < -this.cell * 0.9 && Math.abs(dx) < this.cell * 1.5) {
      d.turned = true;
      this.tryRotate(-1);
    }
    if (d.turned) return;
    // A downward swipe commits to the column it started in: no steering until the finger lifts.
    if (d.hurried) return;
    this.steer(d, dx);
  }

  /** Follow the drag sideways, a column at a time. */
  private steer(d: { pc: number; moved: boolean }, dx: number): void {
    const f = this.falling;
    if (!f) return;
    const want = d.pc + Math.round(dx / this.cell);
    while (f.pc < want) {
      const before = f.pc;
      this.tryMove(1);
      d.moved = true;
      if (f.pc === before) break;
    }
    while (f.pc > want) {
      const before = f.pc;
      this.tryMove(-1);
      d.moved = true;
      if (f.pc === before) break;
    }
  }

  /** Touch: a finger held where it came down hurries the pair in hand, from HOLD_MS until it lifts or moves off. */
  private hold(dt: number): void {
    const d = this.drag;
    if (!d || !d.touch || d.far || d.hurried || d.turned || !this.falling) return;
    d.held += dt;
    if (d.held < HOLD_MS) return;
    d.hurried = true;
    this.softDrop = true;
  }

  private pointerUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.softDrop = false;
    if (!d || !this.falling || d.hurried || d.turned || d.touch) return;
    const dx = e.global.x - d.x;
    const dy = e.global.y - d.y;
    if (!d.moved && Math.abs(dx) < this.cell * 0.4 && Math.abs(dy) < this.cell * 0.4) this.tryRotate(1);
  }

  private pointerCancel(): void {
    this.drag = null;
    this.softDrop = false;
  }

  /** Keyboard: left and right steer, up and X turn counter-clockwise, down and Z clockwise, space hurries while held. */
  keyboard(key: string, down: boolean): boolean {
    if (key === " " && !down) {
      this.softDrop = false;
      return true;
    }
    if (!this.interactive) return false;
    if (key === " ") {
      this.softDrop = true;
      return true;
    }
    if (!down) return false;
    switch (key) {
      case "ArrowLeft":
        this.tryMove(-1);
        return true;
      case "ArrowRight":
        this.tryMove(1);
        return true;
      case "ArrowUp":
      case "x":
      case "X":
        this.tryRotate(-1);
        return true;
      case "ArrowDown":
      case "z":
      case "Z":
        this.tryRotate(1);
        return true;
      default:
        return false;
    }
  }
}
