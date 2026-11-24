/**
 * Showdown (prototype, ADR 0036, ADR 0082): fixed-limit hold'em at a card table, the player against
 * rivals the engine plays. A successor to the original's Poker, faithful to its mechanics.
 *
 * A round is a sitting of `hands` hands. Each hand every seat is dealt two cards face down, and five
 * cards are turned face up in the middle, three, then one, then one. Each player makes the best five
 * card hand they can from their two and the five. Before the first card is turned and after each turn
 * there is a round of betting:
 *
 * - The seat left of the button posts the small blind, the next the big blind (heads up, the button
 *   posts the small blind). Before the turn of the first three cards, the seat left of the big blind
 *   acts first; after it, the first seat left of the button still in.
 * - A seat to act folds, calls (checks when there is nothing to call) or raises (bets when nothing
 *   has been bet). Bets are fixed: `smallBet` before and on the first three cards, `bigBet` on the
 *   fourth and fifth. A street takes at most `raiseCap` bets, the big blind counting as the first.
 * - A street ends when every seat still in has acted and put in the same. When one seat is left it
 *   takes the pot. After the fifth card's betting, the seats still in show and the best hand takes
 *   the pot; equal hands share it, an odd chip to the first of them left of the button.
 *
 * Nobody has a stack: a seat can always bet, so no one is ever all in and there is never a side pot.
 * What a seat wins and loses is its net. The player sits down with `bank` chips, and the round's
 * score is what they stand up with: their bank and their net, never below zero. A player who runs
 * out plays on; they cannot fall below nothing. A sitting left before its last hand keeps none of
 * its winnings, and only the share of the bank of the hands played out: `bank * done / hands`.
 *
 * The rivals are dealt from `styles` at the start of the sitting, one style a seat, and every one of
 * them is played by the same rule with its style's numbers: it reckons its share of the pot by
 * dealing out the unseen cards `samples` times from its own seeded stream, then folds, calls or raises
 * against the price. A rival sees only its own cards, the cards turned and the betting.
 *
 * The engine waits on the player, never on the clock. When a rival is to act the only move is `next`,
 * which plays that one rival's action (the board sends it at its own pace); when the player has
 * folded, one `next` plays the rest of the hand. When a hand is over the only move is `deal`. The
 * sitting ends after its last hand, or on `end`: a hand cut short by `end` costs the player what they
 * put in it, and the sitting scores as one left early.
 *
 * Seats are 0 (the player) to `rivals`, clockwise. Cards are 0..51: rank `card % 13` (0 is a two,
 * 12 an ace) and suit `floor(card / 13)`.
 */
import type { PrngState } from "../prng.js";

/** The four ways a rival plays, by name. */
export const SHOWDOWN_STYLES = ["brick", "sponge", "hothead", "shark"] as const;
export type ShowdownStyle = (typeof SHOWDOWN_STYLES)[number];

/** How one style plays. Every number is in thousandths of a seat's fair share of the pot. */
export interface ShowdownStyleNumbers {
  /** How far below the price it still calls: a share this much short of what the call costs is called. Below zero, it wants more than the price. */
  readonly slack: number;
  /** The share at which it bets or raises. */
  readonly raiseAt: number;
  /** Chance, per thousand, that it bets when checked to with a share under the fair one. */
  readonly bluff: number;
}

