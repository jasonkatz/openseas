/**
 * Pact (prototype, ADR 0036, ADR 0087): partnership trick-taking with bids, the player and a partner
 * the engine plays against two opponents it plays too. A successor to the original's Spades, faithful
 * to its mechanics.
 *
 * Four seats, clockwise: 0 the player, 1 the opponent on their left, 2 their partner across the
 * table, 3 the opponent on their right. Seats 0 and 2 are a side, 1 and 3 the other. A round is a
 * sitting of `hands` hands. In each hand:
 *
 * - The deal moves one seat round. Every seat is dealt thirteen cards.
 * - **The bids.** From the seat after the dealer, each seat in turn bids the tricks it means to take,
 *   1 to 13, or nil (0): that it will take none (only while `nilBonus` is above zero). A side's
 *   pact is the sum of its bids that are not nil.
 * - **The tricks.** The seat after the dealer leads the first trick; whoever takes a trick leads the
 *   next. Each seat in turn plays one card and must follow the suit led if it can. Spades are trumps:
 *   the highest spade in a trick takes it, or with none the highest card of the suit led. Spades may
 *   not be led until one has been played on another suit (they are broken), unless the leader holds
 *   nothing else.
 * - **The count.** A side that takes at least its pact (the tricks of its nil bidders not counted)
 *   scores `trickValue` for each trick of the pact and `bagValue` for each over it; each trick over,
 *   a nil bidder's too, is a bag. A side that takes fewer loses `trickValue` for each trick of the
 *   pact. A nil that takes no trick scores `nilBonus`, and one that takes any loses it. Every
 *   `bagLimit` bags a side has gathered over the sitting cost it `bagPenalty`. A side whose rivals
 *   fall short of their pact scores `setBonus` for each trick of the pact they bid.
 * - **A hand never scores below zero.** Whatever a side's count for a hand comes to, it adds that or
 *   nothing to its total: the total only climbs, and a bad hand costs what it could have made.
 *
 * The round's score is the player's side's total. A sitting left before its last hand keeps the hands
 * counted; the hand in play counts for nothing.
 *
 * The other three seats are played by one rule (`seatChoice`) that sees only what that seat could:
 * its own cards, the bids, the cards played and the tricks taken. Its turn is a move in the log
 * (`next`), one bid or one card, which the board sends at its own pace, so a round replays from its
 * log. The engine waits on the player, never on the clock. When a hand is over the only move is
 * `deal`.
 *
 * Cards are 0..51: rank `card % 13` (0 is a two, 12 an ace) and suit `floor(card / 13)`: 0 clubs,
 * 1 diamonds, 2 hearts, 3 spades.
 */
import type { PrngState } from "../prng.js";

