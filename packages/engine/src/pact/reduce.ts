import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString } from "../prng.js";
import { legalCards, rankOf, shuffled, sortHand, suitOf, winning } from "./cards.js";
import { FULL_SKILL, seatChoice } from "./seat.js";
import { PACT_SEATS, PACT_SPADES, type PactConfig, type PactCount, type PactEvent, type PactMove, type PactSeat, type PactSide, type PactState } from "./types.js";

export function validateConfig(cfg: PactConfig): void {
  const int = (n: unknown, lo: number, hi: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.hands, 1, 50) &&
    int(cfg.trickValue, 0, 1000) &&
    int(cfg.bagValue, 0, 1000) &&
    int(cfg.nilBonus, 0, 10_000) &&
    int(cfg.bagLimit, 0, 100) &&
    int(cfg.bagPenalty, 0, 10_000) &&
    int(cfg.setBonus, 0, 1000) &&
    int(cfg.seatLean, -50, 50) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid pact config");
}

const sideOf = (seat: number): number => seat % 2;

/** The lowest bid a seat may make: nil when nil is on, else one. */
export function minBid(config: PactConfig): number {
  return config.nilBonus > 0 ? 0 : 1;
}

/** The cards the player may play now; none when it is not their card to play. */
export function playable(state: PactState, seat = 0): number[] {
  if (state.toAct !== seat || state.seats[seat]!.bid === null || state.phase === "over") return [];
  return legalCards(state.seats[seat]!.cards, state.trick, state.broken);
}

/** Why the player cannot make this move now, or null. */
export function moveIllegalReason(state: PactState, move: PactMove): string | null {
  if (state.finished) return "the sitting is over";
  switch (move.type) {
    case "end":
      return null;
    case "deal":
      return state.phase === "over" ? null : "a hand is in play";
    case "next":
      return state.phase === "table" ? null : state.phase === "over" ? "the hand is over" : "it is your turn";
    case "bid":
      if (state.phase !== "bid") return state.phase === "play" ? "the bids are in" : state.phase === "table" ? "another seat is to act" : "the hand is over";
      if (!Number.isInteger(move.bid) || move.bid < minBid(state.config) || move.bid > 13) return "a bid is 1 to 13, or nil";
      return null;
    case "play":
      if (state.phase !== "play") return state.phase === "bid" ? "bid first" : state.phase === "table" ? "another seat is to act" : "the hand is over";
      if (!state.seats[0]!.cards.includes(move.card)) return "not in your hand";
      if (!playable(state).includes(move.card)) return state.trick.length === 0 ? "spades are not broken" : "follow the suit led";
      return null;
    default:
      return "unknown move";
  }
}

const phaseFor = (toAct: number, bidding: boolean): PactState["phase"] => (toAct !== 0 ? "table" : bidding ? "bid" : "play");

export function createPactGame(seed: string, config: PactConfig): PactState {
  validateConfig(config);
  let rng = seedFromString(seed);
  const d = nextInt(rng, PACT_SEATS);
  rng = d.state;
  const side: PactSide = { total: 0, bags: 0 };
  const empty: PactState = {
    config,
    seats: Array.from({ length: PACT_SEATS }, () => ({ cards: [], bid: null, tricks: 0, voids: 0 })),
    rng,
    hand: 0,
    // The first hand moves the deal on one, so it starts one seat back.
    dealer: (d.value + PACT_SEATS - 1) % PACT_SEATS,
    toAct: -1,
    phase: "over",
    trick: [],
    played: [],
    broken: false,
    us: side,
    them: side,
    count: null,
    score: 0,
    moveCount: 0,
    tableActs: 0,
    logLength: 0,
    handsDone: 0,
    made: 0,
    nils: 0,
    sets: 0,
    bestHand: 0,
    lastMove: null,
    finished: false,
  };
  return { ...startHand(empty).state, lastMove: null };
}

/** Deal the next hand: move the deal on, shuffle, thirteen cards a seat. */
function startHand(state: PactState): { state: PactState; events: PactEvent[] } {
  const { deck, rng } = shuffled(state.rng);
  const dealer = (state.dealer + 1) % PACT_SEATS;
  const seats: PactSeat[] = state.seats.map((_, i) => ({ cards: sortHand(deck.slice(i * 13, i * 13 + 13)), bid: null, tricks: 0, voids: 0 }));
  const toAct = (dealer + 1) % PACT_SEATS;
  const next: PactState = {
    ...state,
    seats,
    rng,
    hand: state.hand + 1,
    dealer,
    toAct,
    phase: phaseFor(toAct, true),
    trick: [],
    played: [],
    broken: false,
    count: null,
  };
  return { state: next, events: [{ kind: "deal", hand: next.hand, dealer, cards: seats[0]!.cards }] };
}

function bid(state: PactState, seat: number, n: number): { state: PactState; events: PactEvent[] } {
  const seats = state.seats.map((s, i) => (i === seat ? { ...s, bid: n } : s));
  const bidding = seats.some((s) => s.bid === null);
  // The last bid in, the seat after the dealer leads.
  const toAct = bidding ? (seat + 1) % PACT_SEATS : (state.dealer + 1) % PACT_SEATS;
  return { state: { ...state, seats, toAct, phase: phaseFor(toAct, bidding) }, events: [{ kind: "bid", seat, bid: n }] };
}

