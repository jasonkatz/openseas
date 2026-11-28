// Overload on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the bank, every tick and the taps it brings back, every tap and the chain it sets off,
// the refund, the fresh capacitors, the points and the streak. This file only turns what that round reports into the
// old shape, so the board, its sounds and its page are the prototype's, unchanged.
//
// The new engine settles a chain in one event; the board plays it wave by wave. So the waves are laid out here from
// the bank as it was shown, and held to what the round says came of the chain: the same capacitors spent, the same
// charges left.
import { InvalidMoveError, OVERLOAD_DEF, overloadChainValue, overloadNeighbours, overloadStreakPercentAt, type OverloadCell, type OverloadConfig, type OverloadEvent, type OverloadFresh, type OverloadMove, type OverloadState, type OverloadWave, type PuzzleDef } from "@openseas/engine";
import { advance, play, read, seedFromString, start, type AnyMove, type Cell, type Round, type Seen, type Setting } from "@openseas/puzzle";
import overload, { type Hand } from "@openseas/puzzle/examples/overload";
import { held, roundOf } from "./held.js";

/** The new engine ticks every tenth of a second, as the prototype does as shipped. */
const TICK_MS = 100;
const FULL = 4;

/**
 * The prototype's numbers under the names the new puzzle gives them. The prototype takes a move at its last tick and
 * ends there; the new engine's clock refuses a move once it has run out, so it runs a second longer, and the mirror
 * ends the round at the prototype's last tick.
 */
export function overloadSettings(c: OverloadConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, refill: c.refill, boosterPermille: c.boosterPermille, tapCap: c.tapCap, startTaps: c.startTaps, tapRegenTicks: c.tapRegenTicks,
    refundEvery: c.refundEvery, chainCap: c.chainCap, streakMin: c.streakMin, burstPoints: c.burstPoints, streakPercent: c.streakPercent, roundSeconds: Math.floor((c.maxTick * c.tickMs) / 1000) + 1, maxMoves: c.maxMoves,
  };
}

const cellsOf = (board: Seen): OverloadCell[] => board.flatMap((row) => row.map((p) => ({ id: p!.id, charge: p!.state as number, booster: p!.piece === "booster" })));
type Kept = Pick<OverloadState, "eventSeq" | "moveCount" | "logLength" | "bestCombo" | "bestChain">;

/** `finished` given is what the state says of itself; left out, the round is over by its end, its bound or its clock. */
function shown(round: Round<AnyMove>, config: OverloadConfig, kept: Kept, lastMove: OverloadState["lastMove"], ended = false, finished?: boolean): OverloadState {
  const now = read(round);
  const hand = (now.state as { bank: Hand }).bank;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const state: OverloadState = {
    config,
    tick: now.tick,
    cells: cellsOf(now.board),
    rng: round.state.streams.bank!,
    nextId: round.state.nextId,
    taps: now.gauges.taps!,
    // While the hand is full no tap is coming back, and the prototype counts from now.
    regenFrom: now.gauges.taps! >= config.tapCap ? now.tick : hand.regenFrom,
    score: now.score,
    combo: now.streak,
    chains: stat("chains"),
    bursts: stat("bursts"),
    refunds: stat("refunds"),
    ...kept,
    lastMove,
    finished: finished ?? (ended || kept.logLength >= config.maxMoves || now.tick >= config.maxTick),
  };
  return held(state, round);
}

/** A chain's waves, from the bank as shown with the tap on it: every live capacitor at four bursts at once, into its live neighbours. */
function wavesOf(c: OverloadConfig, cells: readonly OverloadCell[], tapped: number): { waves: OverloadWave[]; spent: boolean[]; settled: number[] } {
  const charges = cells.map((x, i) => x.charge + (i === tapped ? 1 : 0));
  const spent = charges.map(() => false);
  const waves: OverloadWave[] = [];
  for (;;) {
    const bursts = charges.flatMap((q, i) => (!spent[i] && q >= FULL ? [i] : []));
    if (bursts.length === 0) return { waves, spent, settled: charges };
    for (const i of bursts) (spent[i] = true), (charges[i] = 0);
    for (const i of bursts) for (const nb of overloadNeighbours(c, i)) if (!spent[nb]) charges[nb] = charges[nb]! + (cells[i]!.booster ? 2 : 1);
    waves.push({ bursts, boosted: bursts.filter((i) => cells[i]!.booster), charges: charges.slice() });
  }
}

