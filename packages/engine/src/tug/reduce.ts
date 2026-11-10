import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_TUG_CONFIG,
  type TugClamp,
  type TugConfig,
  type TugDelivery,
  type TugDir,
  type TugGrade,
  type TugMove,
  type TugMoveReport,
  type TugState,
  type TugStop,
} from "./types.js";

export const idx = (cfg: TugConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: TugConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: TugConfig, cell: number): number => Math.floor(cell / cfg.width);

/** A flick's step in columns and rows, by direction: up, right, down, left. */
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

export function validateConfig(cfg: TugConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 4, 10) &&
    int(cfg.height, 4, 10) &&
    int(cfg.pods, 2, 5) &&
    int(cfg.blocks, 0, 16) &&
    // The search that deals a clamp visits every bay maxPar flicks can reach: four is as deep as it stays quick.
    int(cfg.maxPar, 1, 4) &&
    int(cfg.startPar, 1, cfg.maxPar) &&
    int(cfg.cleanPerStep, 1, 20) &&
    Array.isArray(cfg.parPoints) &&
    cfg.parPoints.length >= cfg.maxPar &&
    cfg.parPoints.length <= 8 &&
    cfg.parPoints.every((p) => int(p, 0, 100_000)) &&
    int(cfg.cleanPercent, 100, 1000) &&
    int(cfg.slack, 0, 20) &&
    int(cfg.slowPercent, 0, 100) &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => int(p, 100, 1000)) &&
    int(cfg.skipPenalty, 0, 100_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid tug config");
}

/** One byte a cell: 1 where a block is. */
function blockMask(cfg: TugConfig, blocks: readonly number[]): Uint8Array {
  const mask = new Uint8Array(cfg.width * cfg.height);
  for (const b of blocks) mask[b] = 1;
  return mask;
}

/** Where a pod at `from` comes to rest when flicked: the last free cell before a wall, a block (`mask`) or a pod (`occ`). */
function glide(cfg: TugConfig, mask: Uint8Array, occ: Uint8Array, from: number, dir: number): number {
  const dx = DX[dir]!;
  const dy = DY[dir]!;
  let col = from % cfg.width;
  let row = (from - col) / cfg.width;
  for (;;) {
    const c = col + dx;
    const r = row + dy;
    if (c < 0 || c >= cfg.width || r < 0 || r >= cfg.height) break;
    const cell = r * cfg.width + c;
    if (mask[cell] === 1 || occ[cell] === 1) break;
    col = c;
    row = r;
  }
  return row * cfg.width + col;
}

/** A flick as the board shows it: where the pod ends and what stopped it. A pod that cannot move ends where it is. */
export function slide(state: TugState, pod: number, dir: TugDir): { to: number; stop: TugStop } {
  const cfg = state.config;
  const mask = blockMask(cfg, state.blocks);
  const occ = new Uint8Array(mask.length);
  for (const p of state.pods) occ[p] = 1;
  const to = glide(cfg, mask, occ, state.pods[pod]!, dir);
  const c = colOf(cfg, to) + DX[dir]!;
  const r = rowOf(cfg, to) + DY[dir]!;
  const beyond = c < 0 || c >= cfg.width || r < 0 || r >= cfg.height ? -1 : idx(cfg, c, r);
  const stop: TugStop = beyond < 0 ? "wall" : mask[beyond] === 1 ? "block" : "pod";
  return { to, stop };
}

export function flickIllegalReason(state: TugState, pod: number, dir: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(pod) || pod < 0 || pod >= state.pods.length) return "no such pod";
  if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) return "bad direction";
  if (slide(state, pod, dir).to === state.pods[pod]) return "the pod cannot move that way";
  return null;
}

/** The par the next clamp is dealt at, at this level. */
export function wantPar(cfg: TugConfig, level: number): number {
  return Math.min(cfg.maxPar, cfg.startPar + Math.floor(Math.max(0, level) / cfg.cleanPerStep));
}

/** The highest the level goes: where the clamps are at maxPar. */
function levelCap(cfg: TugConfig): number {
  return (cfg.maxPar - cfg.startPar) * cfg.cleanPerStep;
}

/** What the streak multiplies a clean delivery by, in percent, at a streak of `streak`. */
export function streakPercentAt(cfg: TugConfig, streak: number): number {
  if (streak <= 0) return 100;
  return cfg.streakPercent[Math.min(streak, cfg.streakPercent.length) - 1]!;
}

/** How a delivery in `flicks` flicks measures against `par`. */
export function gradeAt(cfg: TugConfig, par: number, flicks: number): TugGrade {
  return flicks <= par ? "clean" : flicks <= par + cfg.slack ? "full" : "slow";
}

