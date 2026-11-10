import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_DEFLECTORS_CONFIG,
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_EMPTY,
  DEFLECTORS_SLASH,
  type DeflectorsBeam,
  type DeflectorsConfig,
  type DeflectorsEvent,
  type DeflectorsMove,
  type DeflectorsMoveReport,
  type DeflectorsOutcome,
  type DeflectorsShot,
  type DeflectorsState,
  type DeflectorsTrace,
  type DeflectorsVolley,
} from "./types.js";

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/**
 * How many mirror meetings one search of a volley's settings may spend. The search tries both
 * settings of every mirror the beams could meet, which is exponential at worst; on the content grid
 * it ends long before this. A grid that runs out gets the settings found so far, the same on every
 * machine.
 */
const SEARCH_BUDGET = 40_000;

/** How many sets of entry ports a deal tries before it settles for the best exits it has seen. */
const DEAL_TRIES = 4;

export const portCount = (cfg: DeflectorsConfig): number => cfg.size * 4;
export const portSide = (cfg: DeflectorsConfig, port: number): number => Math.floor(port / cfg.size);
export const portIndex = (cfg: DeflectorsConfig, port: number): number => port % cfg.size;

/** The cell a beam from `port` stands in first, and the way it is heading. */
export function portEntry(cfg: DeflectorsConfig, port: number): { col: number; row: number; dir: number } {
  const n = cfg.size;
  const i = port % n;
  switch (Math.floor(port / n)) {
    case 0:
      return { col: i, row: 0, dir: 2 };
    case 1:
      return { col: n - 1, row: i, dir: 3 };
    case 2:
      return { col: i, row: n - 1, dir: 0 };
    default:
      return { col: 0, row: i, dir: 1 };
  }
}

/** The port a beam leaves by when it steps off the grid heading `dir`, having just left (col, row). */
function exitPort(cfg: DeflectorsConfig, col: number, row: number, dir: number): number {
  const n = cfg.size;
  switch (dir) {
    case 0:
      return col;
    case 1:
      return n + row;
    case 2:
      return 2 * n + col;
    default:
      return 3 * n + row;
  }
}

/** The way a beam heading `dir` leaves a mirror: `/` swaps up with right and down with left, `\` swaps up with left and down with right. */
export function turn(mirror: number, dir: number): number {
  return mirror === DEFLECTORS_SLASH ? dir ^ 1 : 3 - dir;
}

export function validateConfig(cfg: DeflectorsConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.size, 3, 10) &&
    int(cfg.mirrors, 1, cfg.size * cfg.size) &&
    int(cfg.maxBeams, 1, 3) &&
    int(cfg.rampTicks, 1, 100_000) &&
    int(cfg.minBest, 0, 64) &&
    int(cfg.bouncePoints, 0, 1000) &&
    int(cfg.bounceCap, 1, 64) &&
    int(cfg.perfectPercent, 100, 1000) &&
    int(cfg.hullPenalty, 0, 100_000) &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000) &&
    int(cfg.tickMs, 20, 5000) &&
    int(cfg.maxTick, 1, 100_000) &&
    int(cfg.maxMoves, 1, 1_000_000) &&
    int(cfg.openingTicks, 0, 10_000) &&
    int(cfg.chargeTicks, 1, 10_000) &&
    int(cfg.chargeTicksMin, 1, cfg.chargeTicks) &&
    int(cfg.beamTicks, 0, 10_000) &&
    int(cfg.respawnTicks, 0, 10_000);
  if (!ok) throw new Error("invalid deflectors config");
}

/** A value that falls evenly from `start` at tick 0 to `end` by the last tick of the round. */
function eased(cfg: DeflectorsConfig, start: number, end: number, tick: number): number {
  const span = start - end;
  if (span <= 0) return start;
  const steps = Math.floor(((span + 1) * Math.max(0, Math.min(tick, cfg.maxTick))) / cfg.maxTick);
  return Math.max(end, start - steps);
}

/** How many beams a volley dealt at `tick` holds: one at first, one more every rampTicks, up to maxBeams. */
export function beamsAt(cfg: DeflectorsConfig, tick: number): number {
  return Math.min(cfg.maxBeams, 1 + Math.floor(Math.max(0, tick) / cfg.rampTicks));
}

