import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import { bestFive, equity, handName, handValue, rankOf, shuffled, suitOf } from "./cards.js";
import {
  SHOWDOWN_STYLES,
  type ShowdownConfig,
  type ShowdownEvent,
  type ShowdownMove,
  type ShowdownSeat,
  type ShowdownState,
  type ShowdownStyle,
  type ShowdownStyleNumbers,
} from "./types.js";

export function validateConfig(cfg: ShowdownConfig): void {
  const int = (n: unknown, lo: number, hi: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.rivals, 1, 5) &&
    int(cfg.hands, 1, 500) &&
    int(cfg.stack, 1, 10_000) &&
    int(cfg.knockout, 0, 10_000) &&
    int(cfg.speed, 0, 1000) &&
    int(cfg.smallBlind, 0, 1000) &&
    int(cfg.bigBlind, 1, 1000) &&
    cfg.smallBlind <= cfg.bigBlind &&
    int(cfg.smallBet, 1, 1000) &&
    int(cfg.bigBet, 1, 1000) &&
    int(cfg.raiseCap, 1, 8) &&
    Array.isArray(cfg.styles) &&
    cfg.styles.length >= cfg.rivals &&
    cfg.styles.length <= 12 &&
    cfg.styles.every((s) => (SHOWDOWN_STYLES as readonly string[]).includes(s)) &&
    typeof cfg.play === "object" &&
    cfg.play !== null &&
    SHOWDOWN_STYLES.every((s) => {
      const p = cfg.play[s];
      return typeof p === "object" && p !== null && int(p.slack, -3000, 3000) && int(p.raiseAt, 0, 6000) && int(p.bluff, 0, 1000);
    }) &&
    int(cfg.samples, 1, 2000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid showdown config");
}

const seatCount = (cfg: ShowdownConfig): number => cfg.rivals + 1;

/** In this hand: dealt in and not folded. */
const live = (s: ShowdownSeat): boolean => !s.out && !s.folded;
/** Can still bet this hand: in it, with chips behind. */
const actor = (s: ShowdownSeat): boolean => live(s) && s.stack > 0;

/** Everything in the pot, side pots counted. */
export function pot(state: ShowdownState): number {
  return state.seats.reduce((n, s) => n + s.inPot, 0);
}

/** The cards of the middle showing: none before the flop, then three, four, five. */
export function boardShowing(state: ShowdownState): number[] {
  const n = state.street === 0 ? 0 : state.street + 2;
  return state.phase === "over" && state.seats.filter(live).length > 1 ? state.board.slice(0, 5) : state.board.slice(0, n);
}

/** What `seat` puts in to call: what is owed, or all it has when that is less. */
export function owed(state: ShowdownState, seat = 0): number {
  const s = state.seats[seat];
  return s ? Math.max(0, Math.min(state.bet - s.street, s.stack)) : 0;
}

/** The bet this street: the small bet before the turn, the big one after. */
export function betSize(state: ShowdownState): number {
  return state.street < 2 ? state.config.smallBet : state.config.bigBet;
}

/** `seat` may raise: the street takes one, and it has more than the call behind. */
export function canRaise(state: ShowdownState, seat = 0): boolean {
  const s = state.seats[seat];
  return state.bets < state.config.raiseCap && !!s && s.stack > state.bet - s.street;
}

/** What a raise (or a bet) by `seat` puts in: a call and one bet, or all it has. */
export function raiseCost(state: ShowdownState, seat = 0): number {
  const s = state.seats[seat];
  return s ? Math.min(state.bet - s.street + betSize(state), s.stack) : 0;
}

/** Why the player cannot make this move now, or null. */
export function moveIllegalReason(state: ShowdownState, move: ShowdownMove): string | null {
  if (state.finished) return "the round is over";
  switch (move.type) {
    case "end":
      return null;
    case "deal":
      return state.phase === "over" ? null : "a hand is in play";
    case "next":
      return state.phase === "table" ? null : state.phase === "act" ? "it is your turn" : "the hand is over";
    case "fold":
    case "call":
    case "raise":
      if (state.phase !== "act") return state.phase === "table" ? "a rival is to act" : "the hand is over";
      if (move.type === "fold" && owed(state) === 0) return "nothing to call: check";
      if (move.type === "raise" && !canRaise(state)) return state.bets >= state.config.raiseCap ? "the street is capped" : "not enough chips to raise";
      return null;
    default:
      return "unknown move";
  }
}

/** The next seat clockwise from `from` that passes `test`, or -1. */
function nextSeat(seats: readonly ShowdownSeat[], from: number, test: (s: ShowdownSeat) => boolean): number {
  const n = seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (test(seats[i]!)) return i;
  }
  return -1;
}

