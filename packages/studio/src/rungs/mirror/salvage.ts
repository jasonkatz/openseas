// Paths on the new engine, shown as the state the shipped Salvage board draws (ADR 0097). The round is played
// by `@openseas/puzzle`: the deal, every path and loop, the fall and the refill, the prizes, the bounty, the
// timers, the points and the streak. This file only turns what that round reports into the old shape, so the
// board, its sounds and its page are the shipped ones, unchanged.
import { InvalidMoveError, SALVAGE_CRATE, SALVAGE_DEF, SALVAGE_RUBBLE, type PuzzleDef, type SalvageBlast, type SalvageConfig, type SalvageHauled, type SalvageMove, type SalvageMoveReport, type SalvagePiece, type SalvageRound, type SalvageState } from "@openseas/engine";
import { play, read, seedFromString, seenAfter, start, type AnyMove, type Cell, type Event, type Piece, type Round, type Seen, type Setting } from "@openseas/puzzle";
import { pathsWith } from "@openseas/puzzle/examples/paths";
import { held, roundOf } from "./held.js";

/** Paths with every draw from one stream, as Salvage takes its luck: the same seed then deals the same round on both. */
const paths = pathsWith({ luck: "one" });

type Stage = "paths" | "streak" | "loops" | "full";

/**
 * Salvage switches a layer off with a number of nothing; Paths leaves the layer out. A set of numbers is one of
 * the ladder's four cuts, or it is not a round Paths has.
 */
export function pathsStage(c: SalvageConfig): Stage {
  const on = { prizes: c.maxCrates > 0, loops: c.loopMin > 0, bounty: c.orderLength > 0, timers: c.volatileEvery > 0 };
  if (on.prizes && on.loops && on.bounty) return on.timers ? "full" : "loops";
  if (!on.loops && !on.bounty && !on.timers) {
    if (on.prizes) return "streak";
    if (c.streakPercent.every((p) => p === 100)) return "paths";
  }
  throw new Error("these numbers switch off layers that no stage of Paths leaves out together");
}

/** The shipped numbers under the names Paths gives them: only those of the layers the stage has. */
export function pathsSettings(c: SalvageConfig, stage: Stage = pathsStage(c)): Record<string, Setting> {
  const has = (s: Stage): boolean => ["paths", "streak", "loops", "full"].indexOf(stage) >= ["paths", "streak", "loops", "full"].indexOf(s);
  return {
    width: c.width, height: c.height, kinds: c.kinds, maxMoves: c.maxMoves, pathMin: c.minLine, pathPoints: c.linePoints,
    ...(has("streak") ? { streakMin: c.streakMin, streakPercent: c.streakPercent, startPrizes: c.startCrates, prizePermille: c.cratePermille, maxPrizes: c.maxCrates, prizeFloorPoints: c.crateFloorPoints } : {}),
    ...(has("loops") ? { loopMin: c.loopMin, loopPercent: c.loopPercent, insidePoints: c.enclosedPoints, prizeLoopPoints: c.crateLoopPoints, bountyLength: c.orderLength, bountyBonus: c.orderBonus } : {}),
    ...(has("full") ? { timerEvery: c.volatileEvery, timerFuse: c.fuse, timerPoints: c.volatilePoints } : {}),
  };
}

const old = (p: Piece): SalvagePiece =>
  p.piece === "prize" ? { id: p.id, kind: SALVAGE_CRATE } : p.piece === "ruined" ? { id: p.id, kind: SALVAGE_RUBBLE } : p.piece === "timed" ? { id: p.id, kind: p.kind! - 1, fuse: p.state as number } : { id: p.id, kind: p.kind! - 1 };
const cellsOf = (board: Seen): SalvagePiece[] => board.flatMap((row) => row.map((p) => old(p!)));

