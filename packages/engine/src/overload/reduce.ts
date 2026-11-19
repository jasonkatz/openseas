import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_OVERLOAD_CONFIG,
  OVERLOAD_FULL,
  type OverloadCell,
  type OverloadConfig,
  type OverloadEvent,
  type OverloadFresh,
  type OverloadMove,
  type OverloadMoveReport,
  type OverloadState,
  type OverloadWave,
} from "./types.js";

export const idx = (cfg: OverloadConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: OverloadConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: OverloadConfig, cell: number): number => Math.floor(cell / cfg.width);

export function validateConfig(cfg: OverloadConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 3, 10) &&
    int(cfg.height, 3, 10) &&
    Array.isArray(cfg.refill) &&
    cfg.refill.length === OVERLOAD_FULL &&
    cfg.refill.every((w) => int(w, 0, 1000)) &&
    cfg.refill.reduce((a, w) => a + w, 0) > 0 &&
    int(cfg.boosterPermille, 0, 500) &&
    int(cfg.burstPoints, 0, 1000) &&
    int(cfg.chainCap, 1, 1000) &&
    int(cfg.streakMin, 1, 100) &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => int(p, 100, 1000)) &&
    int(cfg.tapCap, 1, 12) &&
    int(cfg.startTaps, 0, cfg.tapCap) &&
    int(cfg.tapRegenTicks, 1, 10_000) &&
    int(cfg.refundEvery, 0, 1000) &&
    Array.isArray(cfg.drawSizes) &&
    cfg.drawSizes.length <= 16 &&
    cfg.drawSizes.every((d) => int(d, 1, cfg.width * cfg.height)) &&
    int(cfg.drawSpan, 0, 100) &&
    int(cfg.drawPercent, 100, 1000) &&
    typeof cfg.drawRandom === "boolean" &&
    int(cfg.tickMs, 20, 5000) &&
    int(cfg.maxTick, 1, 100_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid overload config");
}

/** The cells above, right of, below and left of `cell`, in that order, that are in the bank. */
export function neighbours(cfg: OverloadConfig, cell: number): number[] {
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  const out: number[] = [];
  if (row > 0) out.push(cell - cfg.width);
  if (col < cfg.width - 1) out.push(cell + 1);
  if (row < cfg.height - 1) out.push(cell + cfg.width);
  if (col > 0) out.push(cell - 1);
  return out;
}

/** A fresh capacitor: its charge by the refill weights, a booster by the booster chance. */
function fresh(cfg: OverloadConfig, rng: PrngState): { rng: PrngState; charge: number; booster: boolean } {
  const total = cfg.refill.reduce((a, w) => a + w, 0);
  const pick = nextInt(rng, total);
  let left = pick.value;
  let charge = 0;
  for (let c = 0; c < cfg.refill.length; c++) {
    if (left < cfg.refill[c]!) {
      charge = c;
      break;
    }
    left -= cfg.refill[c]!;
  }
  const b = nextChance(pick.state, cfg.boosterPermille, 1000);
  return { rng: b.state, charge, booster: b.value };
}

export function createOverloadGame(seed: string, config: OverloadConfig = DEFAULT_OVERLOAD_CONFIG): OverloadState {
  validateConfig(config);
  let rng = seedFromString(`overload:${seed}`);
  const cells: OverloadCell[] = [];
  for (let c = 0; c < config.width * config.height; c++) {
    const f = fresh(config, rng);
    rng = f.rng;
    cells.push({ id: c + 1, charge: f.charge, booster: f.booster });
  }
  // The draw has a stream of its own, so turning it on deals the same bank.
  const first = nextDraw(config, seedFromString(`overload-draw:${seed}`), -1);
  return {
    config,
    tick: 0,
    cells,
    rng,
    nextId: cells.length + 1,
    taps: config.startTaps,
    regenFrom: 0,
    eventSeq: 0,
    score: 0,
    moveCount: 0,
    logLength: 0,
    combo: 0,
    bestCombo: 0,
    chains: 0,
    bestChain: 0,
    bursts: 0,
    refunds: 0,
    draw: first.draw,
    drawIndex: first.index,
    drawRng: first.rng,
    draws: 0,
    drawScore: 0,
    lastMove: null,
    finished: false,
  };
}

