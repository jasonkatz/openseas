/**
 * How the engine plays a seat: the partner and both opponents, and the studio's hint for the player.
 * One rule, which sees only what the seat could see: its own cards, the bids, the cards played this
 * hand (and so which seats have shown a void), the tricks each seat has taken, and whether spades are
 * broken. It never reads another seat's cards. It draws nothing at random.
 */
import { beats, legalCards, rankOf, suitOf, winning } from "./cards.js";
import { PACT_SEATS, PACT_SPADES, type PactState } from "./types.js";

/** What a seat's rule knows to do. The full rule is all on; the bots turn parts off to measure them. */
export interface SeatSkill {
  /** Remembers the cards played: a card is a sure winner once every higher one of its suit is out. Off: only an ace is. */
  readonly memory: boolean;
  /** Once its side's pact is made, ducks tricks rather than gather bags. */
  readonly duck: boolean;
  /** Bids nil on a hand that can take nothing, and covers a partner's nil. */
  readonly nil: boolean;
  /** Plays to set the rivals: lets a rival's nil take a trick, and takes tricks the rivals need once its own pact is made. */
  readonly set: boolean;
}

export const FULL_SKILL: SeatSkill = { memory: true, duck: true, nil: true, set: true };

export type SeatChoice = { readonly kind: "bid"; readonly bid: number } | { readonly kind: "play"; readonly card: number };

const partnerOf = (seat: number): number => (seat + 2) % PACT_SEATS;
const sideOf = (seat: number): number => seat % 2;

/**
 * The tricks a hand of thirteen should take, in tenths: its high cards, with the length and the
 * shortness its spades can make good. A rule of thumb a card player bids by.
 */
export function estimate(cards: readonly number[]): number {
  const bySuit: number[][] = [[], [], [], []];
  for (const c of cards) bySuit[suitOf(c)]!.push(rankOf(c));
  for (const s of bySuit) s.sort((a, b) => b - a);
  const spades = bySuit[PACT_SPADES]!;
  const S = spades.length;
  let t = 0;
  // Side suits: an ace nearly always takes a trick; a guarded king often; a queen sometimes.
  for (let s = 0; s < 3; s++) {
    const r = bySuit[s]!;
    const L = r.length;
    const has = (rank: number): boolean => r.includes(rank);
    if (has(12)) t += L <= 5 ? 10 : 6;
    if (has(11)) t += L === 1 ? 1 : L <= 4 ? (has(12) ? 9 : 7) : 4;
    if (has(10) && L >= 3 && L <= 4) t += has(12) || has(11) ? 4 : 2;
  }
  // Spades: the top ones, then length.
  let counted = 0;
  if (spades.includes(12)) (t += 10), counted++;
  if (spades.includes(11) && S >= 2) (t += 9), counted++;
  if (spades.includes(10) && S >= 3) (t += 7), counted++;
  if (spades.includes(9) && S >= 4) (t += 5), counted++;
  if (S > 3) t += (S - 3) * 8 - Math.min(counted, S - 3) * 4;
  // Short side suits ruffed with spades that are not already counted.
  let spare = Math.max(0, S - Math.max(counted, 2));
  for (let s = 0; s < 3 && spare > 0; s++) {
    const L = bySuit[s]!.length;
    if (L === 0) {
      t += 9;
      spare--;
    } else if (L === 1 && spare > 0) {
      t += 5;
      spare--;
    }
  }
  return t;
}

/** Could this hand take no trick? Low spades, few of them, and nothing high in the other suits. */
function nilShaped(cards: readonly number[]): boolean {
  const spades = cards.filter((c) => suitOf(c) === PACT_SPADES);
  if (spades.length > 3 || spades.some((c) => rankOf(c) >= 8)) return false;
  for (let s = 0; s < 3; s++) {
    const r = cards.filter((c) => suitOf(c) === s).map(rankOf);
    // A high card in a short suit is the danger; in a long suit it can be thrown away.
    if (r.includes(12)) return false;
    if (r.includes(11) && r.length < 4) return false;
    if (r.includes(10) && r.length < 3) return false;
  }
  return estimate(cards) <= 12;
}