/** A tap's events in the prototype's words, numbered on from the last. */
function heard(state: OverloadState, next: Round<AnyMove>, cell: number, tick: number): OverloadEvent[] {
  const c = state.config;
  const events = next.last.events;
  const at = (p: Cell): number => p.y * c.width + p.x;
  const tapped = events.find((e) => e.event === "tap")!;
  const chain = events.find((e) => e.event === "chain" || e.event === "short");
  let seq = state.eventSeq;
  const out: OverloadEvent[] = [{ seq: ++seq, tick, type: "tap", cell, charge: tapped.fields.charge as number, burst: chain !== undefined }];
  if (!chain) return out;
  const { waves, spent, settled } = wavesOf(c, state.cells, cell);
  const left = chain.changes.flatMap((ch) => (ch.change === "leave" ? [at(ch.at)] : []));
  const agrees = left.length === spent.filter(Boolean).length && left.every((i) => spent[i]) && chain.changes.every((ch) => ch.change !== "change" || !("piece" in ch) || ch.piece.state === Math.min(FULL - 1, settled[at(ch.at)]!));
  if (!agrees) throw new Error("the chain's waves and the new engine's chain part");
  const size = chain.fields.size as number;
  const streak = chain.event === "chain" ? state.combo + 1 : 0;
  const percent = overloadStreakPercentAt(c, streak);
  const base = overloadChainValue(c, size);
  const back = events.find((e) => e.event === "back");
  const refund = back ? (back.fields.taps as number) - (state.taps - 1) : 0;
  const fresh: OverloadFresh[] = events
    .filter((e) => e.event === "fresh")
    .flatMap((e) => e.changes.flatMap((ch) => (ch.change === "arrive" ? [{ cell: at(ch.at), id: ch.piece.id, charge: ch.piece.state as number, booster: ch.piece.piece === "booster" }] : [])));
  out.push({ seq: ++seq, tick, type: "chain", cell, waves, size, base, streak, streakPercent: percent, brokeStreak: streak === 0 && state.combo > 0, refund, fresh, points: Math.floor((base * percent) / 100) });
  return out;
}

const keptOf = (s: OverloadState): Kept => ({ eventSeq: s.eventSeq, moveCount: s.moveCount, logLength: s.logLength, bestCombo: s.bestCombo, bestChain: s.bestChain });

/** The state at a later tick, without a move: what the board shows while the taps come back. */
export function advanceOverloadMirror(state: OverloadState, tick: number): OverloadState {
  if (tick <= state.tick || state.finished) return state;
  const to = Math.min(tick, state.config.maxTick);
  if (to <= state.tick) return state;
  // Time let pass is no move: the round is over only when a move says so, as the prototype's is.
  return shown(advance(roundOf(state), { at: to * TICK_MS }), state.config, keptOf(state), state.lastMove, false, false);
}

export const OVERLOAD_MIRROR: PuzzleDef<OverloadState, OverloadMove, OverloadConfig> = {
  ...OVERLOAD_DEF,
  validateConfig: (config) => {
    OVERLOAD_DEF.validateConfig(config);
    if (config.tickMs !== TICK_MS) throw new Error(`the new engine plays Overload at a tick of ${TICK_MS} ms`);
  },
  create: (seed, config) => {
    OVERLOAD_MIRROR.validateConfig(config);
    const round = start(overload, { seed, settings: overloadSettings(config), streams: { bank: seedFromString(`overload:${seed}`) } }) as unknown as Round<AnyMove>;
    return shown(round, config, { eventSeq: 0, moveCount: 0, logLength: 0, bestCombo: 0, bestChain: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const c = state.config;
    const tick = move.type === "end" && move.tick === undefined ? state.tick : move.tick;
    if (tick === undefined || !Number.isInteger(tick) || tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
    if (tick > c.maxTick) throw new InvalidMoveError("tick beyond the round", move);
    const kept = { ...keptOf(state), logLength: state.logLength + 1 };
    const round = roundOf(state);
    // A wait is time let pass, and ending early is the host's: neither is a move of the puzzle's.
    if (move.type !== "tap") {
      const later = tick > state.tick ? advance(round, { at: tick * TICK_MS }) : round;
      return shown(later, c, kept, { move, events: [], points: 0 }, move.type === "end");
    }
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= state.cells.length) throw new InvalidMoveError("no such capacitor", move);
    // The bank as it stands at the tap's tick: the taps that came back by then.
    const before = advanceOverloadMirror(state, tick);
    const next = play(roundOf(before), { move: "tap", at: { x: move.cell % c.width, y: Math.floor(move.cell / c.width) } }, { at: tick * TICK_MS });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const events = heard(before, next, move.cell, tick);
    const chain = events.find((e) => e.type === "chain");
    kept.eventSeq = events.at(-1)!.seq;
    kept.moveCount++;
    if (chain?.type === "chain") (kept.bestCombo = Math.max(kept.bestCombo, chain.streak)), (kept.bestChain = Math.max(kept.bestChain, chain.size));
    return shown(next, c, kept, { move, events, points: read(next).score - state.score });
  },
};
