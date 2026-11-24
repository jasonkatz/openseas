/**
 * Forging (prototype, ADR 0036 and ADR 0082): a successor to the original's crafting puzzle
 * Blacksmithing. A hot billet lies on the anvil as a grid of spots, and the press strikes it one
 * spot at a time. Every spot takes `blows` strikes before it is set; a set spot is out of play.
 *
 * Every live spot shows a mark, and the mark says where the press may land next after striking it:
 * - a step of one, two, three or four: exactly that many spots away in a straight line, any of the
 *   eight directions (the spots between are jumped, never in the way);
 * - a rail: the spot at the plate's edge in line with it, along its row or column;
 * - a slant: the spot at the plate's edge in line with it, along either diagonal;
 * - a star: a rail and a slant at once;
 * - a hook: two along and one across, either way round;
 * - a spark: any live spot but the one just struck.
 * The first strike of a round may land anywhere. A target must be live (not yet set).
 *
 * The one verb is a strike: tap a lit spot. It loses one blow, and unless that set it, it shows a
 * new mark at once. New marks are drawn from one stream in a fixed order whatever the player does,
 * so the next few are known and shown (`preview`). A spot that is the last one at the plate's
 * highest heat, when struck and still live, shows a spark instead of a drawn mark: one spark after
 * the whole plate has been struck once, another after it has all been struck twice.
 *
 * Every strike scores `strikePoints`. Striking the same mark as the strike before makes a chain: the
 * n-th strike of a chain adds chainPoints * (n - 1), the step capped at chainCap. Four strikes in a
 * row that hold each step once (one, two, three, four) are a count; four that hold rail, slant, star
 * and hook once each are a span. Either is a set and scores setPoints. A set begun the strike after
 * a set of the other kind links to it: the k-th set of such a weave scores setPoints * k, k capped
 * at weaveCap. A spark stands in for any mark, in a chain and in a set. Weaving counts and spans is
 * the move the puzzle pays most for.
 *
 * A strike that leaves the press nowhere to land is a stall: it costs stallCost times the share of the
 * plate's blows still to strike, rounded down (the score never goes below zero), breaks the chain,
 * the set and the weave, and the next strike may land on any live spot. The round ends when every spot is set, or on the clock, which is the page's and the
 * server's: nothing here reads one.
 *
 * Cell index = row * width + col. Row 0 is the top row.
 */
import type { PrngState } from "../prng.js";

/** Every mark, in the order the engine numbers and draws them. `spark` is never drawn: it is earned. */
export const FORGING_MARKS = ["one", "two", "three", "four", "rail", "slant", "star", "hook", "spark"] as const;
export type ForgingMark = (typeof FORGING_MARKS)[number];
/** The marks a set is made from: a count holds the steps, a span the jumps. */
export type ForgingFamily = "count" | "span";

export interface ForgingConfig {
  readonly width: number;
  readonly height: number;
  /** Strikes a spot takes before it is set. */
  readonly blows: number;
  /** The jumps layer: rails, slants and hooks are dealt. Off: steps only. */
  readonly jumps: boolean;
  /** The far layer: steps of four, and stars where jumps are dealt. Off: steps of one to three. */
  readonly far: boolean;
  /** The sparks layer: the last spot at the plate's highest heat shows a spark. */
  readonly sparks: boolean;
  /** How likely each drawable mark is, in FORGING_MARKS order without the spark. A mark whose layer is off is never drawn. */
  readonly weights: readonly number[];
  /** Upcoming marks shown: the next ones the stream will deal. */
  readonly preview: number;
  readonly strikePoints: number;
  /** The n-th strike of a chain of one mark adds chainPoints * min(n - 1, chainCap). */
  readonly chainPoints: number;
  readonly chainCap: number;
  /** A count or a span. 0 switches the sets layer off. */
  readonly setPoints: number;
  /** The k-th set of a weave scores setPoints * min(k, weaveCap). 1: sets never link. */
  readonly weaveCap: number;
  /** What a stall costs with the whole plate still to strike; it costs that times the share of blows left. */
  readonly stallCost: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_FORGING_CONFIG: ForgingConfig = {
  width: 6,
  height: 6,
  blows: 3,
  jumps: true,
  far: true,
  sparks: true,
  weights: [10, 10, 10, 8, 8, 8, 6, 8],
  preview: 3,
  strikePoints: 2,
  chainPoints: 10,
  chainCap: 3,
  setPoints: 50,
  weaveCap: 5,
  stallCost: 300,
  maxMoves: 400,
};

export interface ForgingSpot {
  /** Blows left: blows on a fresh spot, 0 once it is set. */
  readonly heat: number;
  /** What it shows while live. A set spot keeps the mark it was set on, and nothing reads it. */
  readonly mark: ForgingMark;
}

export type ForgingMove =
  /** Strike the spot at `cell`. */
  | { readonly type: "strike"; readonly cell: number }
  | { readonly type: "end" };

/** What a strike scored, by part, and what it set off: the board plays it back from this. */
export interface ForgingStrike {
  readonly cell: number;
  /** The mark struck: it says where the next strike may land. */
  readonly mark: ForgingMark;
  /** The spot's heat after the strike: 0 when it is now set. */
  readonly heat: number;
  /** The mark it shows now, when still live. */
  readonly next: ForgingMark | null;
  /** True when that mark is an earned spark. */
  readonly sparked: boolean;
  /** The chain this strike is part of, 1 when none. */
  readonly chain: number;
  readonly chainPoints: number;
  /** A set this strike completed, with its place in its weave. */
  readonly set: { readonly family: ForgingFamily; readonly weave: number; readonly points: number } | null;
  /** A set in the making that this strike broke (two or more strikes long), or a weave it cut. */
  readonly broke: boolean;
  /** The press has nowhere to land: the next strike may go anywhere, and this one cost stallCost. */
  readonly stalled: boolean;
  /** What the stall took, after the floor at zero. */
  readonly stallPoints: number;
  /** The whole plate is set. */
  readonly done: boolean;
  /** Everything the strike scored, the stall taken off. */
  readonly points: number;
}

export interface ForgingState {
  readonly config: ForgingConfig;
  readonly cells: readonly ForgingSpot[];
  /** The deal stream: the next marks are drawn from it in order. */
  readonly rng: PrngState;
  /** The spot last struck, null before the first strike. */
  readonly at: number | null;
  /** The mark last struck: where the next strike may land. Null before the first and after a stall. */
  readonly lead: ForgingMark | null;
  readonly score: number;
  /** Strikes made. */
  readonly moveCount: number;
  /** The chain running: its length, and its mark (null while it holds only sparks). */
  readonly chain: number;
  readonly chainMark: ForgingMark | null;
  /** The set in the making: the marks struck towards it, in order. */
  readonly run: readonly ForgingMark[];
  /** The weave running: its sets so far, and the family of the last one. 0 when none is open. */
  readonly weave: number;
  readonly weaveFamily: ForgingFamily | null;
  readonly sets: number;
  readonly bestWeave: number;
  readonly bestChain: number;
  readonly stalls: number;
  readonly sparksEarned: number;
  readonly lastMove: ForgingStrike | null;
  readonly finished: boolean;
}
