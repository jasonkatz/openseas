import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  ASSEMBLY_CABLE,
  ASSEMBLY_CORE,
  ASSEMBLY_GIRDER,
  ASSEMBLY_KINDS,
  ASSEMBLY_STRUT,
  DEFAULT_ASSEMBLY_CONFIG,
  type AssemblyBlueprint,
  type AssemblyConfig,
  type AssemblyFitReport,
  type AssemblyMove,
  type AssemblyMoveReport,
  type AssemblyPart,
  type AssemblyPiece,
  type AssemblyState,
  type AssemblyStreams,
  type AssemblyTaken,
  type AssemblyWay,
} from "./types.js";

export const idx = (cfg: AssemblyConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: AssemblyConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: AssemblyConfig, cell: number): number => Math.floor(cell / cfg.width);

/**
 * The pool: the sixteen blueprints a round deals, the same in every round. Each is drawn as rows,
 * one character a square: the kind's digit (0 panel, 1 girder, 2 strut, 3 cable), `.` where it has
 * no part. Six of three parts, six of four, four of five; none wider or taller than three, and every
 * kind asked for about as often as the others.
 */
const POOL_ROWS: readonly (readonly string[])[] = [
  // Three parts.
  ["123"],
  ["1", "2", "3"],
  ["10", "3."],
  ["21", ".0"],
  ["0.", "32"],
  [".2", "13"],
  // Four.
  ["12", "30"],
  ["131", ".2."],
  ["0.", "2.", "31"],
  [".3", "20", "1."],
  ["21.", ".03"],
  ["2", "0", "1", "3"],
  // Five.
  [".1.", "203", ".1."],
  ["312", "0.2"],
  ["1..", "2..", "031"],
  ["23", "10", "2."],
];

export interface AssemblyPoolPrint {
  readonly width: number;
  readonly height: number;
  readonly parts: readonly AssemblyPart[];
}

/** The pool's blueprints, in the order above; a dealt blueprint names its place here. */
export const ASSEMBLY_POOL: readonly AssemblyPoolPrint[] = POOL_ROWS.map((rows) => {
  const parts: AssemblyPart[] = [];
  rows.forEach((line, dr) => {
    for (let dc = 0; dc < line.length; dc++) if (line[dc] !== ".") parts.push({ dc, dr, kind: Number(line[dc]) });
  });
  return { width: Math.max(...rows.map((r) => r.length)), height: rows.length, parts };
});

/** Deals tried before the opening bay is made to hold a fit by construction. */
const MAX_DEALS = 40;

export function validateConfig(cfg: AssemblyConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const weights = (w: readonly number[], n: number): boolean => Array.isArray(w) && w.length === n && w.every((x) => int(x, 0, 100)) && w.some((x) => x > 0);
  const ok =
    int(cfg.width, 4, 10) &&
    int(cfg.height, 4, 12) &&
    weights(cfg.kindWeights, ASSEMBLY_KINDS) &&
    // Something must move: a bay of panels alone has no swap.
    cfg.kindWeights[ASSEMBLY_GIRDER]! + cfg.kindWeights[ASSEMBLY_STRUT]! + cfg.kindWeights[ASSEMBLY_CABLE]! > 0 &&
    int(cfg.traySize, 1, 8) &&
    int(cfg.fitPoints, 0, 1000) &&
    int(cfg.chainCap, 1, 20) &&
    int(cfg.corePoints, 0, 1000) &&
    int(cfg.maxCores, 0, 10) &&
    int(cfg.startCores, 0, cfg.maxCores) &&
    int(cfg.corePermille, 0, 500) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid assembly config");
}

/** True when a piece is a part that moves its own way or a panel: anything but a core. */
export function isPart(p: AssemblyPiece | null | undefined): p is AssemblyPiece {
  return p !== null && p !== undefined && p.kind !== ASSEMBLY_CORE;
}

/** The way a kind moves by itself, or null for a panel and a core. */
export function wayOf(kind: number): AssemblyWay | null {
  if (kind === ASSEMBLY_GIRDER) return "side";
  if (kind === ASSEMBLY_STRUT) return "up";
  if (kind === ASSEMBLY_CABLE) return "diagonal";
  return null;
}

