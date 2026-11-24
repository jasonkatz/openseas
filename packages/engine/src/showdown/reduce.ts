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
    int(cfg.hands, 1, 200) &&
    int(cfg.bank, 0, 100_000) &&
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

/** Everything in the pot. */
export function pot(state: ShowdownState): number {
  return state.seats.reduce((n, s) => n + s.inPot, 0);
}

/** The cards of the middle showing: none before the flop, then three, four, five. */
export function boardShowing(state: ShowdownState): number[] {
  const n = state.street === 0 ? 0 : state.street + 2;
  return state.phase === "over" && state.seats.filter((s) => !s.folded).length > 1 ? state.board.slice(0, 5) : state.board.slice(0, n);
}

/** What `seat` must put in to call. */
export function owed(state: ShowdownState, seat = 0): number {
  const s = state.seats[seat];
  return s ? state.bet - s.street : 0;
}

/** The bet this street: the small bet before the turn, the big one after. */
export function betSize(state: ShowdownState): number {
  return state.street < 2 ? state.config.smallBet : state.config.bigBet;
}

/** The street still takes a raise. */
export function canRaise(state: ShowdownState): boolean {
  return state.bets < state.config.raiseCap;
}

/** What a raise (or a bet) by `seat` puts in. */
export function raiseCost(state: ShowdownState, seat = 0): number {
  return owed(state, seat) + betSize(state);
}

/** Why the player cannot make this move now, or null. */
export function moveIllegalReason(state: ShowdownState, move: ShowdownMove): string | null {
  if (state.finished) return "the sitting is over";
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
      if (move.type === "raise" && !canRaise(state)) return "the street is capped";
      return null;
    default:
      return "unknown move";
  }
}

/** The next seat clockwise from `from` still in the hand. */
function nextLive(seats: readonly ShowdownSeat[], from: number): number {
  const n = seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!seats[i]!.folded) return i;
  }
  return from;
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
  const seats: ShowdownSeat[] = [null, ...styles].map((style) => ({ style, cards: [], folded: false, street: 0, inPot: 0, acted: false, net: 0, shown: false }));
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
    score: config.bank,
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

/** Deal the next hand: move the button, shuffle, deal two cards a seat, post the blinds. */
function startHand(state: ShowdownState): { state: ShowdownState; events: ShowdownEvent[] } {
  const cfg = state.config;
  const n = seatCount(cfg);
  const { deck, rng } = shuffled(state.rng);
  const button = (state.button + 1) % n;
  const small = n === 2 ? button : (button + 1) % n;
  const big = (small + 1) % n;
  const seats: ShowdownSeat[] = state.seats.map((s, i) => {
    const blind = i === small ? cfg.smallBlind : i === big ? cfg.bigBlind : 0;
    return { ...s, cards: [deck[i * 2]!, deck[i * 2 + 1]!], folded: false, street: blind, inPot: blind, acted: false, shown: false };
  });
  const toAct = (big + 1) % n;
  const next: ShowdownState = {
    ...state,
    seats,
    rng,
    hand: state.hand + 1,
    button,
    board: deck.slice(n * 2, n * 2 + 5),
    street: 0,
    bet: cfg.bigBlind,
    bets: 1,
    toAct,
    phase: toAct === 0 ? "act" : "table",
    checked: false,
    trapSet: false,
  };
  return { state: next, events: [{ kind: "deal", hand: next.hand, button, small, big, cards: seats[0]!.cards }] };
}

type Act = "fold" | "call" | "raise";

