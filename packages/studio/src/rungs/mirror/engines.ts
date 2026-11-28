// Engines on the new engine, shown as the state the game's board draws (ADR 0097, ADR 0098). The round is played by
// `@openseas/puzzle`: the pairs dealt, where each comes to rest, every injector dealt into the core and where, every
// run and injector that clears, what falls after, each chain step's points, a flameout and the streak. This file only
// turns what that round reports into the shipped shape, so the board, its sounds and its page are the game's, unchanged.
//
// The shipped core counts rows from its floor; the new board reads from its top.
import {
  ENGINES_DEF,
  InvalidMoveError,
  type EnginesClearedGroup,
  type EnginesClearRound,
  type EnginesConfig,
  type EnginesMove,
  type EnginesMoveReport,
  type EnginesState,
  type Injector,
  type InjectorCell,
  type PuzzleDef,
  type Segment,
} from "@openseas/engine";
import { play, read, seedFromString, seenAfter, start, type AnyMove, type Cell, type Event, type Round, type Seen, type Setting } from "@openseas/puzzle";
import engines, { type Pair } from "@openseas/puzzle/examples/engines";
import { held, roundOf } from "./held.js";

/** The game's numbers under the names the new puzzle gives them: a flameout's cost is negative points, a chain step a percent. */
export function enginesSettings(c: EnginesConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, kinds: c.pieceKinds, maxMoves: c.maxMoves, injectorsAtOnce: c.injectorsAtOnce, spanLeast: c.injectorSpanMin, spanMost: c.injectorSpanMax,
    runPoints: c.runPoints, injectorPoints: c.injectorPoints, flameoutPoints: -c.flameoutPenalty, chainPercent: c.chainMultipliers.map((m) => m * 100),
  };
}

/** Injectors are terrain on the new engine, with no number; the mirror numbers each as it is dealt, as the shipped engine does. */
interface Kept { readonly injectors: readonly Injector[]; readonly nextInjectorId: number; readonly moveCount: number; readonly bestCombo: number }
const KEPT = new WeakMap<object, Kept>();

const index = (c: EnginesConfig, p: Cell): number => (c.height - 1 - p.y) * c.width + p.x;
const cellsOf = (c: EnginesConfig, board: Seen): (Segment | null)[] => {
  const out = new Array<Segment | null>(c.width * c.height).fill(null);
  board.forEach((row, y) => row.forEach((p, x) => p && (out[index(c, { x, y })] = { id: p.id, kind: p.kind! - 1, pair: p.state as number })));
  return out;
};

/** An injector dealt by an event: its cells in the order of its shape, and what each wants, from the terrain it laid. */
function dealt(c: EnginesConfig, e: Event, id: number): Injector {
  const cells: InjectorCell[] = (e.fields.cells as Cell[]).map((p) => {
    const ch = e.changes.find((x) => x.change === "change" && "terrain" in x && x.at.x === p.x && x.at.y === p.y) as { terrain: string; state?: string };
    return { col: p.x, row: c.height - 1 - p.y, want: ch.terrain === "blank" ? null : Number(ch.state!.slice(5)) - 1 };
  });
  return { id, cells };
}

function shown(round: Round<AnyMove>, config: EnginesConfig, kept: Kept, lastMove: EnginesMoveReport | null, ended = false): EnginesState {
  const now = read(round);
  const pairs = (now.state as { pairs: { hand: Pair; next: Pair; count: number } }).pairs;
  const state: EnginesState = {
    config,
    cells: cellsOf(config, now.board),
    injectors: kept.injectors,
    current: { a: pairs.hand[0], b: pairs.hand[1] },
    next: { a: pairs.next[0], b: pairs.next[1] },
    rng: round.state.streams.core!,
    nextId: round.state.nextId,
    nextPair: pairs.count,
    nextInjectorId: kept.nextInjectorId,
    moveCount: kept.moveCount,
    score: now.score,
    combo: now.streak,
    bestCombo: Math.max(kept.bestCombo, now.streak),
    lastMove,
    finished: ended || kept.moveCount >= config.maxMoves,
  };
  KEPT.set(state, { ...kept, bestCombo: state.bestCombo });
  return held(state, round);
}

