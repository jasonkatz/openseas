import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_REACTOR_CONFIG,
  type ReactorConfig,
  type ReactorDir,
  type ReactorDischarge,
  type ReactorFusion,
  type ReactorMove,
  type ReactorMoveReport,
  type ReactorPort,
  type ReactorRod,
  type ReactorScram,
  type ReactorSlide,
  type ReactorState,
} from "./types.js";

export const DIRS: readonly ReactorDir[] = [0, 1, 2, 3];

export function validateConfig(cfg: ReactorConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.size, 3, 8) &&
    int(cfg.hotGrade, 3, 9) &&
    int(cfg.ports, 1, 8) &&
    // A used port never reopens where it was, so one rim position beyond the open ports must be free.
    cfg.ports + 1 < cfg.size * 4 &&
    int(cfg.criticalHot, 2, cfg.size * cfg.size) &&
    int(cfg.startRods, 1, cfg.size * cfg.size - 1) &&
    int(cfg.twoPermille, 0, 1000) &&
    Array.isArray(cfg.fusePoints) &&
    cfg.fusePoints.length === cfg.hotGrade - 1 &&
    cfg.fusePoints.every((p) => int(p, 0, 100_000)) &&
    int(cfg.dischargePoints, 0, 100_000) &&
    Array.isArray(cfg.salvoPercent) &&
    cfg.salvoPercent.length >= 1 &&
    cfg.salvoPercent.length <= 8 &&
    cfg.salvoPercent.every((p) => int(p, 100, 2000)) &&
    int(cfg.pipelineSwipes, 1, 1000) &&
    Array.isArray(cfg.pipelinePercent) &&
    cfg.pipelinePercent.length >= 1 &&
    cfg.pipelinePercent.length <= 16 &&
    cfg.pipelinePercent.every((p) => int(p, 100, 1000)) &&
    int(cfg.scramPenalty, 0, 100_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid reactor config");
}

/** The cells of one lane in the order a swipe toward `dir` packs them: the cell at that wall first. */
export function laneCells(cfg: ReactorConfig, dir: ReactorDir, lane: number): number[] {
  const n = cfg.size;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    if (dir === 0) out.push(k * n + lane);
    else if (dir === 1) out.push(lane * n + (n - 1 - k));
    else if (dir === 2) out.push((n - 1 - k) * n + lane);
    else out.push(lane * n + k);
  }
  return out;
}

/** The cell at the wall a port opens on: where a hot rod leaves from. */
export function portCell(cfg: ReactorConfig, port: ReactorPort): number {
  return laneCells(cfg, port.side, port.lane)[0]!;
}

const samePort = (a: ReactorPort, b: ReactorPort): boolean => a.side === b.side && a.lane === b.lane;

export const isHot = (cfg: ReactorConfig, grade: number): boolean => grade >= cfg.hotGrade;

/** Hot rods in the core. At `criticalHot` of them the core scrams. */
export function hotCount(cfg: ReactorConfig, cells: ReadonlyArray<ReactorRod | null>): number {
  let n = 0;
  for (const r of cells) if (r && isHot(cfg, r.grade)) n++;
  return n;
}

/** What the pipeline multiplies a discharge by, in percent, when it is the `run`th in its run. */
export function pipelinePercentAt(cfg: ReactorConfig, run: number): number {
  if (run <= 0) return 100;
  return cfg.pipelinePercent[Math.min(run, cfg.pipelinePercent.length) - 1]!;
}

/** What `count` rods out in one swipe multiply that swipe's discharges by, in percent. */
export function salvoPercentAt(cfg: ReactorConfig, count: number): number {
  if (count <= 0) return 100;
  return cfg.salvoPercent[Math.min(count, cfg.salvoPercent.length) - 1]!;
}

/** Swipes left in which a discharge still continues the pipeline's run; 0 when no run is going. */
export function pipelineLeft(state: ReactorState): number {
  return state.combo > 0 ? Math.max(0, state.config.pipelineSwipes - state.sinceDischarge) : 0;
}

interface Slid {
  cells: Array<ReactorRod | null>;
  slides: ReactorSlide[];
  fusions: ReactorFusion[];
  out: Array<{ id: number; port: ReactorPort; cell: number }>;
  /** Lanes in which anything moved, fused or left. */
  changed: number[];
}