/** How two cells lie: side by side, one over the other, corner to corner, or null when they are not neighbours. */
export function wayBetween(cfg: AssemblyConfig, a: number, b: number): AssemblyWay | null {
  const dc = colOf(cfg, b) - colOf(cfg, a);
  const dr = rowOf(cfg, b) - rowOf(cfg, a);
  if (Math.abs(dc) > 1 || Math.abs(dr) > 1 || (dc === 0 && dr === 0)) return null;
  if (dr === 0) return "side";
  if (dc === 0) return "up";
  return "diagonal";
}

/** The cells round `cell`, up to eight, clockwise from the top. */
export function neighbours(cfg: AssemblyConfig, cell: number): number[] {
  const out: number[] = [];
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  for (const [dc, dr] of [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ] as const) {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && c < cfg.width && r >= 0 && r < cfg.height) out.push(idx(cfg, c, r));
  }
  return out;
}

const inBay = (cfg: AssemblyConfig, cell: number): boolean => Number.isInteger(cell) && cell >= 0 && cell < cfg.width * cfg.height;

export function swapIllegalReason(state: AssemblyState, a: number, b: number): string | null {
  if (state.finished) return "game is finished";
  const cfg = state.config;
  if (!inBay(cfg, a) || !inBay(cfg, b)) return "no such cell";
  const way = wayBetween(cfg, a, b);
  if (way === null) return "not neighbours";
  const p = state.cells[a]!;
  const q = state.cells[b]!;
  if (!isPart(p) || !isPart(q)) return "a core never moves";
  if (p.kind === q.kind) return "the same part";
  if (wayOf(p.kind) !== way && wayOf(q.kind) !== way) return "neither part moves that way";
  return null;
}

/** Every legal swap, each pair once, the lower cell first. */
export function legalSwaps(state: AssemblyState): Array<{ a: number; b: number }> {
  const out: Array<{ a: number; b: number }> = [];
  if (state.finished) return out;
  const cfg = state.config;
  for (let a = 0; a < state.cells.length; a++) {
    for (const b of neighbours(cfg, a)) if (b > a && swapIllegalReason(state, a, b) === null) out.push({ a, b });
  }
  return out;
}

/** The cells a blueprint covers with the top left of its box on `cell`, in its parts' order; null when it hangs off the bay. */
export function coverCells(cfg: AssemblyConfig, bp: AssemblyBlueprint, cell: number): number[] | null {
  if (!inBay(cfg, cell)) return null;
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  if (col + bp.width > cfg.width || row + bp.height > cfg.height) return null;
  return bp.parts.map((p) => idx(cfg, col + p.dc, row + p.dr));
}

/** True when the piece under a blueprint's part is what it asks for: the same kind, or a core. */
const matches = (piece: AssemblyPiece, part: AssemblyPart): boolean => piece.kind === ASSEMBLY_CORE || piece.kind === part.kind;

function fitsOn(cfg: AssemblyConfig, cells: readonly AssemblyPiece[], bp: AssemblyBlueprint, cell: number): boolean {
  const cover = coverCells(cfg, bp, cell);
  if (!cover) return false;
  return bp.parts.every((part, i) => matches(cells[cover[i]!]!, part));
}

export function fitIllegalReason(state: AssemblyState, slot: number, cell: number): string | null {
  if (state.finished) return "game is finished";
  const cfg = state.config;
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.tray.length) return "no such blueprint";
  const bp = state.tray[slot]!;
  if (!coverCells(cfg, bp, cell)) return "it does not fit in the bay";
  if (!fitsOn(cfg, state.cells, bp, cell)) return "the parts do not match";
  return null;
}

/** Every fit the bay allows now: a blueprint's slot and the cell its box's top left would sit on. */
export function legalFits(state: AssemblyState): Array<{ slot: number; cell: number }> {
  const out: Array<{ slot: number; cell: number }> = [];
  if (state.finished) return out;
  const cfg = state.config;
  state.tray.forEach((bp, slot) => {
    for (let r = 0; r + bp.height <= cfg.height; r++) {
      for (let c = 0; c + bp.width <= cfg.width; c++) {
        const cell = idx(cfg, c, r);
        if (fitsOn(cfg, state.cells, bp, cell)) out.push({ slot, cell });
      }
    }
  });
  return out;
}

