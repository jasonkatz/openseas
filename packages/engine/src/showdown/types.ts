/**
 * Showdown (prototype, ADR 0036, ADR 0082): fixed-limit hold'em at a card table, the player against
 * rivals the engine plays. A successor to the original's Poker, faithful to its mechanics.
 *
 * A round is a knockout. Every seat sits down with `stack` chips. Each hand every seat still in is
 * dealt two cards face down, and five cards are turned face up in the middle, three, then one, then
 * one. Each player makes the best five card hand they can from their two and the five. Before the
 * first card is turned and after each turn there is a round of betting:
 *
 * - The seat left of the button posts the small blind, the next the big blind (heads up, the button
 *   posts the small blind). Before the turn of the first three cards, the seat left of the big blind
 *   acts first; after it, the first seat left of the button still in.
 * - A seat to act folds, calls (checks when there is nothing to call) or raises (bets when nothing
 *   has been bet). Bets are fixed: `smallBet` before and on the first three cards, `bigBet` on the
 *   fourth and fifth. A street takes at most `raiseCap` bets, the big blind counting as the first.
 * - A seat that cannot cover a call or a raise puts in all it has: it is all in, acts no more this
 *   hand, and can win from each seat only what it put in itself. The rest is a side pot among the
 *   seats that put in more. A raise short of a full bet does not count toward the cap.
 * - A street ends when every seat that can still bet has acted and put in the same. When one seat
 *   is left it takes the pot. When no more than one seat can still bet, the cards left are turned
 *   one street at a time with no betting. After the fifth card, the seats still in show and the
 *   best hand takes each pot it is in; equal hands share it, an odd chip to the first of them left
 *   of the button.
 *
 * A seat with no chips after a hand is out. The player loses when they are out, and wins when every
 * rival is. The score is `knockout` points for each rival out, and for a win `speed` points for each
 * hand of `hands` not needed. After `hands` hands with seats still in, a rival with fewer chips than
 * the player counts as beaten. Leaving early (`end`) keeps the rivals already out and nothing else.
 *
 * The rivals are dealt from `styles` at the start of the round, one style a seat, and every one of
 * them is played by the same rule with its style's numbers: it reckons its share of the pot by
 * dealing out the unseen cards `samples` times from its own seeded stream, then folds, calls or raises
 * against the price. A rival sees only its own cards, the cards turned and the betting.
 *
 * The engine waits on the player, never on the clock. When a rival is to act, or a card is to turn
 * with no betting, the only move is `next`, which plays that one step (the board sends it at its own
 * pace). When a hand is over the only move is `deal`.
 *
 * Seats are 0 (the player) to `rivals`, clockwise. Cards are 0..51: rank `card % 13` (0 is a two,
 * 12 an ace) and suit `floor(card / 13)`: spades, hearts, diamonds, clubs.
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
  /** Hands before the round ends with seats still in. */
  readonly hands: number;
  /** Chips every seat sits down with. */
  readonly stack: number;
  /** Points for each rival out. */
  readonly knockout: number;
  /** Points, on a win, for each hand of `hands` not needed. */
  readonly speed: number;
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
  hands: 40,
  stack: 10,
  knockout: 100,
  speed: 2,
  smallBlind: 1,
  bigBlind: 1,
  smallBet: 1,
  bigBet: 2,
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
  /** A seat acts, putting in `paid`; `allIn` when that was the last of its chips. */
  | { readonly kind: "act"; readonly seat: number; readonly action: ShowdownAction; readonly paid: number; readonly pot: number; readonly allIn: boolean }
  /** Cards turned face up: three on the flop, then one, then one. */
  | { readonly kind: "street"; readonly street: number; readonly cards: readonly number[] }
  /** The hand is over. `winners` and `amounts` hold every seat paid, side pots summed. `shown` holds each seat that showed, with its cards and hand; empty when all but one folded. `out` holds the seats it put out. */
  | {
      readonly kind: "win";
      readonly pot: number;
      readonly winners: readonly number[];
      readonly amounts: readonly number[];
      readonly shown: ReadonlyArray<{ readonly seat: number; readonly cards: readonly number[]; readonly hand: ShowdownHandName; readonly best: readonly number[] }>;
      /** The player raised after checking on a street of this hand, and won it. */
      readonly trap: boolean;
      readonly out: readonly number[];
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
  /** Out of the round: no chips left. */
  readonly out: boolean;
  /** Chips behind, not yet in the pot. */
  readonly stack: number;
  /** Put in this street. */
  readonly street: number;
  /** Put in this hand. */
  readonly inPot: number;
  /** Has acted since the last raise on this street. */
  readonly acted: boolean;
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
  /** The seat to act; -1 between hands, and when cards turn with no betting. */
  readonly toAct: number;
  readonly phase: ShowdownPhase;
  /** The player checked on this street. */
  readonly checked: boolean;
  /** The player raised after checking in this hand. */
  readonly trapSet: boolean;
  /** Knockout points so far, and the win's speed points. */
  readonly score: number;
  /** The player won: every rival is out. */
  readonly won: boolean;
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
