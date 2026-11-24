import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_FORGING_CONFIG,
  FORGING_MARKS,
  type ForgingConfig,
  type ForgingFamily,
  type ForgingMark,
  type ForgingMove,
  type ForgingSpot,
  type ForgingState,
  type ForgingStrike,
} from "./types.js";

export const idx = (cfg: ForgingConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: ForgingConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: ForgingConfig, cell: number): number => Math.floor(cell / cfg.width);

/** The marks the stream can draw, in order: every mark but the spark. */
const DRAWN: readonly ForgingMark[] = FORGING_MARKS.slice(0, 8);
/** How many marks make a set. */
export const FORGING_SET_SIZE = 4;

const STEP: Readonly<Partial<Record<ForgingMark, number>>> = { one: 1, two: 2, three: 3, four: 4 };
const ALL8: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];
const HOOK: ReadonlyArray<readonly [number, number]> = [
  [1, -2],
  [2, -1],
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
  [-2, -1],
  [-1, -2],
];

export function validateConfig(cfg: ForgingConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 4, 9) &&
    int(cfg.height, 4, 9) &&
    int(cfg.blows, 1, 5) &&
    typeof cfg.jumps === "boolean" &&
    typeof cfg.far === "boolean" &&
    typeof cfg.sparks === "boolean" &&
    Array.isArray(cfg.weights) &&
    cfg.weights.length === DRAWN.length &&
    cfg.weights.every((w) => int(w, 0, 100)) &&
    cfg.weights[0]! + cfg.weights[1]! + cfg.weights[2]! > 0 &&
    int(cfg.preview, 0, 6) &&
    int(cfg.strikePoints, 0, 1000) &&
    int(cfg.chainPoints, 0, 1000) &&
    int(cfg.chainCap, 1, 20) &&
    int(cfg.setPoints, 0, 10_000) &&
    int(cfg.weaveCap, 1, 20) &&
    int(cfg.stallCost, 0, 10_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid forging config");
}

/** The kind of set a mark belongs to; a spark belongs to none and stands in for either. */
export function family(mark: ForgingMark): ForgingFamily | null {
  if (mark === "spark") return null;
  return STEP[mark] !== undefined ? "count" : "span";
}

/** True when the config deals this mark: its layer is on and its weight is above zero. */
export function dealt(cfg: ForgingConfig, mark: ForgingMark): boolean {
  const i = DRAWN.indexOf(mark);
  if (i < 0) return false;
  if (cfg.weights[i]! <= 0) return false;
  if (mark === "four") return cfg.far;
  if (mark === "star") return cfg.far && cfg.jumps;
  if (mark === "rail" || mark === "slant" || mark === "hook") return cfg.jumps;
  return true;
}

/** Draw one mark from the stream, by weight among the marks the config deals. */
function draw(cfg: ForgingConfig, rng: PrngState): { mark: ForgingMark; rng: PrngState } {
  let total = 0;
  for (const m of DRAWN) if (dealt(cfg, m)) total += cfg.weights[DRAWN.indexOf(m)]!;
  const r = nextInt(rng, total);
  let left = r.value;
  for (const m of DRAWN) {
    if (!dealt(cfg, m)) continue;
    left -= cfg.weights[DRAWN.indexOf(m)]!;
    if (left < 0) return { mark: m, rng: r.state };
  }
  return { mark: "one", rng: r.state };
}

/** The next `n` marks the stream will deal, in order: the preview. Reads the stream without spending it. */
export function upcoming(state: ForgingState, n: number): ForgingMark[] {
  const out: ForgingMark[] = [];
  let rng = state.rng;
  for (let i = 0; i < n; i++) {
    const d = draw(state.config, rng);
    out.push(d.mark);
    rng = d.rng;
  }
  return out;
}