export function createShowdownGame(seed: string, config: ShowdownConfig): ShowdownState {
  validateConfig(config);
  let rng = seedFromString(seed);
  // The rivals' styles: drawn from the list without putting one back.
  const pool = [...config.styles];
  const styles: ShowdownStyle[] = [];
  for (let i = 0; i < config.rivals; i++) {
    const r = nextInt(rng, pool.length);
    rng = r.state;
    styles.push(pool.splice(r.value, 1)[0]!);
  }
  const b = nextInt(rng, seatCount(config));
  rng = b.state;
  const seats: ShowdownSeat[] = [null, ...styles].map((style) => ({ style, cards: [], folded: false, out: false, stack: config.stack, street: 0, inPot: 0, acted: false, shown: false }));
  const empty: ShowdownState = {
    config,
    seats,
    rng,
    think: seedFromString(`${seed}:think`),
    hand: 0,
    // The first hand moves the button on one, so it starts one seat back.
    button: (b.value + seatCount(config) - 1) % seatCount(config),
    board: [],
    street: 0,
    bet: 0,
    bets: 0,
    toAct: -1,
    phase: "over",
    checked: false,
    trapSet: false,
    score: 0,
    won: false,
    moveCount: 0,
    tableActs: 0,
    logLength: 0,
    handsWon: 0,
    bestPot: 0,
    traps: 0,
    lastMove: null,
    finished: false,
  };
  const dealt = startHand(empty);
  return { ...dealt.state, lastMove: null };
}

type Step = { state: ShowdownState; events: ShowdownEvent[] };

/** Deal the next hand to the seats still in: move the button, shuffle, deal two cards a seat, post the blinds. */
function startHand(state: ShowdownState): Step {
  const cfg = state.config;
  const n = seatCount(cfg);
  const { deck, rng } = shuffled(state.rng);
  const inRound = (s: ShowdownSeat): boolean => !s.out;
  const button = nextSeat(state.seats, state.button, inRound);
  const heads = state.seats.filter(inRound).length === 2;
  const small = heads ? button : nextSeat(state.seats, button, inRound);
  const big = nextSeat(state.seats, small, inRound);
  let k = 0;
  const seats: ShowdownSeat[] = state.seats.map((s, i) => {
    if (s.out) return { ...s, cards: [], folded: true, street: 0, inPot: 0, acted: false, shown: false };
    const blind = Math.min(s.stack, i === small ? cfg.smallBlind : i === big ? cfg.bigBlind : 0);
    const cards = [deck[k * 2]!, deck[k * 2 + 1]!];
    k++;
    return { ...s, cards, folded: false, stack: s.stack - blind, street: blind, inPot: blind, acted: false, shown: false };
  });
  const next: ShowdownState = {
    ...state,
    seats,
    rng,
    hand: state.hand + 1,
    button,
    board: deck.slice(k * 2, k * 2 + 5),
    street: 0,
    bet: cfg.bigBlind,
    bets: 1,
    toAct: -1,
    phase: "table",
    checked: false,
    trapSet: false,
  };
  return settle(next, [{ kind: "deal", hand: next.hand, button, small, big, cards: seats[0]!.cards }], big);
}

/**
 * After a seat acts (or the blinds go in), what comes next: the hand's end when one seat is left,
 * the street's end when betting is done, otherwise the next seat that can bet.
 */
function settle(state: ShowdownState, events: ShowdownEvent[], from: number): Step {
  const seats = state.seats;
  if (seats.filter(live).length === 1) return award(state, events);
  const actors = seats.filter(actor);
  const owing = actors.some((s) => s.street < state.bet);
  const done = actors.every((s) => s.acted && s.street >= state.bet) || (actors.length <= 1 && !owing);
  if (done) return endStreet(state, events);
  const toAct = nextSeat(seats, from, (s) => actor(s) && (!s.acted || s.street < state.bet));
  return { state: { ...state, toAct, phase: toAct === 0 ? "act" : "table" }, events };
}

type Act = "fold" | "call" | "raise";