/**
 * The draw after draw `index` (-1 for the first): the next in the list, or one picked at random from
 * it on the draw's own stream when `drawRandom`. Draws nothing with no draw.
 */
function nextDraw(cfg: OverloadConfig, rng: PrngState, index: number): { draw: number; index: number; rng: PrngState } {
  const n = cfg.drawSizes.length;
  if (n === 0) return { draw: 0, index: 0, rng };
  if (!cfg.drawRandom) {
    const i = (index + 1) % n;
    return { draw: cfg.drawSizes[i]!, index: i, rng };
  }
  const r = nextInt(rng, n);
  return { draw: cfg.drawSizes[r.value]!, index: r.value, rng: r.state };
}

/** The draw asked for now, as the band of chain sizes that meets it and what it multiplies by. Null with no draw. */
export function drawBand(state: OverloadState): { min: number; max: number; percent: number } | null {
  if (state.config.drawSizes.length === 0) return null;
  return { min: state.draw, max: state.draw + state.config.drawSpan, percent: state.config.drawPercent };
}

/** True when a chain of `size` bursts meets the draw asked for now. Never with no draw. */
export function drawMet(state: OverloadState, size: number): boolean {
  const band = drawBand(state);
  return band !== null && size >= band.min && size <= band.max;
}

/**
 * What a chain of `size` set off now scores, and what the draw adds to it: the streak it would build
 * or break and the draw it would meet, as the engine scores the tap. Uses no randomness.
 */
export function chainPoints(state: OverloadState, size: number): { points: number; drawPoints: number; met: boolean } {
  if (size <= 0) return { points: 0, drawPoints: 0, met: false };
  const cfg = state.config;
  const combo = size >= cfg.streakMin ? state.combo + 1 : 0;
  const streaked = Math.floor((chainValue(cfg, size) * streakPercentAt(cfg, combo)) / 100);
  const met = drawMet(state, size);
  const points = met ? Math.floor((streaked * cfg.drawPercent) / 100) : streaked;
  return { points, drawPoints: points - streaked, met };
}

/** The taps held at a later tick, and the tick the tap then coming back started from. */
function tapsAt(state: OverloadState, tick: number): { taps: number; regenFrom: number } {
  const cfg = state.config;
  if (state.taps >= cfg.tapCap) return { taps: cfg.tapCap, regenFrom: tick };
  const gained = Math.floor((tick - state.regenFrom) / cfg.tapRegenTicks);
  const taps = Math.min(cfg.tapCap, state.taps + gained);
  return { taps, regenFrom: taps >= cfg.tapCap ? tick : state.regenFrom + gained * cfg.tapRegenTicks };
}

/**
 * How far along the tap now coming back is, as ticks out of `tapRegenTicks`; 0 while the player
 * holds tapCap. For the board's tap lamps.
 */
export function regenProgress(state: OverloadState): number {
  if (state.taps >= state.config.tapCap) return 0;
  return Math.max(0, Math.min(state.config.tapRegenTicks, state.tick - state.regenFrom));
}

/** The state at a later tick, without logging a move: the taps that have come back by then. Clients call this to show time passing. */
export function advanceOverload(state: OverloadState, tick: number): OverloadState {
  if (tick <= state.tick || state.finished) return state;
  const at = Math.min(tick, state.config.maxTick);
  if (at <= state.tick) return state;
  return { ...state, tick: at, ...tapsAt(state, at) };
}

/**
 * Run a chain to its end on `charges`, which already holds the tap. Every live cell at 4 or more
 * bursts together: it is spent, and passes one charge (two, for a booster) to each live neighbour.
 * Wave after wave until no live cell is at 4. A cell bursts once, so a chain is never longer than
 * the bank. Uses no randomness.
 */