/**
 * What a delivery scores: the clamp's par, how it measured up, and the streak it is scored at
 * (the streak after this delivery, for a clean one). The board shows this; the reducer scores with it.
 */
export function deliveryPoints(cfg: TugConfig, par: number, grade: TugGrade, streak: number): number {
  const base = cfg.parPoints[Math.max(1, Math.min(par, cfg.parPoints.length)) - 1]!;
  if (grade === "clean") return Math.floor((Math.floor((base * cfg.cleanPercent) / 100) * streakPercentAt(cfg, streak)) / 100);
  if (grade === "full") return base;
  return Math.floor((base * cfg.slowPercent) / 100);
}

/** A bay's pods as one number, for telling bays apart in a search. */
function pack(pods: readonly number[], cells: number): number {
  let key = 0;
  for (let p = pods.length - 1; p >= 0; p--) key = key * cells + pods[p]!;
  return key;
}

/**
 * For every pod and cell, the fewest flicks after which that pod can rest on that cell, searching
 * every bay up to `depth` flicks from `start`: -1 where it takes more. Index = pod * cells + cell.
 * Breadth first, pods in order and directions in order, so it is the same on every machine.
 */
function reach(cfg: TugConfig, mask: Uint8Array, start: readonly number[], depth: number): Int8Array {
  const cells = cfg.width * cfg.height;
  const n = start.length;
  const best = new Int8Array(n * cells).fill(-1);
  for (let p = 0; p < n; p++) best[p * cells + start[p]!] = 0;
  const pow: number[] = [];
  for (let p = 0, v = 1; p < n; p++, v *= cells) pow.push(v);
  const occ = new Uint8Array(cells);
  const seen = new Set<number>([pack(start, cells)]);
  let frontier: number[][] = [start.slice()];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: number[][] = [];
    const last = d === depth;
    for (const s of frontier) {
      for (let p = 0; p < n; p++) occ[s[p]!] = 1;
      const base = last ? 0 : pack(s, cells);
      for (let p = 0; p < n; p++) {
        const from = s[p]!;
        for (let dir = 0; dir < 4; dir++) {
          const to = glide(cfg, mask, occ, from, dir);
          if (to === from) continue;
          if (best[p * cells + to]! < 0) best[p * cells + to] = d;
          // The last layer is only read for where pods come to rest; its bays are not searched from.
          if (last) continue;
          const key = base + (to - from) * pow[p]!;
          if (seen.has(key)) continue;
          seen.add(key);
          const s2 = s.slice();
          s2[p] = to;
          next.push(s2);
        }
      }
      for (let p = 0; p < n; p++) occ[s[p]!] = 0;
    }
    frontier = next;
  }
  return best;
}

/**
 * Light a clamp: a pod and a cell that pod can be brought to rest on in exactly `want` flicks and
 * no fewer, drawn evenly from every such pair. An empty cell is preferred; when no pair needs that
 * many flicks the nearest lower par is dealt. `avoid` is a clamp just skipped, never dealt again at once.
 */
function dealClamp(cfg: TugConfig, mask: Uint8Array, pods: readonly number[], rngIn: PrngState, want: number, avoid: TugClamp | null): { clamp: TugClamp; rng: PrngState } {
  const cells = cfg.width * cfg.height;
  const best = reach(cfg, mask, pods, want);
  for (const emptyOnly of [true, false]) {
    for (let par = want; par >= 1; par--) {
      const options: number[] = [];
      for (let p = 0; p < pods.length; p++) {
        for (let cell = 0; cell < cells; cell++) {
          if (best[p * cells + cell] !== par) continue;
          if (emptyOnly && pods.includes(cell)) continue;
          if (avoid && avoid.pod === p && avoid.cell === cell) continue;
          options.push(p * cells + cell);
        }
      }
      if (options.length === 0) continue;
      const pick = nextInt(rngIn, options.length);
      const chosen = options[pick.value]!;
      return { clamp: { pod: Math.floor(chosen / cells), cell: chosen % cells, par }, rng: pick.state };
    }
  }
  // No pod can move at all: a bay no sane config deals. The round is stuck; say so with a clamp on the first free cell.
  let cell = 0;
  while (cell < cells - 1 && (mask[cell] === 1 || pods.includes(cell))) cell++;
  return { clamp: { pod: 0, cell, par: want }, rng: rngIn };
}

/**
 * The shortest way to deliver the lit clamp from the bay as it stands, as flicks, or null when it
 * takes more than `maxDepth` (the bay has been pushed out of reach: skip, or shuffle the pods about).
 * For the idle hint and for bots; the same breadth-first order as the search that deals a clamp.
 */