/** Ticks a volley of `beams` beams dealt at `tick` waits before it fires. */
export function chargeTicksAt(cfg: DeflectorsConfig, tick: number, beams = 1): number {
  return eased(cfg, cfg.chargeTicks, cfg.chargeTicksMin, tick) + cfg.beamTicks * Math.max(0, beams - 1);
}

/** The way a beam from `entry` runs through `mirrors` as they stand. */
export function trace(cfg: DeflectorsConfig, mirrors: readonly number[], entry: number): DeflectorsTrace {
  const n = cfg.size;
  let { col, row, dir } = portEntry(cfg, entry);
  const turns: number[] = [];
  // A path through two-sided mirrors can be run backwards, so a beam from outside always leaves; the bound is for a bad grid only.
  for (let step = 0; step < n * n * 4 + 4; step++) {
    if (col < 0 || col >= n || row < 0 || row >= n) break;
    const cell = row * n + col;
    const mirror = mirrors[cell]!;
    if (mirror !== DEFLECTORS_EMPTY) {
      dir = turn(mirror, dir);
      turns.push(cell);
    }
    col += DX[dir]!;
    row += DY[dir]!;
  }
  return { out: exitPort(cfg, col - DX[dir]!, row - DY[dir]!, dir), bounces: turns.length, turns };
}

/**
 * Every way beams from `entries` could leave together, over every setting of the mirrors they
 * could meet: `visit` is called with each beam's port and turns, and the settings those routes use
 * (0 for a mirror no beam meets). A mirror one beam has set stays set for the beams after it, so
 * what is visited is what one grid can do. The order is fixed and the work bounded, so every
 * machine sees the same.
 */
function explore(cfg: DeflectorsConfig, mirrors: readonly number[], entries: readonly number[], visit: (outs: readonly number[], bounces: readonly number[], setting: readonly number[]) => void): void {
  const n = cfg.size;
  const setting = new Array<number>(n * n).fill(0);
  const outs: number[] = [];
  const bounces: number[] = [];
  let budget = SEARCH_BUDGET;
  const start = (k: number): void => {
    if (k === entries.length) {
      visit(outs, bounces, setting);
      return;
    }
    const e = portEntry(cfg, entries[k]!);
    go(k, e.col, e.row, e.dir, 0);
  };
  const go = (k: number, colIn: number, rowIn: number, dirIn: number, countIn: number): void => {
    let col = colIn;
    let row = rowIn;
    let dir = dirIn;
    let count = countIn;
    for (;;) {
      if (col < 0 || col >= n || row < 0 || row >= n) {
        outs.push(exitPort(cfg, col - DX[dir]!, row - DY[dir]!, dir));
        bounces.push(count);
        start(k + 1);
        outs.pop();
        bounces.pop();
        return;
      }
      const cell = row * n + col;
      if (mirrors[cell] === DEFLECTORS_EMPTY) {
        col += DX[dir]!;
        row += DY[dir]!;
        continue;
      }
      if (--budget < 0) return;
      const set = setting[cell]!;
      if (set !== 0) {
        // Met before, by this beam or one before it: it is set already.
        dir = turn(set, dir);
        count++;
        col += DX[dir]!;
        row += DY[dir]!;
        continue;
      }
      for (let way = DEFLECTORS_SLASH; way <= DEFLECTORS_BACKSLASH; way++) {
        setting[cell] = way;
        const d = turn(way, dir);
        go(k, col + DX[d]!, row + DY[d]!, d, count + 1);
      }
      setting[cell] = 0;
      return;
    }
  };
  start(0);
}

/** A beam's own points for leaving by its exit after `bounces` turns. */
export function beamPoints(cfg: DeflectorsConfig, bounces: number): number {
  const b = Math.min(bounces, cfg.bounceCap);
  return cfg.bouncePoints * (b + 1) * (b + 1);
}

/** What the streak multiplies a clean volley by, in percent, at a streak of `streak` clean volleys. */
export function streakPercentAt(cfg: DeflectorsConfig, streak: number): number {
  if (streak <= 0) return 100;
  return cfg.streakPercent[Math.min(streak, cfg.streakPercent.length) - 1]!;
}

/** What a volley's hits come to: their own points, multiplied when the volley is perfect, and by the streak it stands at. */
export function volleyPoints(cfg: DeflectorsConfig, base: number, perfect: boolean, streak: number): number {
  const routed = perfect ? Math.floor((base * cfg.perfectPercent) / 100) : base;
  return Math.floor((routed * streakPercentAt(cfg, streak)) / 100);
}