function runChain(cfg: OverloadConfig, chargesIn: readonly number[], boosters: readonly boolean[]): { waves: OverloadWave[]; size: number; spent: boolean[] } {
  const charges = chargesIn.slice();
  const spent = new Array<boolean>(charges.length).fill(false);
  const waves: OverloadWave[] = [];
  let size = 0;
  // One wave bursts at least one cell and a cell bursts once: the bank's size bounds the loop.
  for (let n = 0; n < charges.length; n++) {
    const bursts: number[] = [];
    for (let c = 0; c < charges.length; c++) if (!spent[c] && charges[c]! >= OVERLOAD_FULL) bursts.push(c);
    if (bursts.length === 0) break;
    const boosted: number[] = [];
    for (const c of bursts) {
      spent[c] = true;
      charges[c] = 0;
      if (boosters[c]) boosted.push(c);
    }
    for (const c of bursts) {
      const pass = boosters[c] ? 2 : 1;
      for (const nb of neighbours(cfg, c)) if (!spent[nb]) charges[nb] = charges[nb]! + pass;
    }
    size += bursts.length;
    waves.push({ bursts, boosted, charges: charges.slice() });
  }
  return { waves, size, spent };
}

/** What a chain of `size` bursts scores before the streak. */
export function chainValue(cfg: OverloadConfig, size: number): number {
  return cfg.burstPoints * size * Math.min(size, cfg.chainCap);
}

/** What the streak multiplies by, in percent, at a streak of `streak` long chains. */
export function streakPercentAt(cfg: OverloadConfig, streak: number): number {
  if (streak <= 0) return 100;
  return cfg.streakPercent[Math.min(streak, cfg.streakPercent.length) - 1]!;
}

/** How many taps a chain of `size` gives back, before the hand's cap. */
export function refundFor(cfg: OverloadConfig, size: number): number {
  return cfg.refundEvery > 0 ? Math.floor(size / cfg.refundEvery) : 0;
}

/**
 * The chain a tap on `cell` would set off right now, in bursts: 0 when it only charges the
 * capacitor. Uses no randomness, so asking changes nothing. The board never shows this in play;
 * it is for the idle hint, the seed finder and tests.
 */
export function chainSize(state: OverloadState, cell: number): number {
  return chainSizeOn(state.config, state.cells.map((c) => c.charge), state.cells.map((c) => c.booster), cell);
}

/** The capacitors a tap on `cell` would burst right now, in index order: empty when it only charges. Uses no randomness. */
export function chainCells(state: OverloadState, cell: number): number[] {
  const charges = state.cells.map((c) => c.charge);
  if (charges[cell]! + 1 < OVERLOAD_FULL) return [];
  charges[cell] = charges[cell]! + 1;
  const r = runChain(state.config, charges, state.cells.map((c) => c.booster));
  return r.spent.flatMap((s, c) => (s ? [c] : []));
}

function chainSizeOn(cfg: OverloadConfig, charges: readonly number[], boosters: readonly boolean[], cell: number): number {
  if (charges[cell]! + 1 < OVERLOAD_FULL) return 0;
  const next = charges.slice();
  next[cell] = next[cell]! + 1;
  return runChain(cfg, next, boosters).size;
}

export interface OverloadHint {
  /** The capacitor to tap. */
  readonly cell: number;
  /** The chain that tap sets off, in bursts; 0 when the tap only primes. */
  readonly size: number;
  /** True when this tap primes a capacitor for a longer chain on the next tap. */
  readonly prime: boolean;
}

/**
 * A tap worth making, for the idle hint in unrated practice: the tap that sets off the longest
 * chain. When that chain is too short to build the streak and one more charge somewhere would make
 * a longer one, the hint is that priming tap. Null only when a tap or two can set nothing off.
 */