export function createForgingGame(seed: string, config: ForgingConfig = DEFAULT_FORGING_CONFIG): ForgingState {
  validateConfig(config);
  let rng = seedFromString(`forging:${seed}`);
  const cells: ForgingSpot[] = [];
  for (let i = 0; i < config.width * config.height; i++) {
    const d = draw(config, rng);
    rng = d.rng;
    cells.push({ heat: config.blows, mark: d.mark });
  }
  return {
    config,
    cells,
    rng,
    at: null,
    lead: null,
    score: 0,
    moveCount: 0,
    chain: 0,
    chainMark: null,
    run: [],
    weave: 0,
    weaveFamily: null,
    sets: 0,
    bestWeave: 0,
    bestChain: 0,
    stalls: 0,
    sparksEarned: 0,
    lastMove: null,
    finished: false,
  };
}

const live = (cells: readonly ForgingSpot[], cell: number): boolean => cells[cell] !== undefined && cells[cell]!.heat > 0;

/** The spot at the edge of the plate along a ray from `cell`, or null when `cell` is already on that edge. */
function edge(cfg: ForgingConfig, cell: number, dc: number, dr: number): number | null {
  let c = colOf(cfg, cell);
  let r = rowOf(cfg, cell);
  let moved = false;
  while (c + dc >= 0 && c + dc < cfg.width && r + dr >= 0 && r + dr < cfg.height) {
    c += dc;
    r += dr;
    moved = true;
  }
  return moved ? idx(cfg, c, r) : null;
}

/** Every spot a mark reaches from `cell` on an empty plate, live or not, in a fixed order. */
export function reach(cfg: ForgingConfig, cell: number, mark: ForgingMark): number[] {
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  const out: number[] = [];
  const add = (c: number, r: number): void => {
    if (c >= 0 && c < cfg.width && r >= 0 && r < cfg.height) {
      const i = idx(cfg, c, r);
      if (i !== cell && !out.includes(i)) out.push(i);
    }
  };
  const n = STEP[mark];
  if (n !== undefined) {
    for (const [dc, dr] of ALL8) add(col + dc * n, row + dr * n);
  } else if (mark === "hook") {
    for (const [dc, dr] of HOOK) add(col + dc, row + dr);
  } else if (mark === "spark") {
    for (let i = 0; i < cfg.width * cfg.height; i++) if (i !== cell) out.push(i);
  } else {
    const dirs = mark === "rail" ? ORTHO : mark === "slant" ? DIAG : ALL8;
    for (const [dc, dr] of dirs) {
      const e = edge(cfg, cell, dc, dr);
      if (e !== null) add(colOf(cfg, e), rowOf(cfg, e));
    }
  }
  return out;
}

/** Where the next strike may land, in cell order. Every live spot before the first strike and after a stall. */
export function targetsFrom(cfg: ForgingConfig, cells: readonly ForgingSpot[], at: number | null, lead: ForgingMark | null): number[] {
  if (at === null || lead === null) {
    const out: number[] = [];
    for (let i = 0; i < cells.length; i++) if (live(cells, i)) out.push(i);
    return out;
  }
  return reach(cfg, at, lead)
    .filter((i) => live(cells, i))
    .sort((a, b) => a - b);
}

export function targets(state: ForgingState): number[] {
  if (state.finished) return [];
  return targetsFrom(state.config, state.cells, state.at, state.lead);
}

export function strikeIllegalReason(state: ForgingState, cell: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) return "no such spot";
  if (!live(state.cells, cell)) return "that spot is set";
  if (!targets(state).includes(cell)) return "the press cannot reach that spot";
  return null;
}

/** True when a run of marks, with `mark` added, could still be one set. */
function extendsRun(run: readonly ForgingMark[], mark: ForgingMark): boolean {
  if (run.length === 0 || run.length >= FORGING_SET_SIZE) return run.length === 0;
  if (mark === "spark") return true;
  const fam = family(mark);
  for (const r of run) {
    if (r === "spark") continue;
    if (r === mark || family(r) !== fam) return false;
  }
  return true;
}

/** The family a run is heading for: its first mark that is not a spark. */
function runFamily(run: readonly ForgingMark[]): ForgingFamily | null {
  for (const r of run) {
    const f = family(r);
    if (f !== null) return f;
  }
  return null;
}