/** One way beams could be given exits: the ports, and the most and the least the beams' own points come to over the settings that reach them. */
export interface DeflectorsOption {
  readonly exits: readonly number[];
  readonly best: number;
  readonly least: number;
}

/**
 * Every set of exits beams from `entries` can reach together, whatever the mirrors are set to: an
 * exit is a port no beam of the volley comes in by, and no two beams share one. Only where the
 * mirrors are matters, not how they are set. In a fixed order: by the first beam's exit, then the
 * next.
 */
export function volleyOptions(cfg: DeflectorsConfig, mirrors: readonly number[], entries: readonly number[]): DeflectorsOption[] {
  const ports = portCount(cfg);
  const found = new Map<number, { best: number; least: number }>();
  explore(cfg, mirrors, entries, (outs, bounces) => {
    let key = 0;
    let total = 0;
    for (let i = 0; i < outs.length; i++) {
      const out = outs[i]!;
      if (entries.includes(out)) return;
      for (let j = 0; j < i; j++) if (outs[j] === out) return;
      key = key * ports + out;
      total += beamPoints(cfg, bounces[i]!);
    }
    const seen = found.get(key);
    if (!seen) found.set(key, { best: total, least: total });
    else {
      if (total > seen.best) seen.best = total;
      if (total < seen.least) seen.least = total;
    }
  });
  return [...found.keys()]
    .sort((a, b) => a - b)
    .map((key) => {
      const exits = new Array<number>(entries.length);
      let rest = key;
      for (let i = entries.length - 1; i >= 0; i--) {
        exits[i] = rest % ports;
        rest = Math.floor(rest / ports);
      }
      return { exits, best: found.get(key)!.best, least: found.get(key)!.least };
    });
}

/**
 * A setting of the mirrors worth the most there is with every beam out through its exit: the beams'
 * own points under it, and the mirrors to flip, in the order the beams meet them, to get there from
 * `mirrors` as they stand. Of the settings worth that much, the one the fewest flips away. Null
 * when no setting sends every beam home.
 */
export function volleyRoute(cfg: DeflectorsConfig, mirrors: readonly number[], beams: readonly DeflectorsBeam[]): { base: number; flips: number[] } | null {
  const entries = beams.map((b) => b.entry);
  let bestBase = -1;
  let bestFlips = 0;
  let bestSetting: number[] | null = null;
  explore(cfg, mirrors, entries, (outs, bounces, setting) => {
    let base = 0;
    for (let i = 0; i < outs.length; i++) {
      if (outs[i] !== beams[i]!.exit) return;
      base += beamPoints(cfg, bounces[i]!);
    }
    if (base < bestBase) return;
    let flips = 0;
    for (let c = 0; c < setting.length; c++) if (setting[c] !== 0 && setting[c] !== mirrors[c]) flips++;
    if (base === bestBase && flips >= bestFlips) return;
    bestBase = base;
    bestFlips = flips;
    bestSetting = setting.slice();
  });
  if (bestSetting === null) return null;
  const want: number[] = bestSetting;
  const set = mirrors.map((m, cell) => (want[cell] !== 0 ? want[cell]! : m));
  const flips: number[] = [];
  for (const beam of beams) for (const cell of trace(cfg, set, beam.entry).turns) if (mirrors[cell] !== set[cell] && !flips.includes(cell)) flips.push(cell);
  return { base: bestBase, flips };
}

/** The most the beams' own points come to over every setting that sends each out through its exit, or -1 when none does. */
export function volleyBest(cfg: DeflectorsConfig, mirrors: readonly number[], beams: readonly DeflectorsBeam[]): number {
  return volleyRoute(cfg, mirrors, beams)?.base ?? -1;
}

/**
 * What `volley` does fired through `mirrors` as they stand, at a streak of `combo` and a score of
 * `score`. The board shows this while the volley waits; the reducer scores with it.
 */
