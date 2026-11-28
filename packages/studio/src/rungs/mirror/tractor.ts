// Tractor on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the field, every swap, each wave of runs, the beacons and what they sweep, the rise
// and the loot that drifts in, caches hauled at the top, the points and the cascade. This file only turns what that
// round reports into the old shape, so the board, its sounds and its page are the prototype's, unchanged.
import { InvalidMoveError, TRACTOR_CACHE, TRACTOR_DEF, tractorCacheValue, tractorCascadePercentAt, tractorMarkCells, tractorRunValue, type PuzzleDef, type TractorConfig, type TractorFire, type TractorMark, type TractorMove, type TractorMoveReport, type TractorPiece, type TractorRun, type TractorSettle, type TractorState, type TractorTaken, type TractorWave } from "@openseas/engine";
import { play, read, seedFromString, seenAfter, start, type AnyMove, type Cell, type Event, type Piece, type Round, type Seen, type Setting } from "@openseas/puzzle";
import tractor from "@openseas/puzzle/examples/tractor";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. */
export function tractorSettings(c: TractorConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, kinds: c.kinds, startCaches: c.startCaches, cachePermille: c.cachePermille, maxCaches: c.maxCaches, beaconEvery: c.beaconEvery,
    runPoints: c.runPoints, sweepPoints: c.sweepPoints, cachePoints: c.cachePoints, cascadePercent: c.cascadePercent, maxMoves: c.maxMoves,
  };
}

const old = (p: Piece): TractorPiece =>
  p.piece === "cache" ? { id: p.id, kind: TRACTOR_CACHE } : p.piece === "beacon" ? { id: p.id, kind: p.kind! - 1, mark: p.state as TractorMark } : { id: p.id, kind: p.kind! - 1 };
const cellsOf = (board: Seen): TractorPiece[] => board.flatMap((row) => row.map((p) => old(p!)));

type Kept = Pick<TractorState, "bestCombo" | "bestCaches" | "longest">;

function shown(round: Round<AnyMove>, config: TractorConfig, kept: Kept, lastMove: TractorMoveReport | null, ended = false): TractorState {
  const now = read(round);
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const state: TractorState = {
    config,
    cells: cellsOf(now.board),
    rng: round.state.streams.field!,
    nextId: round.state.nextId,
    score: now.score,
    moveCount: now.movesMade,
    clears: stat("clears"),
    duds: now.movesMade - stat("clears"),
    cleared: stat("cleared"),
    ...kept,
    cachesHauled: stat("caches"),
    beaconsFired: stat("fired"),
    lastMove,
    finished: ended || now.movesMade >= config.maxMoves,
  };
  return held(state, round);
}

