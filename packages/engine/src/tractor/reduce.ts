import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_TRACTOR_CONFIG,
  TRACTOR_CACHE,
  type TractorConfig,
  type TractorFire,
  type TractorMark,
  type TractorMove,
  type TractorMoveReport,
  type TractorPiece,
  type TractorRun,
  type TractorSettle,
  type TractorState,
  type TractorSwapValue,
  type TractorTaken,
  type TractorWave,
} from "./types.js";

export const idx = (cfg: TractorConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: TractorConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: TractorConfig, cell: number): number => Math.floor(cell / cfg.width);

/** The shortest run that is beamed aboard. */
export const TRACTOR_MIN_RUN = 3;
/** A swap whose waves keep finding runs stops after this many; what is left waits for the next swap. */
const MAX_WAVES = 24;
/** Settlings within one wave, while caches keep reaching the top. */
const MAX_SETTLES = 12;
/** Deals tried before settling for one that has no swap to make. */
const MAX_DEALS = 60;

type Field = Array<TractorPiece | null>;

export function validateConfig(cfg: TractorConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 4, 10) &&
    int(cfg.height, 4, 12) &&
    int(cfg.kinds, 3, 8) &&
    int(cfg.runPoints, 0, 1000) &&
    Array.isArray(cfg.cascadePercent) &&
    cfg.cascadePercent.length >= 1 &&
    cfg.cascadePercent.length <= 16 &&
    cfg.cascadePercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000) &&
    int(cfg.startCaches, 0, cfg.width) &&
    int(cfg.cachePermille, 0, 500) &&
    int(cfg.maxCaches, 0, cfg.width) &&
    cfg.startCaches <= cfg.maxCaches &&
    int(cfg.cachePoints, 0, 100_000) &&
    int(cfg.beaconEvery, 0, 1000) &&
    int(cfg.sweepPoints, 0, 10_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid tractor config");
}

/** True when a piece is loot: it can be swapped and can be in a run. A cache never can. */
export function isLoot(p: TractorPiece | null | undefined): p is TractorPiece {
  return p !== null && p !== undefined && p.kind !== TRACTOR_CACHE;
}

/** True when a piece is a beacon: loot with a mark. */
export function isBeacon(p: TractorPiece | null | undefined): boolean {
  return isLoot(p) && p.mark !== undefined;
}

/** What a run of n is worth before its wave's percent. */
export function runValue(cfg: TractorConfig, n: number): number {
  return n >= TRACTOR_MIN_RUN ? cfg.runPoints * n * n : 0;
}

/** What k caches hauled in one swap score between them. */
export function cacheValue(cfg: TractorConfig, k: number): number {
  return cfg.cachePoints * k * k;
}

/** What the wave at `wave` (0 for the first) multiplies by, in percent. */
export function cascadePercentAt(cfg: TractorConfig, wave: number): number {
  return cfg.cascadePercent[Math.min(Math.max(0, wave), cfg.cascadePercent.length - 1)]!;
}

/** The cells a beacon at `cell` fires along, nearest first, round the directions in turn. */
export function markCells(cfg: TractorConfig, cell: number, mark: TractorMark): number[] {
  const dirs: ReadonlyArray<readonly [number, number]> =
    mark === "cross"
      ? [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]
      : [
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1],
        ];
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  const out: number[] = [];
  const reach = Math.max(cfg.width, cfg.height);
  for (let d = 1; d < reach; d++) {
    for (const [dc, dr] of dirs) {
      const c = col + dc * d;
      const r = row + dr * d;
      if (c >= 0 && c < cfg.width && r >= 0 && r < cfg.height) out.push(idx(cfg, c, r));
    }
  }
  return out;
}

