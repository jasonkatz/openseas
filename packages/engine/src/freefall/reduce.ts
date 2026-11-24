import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_FREEFALL_CONFIG,
  FREEFALL_LEGS,
  type FreefallConfig,
  type FreefallDrop,
  type FreefallDropValue,
  type FreefallLanding,
  type FreefallMove,
  type FreefallRocker,
  type FreefallSide,
  type FreefallStack,
  type FreefallState,
  type FreefallStep,
} from "./types.js";

export function validateConfig(cfg: FreefallConfig): void {
  const int = (n: unknown, lo: number, hi: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 4, 20) &&
    cfg.width % 2 === 0 &&
    int(cfg.entry, 2, cfg.width) &&
    cfg.entry % 2 === 0 &&
    int(cfg.rows, 2, 10) &&
    int(cfg.gapPermille, 0, 600) &&
    Array.isArray(cfg.quotas) &&
    cfg.quotas.length === FREEFALL_LEGS.length &&
    cfg.quotas.every((q) => int(q, 1, 100_000)) &&
    typeof cfg.bays === "object" &&
    cfg.bays !== null &&
    FREEFALL_LEGS.every((leg) => {
      const b = cfg.bays[leg];
      return Array.isArray(b) && b.length === cfg.width / 2 && b.every((v) => int(v, 0, 10_000));
    }) &&
    typeof cfg.squareClusters === "boolean" &&
    typeof cfg.rival === "boolean" &&
    int(cfg.rivalSkill, 0, 100) &&
    int(cfg.turnSeconds, 5, 120) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid freefall config");
}

/** The lanes row `row` spans, first and last: the entry lanes at the top, widening to the whole width at the foot. */
export function rowSpan(cfg: FreefallConfig, row: number): readonly [number, number] {
  const grow = (cfg.width - cfg.entry) / 2;
  const extra = cfg.rows > 1 ? Math.round((row * grow) / (cfg.rows - 1)) : grow;
  const lo = grow - extra;
  return [lo, cfg.width - 1 - lo];
}

/** The lanes a pod can be dropped down, first and last: the top row's. */
export function entryLanes(cfg: FreefallConfig): readonly [number, number] {
  const lo = (cfg.width - cfg.entry) / 2;
  return [lo, lo + cfg.entry - 1];
}

/** What the berth under `lane` pays in leg `leg`. */
export function bayValue(cfg: FreefallConfig, leg: number, lane: number): number {
  const half = cfg.width / 2;
  const d = lane < half ? half - 1 - lane : lane - half;
  const table = cfg.bays[FREEFALL_LEGS[Math.min(Math.max(0, leg), FREEFALL_LEGS.length - 1)]!];
  return table[d] ?? 0;
}

/** Every berth's value in leg `leg`, left to right. */
export function bayValues(cfg: FreefallConfig, leg: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < cfg.width; c++) out.push(bayValue(cfg, leg, c));
  return out;
}

/** What a cluster of n pods scores in a berth worth `value`. */
export function landingPoints(cfg: FreefallConfig, value: number, n: number): number {
  return cfg.squareClusters ? value * n * n : value * n;
}

/** The lane a rocker's cradle is over, and the lane its arm is over. */
export function cradleLane(r: FreefallRocker): number {
  return r.lane + r.cradle;
}
export function armLane(r: FreefallRocker): number {
  return r.lane + 1 - r.cradle;
}

/** For each row, for each lane, the index of the rocker over it, or -1 where the lane is open. */
export function rockerTable(cfg: FreefallConfig, rockers: readonly FreefallRocker[]): number[][] {
  const table: number[][] = [];
  for (let r = 0; r < cfg.rows; r++) table.push(new Array<number>(cfg.width).fill(-1));
  rockers.forEach((k, i) => {
    table[k.row]![k.lane] = i;
    table[k.row]![k.lane + 1] = i;
  });
  return table;
}

interface Fall {
  readonly rockers: FreefallRocker[];
  readonly steps: FreefallStep[];
  readonly landed: FreefallLanding[];
  readonly points: number;
}

/**
 * One pod down `lane`, and everything it sets off, on the shaft as it stands. Pure: the shaft
 * passed in is not changed. Everything in motion falls a row at a time, so what meets in a lane
 * at a row fuses.
 */