/** Everything a swipe does that needs no dice: the slides, the fusions and the rods that leave. */
function slide(state: ReactorState, dir: ReactorDir): Slid {
  const cfg = state.config;
  const cells = new Array<ReactorRod | null>(state.cells.length).fill(null);
  const slides: ReactorSlide[] = [];
  const fusions: ReactorFusion[] = [];
  const out: Slid["out"] = [];
  const changed: number[] = [];
  for (let lane = 0; lane < cfg.size; lane++) {
    const line = laneCells(cfg, dir, lane);
    let queue: Array<{ cell: number; rod: ReactorRod }> = [];
    for (const cell of line) {
      const rod = state.cells[cell];
      if (rod) queue.push({ cell, rod });
    }
    let moved = false;
    // Hot rods first in line, against a wall with an open port, leave: one, or several stacked nose
    // to tail. The first rod that is not hot stops the rest, and they pack in behind where those left.
    if (state.ports.some((p) => p.side === dir && p.lane === lane)) {
      let gone = 0;
      while (gone < queue.length && isHot(cfg, queue[gone]!.rod.grade)) {
        const head = queue[gone]!;
        out.push({ id: head.rod.id, port: { side: dir, lane }, cell: line[0]! });
        slides.push({ id: head.rod.id, from: head.cell, to: line[0]!, into: null, out: true });
        gone++;
      }
      if (gone > 0) {
        queue = queue.slice(gone);
        moved = true;
      }
    }
    let pos = 0;
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i]!;
      const b = queue[i + 1];
      const to = line[pos]!;
      if (b && a.rod.grade === b.rod.grade && !isHot(cfg, a.rod.grade)) {
        const grade = a.rod.grade + 1;
        cells[to] = { id: a.rod.id, grade };
        slides.push({ id: a.rod.id, from: a.cell, to, into: null, out: false });
        slides.push({ id: b.rod.id, from: b.cell, to, into: a.rod.id, out: false });
        fusions.push({ id: a.rod.id, cell: to, grade, hot: isHot(cfg, grade), points: cfg.fusePoints[grade - 2] ?? 0 });
        i++;
        moved = true;
      } else {
        cells[to] = a.rod;
        slides.push({ id: a.rod.id, from: a.cell, to, into: null, out: false });
        if (a.cell !== to) moved = true;
      }
      pos++;
    }
    if (moved) changed.push(lane);
  }
  return { cells, slides, fusions, out, changed };
}

/** True when a swipe that way would move, fuse or discharge something. A swipe that changes nothing is not a move. */
export function canSwipe(state: ReactorState, dir: ReactorDir): boolean {
  return !state.finished && slide(state, dir).changed.length > 0;
}

export function legalDirs(state: ReactorState): ReactorDir[] {
  return DIRS.filter((d) => canSwipe(state, d));
}

/** What a swipe would do before any dice are rolled: for the hint, and for a board that shows what is ready. */
export interface ReactorOutcome {
  readonly legal: boolean;
  readonly discharges: number;
  readonly fusions: number;
  /** Fusions that would make a hot rod. */
  readonly hotMade: number;
}

export function swipeOutcome(state: ReactorState, dir: ReactorDir): ReactorOutcome {
  const s = slide(state, dir);
  return { legal: s.changed.length > 0, discharges: s.out.length, fusions: s.fusions.length, hotMade: s.fusions.filter((f) => f.hot).length };
}

/**
 * How a port stands: `ready` when a swipe toward its wall would discharge a hot rod through it now,
 * `blocked` when a hot rod is in its lane with another rod between it and the wall, `idle` otherwise.
 */
export function portStatus(state: ReactorState, port: ReactorPort): "idle" | "blocked" | "ready" {
  const cfg = state.config;
  let first = true;
  for (const cell of laneCells(cfg, port.side, port.lane)) {
    const rod = state.cells[cell];
    if (!rod) continue;
    if (isHot(cfg, rod.grade)) return first ? "ready" : "blocked";
    first = false;
  }
  return "idle";
}

/** How many hot rods a swipe toward this port's wall would send out through it now: those stacked nose to tail at the wall. */
export function portLoad(state: ReactorState, port: ReactorPort): number {
  const cfg = state.config;
  let n = 0;
  for (const cell of laneCells(cfg, port.side, port.lane)) {
    const rod = state.cells[cell];
    if (!rod) continue;
    if (!isHot(cfg, rod.grade)) break;
    n++;
  }
  return n;
}

/** The swipe that discharges the most rods right now, for the idle hint in unrated practice. Null when none discharges any. */
export function hint(state: ReactorState): ReactorDir | null {
  let best: ReactorDir | null = null;
  let most = 0;
  for (const d of DIRS) {
    const n = swipeOutcome(state, d).discharges;
    if (n > most) {
      most = n;
      best = d;
    }
  }
  return best;
}