export interface ShowdownConfig {
  /** Rivals at the table: the seats beside the player's. */
  readonly rivals: number;
  /** Hands in a sitting. */
  readonly hands: number;
  /** Chips the player sits down with: the score is these and their net. */
  readonly bank: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** The bet before the turn and on the first three cards. */
  readonly smallBet: number;
  /** The bet on the fourth and fifth cards. */
  readonly bigBet: number;
  /** Bets a street takes, the opening bet (or big blind) counted. */
  readonly raiseCap: number;
  /** The styles the rivals are dealt from, one a seat, without putting one back. At least `rivals` of them. */
  readonly styles: readonly ShowdownStyle[];
  /** Each style's numbers. */
  readonly play: { readonly [K in ShowdownStyle]: ShowdownStyleNumbers };
  /** Deals a rival runs to reckon its share of the pot. */
  readonly samples: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_SHOWDOWN_CONFIG: ShowdownConfig = {
  rivals: 3,
  hands: 12,
  bank: 100,
  smallBlind: 1,
  bigBlind: 2,
  smallBet: 2,
  bigBet: 4,
  raiseCap: 4,
  styles: ["brick", "sponge", "hothead", "shark"],
  play: {
    brick: { slack: -900, raiseAt: 1900, bluff: 0 },
    sponge: { slack: 200, raiseAt: 2200, bluff: 20 },
    hothead: { slack: -100, raiseAt: 1100, bluff: 350 },
    shark: { slack: -500, raiseAt: 1400, bluff: 120 },
  },
  samples: 120,
  maxMoves: 1500,
};

/** The streets of a hand: before the turn, then the first three cards, the fourth, the fifth. */
export const SHOWDOWN_STREETS = ["preflop", "flop", "turn", "river"] as const;

/** Hand categories, lowest first. */
export const SHOWDOWN_HANDS = ["high", "pair", "twoPair", "trips", "straight", "flush", "fullHouse", "quads", "straightFlush"] as const;
export type ShowdownHandName = (typeof SHOWDOWN_HANDS)[number];

export type ShowdownMove =
  | { readonly type: "fold" }
  /** Call what is owed, or check when nothing is. */
  | { readonly type: "call" }
  /** Raise one bet, or bet when nothing has been. */
  | { readonly type: "raise" }
  /** Let the rival to act act; once the player has folded, play out the rest of the hand. */
  | { readonly type: "next" }
  /** Start the next hand. */
  | { readonly type: "deal" }
  | { readonly type: "end" };

export type ShowdownAction = "fold" | "check" | "call" | "bet" | "raise";

/** Whose turn it is: the player's, a rival's, or nobody's between hands. */
export type ShowdownPhase = "act" | "table" | "over";

export type ShowdownEvent =
  /** A hand starts: the button, the blinds posted, and the player's cards. */
  | { readonly kind: "deal"; readonly hand: number; readonly button: number; readonly small: number; readonly big: number; readonly cards: readonly number[] }
  /** A seat acts, putting in `paid`. */
  | { readonly kind: "act"; readonly seat: number; readonly action: ShowdownAction; readonly paid: number; readonly pot: number }
  /** Cards turned face up: three on the flop, then one, then one. */
  | { readonly kind: "street"; readonly street: number; readonly cards: readonly number[] }
  /** The hand is over. `shown` holds each seat that showed, with its cards and hand; empty when all but one folded. */
  | {
      readonly kind: "win";
      readonly pot: number;
      readonly winners: readonly number[];
      readonly amounts: readonly number[];
      readonly shown: ReadonlyArray<{ readonly seat: number; readonly cards: readonly number[]; readonly hand: ShowdownHandName; readonly best: readonly number[] }>;
      /** The player raised after checking on a street of this hand, and won it. */
      readonly trap: boolean;
    };

export interface ShowdownMoveReport {
  readonly move: ShowdownMove;
  readonly events: readonly ShowdownEvent[];
}

export interface ShowdownSeat {
  /** The rival's style; the player's seat is null. */
  readonly style: ShowdownStyle | null;
  readonly cards: readonly number[];
  readonly folded: boolean;
  /** Put in this street. */
  readonly street: number;
  /** Put in this hand. */
  readonly inPot: number;
  /** Has acted since the last raise on this street. */
  readonly acted: boolean;
  /** Won less lost over the sitting. */
  readonly net: number;
  /** Showed its cards at the last showdown. */
  readonly shown: boolean;
}

export interface ShowdownState {
  readonly config: ShowdownConfig;
  readonly seats: readonly ShowdownSeat[];
  /** The deal's stream: the deck each hand. */
  readonly rng: PrngState;
  /** The rivals' stream: their reckoning and their bluffs. */
  readonly think: PrngState;
  /** Hands dealt so far, the one in play included. */
  readonly hand: number;
  readonly button: number;
  /** The five cards of the middle, in the order they turn. */
  readonly board: readonly number[];
  /** 0 before the turn, then 1, 2, 3: how many of the board are showing is 0, 3, 4, 5. */
  readonly street: number;
  /** The most put in by one seat this street. */
  readonly bet: number;
  /** Bets made this street, the big blind counted. */
  readonly bets: number;
  /** The seat to act, or -1 between hands. */
  readonly toAct: number;
  readonly phase: ShowdownPhase;
  /** The player checked on this street. */
  readonly checked: boolean;
  /** The player raised after checking in this hand. */
  readonly trapSet: boolean;
  /** The player's bank and net, never below zero. */
  readonly score: number;
  /** The player's decisions. */
  readonly moveCount: number;
  /** The rivals' actions. */
  readonly tableActs: number;
  /** Moves taken, every kind: what `maxMoves` bounds. */
  readonly logLength: number;
  readonly handsWon: number;
  /** The biggest pot the player took, all of it. */
  readonly bestPot: number;
  /** Pots the player won after checking and then raising on one street. */
  readonly traps: number;
  readonly lastMove: ShowdownMoveReport | null;
  readonly finished: boolean;
}