/** A swap's events as the report the board plays back: wave by wave, and each settling of the field. */
function reportOf(c: TractorConfig, before: Seen, events: readonly Event[], move: Extract<TractorMove, { type: "swap" }>, points: number): TractorMoveReport {
  const at = (p: Cell): number => p.y * c.width + p.x;
  let board = before;
  let swapped: TractorPiece[] = [];
  const taken = (cell: number): TractorTaken => {
    const p = old(board[Math.floor(cell / c.width)]![cell % c.width]!);
    return p.mark !== undefined ? { cell, id: p.id, kind: p.kind, mark: p.mark } : { cell, id: p.id, kind: p.kind };
  };
  const waves: TractorWave[] = [];
  const allCaches: TractorTaken[] = [];
  let wave: { runs: TractorRun[]; fires: number[]; swept: number; settles: TractorSettle[]; topped: TractorTaken[]; rises: TractorSettle["rises"]; cacheTaken: TractorTaken[] } | null = null;
  const close = (): void => {
    if (!wave) return;
    allCaches.push(...wave.cacheTaken);
    wave = null;
  };
  for (const e of events) {
    const f = e.fields as { cells?: Cell[]; kind?: number; length?: number; count?: number; at?: Cell };
    if (e.event === "fire" || (e.event === "run" && (!wave || wave.settles.length > 0))) {
      if (!wave || wave.settles.length > 0) close(), (wave = { runs: [], fires: [], swept: 0, settles: [], topped: [], rises: [], cacheTaken: [] });
    }
    if (e.event === "fire") wave!.fires.push(at(f.at!));
    else if (e.event === "run") wave!.runs.push({ cells: f.cells!.map(at), kind: f.kind! - 1, points: tractorRunValue(c, f.length!) });
    else if (e.event === "sweep") wave!.swept = f.count!;
    else if (e.event === "beam") {
      // The wave takes every piece in a run, then every piece swept, then every cache swept, in that order.
      const cells = f.cells!.map(at);
      const inRun = new Set(wave!.runs.flatMap((r) => r.cells));
      const runTaken = cells.slice(0, inRun.size).map(taken);
      const sweptTaken = cells.slice(inRun.size, inRun.size + wave!.swept).map(taken);
      const cacheTaken = cells.slice(inRun.size + wave!.swept).map(taken);
      // What each beacon took along its mark: the pieces not already gone, in its own order, beacon by beacon.
      const gone = new Set(inRun);
      const fired: TractorFire[] = wave!.fires.map((cell) => {
        const beacon = taken(cell);
        const took = tractorMarkCells(c, cell, beacon.mark!).filter((x) => board[Math.floor(x / c.width)]![x % c.width] && !gone.has(x));
        took.forEach((x) => gone.add(x));
        return { cell, id: beacon.id, mark: beacon.mark!, swept: took };
      });
      const w = waves.length;
      const percent = tractorCascadePercentAt(c, w);
      const base = wave!.runs.reduce((a, r) => a + r.points, 0) + sweptTaken.length * c.sweepPoints;
      wave!.cacheTaken = cacheTaken;
      waves.push({ runs: wave!.runs, fired, cleared: [...runTaken, ...sweptTaken], swept: sweptTaken, caches: cacheTaken, percent, points: Math.floor((base * percent) / 100), settles: wave!.settles });
    } else if (e.event === "rise") {
      wave!.rises = e.changes.flatMap((ch) => (ch.change === "travel" ? [{ id: board[ch.from.y]![ch.from.x]!.id, from: at(ch.from), to: at(ch.to) }] : []));
    } else if (e.event === "drift") {
      const arrived = e.changes.flatMap((ch) => (ch.change === "arrive" ? [ch] : []));
      const perColumn = new Map<number, number>();
      for (const ch of arrived) perColumn.set(ch.at.x, (perColumn.get(ch.at.x) ?? 0) + 1);
      const spawned = arrived.map((ch) => {
        const p = old(ch.piece);
        return { id: p.id, cell: at(ch.at), kind: p.kind, ...(p.mark !== undefined ? { mark: p.mark } : {}), rise: perColumn.get(ch.at.x)! };
      });
      board = seenAfter(board, e);
      allCaches.push(...wave!.topped);
      wave!.settles.push({ topped: wave!.topped, rises: wave!.rises, spawned, cells: cellsOf(board) });
      [wave!.topped, wave!.rises] = [[], []];
      continue;
    } else if (e.event === "top") wave!.topped = e.changes.flatMap((ch) => (ch.change === "leave" ? [taken(at(ch.at))] : []));
    else if (e.event === "haul") close();
    board = seenAfter(board, e);
    if (e.event === "swap") swapped = cellsOf(board);
  }
  close();
  return { move, cell: move.cell, below: move.cell + c.width, swapped, waves, caches: allCaches, cachePoints: tractorCacheValue(c, allCaches.length), shuffled: events.some((e) => e.event === "field"), points };
}

const deal = (seed: string, config: TractorConfig): Round<AnyMove> =>
  start(tractor, { seed, settings: tractorSettings(config), streams: { field: seedFromString(`tractor:${seed}`) } }) as unknown as Round<AnyMove>;

export const TRACTOR_MIRROR: PuzzleDef<TractorState, TractorMove, TractorConfig> = {
  ...TRACTOR_DEF,
  create: (seed, config) => {
    TRACTOR_DEF.validateConfig(config);
    return shown(deal(seed, config), config, { bestCombo: 0, bestCaches: 0, longest: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    const c = state.config;
    const kept: Kept = { bestCombo: state.bestCombo, bestCaches: state.bestCaches, longest: state.longest };
    // Ending early is the host's.
    if (move.type === "end") return shown(round, c, kept, null, true);
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= c.width * c.height) throw new InvalidMoveError("no such cell", move);
    const next = play(round, { move: "swap", at: { x: move.cell % c.width, y: Math.floor(move.cell / c.width) } });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const report = reportOf(c, read(round).board, next.last.events, move, read(next).score - state.score);
    return shown(next, c, {
      bestCombo: Math.max(kept.bestCombo, report.waves.length),
      bestCaches: Math.max(kept.bestCaches, report.caches.length),
      longest: Math.max(kept.longest, ...report.waves.flatMap((w) => w.runs.map((r) => r.cells.length))),
    }, report);
  },
};
