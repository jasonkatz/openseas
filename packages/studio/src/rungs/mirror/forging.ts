// Forging on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the deal, every strike and the mark it shows next, the chain, the set in the making,
// the weave, the plate and the stall. This file only turns what that round reports into the old shape, so the board,
// its sounds and its page are the prototype's, unchanged.
import { FORGING_DEF, InvalidMoveError, type ForgingConfig, type ForgingMark, type ForgingMove, type ForgingSpot, type ForgingState, type ForgingStrike, type PuzzleDef } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Round, type Setting } from "@openseas/puzzle";
import forging, { type Anvil } from "@openseas/puzzle/examples/forging";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. */
export function forgingSettings(c: ForgingConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, maxMoves: c.maxMoves, blows: c.blows, jumps: c.jumps, far: c.far, sparks: c.sparks, weights: c.weights,
    strikePoints: c.strikePoints, platePoints: c.platePoints, chainPoints: c.chainPoints, chainCap: c.chainCap, setPoints: c.setPoints, weaveCap: c.weaveCap,
  };
}

/** The plate: a live spot is the piece on its place; a set one is gone from the board, and keeps the mark it was set on. */
function cellsOf(round: Round<AnyMove>, prev: readonly ForgingSpot[] | null): ForgingSpot[] {
  return read(round).board.flatMap((row, y) => row.map((p, x): ForgingSpot => (p ? { heat: p.state as number, mark: p.piece as ForgingMark } : { heat: 0, mark: prev![y * row.length + x]!.mark })));
}

function shown(round: Round<AnyMove>, config: ForgingConfig, prev: ForgingState | null, lastMove: ForgingStrike | null, ended = false): ForgingState {
  const now = read(round);
  const anvil = (now.state as { anvil: Anvil }).anvil;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const moveCount = stat("strikes");
  const stalled = round.last.events.some((e) => e.event === "stall") || (prev?.stalled ?? false);
  const done = now.board.every((row) => row.every((p) => p === null));
  const state: ForgingState = {
    config,
    cells: cellsOf(round, prev?.cells ?? null),
    rng: round.state.streams.marks!,
    at: anvil.at,
    lead: anvil.lead,
    score: now.score,
    moveCount,
    chain: anvil.chain,
    chainMark: anvil.chainMark,
    run: anvil.run,
    weave: anvil.weave,
    weaveFamily: anvil.weaveFamily,
    sets: stat("sets"),
    bestWeave: stat("bestWeave"),
    bestChain: stat("bestChain"),
    stalled,
    sparksEarned: stat("sparks"),
    lastMove,
    finished: ended || done || stalled || moveCount >= config.maxMoves,
  };
  return held(state, round);
}

/** A strike's events as the report the board plays back. */
function reportOf(before: ForgingState, next: Round<AnyMove>, cell: number): ForgingStrike {
  const c = before.config;
  const events = next.last.events;
  const strike = events.find((e) => e.event === "strike")!.fields as { heat: number; links: number; sparked: boolean };
  const setEvent = events.find((e) => e.event === "count" || e.event === "span");
  const after = (read(next).state as { anvil: Anvil }).anvil;
  const nextMark = strike.heat > 0 ? (read(next).board[Math.floor(cell / c.width)]![cell % c.width]!.piece as ForgingMark) : null;
  const weave = setEvent ? (setEvent.fields.weave as number) : 0;
  return {
    cell,
    mark: before.cells[cell]!.mark,
    heat: strike.heat,
    next: nextMark,
    sparked: strike.sparked,
    chain: after.chain,
    chainPoints: c.chainPoints * Math.min(strike.links, c.chainCap),
    set: setEvent ? { family: setEvent.event as "count" | "span", weave, points: c.setPoints * Math.min(weave, c.weaveCap) } : null,
    broke: events.some((e) => e.event === "broke"),
    stalled: events.some((e) => e.event === "stall"),
    done: events.some((e) => e.event === "plate"),
    points: next.last.banked,
  };
}

const deal = (seed: string, config: ForgingConfig): Round<AnyMove> =>
  start(forging, { seed, settings: forgingSettings(config), streams: { marks: seedFromString(`forging:${seed}`) } }) as unknown as Round<AnyMove>;

export const FORGING_MIRROR: PuzzleDef<ForgingState, ForgingMove, ForgingConfig> = {
  ...FORGING_DEF,
  create: (seed, config) => {
    FORGING_DEF.validateConfig(config);
    return shown(deal(seed, config), config, null, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    // Ending early is the host's.
    if (move.type === "end") return shown(round, state.config, state, null, true);
    const c = state.config;
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= state.cells.length) throw new InvalidMoveError("no such spot", move);
    const next = play(round, { move: "strike", at: { x: move.cell % c.width, y: Math.floor(move.cell / c.width) } });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    return shown(next, c, state, reportOf(state, next, move.cell));
  },
};