/** Every run of TRACTOR_MIN_RUN or more on the field: rows first, top to bottom, then columns, left to right. */
export function findRuns(cfg: TractorConfig, cells: ReadonlyArray<TractorPiece | null>): TractorRun[] {
  const runs: TractorRun[] = [];
  const scan = (line: number[]): void => {
    let start = 0;
    for (let i = 1; i <= line.length; i++) {
      const a = cells[line[start]!];
      const b = i < line.length ? cells[line[i]!] : null;
      if (i < line.length && isLoot(a) && isLoot(b) && a.kind === b.kind) continue;
      const n = i - start;
      if (n >= TRACTOR_MIN_RUN && isLoot(a)) runs.push({ cells: line.slice(start, i), kind: a.kind, points: runValue(cfg, n) });
      start = i;
    }
  };
  for (let r = 0; r < cfg.height; r++) {
    const line: number[] = [];
    for (let c = 0; c < cfg.width; c++) line.push(idx(cfg, c, r));
    scan(line);
  }
  for (let c = 0; c < cfg.width; c++) {
    const line: number[] = [];
    for (let r = 0; r < cfg.height; r++) line.push(idx(cfg, c, r));
    scan(line);
  }
  return runs;
}

/** The length of the run of one kind through `cell` along one axis. */
function runThrough(cfg: TractorConfig, cells: ReadonlyArray<TractorPiece | null>, cell: number, dc: number, dr: number): number {
  const p = cells[cell];
  if (!isLoot(p)) return 0;
  let n = 1;
  for (const s of [1, -1]) {
    let c = colOf(cfg, cell) + dc * s;
    let r = rowOf(cfg, cell) + dr * s;
    while (c >= 0 && c < cfg.width && r >= 0 && r < cfg.height) {
      const q = cells[idx(cfg, c, r)];
      if (!isLoot(q) || q.kind !== p.kind) break;
      n++;
      c += dc * s;
      r += dr * s;
    }
  }
  return n;
}

function makesRunAt(cfg: TractorConfig, cells: ReadonlyArray<TractorPiece | null>, cell: number): boolean {
  return runThrough(cfg, cells, cell, 1, 0) >= TRACTOR_MIN_RUN || runThrough(cfg, cells, cell, 0, 1) >= TRACTOR_MIN_RUN;
}

function swapped<T>(cells: readonly T[], a: number, b: number): T[] {
  const out = cells.slice();
  out[a] = cells[b]!;
  out[b] = cells[a]!;
  return out;
}

export function swapIllegalReason(state: TractorState, cell: number): string | null {
  if (state.finished) return "game is finished";
  const cfg = state.config;
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) return "no such cell";
  if (rowOf(cfg, cell) >= cfg.height - 1) return "nothing below to swap with";
  if (!isLoot(state.cells[cell]) || !isLoot(state.cells[cell + cfg.width])) return "a cache cannot be swapped";
  return null;
}

/** True when swapping `cell` with the piece under it would make a run. */
function swapScores(cfg: TractorConfig, cells: readonly TractorPiece[], cell: number): boolean {
  const below = cell + cfg.width;
  if (!isLoot(cells[cell]) || !isLoot(cells[below])) return false;
  if (cells[cell]!.kind === cells[below]!.kind) return false;
  const after = swapped(cells, cell, below);
  return makesRunAt(cfg, after, cell) || makesRunAt(cfg, after, below);
}

/** True when some swap on the field makes a run. */
export function hasSwap(cfg: TractorConfig, cells: readonly TractorPiece[]): boolean {
  for (let c = 0; c < cfg.width * (cfg.height - 1); c++) if (swapScores(cfg, cells, c)) return true;
  return false;
}

interface Taking {
  runs: TractorRun[];
  fired: TractorFire[];
  /** Cells in runs, in run order, each once. */
  matched: number[];
  swept: number[];
  caches: number[];
  base: number;
}

