/**
 * Pouring (prototype, ADR 0083): a successor to the original's tavern puzzle, Drinking. A few
 * pirates share one bar top in a dockside bar and take turns setting drinks down on it.
 *
 * The bar is a `size` by `size` grid. Every drink has a glass (its outline) and a brew (its colour
 * and the mark floating in it). A drink may be set down on an empty square only where it suits every
 * drink beside it, up, down, left and right: each neighbour shares its glass or its brew. A row or a
 * column that fills is served: the placer scores it and every drink in it is taken away. Lines
 * served by one pour count together, k lines scoring linePoints * k * k, and a pour onto a clean
 * square (one no drink has ever stood on) multiplies that by cleanPercent. A drink set down leaves
 * its pirate's ring on the square for good: a clean square scores ringPoints when it is first rung.
 * Every drink scores its value as it is poured: pourPoints, and agePoints for every turn it has
 * waited in the hand, up to ageMax.
 *
 * Each pirate holds a hand of `offer` drinks, dealt from one shuffled bag of every glass and brew
 * together, with icePerBag ice and ragsPerBag rags in it. Ice is set down on any empty square and
 * anything may stand beside it. A rag wipes one drink off the bar (its ring stays) and scores
 * nothing. A turn is one pour, or one drink drunk: a drink downed scores its value at once, but
 * every `tolerance` drinks without `soberAfter` pours between them put the pirate out cold for
 * their next turn. A pirate with nothing to pour must drink. A rag that is not used to wipe is
 * tossed away.
 *
 * The player is seat 0. The rivals, seats 1 to `rivals`, play inside the reducer from the round's
 * random stream, so a round replays from the player's moves alone. Every hand is on show. The round
 * ends at last call, when every pirate has taken `lastCall` turns. The score is the player's own points.
 *
 * Cell index = row * size + col, row 0 at the top. Nothing here reads a clock: the round's length is
 * the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

export interface PouringConfig {
  /** Squares along each side of the bar. */
  readonly size: number;
  /** Kinds of glass: 0 to glasses - 1. */
  readonly glasses: number;
  /** Kinds of brew: 0 to brews - 1. */
  readonly brews: number;
  /** Drinks in each pirate's hand. */
  readonly offer: number;
  /** Rival pirates at the bar. 0: the player pours alone. */
  readonly rivals: number;
  /** Percent of a rival's turns on which it takes the pour it rates best; on the rest it pours anything that fits. */
  readonly rivalSkill: number;
  /** What every drink is worth, poured or drunk. */
  readonly pourPoints: number;
  /** What a drink gains for each turn it waits in a hand. */
  readonly agePoints: number;
  /** The most turns of waiting that count. */
  readonly ageMax: number;
  /** A clean square's first ring. */
  readonly ringPoints: number;
  /** k lines served by one pour score linePoints * k * k. */
  readonly linePoints: number;
  /** What serving lines with a pour onto a clean square multiplies them by, in percent. 100: no bonus. */
  readonly cleanPercent: number;
  /** Drinks in a row, without soberAfter pours between, that put a pirate out cold for a turn. */
  readonly tolerance: number;
  /** Pours that take one drink off a pirate's count. */
  readonly soberAfter: number;
  /** Ice in each bag: set down on any empty square, and anything stands beside it. */
  readonly icePerBag: number;
  /** Rags in each bag: wipe one drink off the bar. */
  readonly ragsPerBag: number;
  /** Turns each pirate takes before the round ends. */
  readonly lastCall: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_POURING_CONFIG: PouringConfig = {
  size: 6,
  glasses: 4,
  brews: 4,
  offer: 2,
  rivals: 2,
  rivalSkill: 70,
  pourPoints: 5,
  agePoints: 5,
  ageMax: 4,
  ringPoints: 20,
  linePoints: 100,
  cleanPercent: 200,
  tolerance: 3,
  soberAfter: 3,
  icePerBag: 2,
  ragsPerBag: 2,
  lastCall: 20,
  maxMoves: 100,
};

/** What a piece is: a drink of a glass and a brew, ice, or a rag. */
export type PouringPieceKind = "drink" | "ice" | "rag";