/**
 * What a stall costs on this plate: stallCost with every blow still to strike, less as the plate is
 * set, rounded down. A stall early is a mistake; one with three spots left is close to bad luck.
 */
export function stallValue(cfg: ForgingConfig, cells: readonly ForgingSpot[]): number {
  let left = 0;
  for (const s of cells) left += s.heat;
  return Math.floor((cfg.stallCost * left) / (cells.length * cfg.blows));
}

/** What the n-th strike of a chain adds. */
export function chainValue(cfg: ForgingConfig, n: number): number {
  return n >= 2 ? cfg.chainPoints * Math.min(n - 1, cfg.chainCap) : 0;
}

/** What the k-th set of a weave scores. */
export function setValue(cfg: ForgingConfig, k: number): number {
  return k >= 1 ? cfg.setPoints * Math.min(k, cfg.weaveCap) : 0;
}

export function reduceForging(state: ForgingState, move: ForgingMove): ForgingState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "strike":
      return strike(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function strike(state: ForgingState, move: Extract<ForgingMove, { type: "strike" }>): ForgingState {
  const cfg = state.config;
  const reason = strikeIllegalReason(state, move.cell);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const cell = move.cell;
  const spot = state.cells[cell]!;
  const mark = spot.mark;
  const heat = spot.heat - 1;
  let rng = state.rng;

  // The last spot at the plate's highest heat, still live once struck, earns a spark.
  let top = 0;
  let atTop = 0;
  for (const s of state.cells) {
    if (s.heat > top) {
      top = s.heat;
      atTop = 0;
    }
    if (s.heat === top) atTop++;
  }
  const sparked = cfg.sparks && heat > 0 && spot.heat === top && atTop === 1;
  let next: ForgingMark | null = null;
  if (heat > 0) {
    if (sparked) next = "spark";
    else {
      const d = draw(cfg, rng);
      next = d.mark;
      rng = d.rng;
    }
  }
  const cells = state.cells.slice();
  cells[cell] = { heat, mark: next ?? mark };

  // The chain: the same mark as the strike before, a spark standing in for it.
  let chain: number;
  let chainMark: ForgingMark | null;
  if (state.chain > 0 && (mark === "spark" || state.chainMark === null || mark === state.chainMark)) {
    chain = state.chain + 1;
    chainMark = mark === "spark" ? state.chainMark : mark;
  } else {
    chain = 1;
    chainMark = mark === "spark" ? null : mark;
  }
  const chainPts = chainValue(cfg, chain);
  const chainStruck = chain;

  // The set in the making, and the weave it may link to.
  let run = state.run;
  let weave = state.weave;
  let weaveFamily = state.weaveFamily;
  let broke = false;
  if (extendsRun(run, mark)) run = [...run, mark];
  else {
    if (run.length >= 2 || weave >= 2) broke = true;
    run = [mark];
    weave = 0;
    weaveFamily = null;
  }
  const heading = runFamily(run);
  if (weave > 0 && heading !== null && heading === weaveFamily) {
    // A set of the same kind cannot link: the weave is over, and this run may start a new one.
    if (weave >= 2) broke = true;
    weave = 0;
    weaveFamily = null;
  }
  let set: ForgingStrike["set"] = null;
  let sets = state.sets;
  if (cfg.setPoints > 0 && run.length === FORGING_SET_SIZE) {
    const fam = heading ?? "count";
    const k = weave > 0 && weaveFamily !== fam ? weave + 1 : 1;
    set = { family: fam, weave: k, points: setValue(cfg, k) };
    weave = k;
    weaveFamily = fam;
    run = [];
    sets++;
  } else if (cfg.setPoints <= 0) run = [];

  const done = cells.every((s) => s.heat === 0);
  const moveCount = state.moveCount + 1;
  const gained = cfg.strikePoints + chainPts + (set?.points ?? 0);
  let score = state.score + gained;
  let stalled = false;
  let stallPoints = 0;
  let lead: ForgingMark | null = mark;
  if (!done && targetsFrom(cfg, cells, cell, mark).length === 0) {
    stalled = true;
    stallPoints = Math.min(stallValue(cfg, cells), score);
    score -= stallPoints;
    lead = null;
    if (run.length >= 2 || weave >= 2) broke = true;
    chain = 0;
    chainMark = null;
    run = [];
    weave = 0;
    weaveFamily = null;
  }

  const report: ForgingStrike = {
    cell,
    mark,
    heat,
    next,
    sparked: next === "spark",
    chain: stalled ? 0 : chain,
    chainPoints: chainPts,
    set,
    broke,
    stalled,
    stallPoints,
    done,
    points: gained - stallPoints,
  };
  return {
    config: cfg,
    cells,
    rng,
    at: cell,
    lead,
    score,
    moveCount,
    chain,
    chainMark,
    run,
    weave,
    weaveFamily,
    sets,
    bestWeave: Math.max(state.bestWeave, set?.weave ?? 0),
    bestChain: Math.max(state.bestChain, chainStruck),
    stalls: state.stalls + (stalled ? 1 : 0),
    sparksEarned: state.sparksEarned + (next === "spark" ? 1 : 0),
    lastMove: report,
    finished: done || moveCount >= cfg.maxMoves,
  };
}

export function replayForging(seed: string, config: ForgingConfig, moves: readonly ForgingMove[]): ForgingState {
  let s = createForgingGame(seed, config);
  for (const m of moves) s = reduceForging(s, m);
  return s;
}

/** What striking `cell` would do, as the engine plays it: the board's preview and the hint read it. */
export function strikeValue(state: ForgingState, cell: number): ForgingStrike | null {
  if (strikeIllegalReason(state, cell) !== null) return null;
  return reduceForging(state, { type: "strike", cell }).lastMove;
}

/**
 * A strike worth making, for an idle practice round: the one that scores most now without
 * stalling, ties broken by how many places the press could land after it. Advice, never a move.
 */
export function hint(state: ForgingState): number | null {
  let best: number | null = null;
  let bestValue = -Infinity;
  for (const cell of targets(state)) {
    const after = reduceForging(state, { type: "strike", cell });
    const r = after.lastMove!;
    const value = r.points * 10 + (r.stalled ? -1000 : targets(after).length);
    if (value > bestValue) {
      bestValue = value;
      best = cell;
    }
  }
  return best;
}

const MARK_CODE: Readonly<Record<ForgingMark, number>> = { one: 1, two: 2, three: 3, four: 4, rail: 5, slant: 6, star: 7, hook: 8, spark: 9 };
const FAMILY_CODE = (f: ForgingFamily | null): number => (f === null ? 0 : f === "count" ? 1 : 2);

export function hashForgingState(state: ForgingState): string {
  const h = new Hasher();
  h.int(state.cells.length);
  for (const s of state.cells) h.int(s.heat).int(MARK_CODE[s.mark]);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.at ?? -1).int(state.lead === null ? 0 : MARK_CODE[state.lead]);
  h.int(state.score).int(state.moveCount).int(state.chain).int(state.chainMark === null ? 0 : MARK_CODE[state.chainMark]);
  h.int(state.run.length);
  for (const m of state.run) h.int(MARK_CODE[m]);
  h.int(state.weave).int(FAMILY_CODE(state.weaveFamily)).int(state.sets).int(state.bestWeave).int(state.bestChain);
  h.int(state.stalls).int(state.sparksEarned).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface ForgingSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeForging(state: ForgingState): ForgingSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestWeave };
}

const MARK_CHAR: Readonly<Record<ForgingMark, string>> = { one: "1", two: "2", three: "3", four: "4", rail: "r", slant: "s", star: "x", hook: "h", spark: "!" };

/** One character for a mark: a digit for a step, r s x h for rail, slant, star and hook, ! for a spark. */
export function markChar(mark: ForgingMark): string {
  return MARK_CHAR[mark];
}

/**
 * The plate as two characters a spot, row by row: its heat, then its mark (`..` once set). What the
 * board draws must match it.
 */
export function viewString(cells: readonly ForgingSpot[]): string {
  return cells.map((s) => (s.heat > 0 ? `${s.heat}${MARK_CHAR[s.mark]}` : "..")).join("");
}