function play(state: PactState, seat: number, card: number): { state: PactState; events: PactEvent[] } {
  const me = state.seats[seat]!;
  const ledSuit = state.trick.length > 0 ? suitOf(state.trick[0]!.card) : -1;
  // Not following shows the seat holds none of the suit led.
  const voids = ledSuit >= 0 && suitOf(card) !== ledSuit ? me.voids | (1 << ledSuit) : me.voids;
  const broke = !state.broken && suitOf(card) === PACT_SPADES;
  const seats = state.seats.map((s, i) => (i === seat ? { ...s, cards: s.cards.filter((c) => c !== card), voids } : s));
  const trick = [...state.trick, { seat, card }];
  const events: PactEvent[] = [{ kind: "card", seat, card, broke }];
  let s: PactState = { ...state, seats, trick, played: [...state.played, card], broken: state.broken || broke };
  if (trick.length < PACT_SEATS) {
    const toAct = (seat + 1) % PACT_SEATS;
    return { state: { ...s, toAct, phase: phaseFor(toAct, false) }, events };
  }
  const winner = winning(trick).seat;
  const after = s.seats.map((x, i) => (i === winner ? { ...x, tricks: x.tricks + 1 } : x));
  events.push({ kind: "trick", cards: trick, winner, tricks: after.map((x) => x.tricks) });
  s = { ...s, seats: after, trick: [] };
  if (after[0]!.cards.length === 0) return countHand(s, events);
  return { state: { ...s, toAct: winner, phase: phaseFor(winner, false) }, events };
}

/** One side's count for the hand just played, its rivals' pact beside it. */
function countSide(state: PactState, side: number, held: PactSide): PactCount {
  const cfg = state.config;
  const mine = state.seats.map((s, i) => ({ s, i })).filter((x) => sideOf(x.i) === side);
  const rivals = state.seats.filter((_, i) => sideOf(i) !== side);
  const pact = mine.reduce((n, x) => n + (x.s.bid! > 0 ? x.s.bid! : 0), 0);
  const took = mine.reduce((n, x) => n + (x.s.bid! > 0 ? x.s.tricks : 0), 0);
  const nils = mine.filter((x) => x.s.bid === 0).map((x) => ({ seat: x.i, made: x.s.tricks === 0 }));
  const made = took >= pact;
  const pactPoints = pact === 0 ? 0 : made ? pact * cfg.trickValue : -pact * cfg.trickValue;
  const nilPoints = nils.reduce((n, x) => n + (x.made ? cfg.nilBonus : -cfg.nilBonus), 0);
  // Bags: the tricks over the pact, and every trick a nil took.
  const bags = (pact > 0 && made ? took - pact : 0) + mine.reduce((n, x) => n + (x.s.bid === 0 ? x.s.tricks : 0), 0);
  const bagPoints = bags * cfg.bagValue;
  let bagsHeld = held.bags + bags;
  let penalty = 0;
  if (cfg.bagLimit > 0) {
    while (bagsHeld >= cfg.bagLimit) {
      bagsHeld -= cfg.bagLimit;
      penalty += cfg.bagPenalty;
    }
  }
  const theirPact = rivals.reduce((n, s) => n + (s.bid! > 0 ? s.bid! : 0), 0);
  const theirTook = rivals.reduce((n, s) => n + (s.bid! > 0 ? s.tricks : 0), 0);
  const setPoints = theirPact > 0 && theirTook < theirPact ? theirPact * cfg.setBonus : 0;
  const raw = pactPoints + nilPoints + bagPoints - penalty + setPoints;
  const added = Math.max(0, raw);
  return { pact, took, pactPoints, nils, nilPoints, bags, bagPoints, penalty, setPoints, raw, added, total: held.total + added, bagsHeld };
}

function countHand(state: PactState, events: PactEvent[]): { state: PactState; events: PactEvent[] } {
  const us = countSide(state, 0, state.us);
  const them = countSide(state, 1, state.them);
  const handsDone = state.handsDone + 1;
  const next: PactState = {
    ...state,
    toAct: -1,
    phase: "over",
    us: { total: us.total, bags: us.bagsHeld },
    them: { total: them.total, bags: them.bagsHeld },
    count: { us, them },
    score: us.total,
    handsDone,
    made: state.made + (us.pact > 0 && us.took >= us.pact ? 1 : 0),
    nils: state.nils + (us.nils.some((n) => n.seat === 0 && n.made) ? 1 : 0),
    sets: state.sets + (them.pact > 0 && them.took < them.pact ? 1 : 0),
    bestHand: Math.max(state.bestHand, us.added),
    finished: handsDone >= state.config.hands,
  };
  return { state: next, events: [...events, { kind: "count", us, them }] };
}