/** The place the next fit takes in the chain, as counted. */
export function nextPlace(state: AssemblyState): number {
  return Math.min(state.chain + 1, state.config.chainCap);
}

/** What a fit of `parts` parts with `cores` cores in it scores at `place` in a chain. */
export function fitValue(cfg: AssemblyConfig, parts: number, cores: number, place: number): number {
  const p = Math.min(Math.max(1, place), cfg.chainCap);
  return (cfg.fitPoints * Math.max(0, parts - 2) + cfg.corePoints * cores) * p;
}

/** What fitting the blueprint in `slot` on `cell` would score now, or 0 when it is not a legal fit. */
export function fitPoints(state: AssemblyState, slot: number, cell: number): number {
  if (fitIllegalReason(state, slot, cell) !== null) return 0;
  const cover = coverCells(state.config, state.tray[slot]!, cell)!;
  const cores = cover.filter((c) => state.cells[c]!.kind === ASSEMBLY_CORE).length;
  return fitValue(state.config, cover.length, cores, nextPlace(state));
}

/** A weighted roll of an index. */
function weighted(rng: PrngState, w: readonly number[]): { value: number; state: PrngState } {
  const total = w.reduce((a, b) => a + b, 0);
  const r = nextInt(rng, total);
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i]!;
    if (r.value < acc) return { value: i, state: r.state };
  }
  return { value: w.length - 1, state: r.state };
}

/** A fresh bag: the whole pool in a shuffled order, from the blueprints' own stream. */
function fillBag(rngIn: PrngState): { bag: number[]; rng: PrngState } {
  let rng = rngIn;
  const bag = ASSEMBLY_POOL.map((_, i) => i);
  for (let i = bag.length - 1; i > 0; i--) {
    const r = nextInt(rng, i + 1);
    rng = r.state;
    [bag[i], bag[r.value]] = [bag[r.value]!, bag[i]!];
  }
  return { bag, rng };
}

/**
 * Deal the next blueprint from the bag. Every blueprint of the pool comes once before any comes
 * again: when the bag is empty it is filled afresh.
 */
function drawBlueprint(bagIn: readonly number[], rngIn: PrngState, id: number): { bp: AssemblyBlueprint; bag: readonly number[]; rng: PrngState } {
  let bag = bagIn;
  let rng = rngIn;
  if (bag.length === 0) {
    const f = fillBag(rng);
    bag = f.bag;
    rng = f.rng;
  }
  const index = bag[0]!;
  const print = ASSEMBLY_POOL[index]!;
  return { bp: { id, shape: index, width: print.width, height: print.height, parts: print.parts }, bag: bag.slice(1), rng };
}

/** True when the bay holds a fit now, or after one swap: a new player can score in their first seconds. */
function fitWithinOneSwap(state: AssemblyState): boolean {
  if (legalFits(state).length > 0) return true;
  for (const s of legalSwaps(state)) {
    const cells = swapped(state.cells, s.a, s.b);
    if (legalFits({ ...state, cells }).length > 0) return true;
  }
  return false;
}

function swapped<T>(cells: readonly T[], a: number, b: number): T[] {
  const out = cells.slice();
  out[a] = cells[b]!;
  out[b] = cells[a]!;
  return out;
}

