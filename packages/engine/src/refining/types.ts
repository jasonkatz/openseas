/**
 * Refining (prototype, ADR 0036, ADR 0080): a successor to the original's Distilling, faithful to
 * its mechanics and the game's own in everything a player sees and hears.
 *
 * The board is a refinery's tower: columns of fractions, `width` wide and `height` tall, always
 * full, packed as a honeycomb. Every other column sits half a piece lower (`lowered`), so a piece
 * touches two pieces in each column beside it, one up and one down. A column keeps its height as it
 * moves towards the outlet, so which columns sit low turns over with every draw.
 *
 * Three fractions make up the feed: vapour (light), oil (middling) and tar (heavy). Swaps are
 * diagonal only, between a piece and one of those four, and each fraction has one partner it rises
 * past and one it sinks past, the same everywhere: vapour rises past oil and sinks past tar, oil
 * rises past tar and sinks past vapour, tar rises past vapour and sinks past oil. Put as a pair, the
 * upper piece is vapour over tar, tar over oil or oil over vapour (`linked`). A swap is never
 * directly undone, since the pair it leaves is the wrong way round. A catalyst is fixed where it lies
 * and swaps with nothing. Smoke counts as vapour for weight and for swapping.
 *
 * The tower is drawn on a clock: every `pulseTicks` the rightmost column (the outlet) leaves, every
 * other column moves one place right, and a fresh column of feed enters at the left. The player may
 * draw early. A column leaves by weight: more tar than vapour and smoke, and it sinks to the sump;
 * otherwise it rises to the tank.
 *
 * A column that rises is graded:
 * - clear: vapour and catalysts only, with at least one vapour. It extends the clear run, and the
 *   k-th clear of a run pays clearPoints * k, k capped at runCap.
 * - smooth: no tar and no smoke, more vapour than oil. It pays smoothPoints and ends the run.
 * - plain: no tar and no smoke, but not smooth (oil the most of it). It pays nothing and ends the run.
 * - foul: tar or smoke in it. It costs foulPoints for each, and ends the run.
 * A clear or smooth column pays catalystPoints for each catalyst in it.
 *
 * A column that sinks is a dump when it holds no vapour: it leaves the run alone. One that holds
 * vapour spills it and ends the run. Every `smokeEvery`-th vapour spilled turns to smoke, which
 * takes the place of the top vapour in the column nearest the outlet that holds any.
 *
 * The score never goes below zero. Cell index = row * width + col; row 0 is the top row.
 *
 * Time is data: every move carries the integer `tick` it happens at, and the reducer draws every
 * column due by that tick first. Nothing here reads a clock (ADR 0003, ADR 0015).
 */
import type { PrngState } from "../prng.js";

/** The fractions, as the engine numbers them. */
export const REFINING_VAPOUR = 0;
export const REFINING_OIL = 1;
export const REFINING_TAR = 2;
/** Spilled vapour come back: weighs and swaps as vapour, spoils a clear column. */
export const REFINING_SMOKE = 3;
/** Fixed in place; neutral weight; pays in a clear or smooth column. */
export const REFINING_CATALYST = 4;

export type RefiningKind = 0 | 1 | 2 | 3 | 4;

export interface RefiningConfig {
  readonly width: number;
  readonly height: number;
  /** Chance, per thousand, that a piece of fresh feed is vapour, and that it is oil. The rest is tar. */
  readonly vapourPermille: number;
  readonly oilPermille: number;
  /** Chance, per thousand, that a piece of fresh feed is a catalyst instead. 0 deals none. */
  readonly catalystPermille: number;
  /** The k-th clear column of a run pays clearPoints * k, k capped at runCap. A cap of 1 pays every clear the same. */
  readonly clearPoints: number;
  readonly runCap: number;
  /** A smooth column's pay. */
  readonly smoothPoints: number;
  /** Each catalyst in a clear or smooth column. */
  readonly catalystPoints: number;
  /** What each tar or smoke in a rising column costs. */
  readonly foulPoints: number;
  /** Every this many vapour spilled into the sump come back as one smoke. 0: none does. */
  readonly smokeEvery: number;
  /** Ticks between draws. An early draw starts the count again. */
  readonly pulseTicks: number;
  /** Wall-clock ms per tick on the client; the server uses it to bound claimed ticks. */
  readonly tickMs: number;
  /** No move may claim a tick beyond this; the round is over by then. */
  readonly maxTick: number;
  /** Longest move log the server accepts: swaps, draws and waits. */
  readonly maxMoves: number;
}