/** One seat's action, and whatever it closes: the street, the hand. */
function act(state: ShowdownState, seat: number, kind: Act): { state: ShowdownState; events: ShowdownEvent[] } {
  const me = state.seats[seat]!;
  const due = state.bet - me.street;
  let bet = state.bet;
  let bets = state.bets;
  let paid = 0;
  let action: "fold" | "check" | "call" | "bet" | "raise";
  if (kind === "fold") action = "fold";
  else if (kind === "call") {
    paid = due;
    action = due === 0 ? "check" : "call";
  } else {
    bet = state.bet + betSize(state);
    paid = bet - me.street;
    action = bets === 0 ? "bet" : "raise";
    bets++;
  }
  const seats = state.seats.map((s, i) => {
    if (i === seat) return { ...s, folded: kind === "fold", street: s.street + paid, inPot: s.inPot + paid, acted: true };
    // A raise asks everyone still in to act again.
    if (kind === "raise" && !s.folded) return { ...s, acted: false };
    return s;
  });
  let checked = state.checked;
  let trapSet = state.trapSet;
  if (seat === 0 && action === "check") checked = true;
  if (seat === 0 && kind === "raise" && checked) trapSet = true;
  let s: ShowdownState = { ...state, seats, bet, bets, checked, trapSet };
  const events: ShowdownEvent[] = [{ kind: "act", seat, action, paid, pot: pot(s) }];

  const live = seats.filter((x) => !x.folded);
  if (live.length === 1) return award(s, events);
  if (live.every((x) => x.acted && x.street === bet)) return endStreet(s, events);
  const toAct = nextLive(seats, seat);
  return { state: { ...s, toAct, phase: toAct === 0 ? "act" : "table" }, events };
}

function endStreet(state: ShowdownState, events: ShowdownEvent[]): { state: ShowdownState; events: ShowdownEvent[] } {
  if (state.street === 3) return award(state, events);
  const street = state.street + 1;
  const seats = state.seats.map((s) => ({ ...s, street: 0, acted: false }));
  const cards = street === 1 ? state.board.slice(0, 3) : [state.board[street + 1]!];
  const toAct = nextLive(seats, state.button);
  const next: ShowdownState = { ...state, seats, street, bet: 0, bets: 0, checked: false, toAct, phase: toAct === 0 ? "act" : "table" };
  return { state: next, events: [...events, { kind: "street", street, cards }] };
}

/** The hand is over: the pot goes to the last seat in, or to the best hand shown. */
function award(state: ShowdownState, events: ShowdownEvent[]): { state: ShowdownState; events: ShowdownEvent[] } {
  const n = state.seats.length;
  const total = pot(state);
  const live = state.seats.map((s, i) => i).filter((i) => !state.seats[i]!.folded);
  let winners: number[];
  const shown: Array<{ seat: number; cards: readonly number[]; hand: ReturnType<typeof handName>; best: readonly number[] }> = [];
  if (live.length === 1) winners = live;
  else {
    const values = live.map((i) => handValue([...state.seats[i]!.cards, ...state.board]));
    const top = Math.max(...values);
    winners = live.filter((_, k) => values[k] === top);
    live.forEach((i, k) => {
      const cards = [...state.seats[i]!.cards, ...state.board];
      shown.push({ seat: i, cards: state.seats[i]!.cards, hand: handName(values[k]!), best: bestFive(cards) });
    });
  }
  // Winners in order from the button's left, so the odd chip goes to the first of them.
  winners.sort((a, b) => ((a - state.button + n - 1) % n) - ((b - state.button + n - 1) % n));
  const share = Math.floor(total / winners.length);
  const amounts = winners.map((_, k) => share + (k < total - share * winners.length ? 1 : 0));
  const won = new Map(winners.map((w, k) => [w, amounts[k]!]));
  const seats = state.seats.map((s, i) => ({ ...s, net: s.net + (won.get(i) ?? 0) - s.inPot, shown: shown.some((x) => x.seat === i) }));
  const mine = won.get(0) ?? 0;
  const trap = mine > 0 && state.trapSet;
  const finished = state.hand >= state.config.hands;
  const next: ShowdownState = {
    ...state,
    seats,
    toAct: -1,
    phase: "over",
    score: Math.max(0, state.config.bank + seats[0]!.net),
    handsWon: state.handsWon + (mine > 0 ? 1 : 0),
    bestPot: Math.max(state.bestPot, mine),
    traps: state.traps + (trap ? 1 : 0),
    finished,
  };
  return { state: next, events: [...events, { kind: "win", pot: total, winners, amounts, shown, trap }] };
}

/**
 * What a seat would do by a style's numbers, seeing only its own cards, the cards showing and the
 * betting: its share of the pot, reckoned from `samples` deals of what it cannot see, against the
 * price of a call. Shares are in thousandths of a fair share (a share times the seats still in).
 */