/** The bid a seat makes, from its own cards and the bids before it. */
function chooseBid(state: PactState, seat: number, skill: SeatSkill): number {
  const cards = state.seats[seat]!.cards;
  const partner = state.seats[partnerOf(seat)]!.bid;
  const est = estimate(cards);
  const nilOn = state.config.nilBonus > 0;
  if (nilOn && skill.nil && partner !== 0 && nilShaped(cards)) return 0;
  let bid = Math.max(1, Math.round((est + state.config.seatLean) / 10));
  // A partner's nil leaves this seat the side's whole pact, and it must cover them: bid what it can.
  if (partner === 0 && skill.nil) bid = Math.max(bid, Math.round((est + 5) / 10));
  // The side holds thirteen tricks at most between them.
  if (partner !== null && partner > 0) bid = Math.min(bid, 13 - partner);
  return Math.max(nilOn ? 1 : 1, Math.min(13, bid));
}

/** The card is the highest of its suit still out, by what this seat has seen. */
function isTop(card: number, seen: ReadonlySet<number>, held: readonly number[], memory: boolean): boolean {
  if (!memory) return rankOf(card) === 12;
  const s = suitOf(card);
  for (let r = rankOf(card) + 1; r < 13; r++) {
    const c = s * 13 + r;
    if (!seen.has(c) && !held.includes(c)) return false;
  }
  return true;
}

const lowest = (cards: readonly number[]): number => cards.reduce((a, b) => (rankOf(b) < rankOf(a) || (rankOf(b) === rankOf(a) && b < a) ? b : a));
const highest = (cards: readonly number[]): number => cards.reduce((a, b) => (rankOf(b) > rankOf(a) || (rankOf(b) === rankOf(a) && b > a) ? b : a));

/** A card to throw away when it cannot follow and will not trump: the lowest of its shortest side suit. */
function discard(hand: readonly number[], keepHigh: boolean): number {
  const side = hand.filter((c) => suitOf(c) !== PACT_SPADES);
  if (side.length === 0) return keepHigh ? lowest(hand) : highest(hand);
  if (!keepHigh) return highest(side);
  let best = side[0]!;
  let bestLen = 99;
  for (const c of side) {
    const len = side.filter((x) => suitOf(x) === suitOf(c)).length;
    if (len < bestLen || (len === bestLen && rankOf(c) < rankOf(best))) {
      best = c;
      bestLen = len;
    }
  }
  return best;
}

/** What a seat's side still needs, and whether a nil of its own is still alive. */
function needs(state: PactState, seat: number): { need: number; theirNeed: number; myNil: boolean; partnerNil: boolean; rivalNils: number[] } {
  const side = sideOf(seat);
  let pact = 0;
  let took = 0;
  let theirPact = 0;
  let theirTook = 0;
  const rivalNils: number[] = [];
  state.seats.forEach((s, i) => {
    const bid = s.bid ?? 0;
    if (sideOf(i) === side) {
      if (bid > 0) {
        pact += bid;
        took += s.tricks;
      }
    } else if (bid > 0) {
      theirPact += bid;
      theirTook += s.tricks;
    } else if (s.bid === 0 && s.tricks === 0) rivalNils.push(i);
  });
  const me = state.seats[seat]!;
  const p = state.seats[partnerOf(seat)]!;
  return {
    need: pact - took,
    theirNeed: theirPact - theirTook,
    myNil: me.bid === 0 && me.tricks === 0,
    partnerNil: p.bid === 0 && p.tricks === 0,
    rivalNils,
  };
}

