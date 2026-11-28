// Reactor on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the ports, every swipe and where each rod slides, fusions, discharges, the rod that
// enters, scrams, the points and the pipeline. This file only turns what that round reports into the old shape, so
// the board, its sounds and its page are the prototype's, unchanged.
import { InvalidMoveError, REACTOR_DEF, reactorPipelinePercentAt, reactorSalvoPercentAt, type PuzzleDef, type ReactorConfig, type ReactorDir, type ReactorDischarge, type ReactorFusion, type ReactorMove, type ReactorMoveReport, type ReactorPort, type ReactorRod, type ReactorScram, type ReactorSlide, type ReactorState } from "@openseas/engine";
import { play, read, seedFromString, seenAfter, start, type AnyMove, type Cell, type Round, type Seen, type Setting } from "@openseas/puzzle";
import reactor, { laneCells, type Core } from "@openseas/puzzle/examples/reactor";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. A scram's penalty is negative points. */
export function reactorSettings(c: ReactorConfig): Record<string, Setting> {
  return {
    size: c.size, hotGrade: c.hotGrade, ports: c.ports, criticalHot: c.criticalHot, startRods: c.startRods, twoPermille: c.twoPermille, pipelineSwipes: c.pipelineSwipes,
    fusePoints: c.fusePoints, dischargePoints: c.dischargePoints, pipelinePercent: c.pipelinePercent, salvoPercent: c.salvoPercent, scramPoints: -c.scramPenalty, maxMoves: c.maxMoves,
  };
}

const cellsOf = (board: Seen): (ReactorRod | null)[] => board.flatMap((row) => row.map((p) => (p ? { id: p.id, grade: p.kind! } : null)));
type Kept = Pick<ReactorState, "bestCombo">;

function shown(round: Round<AnyMove>, config: ReactorConfig, kept: Kept, lastMove: ReactorMoveReport | null, ended = false): ReactorState {
  const now = read(round);
  const core = (now.state as { core: Core }).core;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const state: ReactorState = {
    config,
    cells: cellsOf(now.board),
    ports: core.ports as ReactorPort[],
    next: core.next,
    rng: round.state.streams.core!,
    nextId: round.state.nextId,
    score: now.score,
    moveCount: now.movesMade,
    combo: now.streak,
    bestCombo: kept.bestCombo,
    sinceDischarge: core.since,
    discharges: stat("discharges"),
    salvos: stat("salvos"),
    fusions: stat("fusions"),
    scrams: stat("scrams"),
    lastMove,
    finished: ended || now.movesMade >= config.maxMoves,
  };
  return held(state, round);
}