/** One seat's action, and whatever it closes: the street, the hand. */
function act(state: ShowdownState, seat: number, kind: Act): Step {
  const me = state.seats[seat]!;
  const due = Math.max(0, state.bet - me.street);
  let bet = state.bet;
  let bets = state.bets;
  let paid = 0;
  let action: "fold" | "check" | "call" | "bet" | "raise";
  let reopen = false;
  if (kind === "fold") action = "fold";
  else if (kind === "call") {
    paid = Math.min(due, me.stack);
    action = due === 0 ? "check" : "call";
  } else {
    paid = Math.min(due + betSize(state), me.stack);
    const to = me.street + paid;
    action = state.bet === 0 ? "bet" : "raise";
    // A short raise all in moves the price but does not count toward the cap.
    if (to - state.bet >= betSize(state)) bets++;
    reopen = to > state.bet;
    bet = Math.max(bet, to);
  }
  const seats = state.seats.map((s, i) => {
    if (i === seat) return { ...s, folded: kind === "fold", stack: s.stack - paid, street: s.street + paid, inPot: s.inPot + paid, acted: true };
    // A raise asks everyone still betting to act again.
    if (reopen && actor(s)) return { ...s, acted: false };
    return s;
  });
  let checked = state.checked;
  let trapSet = state.trapSet;
  if (seat === 0 && action === "check") checked = true;
  if (seat === 0 && kind === "raise" && checked) trapSet = true;
  const s: ShowdownState = { ...state, seats, bet, bets, checked, trapSet };
  const allIn = kind !== "fold" && seats[seat]!.stack === 0;
  return settle(s, [{ kind: "act", seat, action, paid, pot: pot(s), allIn }], seat);
}

/** The street is done: turn the next cards. With no more than one seat left to bet, they turn one street a `next` with no betting. */
function endStreet(state: ShowdownState, events: ShowdownEvent[]): Step {
  if (state.street === 3) return award(state, events);
  const street = state.street + 1;
  const seats = state.seats.map((s) => ({ ...s, street: 0, acted: false }));
  const cards = street === 1 ? state.board.slice(0, 3) : [state.board[street + 1]!];
  const out = [...events, { kind: "street" as const, street, cards }];
  const next: ShowdownState = { ...state, seats, street, bet: 0, bets: 0, checked: false };
  if (seats.filter(actor).length <= 1) return { state: { ...next, toAct: -1, phase: "table" }, events: out };
  const toAct = nextSeat(seats, state.button, actor);
  return { state: { ...next, toAct, phase: toAct === 0 ? "act" : "table" }, events: out };
}

/**
 * The hand is over: the pot goes to the last seat in, or each pot to the best hand in it. A pot is
 * a layer of what was put in: the main pot to the smallest stake still in, each side pot above it
 * among the seats that put in that much.
 */
function award(state: ShowdownState, events: ShowdownEvent[]): Step {
  const n = state.seats.length;
  const total = pot(state);
  const liveSeats = state.seats.map((_, i) => i).filter((i) => live(state.seats[i]!));
  const won = new Array<number>(n).fill(0);
  const shown: Array<{ seat: number; cards: readonly number[]; hand: ReturnType<typeof handName>; best: readonly number[] }> = [];
  // Seats in order from the button's left, so an odd chip goes to the first of the winners.
  const order = (a: number, b: number): number => ((a - state.button + n - 1) % n) - ((b - state.button + n - 1) % n);
  if (liveSeats.length === 1) won[liveSeats[0]!] = total;
  else {
    const values = new Map(liveSeats.map((i) => [i, handValue([...state.seats[i]!.cards, ...state.board])]));
    for (const i of liveSeats) {
      const cards = [...state.seats[i]!.cards, ...state.board];
      shown.push({ seat: i, cards: state.seats[i]!.cards, hand: handName(values.get(i)!), best: bestFive(cards) });
    }
    const stakes = state.seats.map((s) => s.inPot);
    const levels = [...new Set(liveSeats.map((i) => stakes[i]!))].sort((a, b) => a - b);
    let below = 0;
    levels.forEach((level, k) => {
      // The top layer takes whatever folded seats put in above it too.
      const top = k === levels.length - 1 ? Math.max(...stakes) : level;
      const layer = stakes.reduce((sum, c) => sum + Math.max(0, Math.min(c, top) - below), 0);
      below = top;
      if (layer === 0) return;
      const inIt = liveSeats.filter((i) => stakes[i]! >= level);
      const best = Math.max(...inIt.map((i) => values.get(i)!));
      const winners = inIt.filter((i) => values.get(i) === best).sort(order);
      const share = Math.floor(layer / winners.length);
      winners.forEach((w, j) => (won[w] = won[w]! + share + (j < layer - share * winners.length ? 1 : 0)));
    });
  }
  const winners = won.map((_, i) => i).filter((i) => won[i]! > 0).sort(order);
  const amounts = winners.map((w) => won[w]!);
  const seats = state.seats.map((s, i) => {
    const stack = s.stack + won[i]!;
    return { ...s, stack, inPot: 0, street: 0, out: s.out || stack === 0, shown: shown.some((x) => x.seat === i) };
  });
  const out = seats.map((s, i) => i).filter((i) => seats[i]!.out && !state.seats[i]!.out);
  const mine = won[0]!;
  const trap = mine > 0 && state.trapSet;
  let next: ShowdownState = {
    ...state,
    seats,
    toAct: -1,
    phase: "over",
    handsWon: state.handsWon + (mine > 0 ? 1 : 0),
    bestPot: Math.max(state.bestPot, mine),
    traps: state.traps + (trap ? 1 : 0),
  };
  const rivalsLeft = seats.slice(1).filter((s) => !s.out).length;
  if (seats[0]!.out || rivalsLeft === 0 || state.hand >= state.config.hands) next = finish(next, true);
  else next = { ...next, score: knockouts(next) };
  // Events keep the pot as it stood: `inPot` is cleared above, so `total` is reported.
  return { state: next, events: [...events, { kind: "win", pot: total, winners, amounts, shown, trap, out }] };
}