/** Every rim position that is not in `taken`, in a fixed order: side by side, lane by lane. */
function freeRim(cfg: ReactorConfig, taken: readonly ReactorPort[]): ReactorPort[] {
  const out: ReactorPort[] = [];
  for (const side of DIRS) {
    for (let lane = 0; lane < cfg.size; lane++) {
      const p: ReactorPort = { side, lane };
      if (!taken.some((t) => samePort(t, p))) out.push(p);
    }
  }
  return out;
}

function rollNext(cfg: ReactorConfig, rng: PrngState): { state: PrngState; value: number } {
  const two = nextChance(rng, cfg.twoPermille, 1000);
  return { state: two.state, value: two.value ? 2 : 1 };
}

/** `count` grade 1 rods on random empty cells: the opening core, and the core after a scram. */
function seedRods(cfg: ReactorConfig, cells: Array<ReactorRod | null>, rngIn: PrngState, nextIdIn: number): { rng: PrngState; nextId: number; fresh: Array<{ id: number; cell: number; grade: number }> } {
  let rng = rngIn;
  let nextId = nextIdIn;
  const fresh: Array<{ id: number; cell: number; grade: number }> = [];
  for (let n = 0; n < cfg.startRods; n++) {
    const empty: number[] = [];
    for (let c = 0; c < cells.length; c++) if (!cells[c]) empty.push(c);
    if (empty.length === 0) break;
    const pick = nextInt(rng, empty.length);
    rng = pick.state;
    const cell = empty[pick.value]!;
    const rod = { id: nextId++, grade: 1 };
    cells[cell] = rod;
    fresh.push({ id: rod.id, cell, grade: 1 });
  }
  return { rng, nextId, fresh };
}

export function createReactorGame(seed: string, config: ReactorConfig = DEFAULT_REACTOR_CONFIG): ReactorState {
  validateConfig(config);
  let rng = seedFromString(`reactor:${seed}`);
  const cells = new Array<ReactorRod | null>(config.size * config.size).fill(null);
  const ports: ReactorPort[] = [];
  for (let n = 0; n < config.ports; n++) {
    const free = freeRim(config, ports);
    const pick = nextInt(rng, free.length);
    rng = pick.state;
    ports.push(free[pick.value]!);
  }
  const seeded = seedRods(config, cells, rng, 1);
  const next = rollNext(config, seeded.rng);
  return {
    config,
    cells,
    ports,
    next: next.value,
    rng: next.state,
    nextId: seeded.nextId,
    score: 0,
    moveCount: 0,
    combo: 0,
    bestCombo: 0,
    sinceDischarge: 0,
    discharges: 0,
    salvos: 0,
    fusions: 0,
    scrams: 0,
    lastMove: null,
    finished: false,
  };
}