export function solve(state: TugState, maxDepth: number = state.config.maxPar): Array<Extract<TugMove, { type: "flick" }>> | null {
  const cfg = state.config;
  const cells = cfg.width * cfg.height;
  const n = state.pods.length;
  const mask = blockMask(cfg, state.blocks);
  const occ = new Uint8Array(cells);
  const pow: number[] = [];
  for (let p = 0, v = 1; p < n; p++, v *= cells) pow.push(v);
  const states: number[][] = [state.pods.slice()];
  const parent: number[] = [-1];
  const via: number[] = [-1];
  const seen = new Set<number>([pack(state.pods, cells)]);
  let from = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const end = states.length;
    for (let i = from; i < end; i++) {
      const s = states[i]!;
      for (let p = 0; p < n; p++) occ[s[p]!] = 1;
      const base = pack(s, cells);
      for (let p = 0; p < n; p++) {
        const at = s[p]!;
        for (let dir = 0; dir < 4; dir++) {
          const to = glide(cfg, mask, occ, at, dir);
          if (to === at) continue;
          if (p === state.clamp.pod && to === state.clamp.cell) {
            const moves: Array<Extract<TugMove, { type: "flick" }>> = [{ type: "flick", pod: p, dir: dir as TugDir }];
            for (let k = i; parent[k]! >= 0; k = parent[k]!) moves.push({ type: "flick", pod: Math.floor(via[k]! / 4), dir: (via[k]! % 4) as TugDir });
            for (let q = 0; q < n; q++) occ[s[q]!] = 0;
            return moves.reverse();
          }
          const key = base + (to - at) * pow[p]!;
          if (seen.has(key)) continue;
          seen.add(key);
          const s2 = s.slice();
          s2[p] = to;
          states.push(s2);
          parent.push(i);
          via.push(p * 4 + dir);
        }
      }
      for (let p = 0; p < n; p++) occ[s[p]!] = 0;
    }
    from = end;
    if (from === states.length) break;
  }
  return null;
}

/**
 * Blocks off the walls (where the bay is big enough to have an inside), none touching another,
 * corners included, so no cell is ever walled in. Picking at random can box itself in before every
 * block is down, so the layout is tried afresh a few times and the fullest one kept.
 */
function placeBlocks(cfg: TugConfig, rngIn: PrngState): { blocks: number[]; rng: PrngState } {
  let rng = rngIn;
  const inside = cfg.width >= 5 && cfg.height >= 5;
  const all: number[] = [];
  for (let r = inside ? 1 : 0; r < cfg.height - (inside ? 1 : 0); r++) {
    for (let c = inside ? 1 : 0; c < cfg.width - (inside ? 1 : 0); c++) all.push(idx(cfg, c, r));
  }
  let best: number[] = [];
  for (let attempt = 0; attempt < 12 && best.length < cfg.blocks; attempt++) {
    let free = all.slice();
    const blocks: number[] = [];
    while (blocks.length < cfg.blocks && free.length > 0) {
      const pick = nextInt(rng, free.length);
      rng = pick.state;
      const cell = free[pick.value]!;
      blocks.push(cell);
      const col = colOf(cfg, cell);
      const row = rowOf(cfg, cell);
      free = free.filter((f) => Math.abs(colOf(cfg, f) - col) > 1 || Math.abs(rowOf(cfg, f) - row) > 1);
    }
    if (blocks.length > best.length) best = blocks;
  }
  best.sort((x, y) => x - y);
  return { blocks: best, rng };
}

export function createTugGame(seed: string, config: TugConfig = DEFAULT_TUG_CONFIG): TugState {
  validateConfig(config);
  let rng = seedFromString(`tug:${seed}`);
  const placed = placeBlocks(config, rng);
  rng = placed.rng;
  const mask = blockMask(config, placed.blocks);
  const free: number[] = [];
  for (let c = 0; c < mask.length; c++) if (mask[c] === 0) free.push(c);
  const pods: number[] = [];
  for (let p = 0; p < config.pods; p++) {
    const pick = nextInt(rng, free.length);
    rng = pick.state;
    pods.push(free.splice(pick.value, 1)[0]!);
  }
  const dealt = dealClamp(config, mask, pods, rng, wantPar(config, 0), null);
  return {
    config,
    blocks: placed.blocks,
    pods,
    clamp: dealt.clamp,
    flicks: 0,
    level: 0,
    rng: dealt.rng,
    score: 0,
    moveCount: 0,
    logLength: 0,
    delivered: 0,
    clean: 0,
    skipped: 0,
    combo: 0,
    bestCombo: 0,
    bestPar: 0,
    lastMove: null,
    finished: false,
  };
}