/** What the runs on a field take: the runs, the beacons they fire and what those sweep. */
function take(cfg: TractorConfig, field: ReadonlyArray<TractorPiece | null>): Taking {
  const runs = findRuns(cfg, field);
  const matched: number[] = [];
  const inRun = new Set<number>();
  for (const run of runs) {
    for (const c of run.cells) {
      if (inRun.has(c)) continue;
      inRun.add(c);
      matched.push(c);
    }
  }
  const queue = matched.filter((c) => isBeacon(field[c])).sort((a, b) => a - b);
  const firing = new Set(queue);
  const fired: TractorFire[] = [];
  const swept: number[] = [];
  const caches: number[] = [];
  const gone = new Set(inRun);
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q]!;
    const beacon = field[cell]!;
    const took: number[] = [];
    for (const c of markCells(cfg, cell, beacon.mark!)) {
      const p = field[c];
      if (!p || gone.has(c)) continue;
      gone.add(c);
      took.push(c);
      if (p.kind === TRACTOR_CACHE) caches.push(c);
      else {
        swept.push(c);
        if (p.mark !== undefined && !firing.has(c)) {
          firing.add(c);
          queue.push(c);
        }
      }
    }
    fired.push({ cell, id: beacon.id, mark: beacon.mark!, swept: took });
  }
  const base = runs.reduce((a, r) => a + r.points, 0) + swept.length * cfg.sweepPoints;
  return { runs, fired, matched, swept, caches, base };
}

/** What a swap is worth at once: the first wave's runs, sweeps and caches, as the reducer would score them. */
export function swapValue(state: TractorState, cell: number): TractorSwapValue {
  const cfg = state.config;
  const none: TractorSwapValue = { scores: false, runs: [], cleared: [], caches: [], fired: 0, points: 0 };
  if (swapIllegalReason(state, cell) !== null) return none;
  const after = swapped(state.cells, cell, cell + cfg.width);
  const t = take(cfg, after);
  if (t.runs.length === 0) return none;
  const points = Math.floor((t.base * cascadePercentAt(cfg, 0)) / 100) + cacheValue(cfg, t.caches.length);
  return { scores: true, runs: t.runs, cleared: [...t.matched, ...t.swept], caches: t.caches, fired: t.fired.length, points };
}

/** A good swap, for the idle hint in unrated practice: the one worth most at once. Null when no swap scores. */
export function hint(state: TractorState): number | null {
  const cfg = state.config;
  let best: number | null = null;
  let bestPoints = -1;
  for (let c = 0; c < cfg.width * (cfg.height - 1); c++) {
    if (!swapScores(cfg, state.cells, c)) continue;
    const v = swapValue(state, c);
    if (v.points > bestPoints) {
      best = c;
      bestPoints = v.points;
    }
  }
  return best;
}

function countCaches(cells: ReadonlyArray<TractorPiece | null>): number {
  let n = 0;
  for (const p of cells) if (p?.kind === TRACTOR_CACHE) n++;
  return n;
}

/** A kind for `cell` that makes no run with what is already left of it and above it. */
function pickCalm(cfg: TractorConfig, cells: Field, cell: number, rng: PrngState): { kind: number; rng: PrngState } {
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  const banned = new Set<number>();
  const same = (a: number, b: number): number | null => {
    const p = cells[a];
    const q = cells[b];
    return isLoot(p) && isLoot(q) && p.kind === q.kind ? p.kind : null;
  };
  if (col >= 2) {
    const k = same(cell - 1, cell - 2);
    if (k !== null) banned.add(k);
  }
  if (row >= 2) {
    const k = same(cell - cfg.width, cell - 2 * cfg.width);
    if (k !== null) banned.add(k);
  }
  const allowed: number[] = [];
  for (let k = 0; k < cfg.kinds; k++) if (!banned.has(k)) allowed.push(k);
  const pick = nextInt(rng, allowed.length);
  return { kind: allowed[pick.value]!, rng: pick.state };
}