export function fall(cfg: FreefallConfig, rockersIn: readonly FreefallRocker[], leg: number, lane: number, id: number): Fall {
  const rockers = rockersIn.map((r) => ({ ...r })) as Array<{ lane: number; row: number; cradle: 0 | 1; pod: number }>;
  const table = rockerTable(cfg, rockersIn);
  let moving = new Map<number, number[]>([[lane, [id]]]);
  const steps: FreefallStep[] = [];
  for (let row = 0; row < cfg.rows; row++) {
    const lanes = [...moving.keys()].sort((a, b) => a - b);
    const arriving: FreefallStack[] = lanes.map((l) => ({ lane: l, ids: moving.get(l)! }));
    const next = new Map<number, number[]>();
    const push = (l: number, ids: readonly number[]): void => {
      const list = next.get(l);
      if (list) list.push(...ids);
      else next.set(l, [...ids]);
    };
    const rested: Array<{ rocker: number; id: number }> = [];
    const flipped: Array<{ rocker: number; times: number }> = [];
    const tossed: Array<{ rocker: number; id: number; lane: number }> = [];
    const done = new Set<number>();
    for (const l of lanes) {
      const ri = table[row]![l]!;
      if (ri < 0) {
        push(l, moving.get(l)!);
        continue;
      }
      if (done.has(ri)) continue;
      done.add(ri);
      const k = rockers[ri]!;
      const cl = k.lane + k.cradle;
      const al = k.lane + 1 - k.cradle;
      const atCradle = moving.get(cl) ?? [];
      const atArm = moving.get(al) ?? [];
      const passing = [...atArm];
      let resting = 0;
      if (atCradle.length > 0) {
        if (k.pod === 0) {
          resting = atCradle[0]!;
          passing.push(...atCradle.slice(1));
        } else passing.push(...atCradle);
      }
      const m = passing.length;
      if (m % 2 === 1) {
        // An odd number of flips: the cradle swings to the other side, and whatever lay in it falls down its lane.
        const out = k.pod !== 0 ? k.pod : resting;
        if (out !== 0) {
          tossed.push({ rocker: ri, id: out, lane: cl });
          push(cl, [out]);
        }
        k.pod = 0;
        k.cradle = (1 - k.cradle) as 0 | 1;
      } else if (resting !== 0) {
        k.pod = resting;
        rested.push({ rocker: ri, id: resting });
      }
      if (m > 0) {
        flipped.push({ rocker: ri, times: m });
        push(al, passing);
      }
    }
    steps.push({ row, arriving, rested, flipped, tossed });
    moving = next;
  }
  const landed: FreefallLanding[] = [];
  let points = 0;
  for (const l of [...moving.keys()].sort((a, b) => a - b)) {
    const ids = moving.get(l)!;
    const value = bayValue(cfg, leg, l);
    const p = landingPoints(cfg, value, ids.length);
    points += p;
    landed.push({ lane: l, ids, value, points: p });
  }
  return { rockers, steps, landed, points };
}

/** Why dropping down `lane` is not allowed now, or null when it is. */
export function dropIllegalReason(state: FreefallState, lane: number): string | null {
  if (state.finished) return "game is finished";
  const [lo, hi] = entryLanes(state.config);
  if (!Number.isInteger(lane) || lane < lo || lane > hi) return "no such lane";
  return null;
}

/** What a drop down `lane` would do now. */
export function dropValue(state: FreefallState, lane: number): FreefallDropValue {
  const f = fall(state.config, state.rockers, state.leg, lane, state.nextId);
  let pods = 0;
  let cluster = 0;
  for (const l of f.landed) {
    pods += l.ids.length;
    cluster = Math.max(cluster, l.ids.length);
  }
  return { lane, points: f.points, pods, cluster };
}

/** Every entry lane's drop value, left to right. */
export function dropValues(state: FreefallState): FreefallDropValue[] {
  const out: FreefallDropValue[] = [];
  const [lo, hi] = entryLanes(state.config);
  for (let l = lo; l <= hi; l++) out.push(dropValue(state, l));
  return out;
}

/** A drop worth making, for an idle hint: the one worth most at once, the leftmost of equals. Null once the round is over. */
export function hint(state: FreefallState): number | null {
  if (state.finished) return null;
  let best = -1;
  let lane = entryLanes(state.config)[0];
  for (const v of dropValues(state)) {
    if (v.points > best) {
      best = v.points;
      lane = v.lane;
    }
  }
  return lane;
}

export function createFreefallGame(seed: string, config: FreefallConfig = DEFAULT_FREEFALL_CONFIG): FreefallState {
  validateConfig(config);
  let rng = seedFromString(`freefall:${seed}`);
  const rockers: FreefallRocker[] = [];
  for (let row = 0; row < config.rows; row++) {
    const [lo, hi] = rowSpan(config, row);
    for (let lane = lo + (row % 2); lane + 1 <= hi; lane += 2) {
      const gap = nextChance(rng, config.gapPermille, 1000);
      const side = nextInt(gap.state, 2);
      rng = side.state;
      if (gap.value) continue;
      rockers.push({ lane, row, cradle: side.value as 0 | 1, pod: 0 });
    }
  }
  return {
    config,
    rockers,
    rng,
    nextId: 1,
    leg: 0,
    legPoints: [0, 0],
    totals: [0, 0],
    closing: null,
    score: 0,
    moveCount: 0,
    rivalDrops: 0,
    legsWon: 0,
    bestCombo: 0,
    bestCluster: 0,
    lastMove: null,
    finished: false,
  };
}

