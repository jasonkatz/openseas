// Assembly on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the deal, every swap and fit, the refill, the tray and its bag, the points and the
// chain. This file only turns what that round reports into the old shape, so the board, its sounds and its page
// are the prototype's, unchanged.
import { ASSEMBLY_CORE, ASSEMBLY_DEF, InvalidMoveError, type AssemblyBlueprint, type AssemblyConfig, type AssemblyMove, type AssemblyPiece, type AssemblyState, type AssemblyMoveReport, type PuzzleDef } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Cell, type Piece, type Round, type Seen, type Setting } from "@openseas/puzzle";
import assembly, { PARTS, POOL, type Yard } from "@openseas/puzzle/examples/assembly";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. A place in the chain that counts up to a cap is a table of percents. */
export function assemblySettings(c: AssemblyConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, maxMoves: c.maxMoves, kindWeights: c.kindWeights, traySize: c.traySize, fitPoints: c.fitPoints, corePoints: c.corePoints,
    chainPercent: Array.from({ length: c.chainCap }, (_, i) => 100 * (i + 1)), startCores: c.startCores, corePermille: c.corePermille, maxCores: c.maxCores,
  };
}

const kindOf = (p: Piece): number => (p.piece === "core" ? ASSEMBLY_CORE : PARTS.indexOf(p.piece as (typeof PARTS)[number]));
const cellsOf = (board: Seen): AssemblyPiece[] => board.flatMap((row) => row.map((p) => ({ id: p!.id, kind: kindOf(p!) })));
/**
 * A blueprint as the board keeps it. The new engine numbers only pieces, so a blueprint is named by when it was
 * dealt, the k-th from a number no piece reaches.
 */
const BLUEPRINT_IDS = 1_000_000;
const blueprint = (shape: number, k: number): AssemblyBlueprint => ({ id: BLUEPRINT_IDS + k, shape, width: POOL[shape]!.width, height: POOL[shape]!.height, parts: POOL[shape]!.parts });

function shown(round: Round<AnyMove>, config: AssemblyConfig, tray: readonly AssemblyBlueprint[], prev: AssemblyState | null, lastMove: AssemblyMoveReport | null, ended = false): AssemblyState {
  const now = read(round);
  const yard = (now.state as { yard: Yard }).yard;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const moveCount = now.movesMade;
  const state: AssemblyState = {
    config,
    cells: cellsOf(now.board),
    bag: yard.bag,
    tray,
    streams: { parts: round.state.streams.parts!, cores: round.state.streams.cores!, prints: round.state.streams.prints! },
    nextId: round.state.nextId,
    score: now.score,
    moveCount,
    swaps: stat("swaps"),
    fits: stat("fits"),
    chain: now.streak,
    bestChain: Math.max(prev?.bestChain ?? 0, now.streak),
    bigFits: stat("bigFits"),
    coresUsed: stat("coresUsed"),
    lastMove,
    finished: ended || moveCount >= config.maxMoves,
  };
  return held(state, round);
}

const deal = (seed: string, config: AssemblyConfig): Round<AnyMove> =>
  start(assembly, {
    seed,
    settings: assemblySettings(config),
    streams: { parts: seedFromString(`assembly:parts:${seed}`), cores: seedFromString(`assembly:cores:${seed}`), prints: seedFromString(`assembly:prints:${seed}`) },
  }) as unknown as Round<AnyMove>;

export const ASSEMBLY_MIRROR: PuzzleDef<AssemblyState, AssemblyMove, AssemblyConfig> = {
  ...ASSEMBLY_DEF,
  create: (seed, config) => {
    ASSEMBLY_DEF.validateConfig(config);
    const round = deal(seed, config);
    const tray = (read(round).state as { yard: Yard }).yard.tray.map((shape, k) => blueprint(shape, k));
    return shown(round, config, tray, null, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    // Ending early is the host's.
    if (move.type === "end") return shown(round, state.config, state.tray, state, null, true);
    const c = state.config;
    const place = (i: number): Cell => ({ x: i % c.width, y: Math.floor(i / c.width) });
    const inBay = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < c.width * c.height;
    if (move.type === "swap") {
      if (!inBay(move.a) || !inBay(move.b)) throw new InvalidMoveError("no such cell", move);
      const next = play(round, { move: "swap", a: place(move.a), b: place(move.b) });
      if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
      return shown(next, c, state.tray, state, { move, swap: { a: move.a, b: move.b }, chainEnded: state.chain, fit: null, points: 0 });
    }
    if (!inBay(move.cell)) throw new InvalidMoveError("no such cell", move);
    const next = play(round, { move: "fit", slot: move.slot, at: place(move.cell) });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const events = next.last.events;
    const fit = events.find((e) => e.event === "fit")!;
    const refill = events.find((e) => e.event === "refill")!;
    const print = events.find((e) => e.event === "print")!;
    const bp = state.tray[move.slot]!;
    const taken = POOL[bp.shape]!.parts.map((p) => {
      const cell = move.cell + p.dr * c.width + p.dc;
      return { cell, id: state.cells[cell]!.id, kind: state.cells[cell]!.kind };
    });
    const spawned = refill.changes.flatMap((ch) => (ch.change === "arrive" ? [{ id: ch.piece.id, cell: ch.at.y * c.width + ch.at.x, kind: kindOf(ch.piece) }] : []));
    const nextBp = blueprint(print.fields.shape as number, c.traySize + state.fits);
    const tray = state.tray.map((b, slot) => (slot === move.slot ? nextBp : b));
    const points = next.last.banked;
    const report: AssemblyMoveReport = {
      move, swap: null, chainEnded: 0, points,
      fit: { slot: move.slot, blueprint: bp, taken, place: Math.min(state.chain + 1, c.chainCap), cores: fit.fields.cores as number, points, spawned, next: nextBp },
    };
    return shown(next, c, tray, state, report);
  },
};