/** The card a seat plays, from what it can see. */
function chooseCard(state: PactState, seat: number, skill: SeatSkill): number {
  const hand = state.seats[seat]!.cards;
  const trick = state.trick;
  const legal = legalCards(hand, trick, state.broken);
  if (legal.length === 1) return legal[0]!;
  const seen = new Set(state.played);
  const { need, theirNeed, myNil, partnerNil, rivalNils } = needs(state, seat);
  const tricksLeft = hand.length;
  // Wants tricks: the side's pact is short, or (setting) the rivals are close enough to stop.
  const setting = skill.set && need <= 0 && theirNeed > 0 && theirNeed <= tricksLeft;
  const wants = need > 0 || !skill.duck || setting;

  // Will the seats still to play this trick be able to trump the suit?
  const after = (led: number): boolean => {
    for (let k = trick.length + 1; k < PACT_SEATS; k++) {
      const s = (seat + (k - trick.length)) % PACT_SEATS;
      const v = state.seats[s]!.voids;
      if (v & (1 << led) && !(v & (1 << PACT_SPADES))) return true;
    }
    return false;
  };
  const sure = (card: number): boolean => isTop(card, seen, hand, skill.memory) && (suitOf(card) === PACT_SPADES || !after(suitOf(card)));

  if (trick.length === 0) {
    if (myNil && skill.nil) return lowest(legal);
    if (wants || partnerNil) {
      // A sure winner first: a side suit's top card, or a top spade once broken.
      const tops = legal.filter((c) => isTop(c, seen, hand, skill.memory));
      const side = tops.filter((c) => suitOf(c) !== PACT_SPADES);
      if (side.length > 0) return highest(side);
      if (tops.length > 0) return highest(tops);
      // Else something low from the longest side suit, to make the others spend their high cards.
      const sides = legal.filter((c) => suitOf(c) !== PACT_SPADES);
      const pool = sides.length > 0 ? sides : legal;
      let best = pool[0]!;
      let bestLen = -1;
      for (const c of pool) {
        const len = pool.filter((x) => suitOf(x) === suitOf(c)).length;
        if (len > bestLen || (len === bestLen && rankOf(c) < rankOf(best))) {
          best = c;
          bestLen = len;
        }
      }
      return best;
    }
    // Nothing needed: lead low and let someone else take it.
    return lowest(legal);
  }

  const led = suitOf(trick[0]!.card);
  const top = winning(trick);
  const winners = legal.filter((c) => beats(c, top.card, led));
  const losers = legal.filter((c) => !beats(c, top.card, led));
  const following = suitOf(legal[0]!) === led && legal.every((c) => suitOf(c) === led);
  const last = trick.length === PACT_SEATS - 1;

  if (myNil && skill.nil) {
    // Stay under: the highest card that does not take it; forced, the lowest.
    if (losers.length > 0) return following ? highest(losers) : discard(losers, false);
    return lowest(winners);
  }
  // A rival's nil is taking it: let it.
  if (skill.set && rivalNils.includes(top.seat) && losers.length > 0) return following ? lowest(losers) : discard(losers, true);
  // A partner's nil is taking it: take it off them with the cheapest card that does.
  if (partnerNil && skill.nil && top.seat === partnerOf(seat) && winners.length > 0) return lowest(winners);

  if (top.seat === partnerOf(seat)) {
    // The partner has it: keep the good cards. Overtake only a trick the next seat can still beat, when the side needs it.
    const holds = last || sure(top.card);
    if (!holds && wants && !last && winners.length > 0 && following) {
      const sureWin = winners.filter(sure);
      if (sureWin.length > 0) return lowest(sureWin);
    }
    if (losers.length > 0) return following ? lowest(losers) : discard(losers, true);
    return lowest(legal);
  }

  // A rival has it.
  if (wants && winners.length > 0) {
    if (last) return lowest(winners);
    const sureWin = winners.filter(sure);
    if (sureWin.length > 0) return lowest(sureWin);
    // Trumping in: the cheapest spade that takes it.
    if (!following) return lowest(winners);
    // Second to play: low, and leave it to the partner. Third: try with the cheapest card that takes it.
    if (trick.length === 1 && losers.length > 0) return lowest(losers);
    return lowest(winners);
  }
  if (losers.length > 0) return following ? (wants ? lowest(losers) : highest(losers)) : discard(losers, true);
  return lowest(winners);
}

/** What seat `seat` does now, by the rule with `skill`: its bid, or its card. */
export function seatChoice(state: PactState, seat: number, skill: SeatSkill = FULL_SKILL): SeatChoice {
  if (state.seats[seat]!.bid === null) return { kind: "bid", bid: chooseBid(state, seat, skill) };
  return { kind: "play", card: chooseCard(state, seat, skill) };
}
