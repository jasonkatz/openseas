/**
 * Showdown's cards: the deck, what a hand of five to seven is worth, and a seat's share of a pot
 * reckoned by dealing out the cards it cannot see. Pure integer arithmetic throughout.
 */
import { nextInt, type PrngState } from "../prng.js";
import { SHOWDOWN_HANDS, type ShowdownHandName } from "./types.js";

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

/** The highest card of a five-in-a-row in a mask of ranks, the ace also low; -1 when there is none. */
function straightHigh(mask: number): number {
  for (let hi = 12; hi >= 4; hi--) {
    const run = 0b11111 << (hi - 4);
    if ((mask & run) === run) return hi;
  }
  // Five high: ace, two, three, four, five.
  if ((mask & 0b1111) === 0b1111 && mask & (1 << 12)) return 3;
  return -1;
}

/** The top `n` ranks in a mask, highest first. */
function topRanks(mask: number, n: number, skip: readonly number[] = []): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r) && !skip.includes(r)) out.push(r);
  return out;
}

function code(category: number, ranks: readonly number[]): number {
  let v = category;
  for (let i = 0; i < 5; i++) v = v * 16 + (ranks[i] ?? 0);
  return v;
}

/** The category of a value from `handValue`. */
export function handCategory(value: number): number {
  return Math.floor(value / 16 ** 5);
}

export function handName(value: number): ShowdownHandName {
  return SHOWDOWN_HANDS[handCategory(value)]!;
}

/**
 * What the best five of these five to seven cards are worth: higher beats lower, equal ties. The
 * category leads (a pair, two pairs, three of a kind, a straight, a flush, a full house, four of a
 * kind, a straight flush), then the ranks that break ties within it.
 */
export function handValue(cards: readonly number[]): number {
  const counts = new Array<number>(13).fill(0);
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]!++;
    suitCount[s]!++;
    suitMask[s]! |= 1 << r;
    mask |= 1 << r;
  }
  const flush = suitCount.findIndex((n) => n >= 5);
  if (flush >= 0) {
    const sf = straightHigh(suitMask[flush]!);
    if (sf >= 0) return code(8, [sf]);
  }
  let quad = -1;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quad = r;
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  if (quad >= 0) return code(7, [quad, ...topRanks(mask, 1, [quad])]);
  if (trips.length > 0 && trips.length + pairs.length >= 2) {
    const t = trips[0]!;
    const p = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return code(6, [t, p]);
  }
  if (flush >= 0) return code(5, topRanks(suitMask[flush]!, 5));
  const st = straightHigh(mask);
  if (st >= 0) return code(4, [st]);
  if (trips.length > 0) return code(3, [trips[0]!, ...topRanks(mask, 2, [trips[0]!])]);
  if (pairs.length >= 2) return code(2, [pairs[0]!, pairs[1]!, ...topRanks(mask, 1, [pairs[0]!, pairs[1]!])]);
  if (pairs.length === 1) return code(1, [pairs[0]!, ...topRanks(mask, 3, [pairs[0]!])]);
  return code(0, topRanks(mask, 5));
}

/** The five cards that make the best hand of these, in the order given. For the board to lift them at a showdown. */
export function bestFive(cards: readonly number[]): number[] {
  if (cards.length <= 5) return [...cards];
  let best = -1;
  let pick: number[] = [];
  const n = cards.length;
  for (let m = 0; m < 1 << n; m++) {
    let bits = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) bits++;
    if (bits !== 5) continue;
    const five = cards.filter((_, i) => m & (1 << i));
    const v = handValue(five);
    if (v > best) {
      best = v;
      pick = five;
    }
  }
  return pick;
}

/** Units a sole winner takes in `share`: a tie among t takes UNIT / t each, whole for any t up to six. */
const UNIT = 60;

/**
 * A seat's share of the pot in thousandths, reckoned by dealing out the cards it cannot see
 * `samples` times: the rest of the middle and `opponents` hands of two, from the deck without its
 * own cards and those showing. A tie shares.
 */
export function equity(hole: readonly number[], board: readonly number[], opponents: number, samples: number, rng: PrngState): { share: number; rng: PrngState } {
  const known = new Set([...hole, ...board]);
  const rest: number[] = [];
  for (let c = 0; c < DECK; c++) if (!known.has(c)) rest.push(c);
  const need = opponents * 2 + (5 - board.length);
  let s = rng;
  let total = 0;
  const mine = [...hole, ...board];
  const full = [...board];
  for (let i = 0; i < samples; i++) {
    // A partial shuffle of the unseen cards: the first `need` are this deal's.
    for (let k = 0; k < need; k++) {
      const r = nextInt(s, rest.length - k);
      s = r.state;
      const j = k + r.value;
      const t = rest[k]!;
      rest[k] = rest[j]!;
      rest[j] = t;
    }
    let at = opponents * 2;
    full.length = board.length;
    while (full.length < 5) full.push(rest[at++]!);
    mine.length = hole.length + board.length;
    for (let k = board.length; k < 5; k++) mine.push(full[k]!);
    const me = handValue(mine);
    let best = me;
    let ties = 1;
    let beaten = false;
    for (let o = 0; o < opponents; o++) {
      const v = handValue([rest[o * 2]!, rest[o * 2 + 1]!, ...full]);
      if (v > best) {
        beaten = true;
        break;
      }
      if (v === me) ties++;
    }
    if (!beaten && best === me) total += UNIT / ties;
  }
  return { share: Math.floor((total * 1000) / (samples * UNIT)), rng: s };
}