export function resolve(cfg: DeflectorsConfig, mirrors: readonly number[], volley: DeflectorsVolley, combo: number, score: number): DeflectorsOutcome {
  const traces = volley.beams.map((beam) => trace(cfg, mirrors, beam.entry));
  let hits = 0;
  let base = 0;
  volley.beams.forEach((beam, i) => {
    if (traces[i]!.out !== beam.exit) return;
    hits++;
    base += beamPoints(cfg, traces[i]!.bounces);
  });
  const clean = hits === volley.beams.length;
  const perfect = clean && base >= volley.best;
  const streak = clean ? combo + 1 : 0;
  const gained = volleyPoints(cfg, base, perfect, streak);
  // The hits are banked first, then the hull takes its due for each miss, never below zero.
  let left = score + gained;
  let lost = 0;
  const shots: DeflectorsShot[] = volley.beams.map((beam, i) => {
    const t = traces[i]!;
    const hit = t.out === beam.exit;
    let points = 0;
    if (hit) points = beamPoints(cfg, t.bounces);
    else {
      const take = Math.min(left, cfg.hullPenalty);
      left -= take;
      lost += take;
      if (take > 0) points = -take;
    }
    return { sign: beam.sign, entry: beam.entry, exit: beam.exit, out: t.out, bounces: t.bounces, turns: t.turns, hit, points };
  });
  return { shots, hits, clean, perfect, base, streak, streakPercent: streakPercentAt(cfg, streak), gained, lost, points: gained - lost };
}

/** What the waiting volley would do if it fired now, or null when none waits. */
export function outlook(state: DeflectorsState): DeflectorsOutcome | null {
  if (!state.volley) return null;
  return resolve(state.config, state.mirrors, state.volley, state.combo, state.score);
}

/** What the waiting volley would add fired perfect now, or 0 when none waits. */
export function bestPoints(state: DeflectorsState): number {
  if (!state.volley) return 0;
  return volleyPoints(state.config, state.volley.best, true, state.combo + 1);
}

export function flipIllegalReason(state: DeflectorsState, cell: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.mirrors.length) return "no such cell";
  if (state.mirrors[cell] === DEFLECTORS_EMPTY) return "no mirror there";
  return null;
}

export function createDeflectorsGame(seed: string, config: DeflectorsConfig = DEFAULT_DEFLECTORS_CONFIG): DeflectorsState {
  validateConfig(config);
  let rng = seedFromString(`deflectors:${seed}`);
  const cells = config.size * config.size;
  const mirrors = new Array<number>(cells).fill(DEFLECTORS_EMPTY);
  const free: number[] = [];
  for (let c = 0; c < cells; c++) free.push(c);
  for (let m = 0; m < config.mirrors; m++) {
    const pick = nextInt(rng, free.length);
    rng = pick.state;
    const cell = free.splice(pick.value, 1)[0]!;
    const way = nextInt(rng, 2);
    rng = way.state;
    mirrors[cell] = way.value === 0 ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH;
  }
  return {
    config,
    tick: 0,
    mirrors,
    volley: null,
    nextDealTick: config.openingTicks,
    rng,
    nextVolleyId: 1,
    eventSeq: 0,
    logLength: 0,
    flips: 0,
    volleys: 0,
    hits: 0,
    misses: 0,
    perfects: 0,
    longest: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    lastMove: null,
    finished: false,
  };
}

/** The mutable copy of a state the reducer works on. */
interface Work {
  cfg: DeflectorsConfig;
  tick: number;
  mirrors: number[];
  volley: DeflectorsVolley | null;
  nextDealTick: number;
  rng: PrngState;
  nextVolleyId: number;
  eventSeq: number;
  events: DeflectorsEvent[];
  flips: number;
  volleys: number;
  hits: number;
  misses: number;
  perfects: number;
  longest: number;
  score: number;
  combo: number;
  bestCombo: number;
  finished: boolean;
}

function startWork(state: DeflectorsState): Work {
  return {
    cfg: state.config,
    tick: state.tick,
    mirrors: state.mirrors.slice(),
    volley: state.volley,
    nextDealTick: state.nextDealTick,
    rng: state.rng,
    nextVolleyId: state.nextVolleyId,
    eventSeq: state.eventSeq,
    events: [],
    flips: state.flips,
    volleys: state.volleys,
    hits: state.hits,
    misses: state.misses,
    perfects: state.perfects,
    longest: state.longest,
    score: state.score,
    combo: state.combo,
    bestCombo: state.bestCombo,
    finished: state.finished,
  };
}