export function styleChoice(state: ShowdownState, seat: number, play: ShowdownStyleNumbers, rng: PrngState): { kind: Act; share: number; rng: PrngState } {
  const k = state.seats.filter((s) => !s.folded).length;
  const eq = equity(state.seats[seat]!.cards, boardShowing(state), k - 1, state.config.samples, rng);
  let r = eq.rng;
  const fair = eq.share * k;
  const due = owed(state, seat);
  const raise = canRaise(state);
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

function rivalAct(state: ShowdownState): { state: ShowdownState; events: ShowdownEvent[] } {
  const seat = state.toAct;
  const style = state.seats[seat]!.style!;
  const pick = styleChoice(state, seat, state.config.play[style], state.think);
  const r = act({ ...state, think: pick.rng }, seat, pick.kind);
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
  if (state.finished) throw new InvalidMoveError("the sitting is over", move);
  const reason = moveIllegalReason(state, move);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const logLength = state.logLength + 1;
  let next: ShowdownState;
  let events: ShowdownEvent[];
  switch (move.type) {
    case "end":
      next = leave(state);
      events = [];
      break;
    case "deal": {
      const r = startHand(state);
      next = r.state;
      events = r.events;
      break;
    }
    case "next": {
      const r = rivalAct(state);
      next = r.state;
      events = r.events;
      // Once the player is out of the hand, the rest of it plays at once.
      while (next.seats[0]!.folded && next.phase === "table") {
        const more = rivalAct(next);
        next = more.state;
        events = [...events, ...more.events];
      }
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
    // The log is full: the sitting ends as an `end` would end it.
    next = leave(next);
  }
  return { ...next, logLength, lastMove: { move, events } };
}

/** The player stands up: a hand in play costs what they put in it, and a sitting left early keeps no winnings. */
function leave(state: ShowdownState): ShowdownState {
  const cfg = state.config;
  const inPlay = state.phase !== "over";
  const seats = inPlay ? state.seats.map((s, i) => (i === 0 ? { ...s, net: s.net - s.inPot, inPot: 0 } : s)) : state.seats;
  const done = state.hand - (inPlay ? 1 : 0);
  const stands = cfg.bank + seats[0]!.net;
  const score = done >= cfg.hands ? stands : Math.min(stands, Math.floor((cfg.bank * done) / cfg.hands));
  return { ...state, seats, score: Math.max(0, score), finished: true };
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
    h.int(s.folded ? 1 : 0).int(s.street).int(s.inPot).int(s.acted ? 1 : 0).int(s.net).int(s.shown ? 1 : 0);
  }
  for (const r of [state.rng, state.think]) h.int(r.a).int(r.b).int(r.c).int(r.d);
  h.int(state.board.length);
  for (const c of state.board) h.int(c);
  h.int(state.hand).int(state.button).int(state.street).int(state.bet).int(state.bets).int(state.toAct);
  h.int(["act", "table", "over"].indexOf(state.phase)).int(state.checked ? 1 : 0).int(state.trapSet ? 1 : 0);
  h.int(state.score).int(state.moveCount).int(state.tableActs).int(state.logLength).int(state.handsWon).int(state.bestPot).int(state.traps);
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

/**
 * A stretch of play read as a whole sitting, for the live tier indicator: the bank, and the net won
 * in `seconds` of play kept up for the round's `roundSeconds`. Never below zero.
 */
export function paceScore(config: ShowdownConfig, made: number, seconds: number, roundSeconds: number): number {
  if (seconds <= 0) return config.bank;
  return Math.max(0, Math.round(config.bank + (made * roundSeconds) / seconds));
}

const RANKS = "23456789TJQKA";
/** Suits by their pictograms: star, moon, ring, comet. */
const SUITS = "smrc";

/** A card as two letters, its rank and its suit: `As` the ace of stars, `Tm` the ten of moons. */
export function cardName(card: number): string {
  return `${RANKS[rankOf(card)]}${SUITS[suitOf(card)]}`;
}

/**
 * The table as text, what the board draws: `hand:street:pot`, the player's cards, the cards showing,
 * then each rival as `i` (in) or `f` (folded) with its cards once it has shown them. `|` between.
 */
export function viewString(state: ShowdownState): string {
  const parts = [`${state.hand}:${state.street}:${pot(state)}`];
  parts.push(state.seats[0]!.cards.map(cardName).join(""));
  parts.push(boardShowing(state).map(cardName).join(""));
  for (let i = 1; i < state.seats.length; i++) {
    const s = state.seats[i]!;
    parts.push(`${s.folded ? "f" : "i"}${s.shown ? s.cards.map(cardName).join("") : ""}`);
  }
  return parts.join("|");
}