export const ENGINES_MIRROR: PuzzleDef<EnginesState, EnginesMove, EnginesConfig> = {
  ...ENGINES_DEF,
  create: (seed, config) => {
    ENGINES_DEF.validateConfig(config);
    const round = start(engines, { seed, settings: enginesSettings(config), streams: { core: seedFromString(`sailing:${seed}`) } }) as unknown as Round<AnyMove>;
    let id = 1;
    const injectors = round.last.events.filter((e) => e.event === "injector").map((e) => dealt(config, e, id++));
    return shown(round, config, { injectors, nextInjectorId: id, moveCount: 0, bestCombo: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const kept = KEPT.get(state)!;
    const c = state.config;
    const round = roundOf(state);
    if (move.type === "end") return shown(round, c, kept, { move, landed: null, rounds: [], points: 0, wipe: null }, true);
    if (move.type !== "place") throw new InvalidMoveError(`unknown move ${JSON.stringify(move)}`, move);
    if (!Number.isInteger(move.col) || !Number.isInteger(move.row)) throw new InvalidMoveError("bad placement", move);
    const next = play(round, { move: "place", at: { x: move.col, y: c.height - 1 - move.row }, rot: move.rot });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);

    // Every event in turn, on the core as it stood: a step's clears, then what fell and what was dealt.
    let board: Seen = read(round).board;
    let injectors = [...kept.injectors];
    let nextInjectorId = kept.nextInjectorId;
    let landed: EnginesMoveReport["landed"] = null;
    let wipe: EnginesMoveReport["wipe"] = null;
    const rounds: EnginesClearRound[] = [];
    let groups: EnginesClearedGroup[] = [];
    let step = 0;
    const close = (): void => {
      if (groups.length === 0) return;
      const sorted = [...groups].sort((a, b) => a.cells[0]! - b.cells[0]!);
      const base = sorted.reduce((sum, g) => sum + g.points, 0);
      const points = base * sorted.length * c.chainMultipliers[Math.min(step, c.chainMultipliers.length) - 1]!;
      rounds.push({ chain: step, groups: sorted, points, settled: cellsOf(c, board), injectors: [...injectors] });
      groups = [];
    };
    const idsAt = (cells: readonly number[]): number[] => {
      const core = cellsOf(c, board);
      return cells.map((i) => core[i]!.id);
    };
    for (const e of next.last.events) {
      if ((e.event === "run" || e.event === "fire") && e.step !== step) {
        close();
        step = e.step!;
      }
      if (e.event === "land") {
        const arrived = e.changes.flatMap((ch) => (ch.change === "arrive" ? [ch] : []));
        landed = { cells: [index(c, arrived[0]!.at), index(c, arrived[1]!.at)], ids: [arrived[0]!.piece.id, arrived[1]!.piece.id] };
      } else if (e.event === "run") {
        const cells = (e.fields.pellets as Cell[]).map((p) => index(c, p)).sort((a, b) => a - b);
        groups.push({ cells, ids: idsAt(cells), points: c.runPoints * Math.max(1, cells.length - 3), cause: "run" });
      } else if (e.event === "fire") {
        const cells = (e.fields.targets as Cell[]).map((p) => index(c, p)).sort((a, b) => a - b);
        const injector = injectors.find((p) => p.cells.some((k) => k.want !== null && cells.includes(k.row * c.width + k.col)))!;
        groups.push({ cells, ids: idsAt(cells), points: c.injectorPoints * cells.length, cause: "injector", injectorId: injector.id });
        injectors = injectors.filter((p) => p !== injector);
      } else if (e.event === "injector") injectors.push(dealt(c, e, nextInjectorId++));
      else if (e.event === "flameout") {
        close();
        const ids = cellsOf(c, board).filter((s): s is Segment => s !== null).map((s) => s.id);
        wipe = { ids, penalty: c.flameoutPenalty, injectors: [] };
        injectors = [];
      }
      board = seenAfter(board, e);
    }
    close();
    if (wipe) wipe = { ...wipe, injectors: [...injectors] };
    const points = rounds.reduce((sum, r) => sum + r.points, 0);
    return shown(next, c, { injectors, nextInjectorId, moveCount: kept.moveCount + 1, bestCombo: kept.bestCombo }, { move, landed, rounds, points, wipe });
  },
};
