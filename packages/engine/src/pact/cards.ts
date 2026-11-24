/**
 * Pact's cards: the deck, which cards a seat may play, and who takes a trick. Pure integer
 * arithmetic throughout.
 */
import { nextInt, type PrngState } from "../prng.js";
import { PACT_SPADES } from "./types.js";

export const DECK = 52;
export const rankOf = (card: number): number => card % 13;
export const suitOf = (card: number): number => Math.floor(card / 13);

/** A shuffled deck from `rng`, Fisher-Yates. */
export function shuffled(rng: PrngState): { deck: number[]; rng: PrngState } {
  const deck = Array.from({ length: DECK }, (_, i) => i);
  let s = rng;
  for (let i = DECK - 1; i > 0; i--) {
    const r = nextInt(s, i + 1);
    s = r.state;
    const j = r.value;
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  return { deck, rng: s };
}

/** A hand in order: by suit, clubs to spades, then by rank. */
export function sortHand(cards: readonly number[]): number[] {
  return [...cards].sort((a, b) => a - b);
}

/**
 * The cards of `hand` that may be played on `trick`: the suit led when the hand holds it, anything
 * when it does not; to lead, anything but a spade until spades are broken, unless only spades are left.
 */
export function legalCards(hand: readonly number[], trick: ReadonlyArray<{ card: number }>, broken: boolean): number[] {
  if (trick.length === 0) {
    if (broken) return [...hand];
    const side = hand.filter((c) => suitOf(c) !== PACT_SPADES);
    return side.length > 0 ? side : [...hand];
  }
  const led = suitOf(trick[0]!.card);
  const follow = hand.filter((c) => suitOf(c) === led);
  return follow.length > 0 ? follow : [...hand];
}

/** Does `a` beat `b` in a trick led in `led`? */
export function beats(a: number, b: number, led: number): boolean {
  const sa = suitOf(a);
  const sb = suitOf(b);
  if (sa === sb) return rankOf(a) > rankOf(b);
  if (sa === PACT_SPADES) return true;
  if (sb === PACT_SPADES) return false;
  return sa === led;
}

/** The entry of a trick (one or more cards) that is taking it so far. */
export function winning<T extends { card: number }>(trick: readonly T[]): T {
  const led = suitOf(trick[0]!.card);
  let best = trick[0]!;
  for (const x of trick) if (beats(x.card, best.card, led)) best = x;
  return best;
}
