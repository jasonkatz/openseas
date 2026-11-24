import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_DEFLECTORS_CONFIG,
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_EMPTY,
  DEFLECTORS_LENS,
  DEFLECTORS_LENS_KINDS,
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

/** True for a cell that holds a mirror, either way. */
export const isMirror = (cell: number): boolean => cell === DEFLECTORS_SLASH || cell === DEFLECTORS_BACKSLASH;

/** The kind of lens a cell holds, or -1 when it holds none. */
export const lensKind = (cell: number): number => (cell >= DEFLECTORS_LENS ? cell - DEFLECTORS_LENS : -1);

/** Lens kinds in a recipe mask. */
export function recipeSize(mask: number): number {
  let n = 0;
  for (let m = mask; m > 0; m >>= 1) n += m & 1;
  return n;
}

export function validateConfig(cfg: DeflectorsConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const cells = cfg.size * cfg.size;
  const ok =
    int(cfg.size, 3, 10) &&
    int(cfg.mirrors, 1, cells) &&
    int(cfg.lenses, 0, cells - cfg.mirrors) &&
    int(cfg.beams, 1, 3) &&
    int(cfg.recipeLenses, 0, DEFLECTORS_LENS_KINDS) &&
    (cfg.recipeLenses === 0 || cfg.lenses >= 1) &&
    int(cfg.lensPercent, 0, 1000) &&
    typeof cfg.spend === "boolean" &&
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
    int(cfg.respawnTicks, 0, 10_000);
  if (!ok) throw new Error("invalid deflectors config");
}

/** True when a beam that left by `out` having passed `lenses` is home for `beam`: its exit, and with recipes on, exactly its recipe. */
export function isHome(cfg: DeflectorsConfig, beam: { readonly exit: number; readonly recipe: number }, out: number, lenses: number): boolean {
  return out === beam.exit && (cfg.recipeLenses === 0 || lenses === beam.recipe);
}

/** The way a beam from `entry` runs through `cells` as they stand. */
export function trace(cfg: DeflectorsConfig, cells: readonly number[], entry: number): DeflectorsTrace {
  const n = cfg.size;
  let { col, row, dir } = portEntry(cfg, entry);
  const turns: number[] = [];
  const lensCells: number[] = [];
  let lenses = 0;
  // A path through two-sided mirrors can be run backwards, so a beam from outside always leaves; the bound is for a bad grid only.
  for (let step = 0; step < n * n * 4 + 4; step++) {
    if (col < 0 || col >= n || row < 0 || row >= n) break;
    const cell = row * n + col;
    const here = cells[cell]!;
    if (isMirror(here)) {
      dir = turn(here, dir);
      turns.push(cell);
    } else if (here >= DEFLECTORS_LENS) {
      lenses |= 1 << (here - DEFLECTORS_LENS);
      lensCells.push(cell);
    }
    col += DX[dir]!;
    row += DY[dir]!;
  }
  return { out: exitPort(cfg, col - DX[dir]!, row - DY[dir]!, dir), bounces: turns.length, turns, lenses, lensCells };
}

/**
 * Every way beams from `entries` could leave together, over every setting of the mirrors they
 * could meet: `visit` is called with each beam's port, turns and lens mask, and the settings those routes use
 * (0 for a mirror no beam meets). A mirror one beam has set stays set for the beams after it, so
 * what is visited is what one grid can do. The order is fixed and the work bounded, so every
 * machine sees the same.
 */
function explore(
  cfg: DeflectorsConfig,
  cells: readonly number[],
  entries: readonly number[],
  visit: (outs: readonly number[], bounces: readonly number[], lenses: readonly number[], setting: readonly number[]) => void,
): void {
  const n = cfg.size;
  const setting = new Array<number>(n * n).fill(0);
  const outs: number[] = [];
  const bounces: number[] = [];
  const lenses: number[] = [];
  let budget = SEARCH_BUDGET;
  const start = (k: number): void => {
    if (k === entries.length) {
      visit(outs, bounces, lenses, setting);
      return;
    }
    const e = portEntry(cfg, entries[k]!);
    go(k, e.col, e.row, e.dir, 0, 0);
  };
  const go = (k: number, colIn: number, rowIn: number, dirIn: number, countIn: number, maskIn: number): void => {
    let col = colIn;
    let row = rowIn;
    let dir = dirIn;
    let count = countIn;
    let mask = maskIn;
    for (;;) {
      if (col < 0 || col >= n || row < 0 || row >= n) {
        outs.push(exitPort(cfg, col - DX[dir]!, row - DY[dir]!, dir));
        bounces.push(count);
        lenses.push(mask);
        start(k + 1);
        outs.pop();
        bounces.pop();
        lenses.pop();
        return;
      }
      const cell = row * n + col;
      const here = cells[cell]!;
      if (!isMirror(here)) {
        if (here >= DEFLECTORS_LENS) mask |= 1 << (here - DEFLECTORS_LENS);
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
        go(k, col + DX[d]!, row + DY[d]!, d, count + 1, mask);
      }
      setting[cell] = 0;
      return;
    }
  };
  start(0);
}

