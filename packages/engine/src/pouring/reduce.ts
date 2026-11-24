import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_POURING_CONFIG,
  type PouringAct,
  type PouringConfig,
  type PouringLine,
  type PouringMove,
  type PouringPiece,
  type PouringPourValue,
  type PouringSeat,
  type PouringSlot,
  type PouringState,
} from "./types.js";

export const idx = (cfg: PouringConfig, col: number, row: number): number => row * cfg.size + col;
export const colOf = (cfg: PouringConfig, cell: number): number => cell % cfg.size;
export const rowOf = (cfg: PouringConfig, cell: number): number => Math.floor(cell / cfg.size);

/** A rival rates each line it would leave one drink short, for the next pirate to serve, at this share of a line, in percent. */
const GIFT_PERCENT = 60;

type Bar = ReadonlyArray<PouringPiece | null>;

export function validateConfig(cfg: PouringConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.size, 5, 9) &&
    int(cfg.glasses, 2, 6) &&
    int(cfg.brews, 2, 6) &&
    int(cfg.offer, 1, 3) &&
    int(cfg.rivals, 0, 3) &&
    int(cfg.rivalSkill, 0, 100) &&
    int(cfg.pourPoints, 0, 1000) &&
    int(cfg.agePoints, 0, 1000) &&
    int(cfg.ageMax, 0, 20) &&
    int(cfg.ringPoints, 0, 1000) &&
    int(cfg.linePoints, 0, 10_000) &&
    int(cfg.cleanPercent, 100, 400) &&
    int(cfg.tolerance, 1, 6) &&
    int(cfg.soberAfter, 1, 10) &&
    int(cfg.icePerBag, 0, 6) &&
    int(cfg.ragsPerBag, 0, 6) &&
    int(cfg.lastCall, 4, 60) &&
    int(cfg.maxMoves, 1, 1000);
  if (!ok) throw new Error("invalid pouring config");
}

/** True when `piece` may be set down on the empty square `cell`: every drink beside it shares its glass or its brew, or one of the two is ice. */
export function fits(cfg: PouringConfig, cells: Bar, piece: PouringPiece, cell: number): boolean {
  if (piece.kind === "rag" || cells[cell] !== null) return false;
  if (piece.kind === "ice") return true;
  for (const n of neighbours(cfg, cell)) {
    const o = cells[n];
    if (!o || o.kind === "ice") continue;
    if (o.glass !== piece.glass && o.brew !== piece.brew) return false;
  }
  return true;
}

export function neighbours(cfg: PouringConfig, cell: number): number[] {
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  const out: number[] = [];
  if (row > 0) out.push(cell - cfg.size);
  if (col < cfg.size - 1) out.push(cell + 1);
  if (row < cfg.size - 1) out.push(cell + cfg.size);
  if (col > 0) out.push(cell - 1);
  return out;
}

export function rowCells(cfg: PouringConfig, row: number): number[] {
  return Array.from({ length: cfg.size }, (_, c) => idx(cfg, c, row));
}

export function colCells(cfg: PouringConfig, col: number): number[] {
  return Array.from({ length: cfg.size }, (_, r) => idx(cfg, col, r));
}

/** The lines through `cell` that a drink there would fill. */
function linesFilledBy(cfg: PouringConfig, cells: Bar, cell: number): PouringLine[] {
  const out: PouringLine[] = [];
  const row = rowCells(cfg, rowOf(cfg, cell));
  const col = colCells(cfg, colOf(cfg, cell));
  if (row.every((c) => c === cell || cells[c] !== null)) out.push({ axis: "row", index: rowOf(cfg, cell), cells: row });
  if (col.every((c) => c === cell || cells[c] !== null)) out.push({ axis: "col", index: colOf(cfg, cell), cells: col });
  return out;
}

/** What k lines served by one pour score, before the clean square's percent. */
export function lineValue(cfg: PouringConfig, k: number): number {
  return cfg.linePoints * k * k;
}