export const DEFAULT_REFINING_CONFIG: RefiningConfig = {
  width: 6,
  height: 5,
  vapourPermille: 450,
  oilPermille: 275,
  catalystPermille: 30,
  clearPoints: 100,
  runCap: 5,
  smoothPoints: 20,
  catalystPoints: 50,
  foulPoints: 10,
  smokeEvery: 2,
  pulseTicks: 80,
  tickMs: 100,
  maxTick: 1200,
  maxMoves: 2000,
};

export interface RefiningPiece {
  /** Stable identity for animation. */
  readonly id: number;
  readonly kind: RefiningKind;
}

/** Which way a swap goes from its first cell: with one of the two pieces touching it in the column to its right, the one up or the one down. Swaps are diagonal only. */
export type RefiningDir = "upRight" | "downRight";

export const REFINING_DIRS: readonly RefiningDir[] = ["upRight", "downRight"];

export type RefiningMove =
  /** Swap the piece at `cell` with the one above or below it to its right. */
  | { readonly type: "swap"; readonly cell: number; readonly dir: RefiningDir; readonly tick: number }
  /** Draw the outlet now, before the clock does. The clock starts again from here. */
  | { readonly type: "draw"; readonly tick: number }
  /** Nothing but time passing, so the draws the clock made reach the server. */
  | { readonly type: "wait"; readonly tick: number }
  /** The round is over. Without a tick it ends at the tick the round has reached. */
  | { readonly type: "end"; readonly tick?: number };

/** How a drawn column went. */
export type RefiningGrade = "clear" | "smooth" | "plain" | "foul" | "dump" | "spill";

/** A smoke that took a vapour's place. */
export interface RefiningSmoke {
  readonly cell: number;
  /** The vapour it replaced, and the smoke's own id. */
  readonly was: number;
  readonly id: number;
}

/** What a draw of the outlet will do, or did, before the board moves. */
export interface RefiningDrawValue {
  readonly up: boolean;
  readonly grade: RefiningGrade;
  /** The clear run once this column is drawn. */
  readonly run: number;
  /** What it scores; negative for a foul column. */
  readonly points: number;
  /** Vapour it spills into the sump. */
  readonly spilled: number;
  readonly catalysts: number;
}

export type RefiningEvent =
  | { readonly seq: number; readonly tick: number; readonly type: "swap"; readonly a: number; readonly b: number }
  | {
      readonly seq: number;
      readonly tick: number;
      readonly type: "draw";
      /** True when the player drew; false when the clock did. */
      readonly early: boolean;
      /** The column that left, top to bottom. */
      readonly column: readonly RefiningPiece[];
      readonly value: RefiningDrawValue;
      /** What the score actually moved by: a foul column never takes it below zero. */
      readonly points: number;
      /** The fresh feed that entered at the left, top to bottom. */
      readonly fresh: readonly RefiningPiece[];
      /** Smoke that came back, placed on the board after the move right. */
      readonly smoke: readonly RefiningSmoke[];
    };

export interface RefiningMoveReport {
  readonly move: RefiningMove;
  /** The draws the clock made up to the move's tick, then the move's own. */
  readonly events: readonly RefiningEvent[];
  readonly points: number;
}

export interface RefiningState {
  readonly config: RefiningConfig;
  readonly tick: number;
  /** Always full. */
  readonly cells: readonly RefiningPiece[];
  /** The fresh feed's stream, and the catalysts' (ADR 0075): what enters is the same however the round is played. */
  readonly rng: PrngState;
  readonly catalystRng: PrngState;
  readonly nextId: number;
  /** The tick of the next draw by the clock. */
  readonly nextDraw: number;
  /** Clear columns in a row, dumps aside. */
  readonly run: number;
  readonly bestRun: number;
  /** Vapour spilled all round, which counts towards smoke. */
  readonly spilled: number;
  /** The `seq` of the last event made. Events are numbered from 1. */
  readonly eventSeq: number;
  /** Events since the last logged move began, the move's own included: a display advance appends the clock's draws. */
  readonly events: readonly RefiningEvent[];
  readonly score: number;
  /** Swaps and early draws made. */
  readonly moveCount: number;
  /** Every move in the log, waits included. */
  readonly logLength: number;
  readonly draws: number;
  readonly clears: number;
  readonly smooths: number;
  readonly fouls: number;
  readonly dumps: number;
  readonly spills: number;
  readonly lastMove: RefiningMoveReport | null;
  readonly finished: boolean;
}