/** Knockout points: a rival out is worth `knockout`. */
function knockouts(state: ShowdownState): number {
  return state.seats.slice(1).filter((s) => s.out).length * state.config.knockout;
}

/**
 * Where the player stands now, read as a score: every rival out, and every rival still in with fewer
 * chips than the player, is beaten. What the round would score if it ended after this hand.
 */
export function standing(state: ShowdownState): number {
  if (state.finished) return state.score;
  const me = state.seats[0]!;
  const mine = me.stack + me.inPot;
  const beaten = state.seats.slice(1).filter((s) => s.out || s.stack + s.inPot < mine).length;
  return beaten * state.config.knockout;
}

/**
 * The round is over. `played` when it ran to its end (a knockout, a win, or the last hand): rivals
 * still in with fewer chips than the player then count as beaten. Left early, only rivals out count.
 */
function finish(state: ShowdownState, played: boolean): ShowdownState {
  const cfg = state.config;
  const me = state.seats[0]!;
  const rivals = state.seats.slice(1);
  const won = !me.out && rivals.every((s) => s.out);
  let score = knockouts(state);
  if (played && !me.out && !won) score = rivals.filter((s) => s.out || s.stack < me.stack).length * cfg.knockout;
  if (won) score += Math.max(0, cfg.hands - state.hand) * cfg.speed;
  return { ...state, score, won, finished: true };
}

/**
 * What a seat would do by a style's numbers, seeing only its own cards, the cards showing and the
 * betting: its share of the pot, reckoned from `samples` deals of what it cannot see, against the
 * price of a call. Shares are in thousandths of a fair share (a share times the seats still in).
 */
export function styleChoice(state: ShowdownState, seat: number, play: ShowdownStyleNumbers, rng: PrngState): { kind: Act; share: number; rng: PrngState } {
  const k = state.seats.filter(live).length;
  const eq = equity(state.seats[seat]!.cards, boardShowing(state), k - 1, state.config.samples, rng);
  let r = eq.rng;
  const fair = eq.share * k;
  const due = owed(state, seat);
  const raise = canRaise(state, seat);
  if (raise && fair >= play.raiseAt) return { kind: "raise", share: eq.share, rng: r };
  if (due === 0) {
    if (raise && fair < 1000 && play.bluff > 0) {
      const c = nextChance(r, play.bluff, 1000);
      r = c.state;
      if (c.value) return { kind: "raise", share: eq.share, rng: r };
    }
    return { kind: "call", share: eq.share, rng: r };
  }
  const price = Math.floor((due * 1000) / (pot(state) + due)) * k;
  return { kind: fair + play.slack >= price ? "call" : "fold", share: eq.share, rng: r };
}

function rivalAct(state: ShowdownState): Step {
  const seat = state.toAct;
  const style = state.seats[seat]!.style!;
  const pick = styleChoice(state, seat, state.config.play[style], state.think);
  // A rival never folds what it can check.
  const kind = pick.kind === "fold" && owed(state, seat) === 0 ? "call" : pick.kind;
  const r = act({ ...state, think: pick.rng }, seat, kind);
  return { state: { ...r.state, tableActs: r.state.tableActs + 1 }, events: r.events };
}