export function createAssemblyGame(seed: string, config: AssemblyConfig = DEFAULT_ASSEMBLY_CONFIG): AssemblyState {
  validateConfig(config);
  const streams: AssemblyStreams = {
    parts: seedFromString(`assembly:parts:${seed}`),
    cores: seedFromString(`assembly:cores:${seed}`),
    prints: seedFromString(`assembly:prints:${seed}`),
  };
  let nextId = 1;
  let prints = streams.prints;
  let bag: readonly number[] = [];
  const tray: AssemblyBlueprint[] = [];
  for (let s = 0; s < config.traySize; s++) {
    const d = drawBlueprint(bag, prints, nextId++);
    prints = d.rng;
    bag = d.bag;
    tray.push(d.bp);
  }
  const n = config.width * config.height;
  // The opening cores: distinct cells, from their own stream.
  let cores = streams.cores;
  const coreCells = new Set<number>();
  while (coreCells.size < config.startCores) {
    const r = nextInt(cores, n);
    cores = r.state;
    coreCells.add(r.value);
  }
  let parts = streams.parts;
  const firstId = nextId;
  let state: AssemblyState | null = null;
  for (let attempt = 0; attempt < MAX_DEALS; attempt++) {
    nextId = firstId;
    const cells: AssemblyPiece[] = [];
    for (let c = 0; c < n; c++) {
      if (coreCells.has(c)) {
        cells.push({ id: nextId++, kind: ASSEMBLY_CORE });
        continue;
      }
      const k = weighted(parts, config.kindWeights);
      parts = k.state;
      cells.push({ id: nextId++, kind: k.value });
    }
    state = {
      config,
      cells,
      tray,
      bag,
      streams: { parts, cores, prints },
      nextId,
      score: 0,
      moveCount: 0,
      swaps: 0,
      fits: 0,
      chain: 0,
      bestChain: 0,
      bigFits: 0,
      coresUsed: 0,
      lastMove: null,
      finished: false,
    };
    if (fitWithinOneSwap(state)) return state;
  }
  // The fallback passes by construction: the first blueprint's parts are laid into the top left of
  // the last deal, over anything but a core, so it fits there now.
  const s = state!;
  const cells = s.cells.slice();
  const bp = tray[0]!;
  for (const part of bp.parts) {
    const c = idx(config, part.dc, part.dr);
    if (cells[c]!.kind !== ASSEMBLY_CORE) cells[c] = { id: cells[c]!.id, kind: part.kind };
  }
  return { ...s, cells };
}