export function hint(state: OverloadState): OverloadHint | null {
  const cfg = state.config;
  const charges = state.cells.map((c) => c.charge);
  const boosters = state.cells.map((c) => c.booster);
  let best: OverloadHint | null = null;
  for (let c = 0; c < charges.length; c++) {
    const size = chainSizeOn(cfg, charges, boosters, c);
    if (size > 0 && (!best || size > best.size)) best = { cell: c, size, prime: false };
  }
  if (best && best.size >= cfg.streakMin) return best;
  let primed: { cell: number; size: number } | null = null;
  for (let p = 0; p < charges.length; p++) {
    if (charges[p]! + 1 >= OVERLOAD_FULL) continue;
    const after = charges.slice();
    after[p] = after[p]! + 1;
    for (let c = 0; c < charges.length; c++) {
      const size = chainSizeOn(cfg, after, boosters, c);
      if (size > 0 && (!primed || size > primed.size)) primed = { cell: p, size };
    }
  }
  if (primed && (!best || primed.size > best.size)) return { cell: primed.cell, size: 0, prime: true };
  return best;
}

export function tapIllegalReason(state: OverloadState, cell: number, tick: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) return "no such capacitor";
  if (tapsAt(state, Math.max(tick, state.tick)).taps < 1) return "no taps left";
  return null;
}