/**
 * What a level-headed player would do with the player's cards now: the shark's numbers, on a stream
 * of its own so asking never changes the round. A studio hint; a counted round never shows it.
 */
export function hint(state: ShowdownState): Act | null {
  if (state.phase !== "act" || state.finished) return null;
  const rng = seedFromString(`hint:${state.hand}:${state.street}:${state.bets}:${state.seats[0]!.street}`);
  const pick = styleChoice(state, 0, state.config.play.shark, rng);
  if (pick.kind === "fold" && owed(state) === 0) return "call";
  return pick.kind;
}

export function reduceShowdown(state: ShowdownState, move: ShowdownMove): ShowdownState {
  if (state.finished) throw new InvalidMoveError("the round is over", move);
  const reason = moveIllegalReason(state, move);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const logLength = state.logLength + 1;
  let next: ShowdownState;
  let events: ShowdownEvent[];
  switch (move.type) {
    case "end":
      next = finish(state, false);
      events = [];
      break;
    case "deal": {
      const r = startHand(state);
      next = r.state;
      events = r.events;
      break;
    }
    case "next": {
      // A rival acts, or with nobody left to bet, the next cards turn.
      const r = state.toAct === -1 ? endStreet(state, []) : rivalAct(state);
      next = r.state;
      events = r.events;
      break;
    }
    default: {
      const r = act(state, 0, move.type);
      next = { ...r.state, moveCount: state.moveCount + 1 };
      events = r.events;
      break;
    }
  }
  if (!next.finished && logLength >= state.config.maxMoves) {
    // The log is full: the round ends as an `end` would end it.
    next = finish(next, false);
  }
  return { ...next, logLength, lastMove: { move, events } };
}

export function replayShowdown(seed: string, config: ShowdownConfig, moves: readonly ShowdownMove[]): ShowdownState {
  let s = createShowdownGame(seed, config);
  for (const m of moves) s = reduceShowdown(s, m);
  return s;
}

export function hashShowdownState(state: ShowdownState): string {
  const h = new Hasher();
  h.int(state.seats.length);
  for (const s of state.seats) {
    h.int(s.style === null ? -1 : SHOWDOWN_STYLES.indexOf(s.style));
    h.int(s.cards.length);
    for (const c of s.cards) h.int(c);
    h.int(s.folded ? 1 : 0).int(s.out ? 1 : 0).int(s.stack).int(s.street).int(s.inPot).int(s.acted ? 1 : 0).int(s.shown ? 1 : 0);
  }
  for (const r of [state.rng, state.think]) h.int(r.a).int(r.b).int(r.c).int(r.d);
  h.int(state.board.length);
  for (const c of state.board) h.int(c);
  h.int(state.hand).int(state.button).int(state.street).int(state.bet).int(state.bets).int(state.toAct);
  h.int(["act", "table", "over"].indexOf(state.phase)).int(state.checked ? 1 : 0).int(state.trapSet ? 1 : 0);
  h.int(state.score).int(state.won ? 1 : 0).int(state.moveCount).int(state.tableActs).int(state.logLength).int(state.handsWon).int(state.bestPot).int(state.traps);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface ShowdownSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/** `moves` is the player's decisions; `bestCombo` the biggest pot they took. */
export function summarizeShowdown(state: ShowdownState): ShowdownSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestPot };
}

const RANKS = "23456789TJQKA";
/** Suits: spades, hearts, diamonds, clubs. */
const SUITS = "shdc";

/** A card as two letters, its rank and its suit: `As` the ace of spades, `Th` the ten of hearts. */
export function cardName(card: number): string {
  return `${RANKS[rankOf(card)]}${SUITS[suitOf(card)]}`;
}

/**
 * The table as text, what the board draws: `hand:street:pot`, the player's cards and chips, the cards
 * showing, then each rival as `i` (in), `f` (folded) or `x` (out), its chips, and its cards once it
 * has shown them. `|` between.
 */
export function viewString(state: ShowdownState): string {
  const parts = [`${state.hand}:${state.street}:${pot(state)}`];
  const me = state.seats[0]!;
  parts.push(`${me.cards.map(cardName).join("")}/${me.stack}`);
  parts.push(boardShowing(state).map(cardName).join(""));
  for (let i = 1; i < state.seats.length; i++) {
    const s = state.seats[i]!;
    parts.push(`${s.out ? "x" : s.folded ? "f" : "i"}${s.stack}${s.shown ? s.cards.map(cardName).join("") : ""}`);
  }
  return parts.join("|");
}