export function reduceTug(state: TugState, move: TugMove): TugState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "flick":
      return flick(state, move);
    case "skip":
      return skip(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function flick(state: TugState, move: Extract<TugMove, { type: "flick" }>): TugState {
  const cfg = state.config;
  const reason = flickIllegalReason(state, move.pod, move.dir);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const from = state.pods[move.pod]!;
  const { to, stop } = slide(state, move.pod, move.dir);
  const pods = state.pods.slice();
  pods[move.pod] = to;
  const flicks = state.flicks + 1;
  const moveCount = state.moveCount + 1;
  const logLength = state.logLength + 1;
  const finished = logLength >= cfg.maxMoves;
  const slid = { pod: move.pod, from, to, stop };
  if (move.pod !== state.clamp.pod || to !== state.clamp.cell) {
    const report: TugMoveReport = { move, slide: slid, delivered: null, skipped: null, clamp: null, points: 0 };
    return { ...state, pods, flicks, moveCount, logLength, lastMove: report, finished };
  }

  // The wanted pod came to rest on the clamp: grade it against par, score it, and light the next.
  const par = state.clamp.par;
  const grade = gradeAt(cfg, par, flicks);
  const combo = grade === "clean" ? state.combo + 1 : 0;
  const points = deliveryPoints(cfg, par, grade, combo);
  const level = grade === "clean" ? Math.min(levelCap(cfg), state.level + 1) : grade === "slow" ? Math.max(0, state.level - 1) : state.level;
  const delivered: TugDelivery = { pod: move.pod, cell: to, flicks, par, grade, streak: combo, streakPercent: grade === "clean" ? streakPercentAt(cfg, combo) : 100, points };
  const dealt = dealClamp(cfg, blockMask(cfg, state.blocks), pods, state.rng, wantPar(cfg, level), null);
  const report: TugMoveReport = { move, slide: slid, delivered, skipped: null, clamp: dealt.clamp, points };
  return {
    ...state,
    pods,
    clamp: dealt.clamp,
    flicks: 0,
    level,
    rng: dealt.rng,
    score: state.score + points,
    moveCount,
    logLength,
    delivered: state.delivered + 1,
    clean: state.clean + (grade === "clean" ? 1 : 0),
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    bestPar: grade === "clean" ? Math.max(state.bestPar, par) : state.bestPar,
    lastMove: report,
    finished,
  };
}

function skip(state: TugState, move: Extract<TugMove, { type: "skip" }>): TugState {
  const cfg = state.config;
  const penalty = Math.min(state.score, cfg.skipPenalty);
  const level = Math.max(0, state.level - 1);
  const dealt = dealClamp(cfg, blockMask(cfg, state.blocks), state.pods, state.rng, wantPar(cfg, level), state.clamp);
  const logLength = state.logLength + 1;
  const report: TugMoveReport = { move, slide: null, delivered: null, skipped: { clamp: state.clamp, penalty }, clamp: dealt.clamp, points: 0 - penalty };
  return {
    ...state,
    clamp: dealt.clamp,
    flicks: 0,
    level,
    rng: dealt.rng,
    score: state.score - penalty,
    logLength,
    skipped: state.skipped + 1,
    combo: 0,
    lastMove: report,
    finished: logLength >= cfg.maxMoves,
  };
}

export function replayTug(seed: string, config: TugConfig, moves: readonly TugMove[]): TugState {
  let s = createTugGame(seed, config);
  for (const m of moves) s = reduceTug(s, m);
  return s;
}

export function hashTugState(state: TugState): string {
  const h = new Hasher();
  h.int(state.blocks.length);
  for (const b of state.blocks) h.int(b);
  h.int(state.pods.length);
  for (const p of state.pods) h.int(p);
  h.int(state.clamp.pod).int(state.clamp.cell).int(state.clamp.par);
  h.int(state.flicks).int(state.level);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.score).int(state.moveCount).int(state.logLength).int(state.delivered).int(state.clean).int(state.skipped);
  h.int(state.combo).int(state.bestCombo).int(state.bestPar).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface TugSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeTug(state: TugState): TugSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/**
 * The bay as one character a cell, row by row (`.` empty, `#` a block, a digit a pod), then the lit
 * clamp as `|cell:pod`. What the board draws must match it.
 */
export function viewString(width: number, height: number, blocks: readonly number[], pods: readonly number[], clampCell: number, clampPod: number): string {
  const chars = new Array<string>(width * height).fill(".");
  for (const b of blocks) chars[b] = "#";
  pods.forEach((cell, pod) => {
    chars[cell] = String(pod);
  });
  return `${chars.join("")}|${clampCell}:${clampPod}`;
}

export function stateViewString(state: TugState): string {
  return viewString(state.config.width, state.config.height, state.blocks, state.pods, state.clamp.cell, state.clamp.pod);
}