export function reduceOverload(state: OverloadState, move: OverloadMove): OverloadState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  // An end may come without a tick: the round then ends where it stands.
  const tick = move.type === "end" && move.tick === undefined ? state.tick : move.tick;
  if (tick === undefined || !Number.isInteger(tick) || tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
  if (tick > state.config.maxTick) throw new InvalidMoveError("tick beyond the round", move);
  const cfg = state.config;
  const at = tapsAt(state, tick);
  let next: OverloadState = { ...state, tick, taps: at.taps, regenFrom: at.regenFrom };
  let events: OverloadEvent[] = [];
  let ended = false;
  switch (move.type) {
    case "wait":
      break;
    case "end":
      ended = true;
      break;
    case "tap": {
      const reason = tapIllegalReason(state, move.cell, tick);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      const r = tap(next, move.cell);
      next = r.state;
      events = r.events;
      break;
    }
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
  const logLength = state.logLength + 1;
  const report: OverloadMoveReport = { move, events, points: next.score - state.score };
  return { ...next, logLength, lastMove: report, finished: ended || logLength >= cfg.maxMoves || next.tick >= cfg.maxTick };
}

function tap(state: OverloadState, cell: number): { state: OverloadState; events: OverloadEvent[] } {
  const cfg = state.config;
  const tick = state.tick;
  let seq = state.eventSeq;
  const events: OverloadEvent[] = [];
  const charges = state.cells.map((c) => c.charge);
  charges[cell] = charges[cell]! + 1;
  const sets = charges[cell]! >= OVERLOAD_FULL;
  events.push({ seq: ++seq, tick, type: "tap", cell, charge: charges[cell]!, burst: sets });
  // Spending a tap from a full hand starts the next one coming back now.
  const regenFrom = state.taps >= cfg.tapCap ? tick : state.regenFrom;
  let taps = state.taps - 1;
  const moveCount = state.moveCount + 1;
  if (!sets) {
    const cells = state.cells.slice();
    cells[cell] = { ...cells[cell]!, charge: charges[cell]! };
    return { state: { ...state, cells, taps, regenFrom, eventSeq: seq, moveCount }, events };
  }

  const chain = runChain(cfg, charges, state.cells.map((c) => c.booster));
  const long = chain.size >= cfg.streakMin;
  const brokeStreak = !long && state.combo > 0;
  const combo = long ? state.combo + 1 : 0;
  const percent = streakPercentAt(cfg, combo);
  const base = chainValue(cfg, chain.size);
  const scored = chainPoints(state, chain.size);
  const points = scored.points;
  const drew = scored.met ? nextDraw(cfg, state.drawRng, state.drawIndex) : { draw: state.draw, index: state.drawIndex, rng: state.drawRng };
  const refund = Math.min(refundFor(cfg, chain.size), cfg.tapCap - taps);
  taps += refund;

  // Every spent capacitor is swapped for a fresh one; the rest keep the charge they were passed.
  const settled = chain.waves[chain.waves.length - 1]!.charges;
  let rng = state.rng;
  let nextId = state.nextId;
  const cells: OverloadCell[] = [];
  const swapped: OverloadFresh[] = [];
  for (let c = 0; c < state.cells.length; c++) {
    if (chain.spent[c]) {
      const f = fresh(cfg, rng);
      rng = f.rng;
      const made = { id: nextId++, charge: f.charge, booster: f.booster };
      cells.push(made);
      swapped.push({ cell: c, ...made });
    } else cells.push({ ...state.cells[c]!, charge: Math.min(OVERLOAD_FULL - 1, settled[c]!) });
  }
  events.push({ seq: ++seq, tick, type: "chain", cell, waves: chain.waves, size: chain.size, base, streak: combo, streakPercent: percent, brokeStreak, refund, drawMet: scored.met, drawPoints: scored.drawPoints, draw: drew.draw, fresh: swapped, points });
  return {
    state: {
      ...state,
      cells,
      rng,
      nextId,
      taps,
      // A refund that fills the hand stops the count, as holding tapCap always does.
      regenFrom: taps >= cfg.tapCap ? tick : regenFrom,
      eventSeq: seq,
      score: state.score + points,
      moveCount,
      combo,
      bestCombo: Math.max(state.bestCombo, combo),
      chains: state.chains + 1,
      bestChain: Math.max(state.bestChain, chain.size),
      bursts: state.bursts + chain.size,
      refunds: state.refunds + refund,
      draw: drew.draw,
      drawIndex: drew.index,
      drawRng: drew.rng,
      draws: state.draws + (scored.met ? 1 : 0),
      drawScore: state.drawScore + scored.drawPoints,
    },
    events,
  };
}

export function replayOverload(seed: string, config: OverloadConfig, moves: readonly OverloadMove[]): OverloadState {
  let s = createOverloadGame(seed, config);
  for (const m of moves) s = reduceOverload(s, m);
  return s;
}

export function hashOverloadState(state: OverloadState): string {
  const h = new Hasher();
  h.int(state.config.width).int(state.config.height).int(state.tick);
  for (const c of state.cells) h.int(c.id).int(c.charge).int(c.booster ? 1 : 0);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.taps).int(state.regenFrom).int(state.eventSeq);
  h.int(state.score).int(state.moveCount).int(state.logLength).int(state.combo).int(state.bestCombo);
  h.int(state.chains).int(state.bestChain).int(state.bursts).int(state.refunds).int(state.finished ? 1 : 0);
  // The draw, only when it is on: a round with no draw hashes as it did before there was one.
  if (state.config.drawSizes.length > 0) {
    h.int(state.draw).int(state.drawIndex).int(state.draws).int(state.drawScore);
    h.int(state.drawRng.a).int(state.drawRng.b).int(state.drawRng.c).int(state.drawRng.d);
  }
  return h.digest();
}

export interface OverloadSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/** `moves` is taps made: waits are the clock's, not the player's. */
export function summarizeOverload(state: OverloadState): OverloadSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/** The bank as one character a cell, row by row: its charge as a digit, or `a` to `d` for a booster at 0 to 3. What the board draws must match it. */
export function viewString(cells: ReadonlyArray<{ readonly charge: number; readonly booster: boolean }>): string {
  return cells.map((c) => cellChar(c.charge, c.booster)).join("");
}

export function cellChar(charge: number, booster: boolean): string {
  const c = Math.max(0, Math.min(OVERLOAD_FULL - 1, charge));
  return booster ? "abcd"[c]! : String(c);
}
