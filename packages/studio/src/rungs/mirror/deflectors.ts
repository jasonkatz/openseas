// Deflectors on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the grid, the targets and their recipes, the queue and the supply, every place, turn,
// bin and shot, what each shot spent and the points. This file only turns what that round reports into the old shape,
// so the board, its sounds and its page are the prototype's, unchanged.
import {
  DEFLECTORS_DEF,
  deflectorsEmitterPorts,
  deflectorsOutlook,
  deflectorsResolve,
  InvalidMoveError,
  type DeflectorsConfig,
  type DeflectorsEvent,
  type DeflectorsMove,
  type DeflectorsState,
  type DeflectorsTarget,
  type PuzzleDef,
} from "@openseas/engine";
import { advance, play, read, seedFromString, start, type AnyMove, type Round, type Seen, type Setting } from "@openseas/puzzle";
import deflectors, { type Range } from "@openseas/puzzle/examples/deflectors";
import { held, roundOf } from "./held.js";

/** The new engine ticks every tenth of a second, as the prototype does as shipped. */
const TICK_MS = 100;

/**
 * The prototype's numbers under the names the new puzzle gives them: its lens bonus as a table for one, two and three
 * lenses, and its turn cap as legs. The prototype takes a move at its last tick; the new engine's clock refuses a move
 * once it has run out, so it runs a second longer, and the mirror ends the round at the prototype's last tick.
 */
export function deflectorsSettings(c: DeflectorsConfig): Record<string, Setting> {
  return {
    size: c.size, roundSeconds: Math.floor((c.maxTick * c.tickMs) / 1000) + 1, maxMoves: c.maxMoves, emitters: c.emitters, targets: c.targets, mirrors: c.mirrors, lenses: c.lenses,
    recipeWeights: c.recipeWeights, lensPercent: [1, 2, 3].map((k) => 100 + k * c.lensPercent), bouncePoints: c.bouncePoints, legCap: c.bounceCap + 1, litPercent: c.litPercent,
    spend: c.spend, pieces: c.pieces, queueSize: c.queueSize, lensChance: c.lensChance, splitterChance: c.splitterChance, fireTicks: c.fireTicks,
  };
}

/** A piece on the board as the cell number the prototype keeps: empty, `/`, `\`, a lens of a kind, or a splitter. */
const cellsOf = (board: Seen): number[] =>
  board.flatMap((row) => row.map((p) => (!p ? 0 : p.piece === "mirror" ? 1 + (p.state as number) : p.piece === "splitter" ? 6 : 3 + (p.state as number))));

type Kept = Pick<DeflectorsState, "eventSeq" | "logLength" | "bestShot" | "lastMove">;

function shown(round: Round<AnyMove>, config: DeflectorsConfig, kept: Kept, ended = false, finished?: boolean): DeflectorsState {
  const now = read(round);
  const range = (now.state as { range: Range }).range;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const state: DeflectorsState = {
    config,
    tick: now.tick,
    mirrors: cellsOf(now.board),
    emitters: deflectorsEmitterPorts(config),
    targets: range.targets.map((t) => ({ id: t.id, port: t.port, recipe: t.recipe })),
    queue: [...range.queue],
    left: range.left,
    fireTick: range.fireTick,
    rng: round.state.streams.range!,
    eventSeq: kept.eventSeq,
    logLength: kept.logLength,
    placed: stat("placed"),
    binned: stat("binned"),
    shots: stat("shots"),
    lit: stat("lit"),
    spent: stat("spent"),
    bestShot: kept.bestShot,
    bestLit: stat("bestLit"),
    longest: stat("longest"),
    score: now.score,
    lastMove: kept.lastMove,
    finished: false,
  };
  // With the supply used up, a grid that lights nothing has nothing left to give: the prototype ends there.
  const spentOut = state.queue.length === 0 && deflectorsOutlook(state).lit === 0;
  return held({ ...state, finished: finished ?? (ended || spentOut || kept.logLength >= config.maxMoves || now.tick >= config.maxTick) }, round);
}

/** The state at a later tick, without a move: nothing comes on the clock, so only the tick moves. */
export function advanceDeflectorsMirror(state: DeflectorsState, tick: number): DeflectorsState {
  if (tick <= state.tick || state.finished) return state;
  const at = Math.min(tick, state.config.maxTick);
  const later = advance(roundOf(state), { at: at * TICK_MS });
  return shown(later, state.config, { ...state, lastMove: { move: { type: "wait", tick: at }, events: [], points: 0 } }, false, state.finished);
}

export const DEFLECTORS_MIRROR: PuzzleDef<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  ...DEFLECTORS_DEF,
  validateConfig: (config) => {
    DEFLECTORS_DEF.validateConfig(config);
    if (config.tickMs !== TICK_MS) throw new Error(`the new engine plays Deflectors at a tick of ${TICK_MS} ms`);
  },
  create: (seed, config) => {
    DEFLECTORS_MIRROR.validateConfig(config);
    const round = start(deflectors, { seed, settings: deflectorsSettings(config), streams: { range: seedFromString(`deflectors:${seed}`) } }) as unknown as Round<AnyMove>;
    return shown(round, config, { eventSeq: 0, logLength: 0, bestShot: 0, lastMove: null });
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const c = state.config;
    if (!Number.isInteger(move.tick) || move.tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
    if (move.tick > c.maxTick) throw new InvalidMoveError("tick beyond the round", move);
    const at = move.tick * TICK_MS;
    const logLength = state.logLength + 1;
    if (move.type === "wait" || move.type === "end") {
      const round = advance(roundOf(state), { at });
      return shown(round, c, { eventSeq: state.eventSeq, logLength, bestShot: state.bestShot, lastMove: { move, events: [], points: 0 } }, move.type === "end");
    }
    if (move.type === "place" && (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= c.size * c.size)) throw new InvalidMoveError("no such cell", move);
    // What a shot does is read off the grid as it stood, by the prototype's own trace; the new engine's report must agree.
    const before = advanceDeflectorsMirror(state, move.tick);
    const outcome = move.type === "fire" ? deflectorsResolve(c, before.mirrors, before.emitters, before.targets) : null;
    const next = play(roundOf(before), move.type === "place" ? { move: "place", at: { x: move.cell % c.size, y: Math.floor(move.cell / c.size) } } : { move: move.type }, { at });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    let seq = state.eventSeq;
    const events: DeflectorsEvent[] = [];
    const after = (read(next).state as { range: Range }).range;
    for (const e of next.last.events) {
      const f = e.fields as Record<string, number>;
      if (e.event === "piece") events.push({ seq: ++seq, tick: move.tick, type: "piece", piece: f.kind! });
      else if (e.event === "bin") events.push({ seq: ++seq, tick: move.tick, type: "bin", piece: f.kind! });
      else if (e.event === "fire") {
        if (!outcome || outcome.lit !== f.lit) throw new Error("the new engine's shot is not the shot the grid shows");
        const spent = c.spend ? [...new Set(outcome.shots.flatMap((s) => (s.target >= 0 ? [...s.turns, ...s.lensCells] : s.turns)))].sort((a, b) => a - b) : [];
        const targets: DeflectorsTarget[] = after.targets.map((t) => ({ id: t.id, port: t.port, recipe: t.recipe }));
        events.push({ seq: ++seq, tick: move.tick, type: "fire", outcome, spent, targets });
      }
    }
    const points = read(next).score - state.score;
    return shown(next, c, { eventSeq: seq, logLength, bestShot: outcome ? Math.max(state.bestShot, points) : state.bestShot, lastMove: { move, events, points } });
  },
};