export interface PouringPiece {
  /** Stable identity for animation. Never reused within a round. */
  readonly id: number;
  readonly kind: PouringPieceKind;
  /** For a drink: 0 to glasses - 1. -1 for ice and a rag. */
  readonly glass: number;
  /** For a drink: 0 to brews - 1. -1 for ice and a rag. */
  readonly brew: number;
}

/** One drink in a hand, and how many turns it has waited there. */
export interface PouringSlot {
  readonly piece: PouringPiece;
  readonly age: number;
}

export interface PouringSeat {
  readonly hand: readonly PouringSlot[];
  readonly score: number;
  /** Drinks downed since the count last fell to zero. At `tolerance` the pirate is out cold. */
  readonly drunk: number;
  /** Pours since the last drink or the last time the count fell. */
  readonly sober: number;
  /** Out cold: the next turn is lost. */
  readonly asleep: boolean;
  /** Turns taken, lost ones included. */
  readonly turns: number;
  /** Lines this pirate has served. */
  readonly lines: number;
}

export type PouringMove =
  /** Set the drink in hand slot `slot` down on `cell`: a drink or ice on an empty square, a rag on a drink to wipe it. */
  | { readonly type: "pour"; readonly slot: number; readonly cell: number }
  /** Down the drink in hand slot `slot`, or toss a rag. */
  | { readonly type: "drink"; readonly slot: number }
  | { readonly type: "end" };

/** A line served: a row or a column, and its cells in order. */
export interface PouringLine {
  readonly axis: "row" | "col";
  readonly index: number;
  readonly cells: readonly number[];
}

/** One turn at the bar, the player's or a rival's, as the board plays it back. */
export interface PouringAct {
  readonly seat: number;
  /** `pour` sets a drink or ice down, `wipe` is a rag on a drink, `drink` downs one, `toss` throws a rag away, `sleep` is a turn lost out cold. */
  readonly type: "pour" | "wipe" | "drink" | "toss" | "sleep";
  /** The hand slot used. -1 for a lost turn. */
  readonly slot: number;
  /** The piece that left the hand. Null for a lost turn. */
  readonly piece: PouringPiece | null;
  /** The square poured on or wiped. -1 for a drink, a toss or a lost turn. */
  readonly cell: number;
  /** The drink a rag wiped off the bar. */
  readonly wiped: PouringPiece | null;
  /** True when the square had never been rung. */
  readonly clean: boolean;
  /** Lines served, and the drinks taken off the bar with them (each once, by cell). */
  readonly lines: readonly PouringLine[];
  readonly taken: ReadonlyArray<{ readonly cell: number; readonly id: number }>;
  /** The drink's value, the ring and the lines. */
  readonly drinkPoints: number;
  readonly ringPoints: number;
  readonly linePoints: number;
  readonly points: number;
  /** This drink put the pirate out cold. */
  readonly passedOut: boolean;
  /** The seat's hand once the slot is dealt again and the rest have aged. */
  readonly hand: readonly PouringSlot[];
  /** The bar after the act. */
  readonly cells: readonly (PouringPiece | null)[];
  readonly rings: readonly number[];
}

/** What a pour would do, before it is made: the engine's own sum, for the board's preview and the hint. */
export interface PouringPourValue {
  readonly legal: boolean;
  readonly clean: boolean;
  readonly lines: readonly PouringLine[];
  readonly drinkPoints: number;
  readonly ringPoints: number;
  readonly linePoints: number;
  readonly points: number;
}

export interface PouringMoveReport {
  readonly move: PouringMove;
  /** The player's act first, then every rival's and every lost turn, in order, until the player is to pour again. */
  readonly acts: readonly PouringAct[];
}

export interface PouringState {
  readonly config: PouringConfig;
  /** The bar: a drink or ice on a square, or null. */
  readonly cells: readonly (PouringPiece | null)[];
  /** Whose ring is on each square: a seat, or -1 for a clean square. */
  readonly rings: readonly number[];
  /** Seat 0 is the player. */
  readonly seats: readonly PouringSeat[];
  /** What is left in the bag, drawn from the front. */
  readonly bag: readonly PouringPiece[];
  readonly rng: PrngState;
  readonly nextId: number;
  /** The player's points. */
  readonly score: number;
  /** The player's moves. */
  readonly moveCount: number;
  /** The most lines one of the player's pours served. */
  readonly bestCombo: number;
  readonly lastMove: PouringMoveReport | null;
  readonly finished: boolean;
}