export function reduceFreefall(state: FreefallState, move: FreefallMove): FreefallState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "drop":
      return playerDrop(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

/** One side's drop: the fall, the points, and the leg's close. */
function applyDrop(state: FreefallState, side: FreefallSide, lane: number): { state: FreefallState; drop: FreefallDrop } {
  const cfg = state.config;
  const id = state.nextId;
  const f = fall(cfg, state.rockers, state.leg, lane, id);
  const legPoints: [number, number] = [state.legPoints[0], state.legPoints[1]];
  const totals: [number, number] = [state.totals[0], state.totals[1]];
  legPoints[side] += f.points;
  totals[side] += f.points;
  let closing = state.closing;
  let legsWon = state.legsWon;
  let legEnded = false;
  if (closing !== null && closing !== side) legEnded = true;
  else if (closing === null && legPoints[side] >= cfg.quotas[state.leg]!) {
    if (side === 0) legsWon++;
    if (cfg.rival) closing = side;
    else legEnded = true;
  }
  let leg = state.leg;
  let finished = false;
  let nextLegPoints: readonly [number, number] = legPoints;
  if (legEnded) {
    leg++;
    nextLegPoints = [0, 0];
    closing = null;
    finished = leg >= FREEFALL_LEGS.length;
  }
  let pods = 0;
  let cluster = 0;
  for (const l of f.landed) {
    pods += l.ids.length;
    cluster = Math.max(cluster, l.ids.length);
  }
  const drop: FreefallDrop = { side, lane, id, steps: f.steps, landed: f.landed, points: f.points, leg: state.leg, rockers: f.rockers, legEnded };
  return {
    drop,
    state: {
      ...state,
      rockers: f.rockers,
      nextId: id + 1,
      leg: finished ? FREEFALL_LEGS.length - 1 : leg,
      legPoints: nextLegPoints,
      totals,
      closing,
      score: Math.max(0, totals[0] - totals[1]),
      legsWon,
      bestCombo: side === 0 ? Math.max(state.bestCombo, pods) : state.bestCombo,
      bestCluster: side === 0 ? Math.max(state.bestCluster, cluster) : state.bestCluster,
      finished,
    },
  };
}

/** The rival's lane: the drop worth most at once `rivalSkill` percent of the time (a random one of equals), else any lane. */
export function rivalLane(state: FreefallState): { lane: number; rng: PrngState } {
  const cfg = state.config;
  const skilled = nextInt(state.rng, 100);
  if (skilled.value < cfg.rivalSkill) {
    const values = dropValues(state);
    const best = Math.max(...values.map((v) => v.points));
    const ties = values.filter((v) => v.points === best);
    const pick = nextInt(skilled.state, ties.length);
    return { lane: ties[pick.value]!.lane, rng: pick.state };
  }
  const [lo] = entryLanes(cfg);
  const pick = nextInt(skilled.state, cfg.entry);
  return { lane: lo + pick.value, rng: pick.state };
}

function playerDrop(state: FreefallState, move: Extract<FreefallMove, { type: "drop" }>): FreefallState {
  const reason = dropIllegalReason(state, move.lane);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const mine = applyDrop(state, 0, move.lane);
  let s = mine.state;
  const drops: FreefallDrop[] = [mine.drop];
  if (!s.finished && s.config.rival) {
    const pick = rivalLane(s);
    const theirs = applyDrop({ ...s, rng: pick.rng }, 1, pick.lane);
    s = { ...theirs.state, rivalDrops: s.rivalDrops + 1 };
    drops.push(theirs.drop);
  }
  const moveCount = state.moveCount + 1;
  return { ...s, moveCount, lastMove: { move, drops }, finished: s.finished || moveCount >= s.config.maxMoves };
}

export function replayFreefall(seed: string, config: FreefallConfig, moves: readonly FreefallMove[]): FreefallState {
  let s = createFreefallGame(seed, config);
  for (const m of moves) s = reduceFreefall(s, m);
  return s;
}

export function hashFreefallState(state: FreefallState): string {
  const h = new Hasher();
  h.int(state.rockers.length);
  for (const r of state.rockers) h.int(r.lane).int(r.row).int(r.cradle).int(r.pod);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.leg).int(state.legPoints[0]).int(state.legPoints[1]).int(state.totals[0]).int(state.totals[1]);
  h.int(state.closing === null ? -1 : state.closing).int(state.score).int(state.moveCount).int(state.rivalDrops);
  h.int(state.legsWon).int(state.bestCombo).int(state.bestCluster).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface FreefallSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeFreefall(state: FreefallState): FreefallSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/**
 * The shaft as text, a line a row, `|` between rows: for each lane `.` where it is open, `C` an
 * empty cradle, `P` a cradle holding a pod, `a` an arm, and ` ` outside the row's span. What the
 * board draws must match it.
 */
export function viewString(cfg: FreefallConfig, rockers: readonly FreefallRocker[]): string {
  const rows: string[] = [];
  const table = rockerTable(cfg, rockers);
  for (let row = 0; row < cfg.rows; row++) {
    let line = "";
    for (let l = 0; l < cfg.width; l++) {
      const ri = table[row]![l]!;
      const [lo, hi] = rowSpan(cfg, row);
      if (l < lo || l > hi) line += " ";
      else if (ri < 0) line += ".";
      else {
        const k = rockers[ri]!;
        line += l === k.lane + k.cradle ? (k.pod !== 0 ? "P" : "C") : "a";
      }
    }
    rows.push(line);
  }
  return rows.join("|");
}