/** What a drink that has waited `age` turns is worth, poured or drunk. A rag is worth nothing. */
export function slotValue(cfg: PouringConfig, slot: PouringSlot): number {
  if (slot.piece.kind === "rag") return 0;
  return cfg.pourPoints + cfg.agePoints * Math.min(slot.age, cfg.ageMax);
}

/** What pouring hand slot `slot` of `seat` on `cell` would do. A rag on a drink is legal and scores nothing. */
export function pourValue(state: PouringState, slot: number, cell: number, seat = 0): PouringPourValue {
  const cfg = state.config;
  const none: PouringPourValue = { legal: false, clean: false, lines: [], drinkPoints: 0, ringPoints: 0, linePoints: 0, points: 0 };
  const s = state.seats[seat]?.hand[slot];
  if (!s || !Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) return none;
  if (s.piece.kind === "rag") return state.cells[cell] !== null ? { ...none, legal: true } : none;
  if (!fits(cfg, state.cells, s.piece, cell)) return none;
  const clean = state.rings[cell] === -1;
  const lines = linesFilledBy(cfg, state.cells, cell);
  const drinkPoints = slotValue(cfg, s);
  const ringPoints = clean ? cfg.ringPoints : 0;
  const base = lineValue(cfg, lines.length);
  const linePoints = clean ? Math.floor((base * cfg.cleanPercent) / 100) : base;
  return { legal: true, clean, lines, drinkPoints, ringPoints, linePoints, points: drinkPoints + ringPoints + linePoints };
}

/** Why the player cannot make `move` now, or null when they can. */
export function moveIllegalReason(state: PouringState, move: PouringMove): string | null {
  if (state.finished) return "the round is over";
  if (move.type === "end") return null;
  if (move.type !== "pour" && move.type !== "drink") return "no such move";
  const hand = state.seats[0]!.hand;
  if (!Number.isInteger(move.slot) || move.slot < 0 || move.slot >= hand.length) return "no such drink in hand";
  if (move.type === "drink") return null;
  if (!pourValue(state, move.slot, move.cell).legal) return hand[move.slot]!.piece.kind === "rag" ? "a rag wipes a drink" : "it does not suit its neighbours";
  return null;
}

/** True when `seat` has something to set down: a drink or ice that fits somewhere, or a rag and a drink to wipe. */
export function canPour(state: PouringState, seat = 0): boolean {
  return state.seats[seat]!.hand.some((_, slot) => legalCells(state, slot, seat).length > 0);
}

/** Every square hand slot `slot` of `seat` may be poured on. */
export function legalCells(state: PouringState, slot: number, seat = 0): number[] {
  const s = state.seats[seat]?.hand[slot];
  if (!s) return [];
  const out: number[] = [];
  for (let c = 0; c < state.cells.length; c++) {
    if (s.piece.kind === "rag" ? state.cells[c] !== null : fits(state.config, state.cells, s.piece, c)) out.push(c);
  }
  return out;
}

/** Lines with exactly one empty square: the next pirate who can fit a drink there serves it. */
export function openings(cfg: PouringConfig, cells: Bar): number[] {
  const gaps = new Set<number>();
  for (let i = 0; i < cfg.size; i++) {
    for (const line of [rowCells(cfg, i), colCells(cfg, i)]) {
      const empty = line.filter((c) => cells[c] === null);
      if (empty.length === 1) gaps.add(empty[0]!);
    }
  }
  return [...gaps].sort((a, b) => a - b);
}

/** True when anything in `hand` could be set down on the empty square `cell`. */
function handFits(cfg: PouringConfig, cells: Bar, hand: readonly PouringSlot[], cell: number): boolean {
  return hand.some((s) => fits(cfg, cells, s.piece, cell));
}