/** A kind for `cell` that completes no run with the pieces already placed round it, in either axis. */
function pickUnmatched(cfg: TractorConfig, cells: ReadonlyArray<TractorPiece | null | undefined>, cell: number, rng: PrngState): { kind: number; rng: PrngState } {
  const allowed: number[] = [];
  const trial = cells.slice() as Array<TractorPiece | null>;
  for (let k = 0; k < cfg.kinds; k++) {
    trial[cell] = { id: 0, kind: k };
    if (!makesRunAt(cfg, trial, cell)) allowed.push(k);
  }
  if (allowed.length === 0) for (let k = 0; k < cfg.kinds; k++) allowed.push(k);
  const pick = nextInt(rng, allowed.length);
  return { kind: allowed[pick.value]!, rng: pick.state };
}

/** Deal loot into every cell that is not a cache or a beacon, with no run standing and a swap to make. */
function dealLoot(cfg: TractorConfig, cells: Field, rngIn: PrngState, nextIdIn: number): { rng: PrngState; nextId: number } {
  let rng = rngIn;
  let nextId = nextIdIn;
  const keep = cells.map((p) => p !== null && p !== undefined && (p.kind === TRACTOR_CACHE || p.mark !== undefined));
  for (let attempt = 0; attempt < MAX_DEALS; attempt++) {
    for (let c = 0; c < cells.length; c++) if (!keep[c]) cells[c] = null;
    for (let c = 0; c < cells.length; c++) {
      if (keep[c]) continue;
      const pick = pickCalm(cfg, cells, c, rng);
      rng = pick.rng;
      cells[c] = { id: nextId++, kind: pick.kind };
    }
    const full = cells as TractorPiece[];
    if (findRuns(cfg, full).length === 0 && hasSwap(cfg, full)) return { rng, nextId };
  }
  return { rng, nextId };
}

export function createTractorGame(seed: string, config: TractorConfig = DEFAULT_TRACTOR_CONFIG): TractorState {
  validateConfig(config);
  let rng = seedFromString(`tractor:${seed}`);
  let nextId = 1;
  const cells: Field = new Array<TractorPiece | null>(config.width * config.height).fill(null);
  // Caches open in the lower half, a column each, so each has loot over it to be cleared.
  const cols: number[] = [];
  for (let c = 0; c < config.width; c++) cols.push(c);
  const top = Math.ceil(config.height / 2);
  for (let n = 0; n < config.startCaches && cols.length > 0; n++) {
    const pc = nextInt(rng, cols.length);
    const col = cols.splice(pc.value, 1)[0]!;
    const pr = nextInt(pc.state, config.height - top);
    rng = pr.state;
    cells[idx(config, col, top + pr.value)] = { id: nextId++, kind: TRACTOR_CACHE };
  }
  const dealt = dealLoot(config, cells, rng, nextId);
  return {
    config,
    cells: cells as TractorPiece[],
    rng: dealt.rng,
    nextId: dealt.nextId,
    score: 0,
    moveCount: 0,
    clears: 0,
    duds: 0,
    cleared: 0,
    bestCombo: 0,
    cachesHauled: 0,
    bestCaches: 0,
    beaconsFired: 0,
    longest: 0,
    lastMove: null,
    finished: false,
  };
}

interface Settled {
  cells: TractorPiece[];
  rises: Array<{ id: number; from: number; to: number }>;
  spawned: Array<{ id: number; cell: number; kind: number; mark?: TractorMark; rise: number }>;
  rng: PrngState;
  nextId: number;
}

/**
 * Let every piece rise into the gaps over it, then fill each column from the bottom with new loot.
 * With `beacon`, one piece of the new loot, drawn from the stream, drifts in as a beacon.
 */