/** The seat to act bids or plays by the engine's rule. */
function tableAct(state: PactState): { state: PactState; events: PactEvent[] } {
  const seat = state.toAct;
  const c = seatChoice(state, seat, FULL_SKILL);
  const r = c.kind === "bid" ? bid(state, seat, c.bid) : play(state, seat, c.card);
  return { state: { ...r.state, tableActs: r.state.tableActs + 1 }, events: r.events };
}

/**
 * What the engine's own rule would do in the player's seat: a bid or a card. A studio hint; a counted
 * round never shows it. It reads only what the player can see.
 */
export function hint(state: PactState): PactMove | null {
  if (state.finished || (state.phase !== "bid" && state.phase !== "play")) return null;
  const c = seatChoice(state, 0, FULL_SKILL);
  return c.kind === "bid" ? { type: "bid", bid: c.bid } : { type: "play", card: c.card };
}

export function reducePact(state: PactState, move: PactMove): PactState {
  if (state.finished) throw new InvalidMoveError("the sitting is over", move);
  const reason = moveIllegalReason(state, move);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const logLength = state.logLength + 1;
  let r: { state: PactState; events: PactEvent[] };
  switch (move.type) {
    case "end":
      r = { state: { ...state, finished: true }, events: [] };
      break;
    case "deal":
      r = startHand(state);
      break;
    case "next":
      r = tableAct(state);
      break;
    case "bid": {
      const b = bid(state, 0, move.bid);
      r = { state: { ...b.state, moveCount: state.moveCount + 1 }, events: b.events };
      break;
    }
    case "play": {
      const p = play(state, 0, move.card);
      r = { state: { ...p.state, moveCount: state.moveCount + 1 }, events: p.events };
      break;
    }
  }
  let next = r.state;
  // The log is full: the sitting ends as an `end` would end it.
  if (!next.finished && logLength >= state.config.maxMoves) next = { ...next, finished: true };
  return { ...next, logLength, lastMove: { move, events: r.events } };
}

export function replayPact(seed: string, config: PactConfig, moves: readonly PactMove[]): PactState {
  let s = createPactGame(seed, config);
  for (const m of moves) s = reducePact(s, m);
  return s;
}

export function hashPactState(state: PactState): string {
  const h = new Hasher();
  for (const s of state.seats) {
    h.int(s.cards.length);
    for (const c of s.cards) h.int(c);
    h.int(s.bid === null ? -1 : s.bid).int(s.tricks).int(s.voids);
  }
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.hand).int(state.dealer).int(state.toAct).int(["bid", "play", "table", "over"].indexOf(state.phase));
  h.int(state.trick.length);
  for (const t of state.trick) h.int(t.seat).int(t.card);
  h.int(state.played.length);
  for (const c of state.played) h.int(c);
  h.int(state.broken ? 1 : 0).int(state.us.total).int(state.us.bags).int(state.them.total).int(state.them.bags);
  h.int(state.score).int(state.moveCount).int(state.tableActs).int(state.logLength).int(state.handsDone);
  h.int(state.made).int(state.nils).int(state.sets).int(state.bestHand).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface PactSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/** `moves` is the player's bids and cards; `bestCombo` the most one hand added. */
export function summarizePact(state: PactState): PactSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestHand };
}

/**
 * A stretch of play read as a whole sitting, for the live tier indicator: the points made in
 * `seconds` of play, kept up for the round's `roundSeconds`. Never below zero.
 */
export function paceScore(made: number, seconds: number, roundSeconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(0, Math.round((made * roundSeconds) / seconds));
}

/** Each side's bid and tricks so far this hand: the pact, the tricks toward it, and nils still alive. */
export function sideStanding(state: PactState, side: 0 | 1): { pact: number; took: number; bidding: boolean } {
  let pact = 0;
  let took = 0;
  let bidding = false;
  state.seats.forEach((s, i) => {
    if (sideOf(i) !== side) return;
    if (s.bid === null) bidding = true;
    else if (s.bid > 0) pact += s.bid;
    took += s.tricks;
  });
  return { pact, took, bidding };
}

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

/** A card as two letters, rank then suit: `As` the ace of spades, `Th` the ten of hearts. */
export function cardName(card: number): string {
  return `${RANKS[rankOf(card)]}${SUITS[suitOf(card)]}`;
}

/** A card from its two letters. */
export function cardOf(name: string): number {
  return RANKS.indexOf(name[0]!) + 13 * SUITS.indexOf(name[1]!);
}

/**
 * The table as text, what the board draws: `hand:tricksPlayed:phase`, the player's cards, the trick on
 * the table as `seat` and card, then each seat's bid (`-` before it bids, `n` for nil) and tricks.
 * `|` between.
 */
export function viewString(state: PactState): string {
  const tricksPlayed = state.seats.reduce((n, s) => n + s.tricks, 0);
  const parts = [`${state.hand}:${tricksPlayed}:${state.phase}`];
  parts.push(state.seats[0]!.cards.map(cardName).join(""));
  parts.push(state.trick.map((t) => `${t.seat}${cardName(t.card)}`).join(""));
  parts.push(state.seats.map((s) => `${s.bid === null ? "-" : s.bid === 0 ? "n" : s.bid}/${s.tricks}`).join(","));
  return parts.join("|");
}