export interface PactConfig {
  /** Hands in a sitting. */
  readonly hands: number;
  /** Points for each trick of a pact that is made, and lost for each when it is not. */
  readonly trickValue: number;
  /** Points for each trick over a pact. */
  readonly bagValue: number;
  /** What a nil scores when it takes no trick, and loses when it takes one. 0: nobody bids nil. */
  readonly nilBonus: number;
  /** Bags a side gathers before they cost it `bagPenalty`. 0: bags never cost. */
  readonly bagLimit: number;
  readonly bagPenalty: number;
  /** Points a side scores for each trick of its rivals' pact when they fall short. 0: none. */
  readonly setBonus: number;
  /** How far the other seats lean their bids over the tricks their cards count to, in tenths of a trick. */
  readonly seatLean: number;
  /** About how long a hand takes at a person's pace, in seconds: the live tier indicator reads a stretch of play as a sitting of hands this long. */
  readonly handSeconds: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_PACT_CONFIG: PactConfig = {
  hands: 4,
  trickValue: 10,
  bagValue: 1,
  nilBonus: 100,
  bagLimit: 10,
  bagPenalty: 100,
  setBonus: 10,
  seatLean: 4,
  handSeconds: 100,
  maxMoves: 2000,
};

export const PACT_SEATS = 4;
export const PACT_SPADES = 3;

export type PactMove =
  /** The player's bid: 1 to 13 tricks, or 0 for nil. */
  | { readonly type: "bid"; readonly bid: number }
  /** The player plays a card from their hand. */
  | { readonly type: "play"; readonly card: number }
  /** Let the seat to act bid or play. */
  | { readonly type: "next" }
  /** Start the next hand. */
  | { readonly type: "deal" }
  | { readonly type: "end" };

/** Whose turn it is: the player's bid, the player's card, another seat's, or nobody's between hands. */
export type PactPhase = "bid" | "play" | "table" | "over";

/** One side's count for a hand. */
export interface PactCount {
  /** The side's pact: its bids that are not nil. */
  readonly pact: number;
  /** Tricks taken toward it: those of its seats that did not bid nil. */
  readonly took: number;
  /** Points for the pact: made, or lost. Zero when the side bid only nil. */
  readonly pactPoints: number;
  /** Each nil the side bid: the seat, and whether it took no trick. */
  readonly nils: ReadonlyArray<{ readonly seat: number; readonly made: boolean }>;
  readonly nilPoints: number;
  /** Bags gathered this hand, and the points they score. */
  readonly bags: number;
  readonly bagPoints: number;
  /** Lost to bags: `bagPenalty` for each `bagLimit` reached this hand. */
  readonly penalty: number;
  /** Won from the rivals falling short. */
  readonly setPoints: number;
  /** The sum of the above, which may be below zero. */
  readonly raw: number;
  /** What the hand adds to the side's total: the raw count, or nothing. */
  readonly added: number;
  /** The side's total after the hand. */
  readonly total: number;
  /** Bags carried after the hand. */
  readonly bagsHeld: number;
}

export type PactEvent =
  /** A hand starts: the dealer and the player's cards. */
  | { readonly kind: "deal"; readonly hand: number; readonly dealer: number; readonly cards: readonly number[] }
  | { readonly kind: "bid"; readonly seat: number; readonly bid: number }
  /** A card played; `broke` when it is the first spade of the hand. */
  | { readonly kind: "card"; readonly seat: number; readonly card: number; readonly broke: boolean }
  /** The fourth card is down: the trick, in the order played, goes to `winner`. */
  | { readonly kind: "trick"; readonly cards: ReadonlyArray<{ readonly seat: number; readonly card: number }>; readonly winner: number; readonly tricks: readonly number[] }
  /** The hand is counted: the player's side (`us`) and the other (`them`). */
  | { readonly kind: "count"; readonly us: PactCount; readonly them: PactCount };

export interface PactMoveReport {
  readonly move: PactMove;
  readonly events: readonly PactEvent[];
}

export interface PactSeat {
  /** Cards held, in order. */
  readonly cards: readonly number[];
  /** The seat's bid this hand: null until it bids, 0 for nil. */
  readonly bid: number | null;
  /** Tricks taken this hand. */
  readonly tricks: number;
  /** A bit for each suit this seat has shown it holds none of, by not following it this hand. */
  readonly voids: number;
}

export interface PactSide {
  /** Points over the sitting: never falls. */
  readonly total: number;
  /** Bags carried toward the next penalty. */
  readonly bags: number;
}

export interface PactState {
  readonly config: PactConfig;
  readonly seats: readonly PactSeat[];
  /** The deal's stream: the deck each hand. */
  readonly rng: PrngState;
  /** Hands dealt so far, the one in play included. */
  readonly hand: number;
  readonly dealer: number;
  /** The seat to act, or -1 between hands. */
  readonly toAct: number;
  readonly phase: PactPhase;
  /** The trick on the table, in the order played. */
  readonly trick: ReadonlyArray<{ readonly seat: number; readonly card: number }>;
  /** Every card played this hand, in order, the trick on the table included. */
  readonly played: readonly number[];
  /** A spade has been played this hand. */
  readonly broken: boolean;
  /** The player's side (seats 0 and 2), and the other (1 and 3). */
  readonly us: PactSide;
  readonly them: PactSide;
  /** The last hand's count, kept until the next deal. */
  readonly count: { readonly us: PactCount; readonly them: PactCount } | null;
  /** The player's side's total: the round's score. */
  readonly score: number;
  /** The player's bids and cards. */
  readonly moveCount: number;
  /** The other seats' bids and cards. */
  readonly tableActs: number;
  /** Moves taken, every kind: what `maxMoves` bounds. */
  readonly logLength: number;
  /** Hands counted. */
  readonly handsDone: number;
  /** Pacts the player's side made. */
  readonly made: number;
  /** Nils the player made. */
  readonly nils: number;
  /** Hands the other side fell short. */
  readonly sets: number;
  /** The most one hand added to the player's side. */
  readonly bestHand: number;
  readonly lastMove: PactMoveReport | null;
  readonly finished: boolean;
}