/** Gaps the next pirate's hand could fill, among the lines through `around`'s row and column and the ones beside them; every line when `around` is -1. */
function gifts(cfg: PouringConfig, cells: Bar, hand: readonly PouringSlot[], around: number): number {
  const lines: number[][] = [];
  const near = (i: number, at: number): boolean => around < 0 || Math.abs(i - at) <= 1;
  for (let i = 0; i < cfg.size; i++) {
    if (near(i, around < 0 ? 0 : rowOf(cfg, around))) lines.push(rowCells(cfg, i));
    if (near(i, around < 0 ? 0 : colOf(cfg, around))) lines.push(colCells(cfg, i));
  }
  const gaps = new Set<number>();
  for (const line of lines) {
    let empty = -1;
    let count = 0;
    for (const c of line) {
      if (cells[c] === null) {
        empty = c;
        count++;
      }
    }
    if (count === 1) gaps.add(empty);
  }
  let n = 0;
  for (const g of gaps) if (handFits(cfg, cells, hand, g)) n++;
  return n;
}

/**
 * How a careful pirate at `seat` rates pouring `slot` on `cell`: its points now, less a share of a
 * line for every gap it leaves that the next pirate in turn could fill (their hand is on show).
 * A rag is rated by the gaps it takes away. The rivals play by it; the hint shows its best.
 */
export function rate(state: PouringState, seat: number, slot: number, cell: number): number {
  const cfg = state.config;
  const v = pourValue(state, slot, cell, seat);
  if (!v.legal) return -Infinity;
  const piece = state.seats[seat]!.hand[slot]!.piece;
  const next = nextAwake(state, seat);
  if (next === seat || next < 0) return v.points;
  const after = state.cells.slice();
  if (piece.kind === "rag") after[cell] = null;
  else {
    after[cell] = piece;
    for (const line of v.lines) for (const c of line.cells) after[c] = null;
  }
  // A pour changes the lines through its square and the gaps beside it; a served line empties a whole row or column, which touches every line across it.
  const around = v.lines.length > 0 ? -1 : cell;
  const hand = state.seats[next]!.hand;
  const given = gifts(cfg, after, hand, around) - gifts(cfg, state.cells, hand, around);
  return v.points - Math.floor((given * cfg.linePoints * GIFT_PERCENT) / 100);
}

/** The next seat after `seat` that will act, or -1 with nobody else at the bar. */
function nextAwake(state: PouringState, seat: number): number {
  const n = state.seats.length;
  for (let i = 1; i < n; i++) {
    const s = (seat + i) % n;
    if (!state.seats[s]!.asleep) return s;
  }
  return n > 1 ? (seat + 1) % n : -1;
}

/** The pour the careful rating likes best for `seat`, or null with nothing to pour. Ties go to the first slot and square. */
export function bestPour(state: PouringState, seat = 0): { slot: number; cell: number; rating: number } | null {
  let best: { slot: number; cell: number; rating: number } | null = null;
  state.seats[seat]!.hand.forEach((_, slot) => {
    for (const cell of legalCells(state, slot, seat)) {
      const r = rate(state, seat, slot, cell);
      if (best === null || r > best.rating) best = { slot, cell, rating: r };
    }
  });
  return best;
}

/** A pour worth making, for an idle hint: the careful rating's best, or null to drink. */
export function hint(state: PouringState): { slot: number; cell: number } | null {
  if (state.finished) return null;
  const b = bestPour(state, 0);
  return b ? { slot: b.slot, cell: b.cell } : null;
}

// ---- the deal