/** A swipe's events as the report the board plays back. */
function reportOf(state: ReactorState, before: Seen, next: Round<AnyMove>, move: Extract<ReactorMove, { type: "swipe" }>): ReactorMoveReport {
  const c = state.config;
  const n = c.size;
  const dir = move.dir;
  const at = (p: Cell): number => p.y * n + p.x;
  const idAt = (cell: number): number => state.cells[cell]!.id;
  const laneOf = (cell: number): number => (dir === 0 || dir === 2 ? cell % n : Math.floor(cell / n));
  const events = next.last.events;
  const swipe = events.find((e) => e.event === "swipe")!;
  const travels = new Map(swipe.changes.flatMap((ch) => (ch.change === "travel" ? [[at(ch.from), at(ch.to)] as const] : [])));
  const arrivedAt = new Map([...travels].map(([from, to]) => [to, from]));
  const fusedAway = new Set(swipe.changes.flatMap((ch) => (ch.change === "leave" ? [at(ch.at)] : [])));

  // The pipeline, as the prototype counts it: a discharge within the window of the last carries the run on.
  let combo = state.combo;
  let since = state.combo > 0 ? state.sinceDischarge + 1 : 0;
  const discharges: ReactorDischarge[] = [];
  const out = new Map<number, number>();
  const fuseEvents = events.filter((e) => e.event === "fuse");
  const fusions: ReactorFusion[] = fuseEvents.map((e) => {
    const cell = at(e.fields.at as Cell);
    const grade = e.fields.grade as number;
    return { id: idAt(arrivedAt.get(cell) ?? cell), cell, grade, hot: grade >= c.hotGrade, points: c.fusePoints[grade - 2] ?? 0 };
  });
  for (const e of events.filter((e) => e.event === "discharge")) {
    const from = at(e.fields.at as Cell);
    const port = { side: e.fields.side as ReactorDir, lane: e.fields.lane as number };
    const cell = laneCells(n, port.side, port.lane)[0]!;
    combo = combo > 0 && since <= c.pipelineSwipes ? combo + 1 : 1;
    const percent = reactorPipelinePercentAt(c, combo);
    discharges.push({ id: idAt(from), port, cell, pipeline: combo, percent, points: Math.floor((c.dischargePoints * percent) / 100) });
    out.set(from, cell);
    since = 0;
  }
  // Every rod that was in the core, lane by lane and nose first: where it went.
  const slides: ReactorSlide[] = state.cells
    .flatMap((rod, from) => (rod ? [from] : []))
    .sort((a, b) => laneOf(a) - laneOf(b) || laneCells(n, dir, laneOf(a)).indexOf(a) - laneCells(n, dir, laneOf(b)).indexOf(b))
    .map((from): ReactorSlide => {
      const id = idAt(from);
      if (out.has(from)) return { id, from, to: out.get(from)!, into: null, out: true };
      if (fusedAway.has(from)) {
        // It joined the rod ahead of it in its lane, at the fusion's cell.
        const line = laneCells(n, dir, laneOf(from));
        const f = fusions.find((f) => line.includes(f.cell) && claimed(f, from, line))!;
        return { id, from, to: f.cell, into: f.id, out: false };
      }
      return { id, from, to: travels.get(from) ?? from, into: null, out: false };
    });
  // A fusion took in the nearest rod behind its keeper in the lane: the next one in line after it.
  function claimed(f: ReactorFusion, from: number, line: number[]): boolean {
    const keeper = arrivedAt.get(f.cell) ?? f.cell;
    const behind = line.filter((cell) => state.cells[cell] && line.indexOf(cell) > line.indexOf(keeper));
    return behind[0] === from;
  }
  const salvo = reactorSalvoPercentAt(c, discharges.length);
  const sum = discharges.reduce((a, d) => a + d.points, 0);
  const afterSwipe = events.indexOf(swipe);
  const opened = events.slice(afterSwipe).filter((e) => e.event === "port").map((e) => ({ side: e.fields.side as ReactorDir, lane: e.fields.lane as number }));
  const rodIn = events.find((e) => e.event === "rod" && !e.fields.why);
  const entered = rodIn ? (() => { const ch = rodIn.changes.find((x) => x.change === "arrive")!; return ch.change === "arrive" ? { id: ch.piece.id, cell: at(ch.at), grade: ch.piece.kind! } : null; })() : null;
  let scram: ReactorScram | null = null;
  let board = before;
  for (const e of events) {
    if (e.event === "scram") {
      const ids = board.flatMap((row) => row.flatMap((p) => (p ? [p.id] : [])));
      const fresh = events.filter((x) => x.event === "rod" && x.fields.why).flatMap((x) => x.changes.flatMap((ch) => (ch.change === "arrive" ? [{ id: ch.piece.id, cell: at(ch.at), grade: ch.piece.kind! }] : [])));
      scram = { cause: e.fields.critical ? "critical" : "jammed", ids, penalty: e.fields.lost as number, fresh };
    }
    board = seenAfter(board, e);
  }
  return { move, dir, slides, fusions, discharges, salvoPercent: salvo, dischargeTotal: Math.floor((sum * salvo) / 100), opened, entered, scram, lapsed: events.some((e) => e.event === "lapse"), points: read(next).score - state.score };
}

const deal = (seed: string, config: ReactorConfig): Round<AnyMove> =>
  start(reactor, { seed, settings: reactorSettings(config), streams: { core: seedFromString(`reactor:${seed}`) } }) as unknown as Round<AnyMove>;

export const REACTOR_MIRROR: PuzzleDef<ReactorState, ReactorMove, ReactorConfig> = {
  ...REACTOR_DEF,
  create: (seed, config) => {
    REACTOR_DEF.validateConfig(config);
    return shown(deal(seed, config), config, { bestCombo: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    const c = state.config;
    // Ending early is the host's.
    if (move.type === "end") return shown(round, c, { bestCombo: state.bestCombo }, null, true);
    const next = play(round, { move: "swipe", dir: move.dir });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const report = reportOf(state, read(round).board, next, move);
    return shown(next, c, { bestCombo: Math.max(state.bestCombo, ...report.discharges.map((d) => d.pipeline)) }, report);
  },
};