function finishWork(state: DeflectorsState, w: Work): DeflectorsState {
  return {
    ...state,
    tick: w.tick,
    mirrors: w.mirrors,
    volley: w.volley,
    nextDealTick: w.nextDealTick,
    rng: w.rng,
    nextVolleyId: w.nextVolleyId,
    eventSeq: w.eventSeq,
    flips: w.flips,
    volleys: w.volleys,
    hits: w.hits,
    misses: w.misses,
    perfects: w.perfects,
    longest: w.longest,
    score: w.score,
    combo: w.combo,
    bestCombo: w.bestCombo,
    finished: w.finished,
  };
}

/**
 * Announce a volley at `tick`: entry ports drawn at random, and exits the mirrors can reach
 * together. A few sets of entries are tried for exits worth routing to; failing that the best seen
 * will do, and a grid too bare for the volley's size deals a smaller one.
 */
function deal(w: Work, tick: number): void {
  const cfg = w.cfg;
  const ports: number[] = [];
  for (let p = 0; p < portCount(cfg); p++) ports.push(p);
  for (let i = ports.length - 1; i > 0; i--) {
    const j = nextInt(w.rng, i + 1);
    w.rng = j.state;
    const t = ports[i]!;
    ports[i] = ports[j.value]!;
    ports[j.value] = t;
  }
  let chosen: { entries: number[]; exits: readonly number[]; best: number } | null = null;
  for (let size = beamsAt(cfg, tick); size >= 1 && !chosen; size--) {
    const floor = size * beamPoints(cfg, cfg.minBest);
    let fallback: { entries: number[]; exits: readonly number[]; best: number } | null = null;
    for (let attempt = 0; attempt < DEAL_TRIES && (attempt + 1) * size <= ports.length; attempt++) {
      const entries = ports.slice(attempt * size, attempt * size + size);
      const now = entries.map((entry) => trace(cfg, w.mirrors, entry).out);
      const options = volleyOptions(cfg, w.mirrors, entries);
      // Worth routing to: a long way round, a cheaper way that is not it, and no beam home already.
      const rich = options.filter((o) => o.best >= floor && o.least < o.best && o.exits.every((exit, i) => exit !== now[i]));
      if (rich.length > 0) {
        const pick = nextInt(w.rng, rich.length);
        w.rng = pick.state;
        const o = rich[pick.value]!;
        chosen = { entries, exits: o.exits, best: o.best };
        break;
      }
      for (const o of options) if (!fallback || o.best > fallback.best) fallback = { entries, exits: o.exits, best: o.best };
    }
    chosen ??= fallback;
  }
  // One beam alone always has somewhere to go, so a volley is always dealt.
  if (!chosen) return;
  const got = chosen;
  const beams: DeflectorsBeam[] = got.entries.map((entry, sign) => ({ sign, entry, exit: got.exits[sign]! }));
  const volley: DeflectorsVolley = { id: w.nextVolleyId++, beams, dealTick: tick, fireTick: tick + chargeTicksAt(cfg, tick, beams.length), best: got.best };
  w.volley = volley;
  w.events.push({ seq: ++w.eventSeq, tick, type: "deal", volley });
}

/** Fire the waiting volley at `tick` through the mirrors as they stand, and score it. */
function fire(w: Work, volley: DeflectorsVolley, tick: number, early: boolean): void {
  const outcome = resolve(w.cfg, w.mirrors, volley, w.combo, w.score);
  w.volley = null;
  w.volleys++;
  w.hits += outcome.hits;
  w.misses += outcome.shots.length - outcome.hits;
  if (outcome.perfect) w.perfects++;
  for (const shot of outcome.shots) if (shot.hit) w.longest = Math.max(w.longest, shot.bounces);
  w.combo = outcome.streak;
  w.bestCombo = Math.max(w.bestCombo, w.combo);
  w.score += outcome.points;
  w.events.push({ seq: ++w.eventSeq, tick, type: "fire", volley, early, outcome });
  // The next volley follows closely, so a quick hand sees more of them.
  w.nextDealTick = tick + w.cfg.respawnTicks;
}

/** Carry the grid forward to `tick`: a volley whose count has ended fires, and the next is dealt when it is due. */
function simulate(state: DeflectorsState, tick: number): Work {
  const w = startWork(state);
  while (!w.finished) {
    const at = w.volley ? w.volley.fireTick : Math.max(w.nextDealTick, w.tick);
    if (at > tick) break;
    w.tick = at;
    if (w.volley) fire(w, w.volley, at, false);
    else deal(w, at);
  }
  w.tick = Math.max(w.tick, tick);
  return w;
}