function fillBag(cfg: PouringConfig, rng: PrngState, nextId: number): { bag: PouringPiece[]; rng: PrngState; nextId: number } {
  const bag: PouringPiece[] = [];
  for (let g = 0; g < cfg.glasses; g++) for (let b = 0; b < cfg.brews; b++) bag.push({ id: 0, kind: "drink", glass: g, brew: b });
  for (let i = 0; i < cfg.icePerBag; i++) bag.push({ id: 0, kind: "ice", glass: -1, brew: -1 });
  for (let i = 0; i < cfg.ragsPerBag; i++) bag.push({ id: 0, kind: "rag", glass: -1, brew: -1 });
  for (let i = bag.length - 1; i > 0; i--) {
    const r = nextInt(rng, i + 1);
    rng = r.state;
    const j = r.value;
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  return { bag: bag.map((p) => ({ ...p, id: nextId++ })), rng, nextId };
}

interface Dealer {
  bag: PouringPiece[];
  rng: PrngState;
  nextId: number;
}

function draw(cfg: PouringConfig, d: Dealer): PouringPiece {
  if (d.bag.length === 0) {
    const f = fillBag(cfg, d.rng, d.nextId);
    d.bag = f.bag;
    d.rng = f.rng;
    d.nextId = f.nextId;
  }
  return d.bag.shift()!;
}

export function createPouringGame(seed: string, config: PouringConfig = DEFAULT_POURING_CONFIG): PouringState {
  validateConfig(config);
  const d: Dealer = { bag: [], rng: seedFromString(seed), nextId: 1 };
  const seats: PouringSeat[] = [];
  for (let s = 0; s <= config.rivals; s++) {
    const hand: PouringSlot[] = [];
    for (let i = 0; i < config.offer; i++) hand.push({ piece: draw(config, d), age: 0 });
    seats.push({ hand, score: 0, drunk: 0, sober: 0, asleep: false, turns: 0, lines: 0 });
  }
  return {
    config,
    cells: new Array<PouringPiece | null>(config.size * config.size).fill(null),
    rings: new Array<number>(config.size * config.size).fill(-1),
    seats,
    bag: d.bag,
    rng: d.rng,
    nextId: d.nextId,
    score: 0,
    moveCount: 0,
    bestCombo: 0,
    lastMove: null,
    finished: false,
  };
}

// ---- a turn

interface Table {
  cells: Array<PouringPiece | null>;
  rings: number[];
  seats: PouringSeat[];
  dealer: Dealer;
}

/** A seat's hand once `slot` is used: the others age a turn, and a new drink is dealt into the slot. */
function redeal(cfg: PouringConfig, hand: readonly PouringSlot[], slot: number, d: Dealer): PouringSlot[] {
  return hand.map((s, i) => (i === slot ? { piece: draw(cfg, d), age: 0 } : { piece: s.piece, age: s.age + 1 }));
}

/** Play one act for `seat` on the table, and return it. `slot` and `cell` are already known to be legal; cell -1 drinks. */
function act(cfg: PouringConfig, t: Table, seat: number, slot: number, cell: number): PouringAct {
  const st = t.seats[seat]!;
  const used = st.hand[slot]!;
  const piece = used.piece;
  let type: PouringAct["type"];
  let wiped: PouringPiece | null = null;
  let clean = false;
  let lines: PouringLine[] = [];
  const taken: Array<{ cell: number; id: number }> = [];
  let drinkPoints = 0;
  let ringPoints = 0;
  let linePoints = 0;
  let passedOut = false;
  let drunk = st.drunk;
  let sober = st.sober;
  let asleep = false;
  if (cell < 0) {
    if (piece.kind === "rag") type = "toss";
    else {
      type = "drink";
      drinkPoints = slotValue(cfg, used);
      drunk += 1;
      sober = 0;
      if (drunk >= cfg.tolerance) {
        passedOut = true;
        asleep = true;
        drunk = cfg.tolerance - 1;
      }
    }
  } else if (piece.kind === "rag") {
    type = "wipe";
    wiped = t.cells[cell]!;
    t.cells[cell] = null;
  } else {
    type = "pour";
    clean = t.rings[cell] === -1;
    lines = linesFilledBy(cfg, t.cells, cell);
    t.cells[cell] = piece;
    if (clean) {
      t.rings[cell] = seat;
      ringPoints = cfg.ringPoints;
    }
    drinkPoints = slotValue(cfg, used);
    const base = lineValue(cfg, lines.length);
    linePoints = clean ? Math.floor((base * cfg.cleanPercent) / 100) : base;
    const seen = new Set<number>();
    for (const line of lines) {
      for (const c of line.cells) {
        if (seen.has(c)) continue;
        seen.add(c);
        taken.push({ cell: c, id: t.cells[c]!.id });
      }
    }
    for (const c of seen) t.cells[c] = null;
    sober += 1;
    if (sober >= cfg.soberAfter && drunk > 0) {
      drunk -= 1;
      sober = 0;
    }
  }
  const points = drinkPoints + ringPoints + linePoints;
  const hand = redeal(cfg, st.hand, slot, t.dealer);
  t.seats[seat] = { hand, score: st.score + points, drunk, sober, asleep, turns: st.turns + 1, lines: st.lines + lines.length };
  return {
    seat,
    type,
    slot,
    piece,
    cell,
    wiped,
    clean,
    lines,
    taken,
    drinkPoints,
    ringPoints,
    linePoints,
    points,
    passedOut,
    hand,
    cells: t.cells.slice(),
    rings: t.rings.slice(),
  };
}

/** A turn lost out cold: the pirate wakes for the one after. */
function sleep(t: Table, seat: number): PouringAct {
  const st = t.seats[seat]!;
  t.seats[seat] = { ...st, asleep: false, turns: st.turns + 1, sober: 0 };
  return {
    seat,
    type: "sleep",
    slot: -1,
    piece: null,
    cell: -1,
    wiped: null,
    clean: false,
    lines: [],
    taken: [],
    drinkPoints: 0,
    ringPoints: 0,
    linePoints: 0,
    points: 0,
    passedOut: false,
    hand: st.hand,
    cells: t.cells.slice(),
    rings: t.rings.slice(),
  };
}

function snapshot(cfg: PouringConfig, t: Table, base: PouringState): PouringState {
  return { ...base, config: cfg, cells: t.cells.slice(), rings: t.rings.slice(), seats: t.seats.slice(), bag: t.dealer.bag.slice(), rng: t.dealer.rng, nextId: t.dealer.nextId };
}

/** A rival's turn: the careful rating's best pour on `rivalSkill` percent of turns, anything that fits on the rest, and a drink only when nothing fits. */
function rivalAct(cfg: PouringConfig, t: Table, seat: number, base: PouringState): PouringAct {
  const view = snapshot(cfg, t, base);
  const hand = t.seats[seat]!.hand;
  const careful = nextChance(t.dealer.rng, cfg.rivalSkill, 100);
  t.dealer.rng = careful.state;
  const options: Array<{ slot: number; cell: number; rating: number }> = [];
  hand.forEach((s, slot) => {
    for (const cell of legalCells(view, slot, seat)) {
      // A careless turn pours anything that fits; a rival wipes only, carefully, to take a gap away from the pirate after it.
      if (s.piece.kind === "rag") {
        if (!careful.value) continue;
        const rating = rate(view, seat, slot, cell);
        if (rating > 0) options.push({ slot, cell, rating });
      } else options.push({ slot, cell, rating: careful.value ? rate(view, seat, slot, cell) : 0 });
    }
  });
  if (options.length === 0) {
    // Nothing to pour: down the drink worth most, or toss a rag when that is all there is.
    let slot = 0;
    let top = -1;
    hand.forEach((s, i) => {
      const v = s.piece.kind === "rag" ? -1 : slotValue(cfg, s);
      if (v > top) {
        top = v;
        slot = i;
      }
    });
    return act(cfg, t, seat, slot, -1);
  }
  let pick = options[0]!;
  if (careful.value) {
    for (const o of options) if (o.rating > pick.rating) pick = o;
  } else {
    const r = nextInt(t.dealer.rng, options.length);
    t.dealer.rng = r.state;
    pick = options[r.value]!;
  }
  return act(cfg, t, seat, pick.slot, pick.cell);
}

export function reducePouring(state: PouringState, move: PouringMove): PouringState {
  if (state.finished) throw new InvalidMoveError("the round is over", move);
  const cfg = state.config;
  if (move.type === "end") return { ...state, lastMove: { move, acts: [] }, finished: true };
  const why = moveIllegalReason(state, move);
  if (why !== null) throw new InvalidMoveError(why, move);
  const t: Table = {
    cells: state.cells.slice(),
    rings: state.rings.slice(),
    seats: state.seats.slice(),
    dealer: { bag: state.bag.slice(), rng: state.rng, nextId: state.nextId },
  };
  const acts: PouringAct[] = [];
  const mine = act(cfg, t, 0, move.slot, move.type === "pour" ? move.cell : -1);
  acts.push(mine);
  // The rivals take their turns, and any turn lost out cold passes, until the player is awake to pour again.
  const n = t.seats.length;
  let seat = 0;
  let finished = false;
  for (;;) {
    if (t.seats.every((s) => s.turns >= cfg.lastCall)) {
      finished = true;
      break;
    }
    seat = (seat + 1) % n;
    const st = t.seats[seat]!;
    if (st.turns >= cfg.lastCall) continue;
    if (st.asleep) {
      acts.push(sleep(t, seat));
      continue;
    }
    if (seat === 0) break;
    acts.push(rivalAct(cfg, t, seat, state));
  }
  const after = snapshot(cfg, t, state);
  return {
    ...after,
    score: t.seats[0]!.score,
    moveCount: state.moveCount + 1,
    bestCombo: Math.max(state.bestCombo, mine.lines.length),
    lastMove: { move, acts },
    finished: finished || state.moveCount + 1 >= cfg.maxMoves,
  };
}

export function replayPouring(seed: string, config: PouringConfig, moves: readonly PouringMove[]): PouringState {
  let s = createPouringGame(seed, config);
  for (const m of moves) s = reducePouring(s, m);
  return s;
}

const KIND_CODE = { drink: 1, ice: 2, rag: 3 } as const;

function hashPiece(h: Hasher, p: PouringPiece | null): void {
  if (p === null) {
    h.int(0);
    return;
  }
  h.int(p.id).int(KIND_CODE[p.kind]).int(p.glass).int(p.brew);
}

export function hashPouringState(state: PouringState): string {
  const h = new Hasher();
  h.int(state.cells.length);
  for (const p of state.cells) hashPiece(h, p);
  for (const r of state.rings) h.int(r);
  h.int(state.seats.length);
  for (const s of state.seats) {
    h.int(s.hand.length);
    for (const slot of s.hand) {
      hashPiece(h, slot.piece);
      h.int(slot.age);
    }
    h.int(s.score).int(s.drunk).int(s.sober).int(s.asleep ? 1 : 0).int(s.turns).int(s.lines);
  }
  h.int(state.bag.length);
  for (const p of state.bag) hashPiece(h, p);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.score).int(state.moveCount).int(state.bestCombo).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface PouringSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizePouring(state: PouringState): PouringSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/** Where the player stands among the pirates at the bar: 1 for the most points, ties sharing the better place. */
export function place(state: PouringState): number {
  const mine = state.seats[0]!.score;
  return 1 + state.seats.filter((s, i) => i > 0 && s.score > mine).length;
}

/**
 * A square as two characters: `..` empty, `**` ice, and a drink as a letter for its glass (`a` for
 * glass 0) and a digit for its brew. (`~~` is a rag, which is only ever in a hand.)
 */
export function pieceCode(p: PouringPiece | null): string {
  if (p === null) return "..";
  if (p.kind === "ice") return "**";
  if (p.kind === "rag") return "~~";
  return `${String.fromCharCode(97 + p.glass)}${p.brew}`;
}

/** The bar, two characters a square (`pieceCode`), squares in index order. */
export function viewString(cells: Bar): string {
  return cells.map(pieceCode).join("");
}