export function reduceReactor(state: ReactorState, move: ReactorMove): ReactorState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "swipe":
      return swipe(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function swipe(state: ReactorState, move: Extract<ReactorMove, { type: "swipe" }>): ReactorState {
  const cfg = state.config;
  const dir = move.dir;
  if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) throw new InvalidMoveError("no such direction", move);
  const s = slide(state, dir);
  if (s.changed.length === 0) throw new InvalidMoveError("nothing moves", move);

  let rng = state.rng;
  let nextId = state.nextId;
  let cells = s.cells;

  // The pipeline: a discharge within the window of the last one continues the run; a swipe that
  // uses the window up without one ends it.
  let combo = state.combo;
  let since = state.combo > 0 ? state.sinceDischarge + 1 : 0;
  let lapsed = false;
  const discharges: ReactorDischarge[] = [];
  for (const o of s.out) {
    combo = combo > 0 && since <= cfg.pipelineSwipes ? combo + 1 : 1;
    const percent = pipelinePercentAt(cfg, combo);
    discharges.push({ id: o.id, port: o.port, cell: o.cell, pipeline: combo, percent, points: Math.floor((cfg.dischargePoints * percent) / 100) });
    since = 0;
  }
  if (discharges.length === 0 && combo > 0 && since >= cfg.pipelineSwipes) {
    combo = 0;
    since = 0;
    lapsed = true;
  }
  const dischargeSum = discharges.reduce((a, d) => a + d.points, 0);
  const salvo = salvoPercentAt(cfg, discharges.length);
  const dischargePoints = Math.floor((dischargeSum * salvo) / 100);
  const fusePoints = s.fusions.reduce((a, f) => a + f.points, 0);

  // A used port closes and another opens somewhere it was not.
  const used = state.ports.filter((p) => discharges.some((d) => samePort(d.port, p)));
  let ports = state.ports.filter((p) => !used.includes(p));
  const opened: ReactorPort[] = [];
  for (let n = 0; n < used.length; n++) {
    const free = freeRim(cfg, [...ports, ...used]);
    if (free.length === 0) break;
    const pick = nextInt(rng, free.length);
    rng = pick.state;
    const port = free[pick.value]!;
    ports = [...ports, port];
    opened.push(port);
  }

  // The next rod enters on the edge the rods slid away from, in a lane that changed.
  const lanes = s.changed.filter((lane) => cells[laneCells(cfg, dir, lane)[cfg.size - 1]!] === null);
  let entered: ReactorMoveReport["entered"] = null;
  if (lanes.length > 0) {
    const pick = nextInt(rng, lanes.length);
    rng = pick.state;
    const cell = laneCells(cfg, dir, lanes[pick.value]!)[cfg.size - 1]!;
    const rod = { id: nextId++, grade: state.next };
    cells = cells.slice();
    cells[cell] = rod;
    entered = { id: rod.id, cell, grade: rod.grade };
  }
  const rolled = rollNext(cfg, rng);
  rng = rolled.state;

  let score = state.score + fusePoints + dischargePoints;
  let scram: ReactorScram | null = null;
  let scrams = state.scrams;
  const settled: ReactorState = { ...state, cells, ports, finished: false };
  const jammed = !DIRS.some((d) => slide(settled, d).changed.length > 0);
  const critical = hotCount(cfg, cells) >= cfg.criticalHot;
  if (jammed || critical) {
    // Nothing can move, or too many hot rods are in the core: it is emptied for a penalty and started again.
    const ids = cells.flatMap((r) => (r ? [r.id] : []));
    const penalty = Math.min(score, cfg.scramPenalty);
    score -= penalty;
    const fresh = new Array<ReactorRod | null>(cells.length).fill(null);
    const seeded = seedRods(cfg, fresh, rng, nextId);
    rng = seeded.rng;
    nextId = seeded.nextId;
    cells = fresh;
    scram = { cause: critical ? "critical" : "jammed", ids, penalty, fresh: seeded.fresh };
    scrams += 1;
    combo = 0;
    since = 0;
  }

  const points = score - state.score;
  const report: ReactorMoveReport = { move, dir, slides: s.slides, fusions: s.fusions, discharges, salvoPercent: salvo, dischargeTotal: dischargePoints, opened, entered, scram, lapsed, points };
  const moveCount = state.moveCount + 1;
  return {
    config: cfg,
    cells,
    ports,
    next: rolled.value,
    rng,
    nextId,
    score,
    moveCount,
    combo,
    bestCombo: Math.max(state.bestCombo, discharges.reduce((a, d) => Math.max(a, d.pipeline), 0)),
    sinceDischarge: since,
    discharges: state.discharges + discharges.length,
    salvos: state.salvos + (discharges.length >= 2 ? 1 : 0),
    fusions: state.fusions + s.fusions.length,
    scrams,
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
}

export function replayReactor(seed: string, config: ReactorConfig, moves: readonly ReactorMove[]): ReactorState {
  let s = createReactorGame(seed, config);
  for (const m of moves) s = reduceReactor(s, m);
  return s;
}

export function hashReactorState(state: ReactorState): string {
  const h = new Hasher();
  h.int(state.cells.length);
  for (const r of state.cells) {
    if (r) h.int(r.id).int(r.grade);
    else h.int(-1);
  }
  h.int(state.ports.length);
  for (const p of state.ports) h.int(p.side).int(p.lane);
  h.int(state.next);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.score).int(state.moveCount).int(state.combo).int(state.bestCombo).int(state.sinceDischarge);
  h.int(state.discharges).int(state.salvos).int(state.fusions).int(state.scrams).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface ReactorSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeReactor(state: ReactorState): ReactorSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/**
 * The core as a string: one character a cell, row by row (`.` empty, a digit for a grade), then
 * `|`, then the open ports as side and lane, sorted. What the board draws must match it.
 */
export function viewString(cells: ReadonlyArray<{ readonly grade: number } | null>, ports: readonly ReactorPort[]): string {
  const grid = cells.map((r) => (r ? String(r.grade) : ".")).join("");
  const rim = ports
    .map((p) => `${p.side}${p.lane}`)
    .sort()
    .join(",");
  return `${grid}|${rim}`;
}