/** A beam's own points for coming home after `bounces` turns with a recipe of `recipe` (a mask): (turns + 1) squared, and lensPercent more for each lens. */
export function beamPoints(cfg: DeflectorsConfig, bounces: number, recipe = 0): number {
  const b = Math.min(bounces, cfg.bounceCap);
  const turned = cfg.bouncePoints * (b + 1) * (b + 1);
  if (cfg.recipeLenses === 0) return turned;
  return Math.floor((turned * (100 + cfg.lensPercent * recipeSize(recipe))) / 100);
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

/**
 * One way beams could be given exits and recipes: the ports, the lens masks (all 0 when recipes are
 * off), and the most and the least the beams' own points come to over the settings that reach them.
 */
export interface DeflectorsOption {
  readonly exits: readonly number[];
  readonly recipes: readonly number[];
  readonly best: number;
  readonly least: number;
}

/**
 * Every set of exits and recipes beams from `entries` can reach together, whatever the mirrors are
 * set to: an exit is a port no beam of the volley comes in by, and no two beams share one; a recipe
 * is the lenses the beam passed, one to recipeLenses of them. Only where the mirrors and lenses are
 * matters, not how the mirrors are set. In a fixed order: by the first beam's exit and recipe, then
 * the next.
 */
export function volleyOptions(cfg: DeflectorsConfig, cells: readonly number[], entries: readonly number[]): DeflectorsOption[] {
  const ports = portCount(cfg);
  const kinds = 1 << DEFLECTORS_LENS_KINDS;
  const recipes = cfg.recipeLenses > 0;
  const found = new Map<number, { best: number; least: number }>();
  explore(cfg, cells, entries, (outs, bounces, lenses) => {
    let key = 0;
    let total = 0;
    for (let i = 0; i < outs.length; i++) {
      const out = outs[i]!;
      if (entries.includes(out)) return;
      for (let j = 0; j < i; j++) if (outs[j] === out) return;
      const recipe = recipes ? lenses[i]! : 0;
      if (recipes && (recipe === 0 || recipeSize(recipe) > cfg.recipeLenses)) return;
      key = (key * ports + out) * kinds + recipe;
      total += beamPoints(cfg, bounces[i]!, recipe);
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
      const masks = new Array<number>(entries.length);
      let rest = key;
      for (let i = entries.length - 1; i >= 0; i--) {
        masks[i] = rest % kinds;
        rest = Math.floor(rest / kinds);
        exits[i] = rest % ports;
        rest = Math.floor(rest / ports);
      }
      return { exits, recipes: masks, best: found.get(key)!.best, least: found.get(key)!.least };
    });
}

/**
 * A setting of the mirrors worth the most there is with every beam home: the beams' own points
 * under it, and the mirrors to flip, in the order the beams meet them, to get there from `mirrors`
 * as they stand. Of the settings worth that much, the one the fewest flips away. Null when no
 * setting sends every beam home. Aimed at the nearest instead, it is the setting the fewest flips
 * away, and of those the one worth the most: what a player who takes the first way home finds.
 */
export function volleyRoute(cfg: DeflectorsConfig, mirrors: readonly number[], beams: readonly DeflectorsBeam[], aim: "best" | "nearest" = "best"): { base: number; flips: number[] } | null {
  const entries = beams.map((b) => b.entry);
  let bestBase = -1;
  let bestFlips = 0;
  let bestSetting: number[] | null = null;
  explore(cfg, mirrors, entries, (outs, bounces, lenses, setting) => {
    let base = 0;
    for (let i = 0; i < outs.length; i++) {
      if (!isHome(cfg, beams[i]!, outs[i]!, lenses[i]!)) return;
      base += beamPoints(cfg, bounces[i]!, beams[i]!.recipe);
    }
    let flips = 0;
    for (let c = 0; c < setting.length; c++) if (setting[c] !== 0 && setting[c] !== mirrors[c]) flips++;
    if (bestSetting !== null) {
      // Best: the most points, then the fewest flips. Nearest: the fewest flips, then the most points.
      const [first, firstWas, second, secondWas] = aim === "best" ? [base, bestBase, -flips, -bestFlips] : [-flips, -bestFlips, base, bestBase];
      if (first < firstWas || (first === firstWas && second <= secondWas)) return;
    }
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

/** The most the beams' own points come to over every setting that sends each home, or -1 when none does. */
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
    if (!isHome(cfg, beam, traces[i]!.out, traces[i]!.lenses)) return;
    hits++;
    base += beamPoints(cfg, traces[i]!.bounces, beam.recipe);
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
    const hit = isHome(cfg, beam, t.out, t.lenses);
    let points = 0;
    if (hit) points = beamPoints(cfg, t.bounces, beam.recipe);
    else {
      const take = Math.min(left, cfg.hullPenalty);
      left -= take;
      lost += take;
      if (take > 0) points = -take;
    }
    return { sign: beam.sign, entry: beam.entry, exit: beam.exit, recipe: beam.recipe, out: t.out, bounces: t.bounces, turns: t.turns, lenses: t.lenses, lensCells: t.lensCells, atExit: t.out === beam.exit, hit, points };
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
  if (!isMirror(state.mirrors[cell]!)) return "no mirror there";
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
  for (let l = 0; l < config.lenses; l++) {
    const pick = nextInt(rng, free.length);
    rng = pick.state;
    const cell = free.splice(pick.value, 1)[0]!;
    mirrors[cell] = DEFLECTORS_LENS + (l % DEFLECTORS_LENS_KINDS);
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
    spent: 0,
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
  spent: number;
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
    spent: state.spent,
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
    spent: w.spent,
    perfects: w.perfects,
    longest: w.longest,
    score: w.score,
    combo: w.combo,
    bestCombo: w.bestCombo,
    finished: w.finished,
  };
}

/**
 * Announce a volley at `tick`: entry ports drawn at random, and exits and recipes the grid can
 * reach together. A few sets of entries are tried for ones worth routing to; failing that the best
 * seen will do, and a grid too bare for the volley's size deals a smaller one.
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
  type Pick = { entries: number[]; option: DeflectorsOption; asks?: boolean };
  let chosen: Pick | null = null;
  for (let size = cfg.beams; size >= 1 && !chosen; size--) {
    const floor = size * beamPoints(cfg, cfg.minBest);
    let fallback: Pick | null = null;
    for (let attempt = 0; attempt < DEAL_TRIES && (attempt + 1) * size <= ports.length; attempt++) {
      const entries = ports.slice(attempt * size, attempt * size + size);
      const now = entries.map((entry) => trace(cfg, w.mirrors, entry));
      const options = volleyOptions(cfg, w.mirrors, entries);
      const asks = (o: DeflectorsOption): boolean => o.exits.every((exit, i) => !isHome(cfg, { exit, recipe: o.recipes[i]! }, now[i]!.out, now[i]!.lenses));
      // Worth routing to: a long way round, a cheaper way that is not it, and no beam home already.
      const rich = options.filter((o) => o.best >= floor && o.least < o.best && asks(o));
      if (rich.length > 0) {
        const pick = nextInt(w.rng, rich.length);
        w.rng = pick.state;
        chosen = { entries, option: rich[pick.value]! };
        break;
      }
      // Failing that, the richest that still asks for a flip, and only on a grid with no such way the richest of all.
      for (const o of options) {
        const better = !fallback || (asks(o) ? !fallback.asks || o.best > fallback.option.best : !fallback.asks && o.best > fallback.option.best);
        if (better) fallback = { entries, option: o, asks: asks(o) };
      }
    }
    chosen ??= fallback;
  }
  // A grid with nowhere to send even one beam deals nothing, and tries again a little later.
  if (!chosen) {
    w.nextDealTick = tick + Math.max(1, cfg.respawnTicks);
    return;
  }
  const got = chosen;
  const beams: DeflectorsBeam[] = got.entries.map((entry, sign) => ({ sign, entry, exit: got.option.exits[sign]!, recipe: got.option.recipes[sign]! }));
  const volley: DeflectorsVolley = { id: w.nextVolleyId++, beams, dealTick: tick, best: got.option.best };
  w.volley = volley;
  w.events.push({ seq: ++w.eventSeq, tick, type: "deal", volley });
}

/**
 * The grid once the mirrors at `spent` have gone: in each column, whatever stood above a spent
 * mirror drops one cell for each spent below it, and as many fresh mirrors come in at the top, each
 * set at random. Columns are refilled left to right and a column's fresh mirrors top to bottom, so
 * the draws come in a fixed order. `fell` is, for every cell after, how many rows its content
 * dropped (0 for an empty cell).
 */
export function settle(cfg: DeflectorsConfig, cells: readonly number[], spent: readonly number[], rng: PrngState): { cells: number[]; fell: number[]; rng: PrngState } {
  const n = cfg.size;
  const out = cells.slice();
  const fell = new Array<number>(n * n).fill(0);
  let r = rng;
  for (let col = 0; col < n; col++) {
    const gone = new Set<number>();
    for (const cell of spent) if (cell % n === col) gone.add(Math.floor(cell / n));
    if (gone.size === 0) continue;
    // What stays, top to bottom, with the row it stood in.
    const kept: { cell: number; row: number }[] = [];
    for (let row = 0; row < n; row++) if (!gone.has(row)) kept.push({ cell: cells[row * n + col]!, row });
    const fresh = gone.size;
    for (let row = 0; row < fresh; row++) {
      const way = nextInt(r, 2);
      r = way.state;
      out[row * n + col] = way.value === 0 ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH;
      fell[row * n + col] = fresh;
    }
    kept.forEach((k, i) => {
      const row = fresh + i;
      out[row * n + col] = k.cell;
      fell[row * n + col] = k.cell === DEFLECTORS_EMPTY ? 0 : row - k.row;
    });
  }
  return { cells: out, fell, rng: r };
}

/** Fire the waiting volley at `tick` through the mirrors as they stand, score it, and spend the mirrors it turned at. */
function fire(w: Work, volley: DeflectorsVolley, tick: number): void {
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
  let spent: number[] = [];
  let fell: number[] = new Array<number>(w.mirrors.length).fill(0);
  if (w.cfg.spend) {
    spent = [...new Set(outcome.shots.flatMap((shot) => shot.turns))].sort((a, b) => a - b);
    const settled = settle(w.cfg, w.mirrors, spent, w.rng);
    w.mirrors = settled.cells;
    w.rng = settled.rng;
    fell = settled.fell;
    w.spent += spent.length;
  }
  w.events.push({ seq: ++w.eventSeq, tick, type: "fire", volley, outcome, spent, fell });
  // The next volley follows once the grid has settled.
  w.nextDealTick = tick + w.cfg.respawnTicks;
}

/** Carry the grid forward to `tick`: the next volley is dealt when it is due. A volley waits until it is fired. */
function simulate(state: DeflectorsState, tick: number): Work {
  const w = startWork(state);
  while (!w.finished && !w.volley) {
    const at = Math.max(w.nextDealTick, w.tick);
    if (at > tick) break;
    w.tick = at;
    deal(w, at);
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
      // A tap meant for a volley gone by fires nothing.
      if (!w.volley || w.volley.id !== move.volley) throw new InvalidMoveError("no such volley waiting", move);
      fire(w, w.volley, move.tick);
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
    h.int(v.id).int(v.dealTick).int(v.best);
    for (const b of v.beams) h.int(b.sign).int(b.entry).int(b.exit).int(b.recipe);
  }
  h.int(state.nextDealTick).int(state.nextVolleyId).int(state.eventSeq).int(state.logLength);
  h.int(state.flips).int(state.volleys).int(state.hits).int(state.misses).int(state.spent).int(state.perfects).int(state.longest);
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
 * The grid as text: one character a cell, row by row (`.` empty, `/` and `\\` mirrors, `a`, `b`, `c`
 * lenses), then a bar and the waiting beams as sign:entry>exit~recipe, in order. What the board
 * draws must match it.
 */
export function viewString(cells: readonly number[], beams: ReadonlyArray<{ readonly sign: number; readonly entry: number; readonly exit: number; readonly recipe: number }>): string {
  const grid = cells.map((m) => (m === DEFLECTORS_SLASH ? "/" : m === DEFLECTORS_BACKSLASH ? "\\" : m >= DEFLECTORS_LENS ? String.fromCharCode(97 + m - DEFLECTORS_LENS) : ".")).join("");
  const waiting = beams
    .slice()
    .sort((a, b) => a.sign - b.sign)
    .map((b) => `${b.sign}:${b.entry}>${b.exit}~${b.recipe}`)
    .join(",");
  return `${grid}|${waiting}`;
}