/** A move's events as the report the board plays back: what was taken, what blew, and each settling of the field. */
function reportOf(before: Seen, events: readonly Event[], c: SalvageConfig, move: SalvageMove, streak: number, streakPercent: number, banked: number): SalvageMoveReport {
  const at = (p: Cell): number => p.y * c.width + p.x;
  let board = before;
  const taken = (p: Cell): SalvageHauled => ({ cell: at(p), id: board[p.y]![p.x]!.id, kind: old(board[p.y]![p.x]!).kind });
  const inOrder = (places: readonly Cell[]): SalvageHauled[] => places.map(taken).sort((p, q) => p.cell - q.cell);
  let line: SalvageHauled[] = [], enclosed: SalvageHauled[] = [], netted: SalvageHauled[] = [], floor: SalvageHauled[] = [];
  const defused: SalvageHauled[] = [];
  const blasts: SalvageBlast[] = [];
  const rounds: Array<{ -readonly [K in keyof SalvageRound]: SalvageRound[K] }> = [];
  let [loop, orderFilled, shuffled, floorPoints] = [false, false, false, 0];
  for (const e of events) {
    const f = e.fields as { path?: Cell[]; inside?: Cell[]; prizes?: Cell[]; pieces?: Cell[]; place?: Cell; ruined?: Cell[] };
    if (e.event === "defuse") defused.push(taken(f.place!));
    else if (e.event === "clear") line = f.path!.map(taken);
    else if (e.event === "loop") [line, enclosed, netted, loop] = [f.path!.map(taken), inOrder(f.inside!), inOrder(f.prizes!), true];
    else if (e.event === "blowup") blasts.push({ cell: at(f.place!), id: board[f.place!.y]![f.place!.x]!.id, scorched: f.ruined!.map(at).sort((p, q) => p - q) });
    else if (e.event === "bounty") orderFilled = true;
    else if (e.event === "fill" || e.event === "reshuffle") shuffled = true;
    else if (e.event === "prize_floor") (floor.push(...f.prizes!.map(taken)), (floorPoints += Math.floor(((e.points ?? 0) * streakPercent) / 100)));
    else if (e.event === "swept") floor.push(...f.pieces!.map(taken));
    else if (e.event === "refill") {
      // Each new piece starts as many rows above the top as its column took in.
      const drop = new Map<number, number>();
      for (const ch of e.changes) if (ch.change === "arrive") drop.set(ch.at.x, (drop.get(ch.at.x) ?? 0) + 1);
      const falls = e.changes.flatMap((ch) => (ch.change === "travel" ? [{ id: board[ch.from.y]![ch.from.x]!.id, from: at(ch.from), to: at(ch.to) }] : []));
      const spawned = e.changes.flatMap((ch) => (ch.change === "arrive" ? [{ id: ch.piece.id, cell: at(ch.at), kind: old(ch.piece).kind, drop: drop.get(ch.at.x)! }] : []));
      board = seenAfter(board, e);
      rounds.push({ floor: floor.sort((p, q) => p.cell - q.cell), points: floorPoints, falls, spawned, cells: cellsOf(board) });
      [floor, floorPoints] = [[], 0];
      continue;
    }
    board = seenAfter(board, e);
    if (e.event === "arm") {
      // The timed piece is one of those the first settling brought in.
      const round = rounds[0]!;
      const fuse = board[f.place!.y]![f.place!.x]!.state as number;
      round.spawned = round.spawned.map((s) => (s.cell === at(f.place!) ? { ...s, fuse } : s));
      round.cells = cellsOf(board);
    }
  }
  // A path's own timed pieces are defused in the order drawn; a loop's, with those inside it, in the board's order.
  const where = new Map(line.map((h, i) => [h.cell, i]));
  if (loop) defused.sort((p, q) => p.cell - q.cell);
  else defused.sort((p, q) => where.get(p.cell)! - where.get(q.cell)!);
  const settled = rounds.reduce((sum, r) => sum + r.points, 0);
  return { move, line, loop, enclosed, netted, defused, orderFilled, blasts, streak, streakPercent, haulPoints: banked - settled, rounds, shuffled, points: banked };
}

const count = (r: SalvageMoveReport): number => r.line.length + r.enclosed.length + r.netted.length + r.rounds.reduce((n, round) => n + round.floor.length, 0);

function shown(round: Round<AnyMove>, config: SalvageConfig, prev: SalvageState | null, lastMove: SalvageMoveReport | null, finished = false): SalvageState {
  const now = read(round);
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const bounty = now.tasks.find((t) => t.task === "bounty");
  const state: SalvageState = {
    config,
    cells: cellsOf(now.board),
    rng: round.state.streams.debris!,
    nextId: round.state.nextId,
    score: now.score,
    moveCount: now.movesMade,
    combo: now.streak,
    bestCombo: round.state.best,
    grace: now.streak > 0 && round.state.misses === 0,
    hauled: (prev?.hauled ?? 0) + (lastMove ? count(lastMove) : 0),
    cratesNetted: stat("prizes_netted"),
    cratesFloor: stat("prizes_floor"),
    loops: stat("loops"),
    order: bounty ? { kind: (bounty.holds.kind as number) - 1 } : null,
    ordersFilled: stat("bounties"),
    defused: stat("defused"),
    blasts: stat("blowups"),
    longest: stat("longest"),
    lastMove,
    finished: finished || now.ended !== null,
  };
  return held(state, round);
}

/** A round of the new engine as the state the shipped board draws. Its moves go through `SALVAGE_MIRROR.reduce`. */
export function salvageShown(round: Round<AnyMove>, config: SalvageConfig): SalvageState {
  return shown(round, config, null, null);
}

const deal = (seed: string, config: SalvageConfig): Round<AnyMove> => {
  const stage = pathsStage(config);
  return start(paths, { seed, stage, settings: pathsSettings(config, stage), streams: { debris: seedFromString(`salvage:${seed}`) } }) as unknown as Round<AnyMove>;
};

export const SALVAGE_MIRROR: PuzzleDef<SalvageState, SalvageMove, SalvageConfig> = {
  ...SALVAGE_DEF,
  validateConfig: (config) => {
    SALVAGE_DEF.validateConfig(config);
    deal("check", config);
  },
  create: (seed, config) => {
    SALVAGE_DEF.validateConfig(config);
    return shown(deal(seed, config), config, null, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    // Ending early is the host's.
    if (move.type === "end") return shown(round, state.config, state, null, true);
    const c = state.config;
    const next = play(round, { move: "trace", path: move.cells.map((cell) => ({ x: cell % c.width, y: Math.floor(cell / c.width) })), closed: move.loop });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    // The streak the move was paid at. A timer that ran out has since broken it, so then it is counted from the streak before.
    const blew = next.last.events.some((e) => e.event === "blowup");
    const built = move.cells.length >= c.streakMin ? state.combo + 1 : state.grace ? state.combo : 0;
    const paidAt = round.stage === "paths" ? 0 : blew ? built : next.state.streak;
    const percent = round.stage === "paths" ? 100 : c.streakPercent[Math.min(Math.max(paidAt - 1, 0), c.streakPercent.length - 1)]!;
    const report = reportOf(read(round).board, next.last.events, c, move, next.state.streak, paidAt === 0 ? 100 : percent, next.last.banked);
    return shown(next, c, state, report);
  },
};