export function reduceDeflectors(state: DeflectorsState, move: DeflectorsMove): DeflectorsState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (!Number.isInteger(move.tick) || move.tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
  if (move.tick > state.config.maxTick) throw new InvalidMoveError("tick beyond the round", move);
  const w = simulate(state, move.tick);
  switch (move.type) {
    case "wait":
      break;
    case "end":
      w.finished = true;
      break;
    case "flip": {
      const reason = flipIllegalReason(state, move.cell);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      w.mirrors[move.cell] = w.mirrors[move.cell] === DEFLECTORS_SLASH ? DEFLECTORS_BACKSLASH : DEFLECTORS_SLASH;
      w.flips++;
      break;
    }
    case "fire": {
      // A volley whose count ended on this very tick has fired already: there is nothing left to fire.
      if (!w.volley || w.volley.id !== move.volley) throw new InvalidMoveError("no such volley waiting", move);
      fire(w, w.volley, move.tick, true);
      break;
    }
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
  const logLength = state.logLength + 1;
  const report: DeflectorsMoveReport = { move, events: w.events, points: w.score - state.score };
  return {
    ...finishWork(state, w),
    logLength,
    lastMove: report,
    finished: w.finished || logLength >= state.config.maxMoves || w.tick >= state.config.maxTick,
  };
}

/** The state at a later tick, without logging a move. Clients call this to show time passing. */
export function advanceDeflectors(state: DeflectorsState, tick: number): DeflectorsState {
  if (tick <= state.tick || state.finished) return state;
  const w = simulate(state, Math.min(tick, state.config.maxTick));
  return { ...finishWork(state, w), lastMove: { move: { type: "wait", tick: w.tick }, events: w.events, points: w.score - state.score } };
}

export function replayDeflectors(seed: string, config: DeflectorsConfig, moves: readonly DeflectorsMove[]): DeflectorsState {
  let s = createDeflectorsGame(seed, config);
  for (const m of moves) s = reduceDeflectors(s, m);
  return s;
}

export function hashDeflectorsState(state: DeflectorsState): string {
  const h = new Hasher();
  h.int(state.config.size).int(state.tick);
  for (const m of state.mirrors) h.int(m);
  const v = state.volley;
  h.int(v ? v.beams.length : -1);
  if (v) {
    h.int(v.id).int(v.dealTick).int(v.fireTick).int(v.best);
    for (const b of v.beams) h.int(b.sign).int(b.entry).int(b.exit);
  }
  h.int(state.nextDealTick).int(state.nextVolleyId).int(state.eventSeq).int(state.logLength);
  h.int(state.flips).int(state.volleys).int(state.hits).int(state.misses).int(state.perfects).int(state.longest);
  h.int(state.score).int(state.combo).int(state.bestCombo);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface DeflectorsSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/** `moves` is volleys fired: the count a player would recognise. */
export function summarizeDeflectors(state: DeflectorsState): DeflectorsSummary {
  return { score: state.score, moves: state.volleys, bestCombo: state.bestCombo };
}

/**
 * The mirror to flip next, for the idle hint in unrated practice: the first flip towards a setting
 * worth the most the waiting volley can be. Null when the volley is perfect as the mirrors stand,
 * or none waits. Following it flip by flip always arrives: each flip is one fewer to go.
 */
export function hint(state: DeflectorsState): { cell: number } | null {
  const volley = state.volley;
  if (!volley || state.finished) return null;
  if (resolve(state.config, state.mirrors, volley, state.combo, state.score).perfect) return null;
  const cell = volleyRoute(state.config, state.mirrors, volley.beams)?.flips[0];
  return cell === undefined ? null : { cell };
}

/**
 * The grid as text: one character a cell, row by row (`.` empty, `/` and `\` mirrors), then a bar
 * and the waiting beams as sign:entry>exit, in order. What the board draws must match it.
 */
export function viewString(mirrors: readonly number[], beams: ReadonlyArray<{ readonly sign: number; readonly entry: number; readonly exit: number }>): string {
  const grid = mirrors.map((m) => (m === DEFLECTORS_SLASH ? "/" : m === DEFLECTORS_BACKSLASH ? "\\" : ".")).join("");
  const waiting = beams
    .slice()
    .sort((a, b) => a.sign - b.sign)
    .map((b) => `${b.sign}:${b.entry}>${b.exit}`)
    .join(",");
  return `${grid}|${waiting}`;
}