function settle(cfg: TractorConfig, field: ReadonlyArray<TractorPiece | null>, rngIn: PrngState, nextIdIn: number, beacon: boolean): Settled {
  let rng = rngIn;
  let nextId = nextIdIn;
  const cells = new Array<TractorPiece>(field.length);
  const rises: Settled["rises"] = [];
  const spawned: Settled["spawned"] = [];
  let caches = countCaches(field);
  // Everything rises first, in every column, so new loot is dealt against the whole risen field.
  const filled: number[] = [];
  for (let col = 0; col < cfg.width; col++) {
    let row = 0;
    for (let r = 0; r < cfg.height; r++) {
      const piece = field[idx(cfg, col, r)];
      if (!piece) continue;
      const to = idx(cfg, col, row);
      cells[to] = piece;
      if (r !== row) rises.push({ id: piece.id, from: idx(cfg, col, r), to });
      row++;
    }
    filled.push(row);
  }
  for (let col = 0; col < cfg.width; col++) {
    const gaps = cfg.height - filled[col]!;
    for (let r = filled[col]!; r < cfg.height; r++) {
      let piece: TractorPiece;
      const cache = caches < cfg.maxCaches ? nextChance(rng, cfg.cachePermille, 1000) : null;
      if (cache) rng = cache.state;
      if (cache?.value) {
        piece = { id: nextId++, kind: TRACTOR_CACHE };
        caches++;
      } else {
        // New loot never completes a run as it arrives: every wave after the first comes from what
        // was already on the field, so a player can see it coming.
        const k = pickUnmatched(cfg, cells, idx(cfg, col, r), rng);
        rng = k.rng;
        piece = { id: nextId++, kind: k.kind };
      }
      const cell = idx(cfg, col, r);
      cells[cell] = piece;
      spawned.push({ id: piece.id, cell, kind: piece.kind, rise: gaps });
    }
  }
  if (beacon) {
    const loot = spawned.filter((p) => p.kind !== TRACTOR_CACHE);
    if (loot.length > 0) {
      const pick = nextInt(rng, loot.length);
      const m = nextInt(pick.state, 2);
      rng = m.state;
      const mark: TractorMark = m.value === 0 ? "cross" : "saltire";
      const chosen = loot[pick.value]!;
      spawned[spawned.indexOf(chosen)] = { ...chosen, mark };
      cells[chosen.cell] = { id: chosen.id, kind: chosen.kind, mark };
    }
  }
  return { cells, rises, spawned, rng, nextId };
}