export function reduceAssembly(state: AssemblyState, move: AssemblyMove): AssemblyState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "swap":
      return swap(state, move);
    case "fit":
      return fit(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function swap(state: AssemblyState, move: Extract<AssemblyMove, { type: "swap" }>): AssemblyState {
  const reason = swapIllegalReason(state, move.a, move.b);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const moveCount = state.moveCount + 1;
  const report: AssemblyMoveReport = { move, swap: { a: move.a, b: move.b }, chainEnded: state.chain, fit: null, points: 0 };
  return {
    ...state,
    cells: swapped(state.cells, move.a, move.b),
    moveCount,
    swaps: state.swaps + 1,
    chain: 0,
    lastMove: report,
    finished: moveCount >= state.config.maxMoves,
  };
}

function fit(state: AssemblyState, move: Extract<AssemblyMove, { type: "fit" }>): AssemblyState {
  const reason = fitIllegalReason(state, move.slot, move.cell);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const cfg = state.config;
  const bp = state.tray[move.slot]!;
  const cover = coverCells(cfg, bp, move.cell)!;
  const taken: AssemblyTaken[] = cover.map((c) => ({ cell: c, id: state.cells[c]!.id, kind: state.cells[c]!.kind }));
  const cores = taken.filter((t) => t.kind === ASSEMBLY_CORE).length;
  const place = nextPlace(state);
  const points = fitValue(cfg, cover.length, cores, place);

  // The bay refills in place: each cell a fit took gets a new part, in reading order, and every
  // other part, cores among them, stays where it is.
  const cells = state.cells.slice();
  const spawned: Array<{ id: number; cell: number; kind: number }> = [];
  let { parts, cores: coreRng, prints } = state.streams;
  let nextId = state.nextId;
  let standing = cells.filter((p, c) => p.kind === ASSEMBLY_CORE && !cover.includes(c)).length;
  for (const cell of [...cover].sort((a, b) => a - b)) {
    let kind: number;
    const core = standing < cfg.maxCores && cfg.corePermille > 0 ? nextChance(coreRng, cfg.corePermille, 1000) : null;
    if (core) coreRng = core.state;
    if (core?.value) {
      kind = ASSEMBLY_CORE;
      standing++;
    } else {
      const k = weighted(parts, cfg.kindWeights);
      parts = k.state;
      kind = k.value;
    }
    const piece = { id: nextId++, kind };
    cells[cell] = piece;
    spawned.push({ id: piece.id, cell, kind });
  }
  const d = drawBlueprint(state.bag, prints, nextId++);
  prints = d.rng;
  const tray = state.tray.slice();
  tray[move.slot] = d.bp;

  const fitReport: AssemblyFitReport = { slot: move.slot, blueprint: bp, taken, place, cores, points, spawned, next: d.bp };
  const moveCount = state.moveCount + 1;
  const chain = state.chain + 1;
  return {
    config: cfg,
    cells,
    tray,
    bag: d.bag,
    streams: { parts, cores: coreRng, prints },
    nextId,
    score: state.score + points,
    moveCount,
    swaps: state.swaps,
    fits: state.fits + 1,
    chain,
    bestChain: Math.max(state.bestChain, chain),
    bigFits: state.bigFits + (cover.length >= 5 ? 1 : 0),
    coresUsed: state.coresUsed + cores,
    lastMove: { move, swap: null, chainEnded: 0, fit: fitReport, points },
    finished: moveCount >= cfg.maxMoves,
  };
}

/** A good move, for the idle hint in unrated practice: the fit worth most now, else a swap that opens the most fits. Null when neither exists. */
export function hint(state: AssemblyState): AssemblyMove | null {
  if (state.finished) return null;
  let best: AssemblyMove | null = null;
  let bestPoints = -1;
  for (const f of legalFits(state)) {
    const p = fitPoints(state, f.slot, f.cell);
    if (p > bestPoints) {
      bestPoints = p;
      best = { type: "fit", slot: f.slot, cell: f.cell };
    }
  }
  if (best) return best;
  let bestFits = 0;
  for (const s of legalSwaps(state)) {
    const n = legalFits({ ...state, cells: swapped(state.cells, s.a, s.b) }).length;
    if (n > bestFits) {
      bestFits = n;
      best = { type: "swap", a: s.a, b: s.b };
    }
  }
  return best;
}

export function replayAssembly(seed: string, config: AssemblyConfig, moves: readonly AssemblyMove[]): AssemblyState {
  let s = createAssemblyGame(seed, config);
  for (const m of moves) s = reduceAssembly(s, m);
  return s;
}

export function hashAssemblyState(state: AssemblyState): string {
  const h = new Hasher();
  h.int(state.cells.length);
  for (const p of state.cells) h.int(p.id).int(p.kind);
  h.int(state.tray.length);
  for (const bp of state.tray) {
    h.int(bp.id).int(bp.shape).int(bp.parts.length);
    for (const part of bp.parts) h.int(part.dc).int(part.dr).int(part.kind);
  }
  h.int(state.bag.length);
  for (const i of state.bag) h.int(i);
  for (const s of [state.streams.parts, state.streams.cores, state.streams.prints]) h.int(s.a).int(s.b).int(s.c).int(s.d);
  h.int(state.nextId).int(state.score).int(state.moveCount).int(state.swaps).int(state.fits).int(state.chain);
  h.int(state.bestChain).int(state.bigFits).int(state.coresUsed);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface AssemblySummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeAssembly(state: AssemblyState): AssemblySummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestChain };
}

/** A part as one character: its kind's digit, or `@` for a core. */
export function kindChar(kind: number): string {
  return kind === ASSEMBLY_CORE ? "@" : String(kind);
}

/** The bay as one character a cell, row by row. What the board draws must match it. */
export function viewString(cells: ReadonlyArray<{ readonly kind: number }>): string {
  return cells.map((p) => kindChar(p.kind)).join("");
}

/**
 * The tray as one string: each blueprint as its box's width and height, then a character a cell of
 * the box (a kind's digit, `.` where it has no part), blueprints joined by `|`.
 */
export function trayString(tray: readonly AssemblyBlueprint[]): string {
  return tray
    .map((bp) => {
      const box = new Array<string>(bp.width * bp.height).fill(".");
      for (const p of bp.parts) box[p.dr * bp.width + p.dc] = String(p.kind);
      return `${bp.width}${bp.height}${box.join("")}`;
    })
    .join("|");
}