export function reduceTractor(state: TractorState, move: TractorMove): TractorState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "swap":
      return swap(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function swap(state: TractorState, move: Extract<TractorMove, { type: "swap" }>): TractorState {
  const cfg = state.config;
  const reason = swapIllegalReason(state, move.cell);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const below = move.cell + cfg.width;
  const after = swapped(state.cells, move.cell, below);
  const moveCount = state.moveCount + 1;
  const taken = (field: ReadonlyArray<TractorPiece | null>, cell: number): TractorTaken => {
    const p = field[cell]!;
    return p.mark !== undefined ? { cell, id: p.id, kind: p.kind, mark: p.mark } : { cell, id: p.id, kind: p.kind };
  };

  let rng = state.rng;
  let nextId = state.nextId;
  let cells: TractorPiece[] = after;
  const waves: TractorWave[] = [];
  const allCaches: TractorTaken[] = [];
  let wavePoints = 0;
  let cleared = 0;
  let fired = 0;
  let longest = state.longest;
  const scoring = findRuns(cfg, after).length > 0;
  const clears = state.clears + (scoring ? 1 : 0);
  // A beacon drifts in with the first new loot after every beaconEvery scoring swaps.
  const beaconDue = scoring && cfg.beaconEvery > 0 && clears % cfg.beaconEvery === 0;

  for (let w = 0; w < MAX_WAVES; w++) {
    const t = take(cfg, cells);
    if (t.runs.length === 0) break;
    const percent = cascadePercentAt(cfg, w);
    const points = Math.floor((t.base * percent) / 100);
    const runTaken = t.matched.map((c) => taken(cells, c));
    const sweptTaken = t.swept.map((c) => taken(cells, c));
    const cacheTaken = t.caches.map((c) => taken(cells, c));
    let field: Field = cells.slice();
    for (const c of [...t.matched, ...t.swept, ...t.caches]) field[c] = null;
    for (const run of t.runs) longest = Math.max(longest, run.cells.length);
    const settles: TractorSettle[] = [];
    let topped: TractorTaken[] = [];
    for (let s = 0; s < MAX_SETTLES; s++) {
      const st = settle(cfg, field, rng, nextId, beaconDue && w === 0 && s === 0);
      rng = st.rng;
      nextId = st.nextId;
      cells = st.cells;
      settles.push({ topped, rises: st.rises, spawned: st.spawned, cells });
      allCaches.push(...topped);
      // Caches that have risen to the top row are hauled next, and the field settles again.
      topped = [];
      for (let col = 0; col < cfg.width; col++) {
        const cell = idx(cfg, col, 0);
        if (cells[cell]!.kind === TRACTOR_CACHE) topped.push(taken(cells, cell));
      }
      if (topped.length === 0) break;
      field = cells.slice();
      for (const h of topped) field[h.cell] = null;
    }
    allCaches.push(...cacheTaken);
    waves.push({ runs: t.runs, fired: t.fired, cleared: [...runTaken, ...sweptTaken], swept: sweptTaken, caches: cacheTaken, percent, points, settles });
    wavePoints += points;
    cleared += runTaken.length + sweptTaken.length;
    fired += t.fired.length;
  }

  let shuffled = false;
  if (!hasSwap(cfg, cells)) {
    const next: Field = cells.slice();
    const dealt = dealLoot(cfg, next, rng, nextId);
    rng = dealt.rng;
    nextId = dealt.nextId;
    cells = next as TractorPiece[];
    shuffled = true;
  }

  const cachePoints = cacheValue(cfg, allCaches.length);
  const points = wavePoints + cachePoints;
  const report: TractorMoveReport = {
    move,
    cell: move.cell,
    below,
    swapped: after,
    waves,
    caches: allCaches,
    cachePoints,
    shuffled,
    points,
  };
  return {
    config: cfg,
    cells,
    rng,
    nextId,
    score: state.score + points,
    moveCount,
    clears,
    duds: state.duds + (scoring ? 0 : 1),
    cleared: state.cleared + cleared,
    bestCombo: Math.max(state.bestCombo, waves.length),
    cachesHauled: state.cachesHauled + allCaches.length,
    bestCaches: Math.max(state.bestCaches, allCaches.length),
    beaconsFired: state.beaconsFired + fired,
    longest,
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
}

export function replayTractor(seed: string, config: TractorConfig, moves: readonly TractorMove[]): TractorState {
  let s = createTractorGame(seed, config);
  for (const m of moves) s = reduceTractor(s, m);
  return s;
}

const MARK_CODE: Record<TractorMark, number> = { cross: 1, saltire: 2 };

export function hashTractorState(state: TractorState): string {
  const h = new Hasher();
  h.int(state.cells.length);
  for (const p of state.cells) h.int(p.id).int(p.kind).int(p.mark === undefined ? 0 : MARK_CODE[p.mark]);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.score).int(state.moveCount).int(state.clears).int(state.duds).int(state.cleared);
  h.int(state.bestCombo).int(state.cachesHauled).int(state.bestCaches).int(state.beaconsFired).int(state.longest);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface TractorSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeTractor(state: TractorState): TractorSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/**
 * The field as one character a cell, row by row: a digit for loot, a letter from `a` for a cross
 * beacon of that kind (`a` is kind 0), a letter from `n` for a saltire beacon, `@` for a cache.
 * What the board draws must match it.
 */
export function viewString(cells: ReadonlyArray<{ readonly kind: number; readonly mark?: TractorMark }>): string {
  return cells.map((p) => kindChar(p.kind, p.mark)).join("");
}

export function kindChar(kind: number, mark?: TractorMark): string {
  if (kind === TRACTOR_CACHE) return "@";
  if (mark === "cross") return String.fromCharCode(97 + kind);
  if (mark === "saltire") return String.fromCharCode(110 + kind);
  return String(kind);
}
