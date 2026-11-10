import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_SALVAGE_CONFIG,
  SALVAGE_COUPLER,
  SALVAGE_CRATE,
  type SalvageConfig,
  type SalvageHauled,
  type SalvageMove,
  type SalvageMoveReport,
  type SalvagePiece,
  type SalvageRound,
  type SalvageState,
  type SalvageValue,
} from "./types.js";

export const idx = (cfg: SalvageConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: SalvageConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: SalvageConfig, cell: number): number => Math.floor(cell / cfg.width);

/** A settle that keeps finding crates on the floor stops after this many rounds; what is left waits for the next haul. */
const MAX_ROUNDS = 12;
/** How many steps the hint's search may take before it settles for the best line it has. */
const HINT_BUDGET = 6000;

export function validateConfig(cfg: SalvageConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 3, 12) &&
    int(cfg.height, 3, 12) &&
    int(cfg.kinds, 2, 8) &&
    int(cfg.minLine, 2, 5) &&
    int(cfg.linePoints, 0, 1000) &&
    int(cfg.loopMin, 3, 12) &&
    int(cfg.loopPercent, 100, 1000) &&
    int(cfg.enclosedPoints, 0, 10_000) &&
    int(cfg.startCrates, 0, cfg.width) &&
    int(cfg.cratePermille, 0, 500) &&
    int(cfg.maxCrates, 0, cfg.width) &&
    cfg.startCrates <= cfg.maxCrates &&
    int(cfg.crateFloorPoints, 0, 100_000) &&
    int(cfg.crateLoopPoints, 0, 100_000) &&
    int(cfg.couplerPermille, 0, 500) &&
    int(cfg.maxCouplers, 0, 8) &&
    int(cfg.streakMin, 2, 20) &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid salvage config");
}

/** True when two cells touch, diagonals included. */
export function adjacent(cfg: SalvageConfig, a: number, b: number): boolean {
  if (a === b) return false;
  return Math.abs(colOf(cfg, a) - colOf(cfg, b)) <= 1 && Math.abs(rowOf(cfg, a) - rowOf(cfg, b)) <= 1;
}

/** True when a line may run from one piece to the next: the same kind of debris, or either is a coupler. A crate never links. */
export function canLink(a: SalvagePiece, b: SalvagePiece): boolean {
  if (a.kind === SALVAGE_CRATE || b.kind === SALVAGE_CRATE) return false;
  return a.kind === SALVAGE_COUPLER || b.kind === SALVAGE_COUPLER || a.kind === b.kind;
}

/** True when the line `cells` could take `next` as its next piece: in the field, touching the last, linkable, and not on the line already. */
export function canExtend(state: SalvageState, cells: readonly number[], next: number): boolean {
  const last = cells[cells.length - 1];
  if (last === undefined || !Number.isInteger(next) || next < 0 || next >= state.cells.length) return false;
  if (cells.includes(next) || !adjacent(state.config, last, next)) return false;
  return canLink(state.cells[last]!, state.cells[next]!);
}

/** True when the line could close back onto its first piece: long enough, its ends touching and linkable. */
export function canClose(state: SalvageState, cells: readonly number[]): boolean {
  if (cells.length < state.config.loopMin) return false;
  const first = cells[0]!;
  const last = cells[cells.length - 1]!;
  return adjacent(state.config, last, first) && canLink(state.cells[last]!, state.cells[first]!);
}

export function lineIllegalReason(state: SalvageState, cells: readonly number[], loop: boolean): string | null {
  if (state.finished) return "game is finished";
  if (!Array.isArray(cells)) return "no line";
  if (cells.length < state.config.minLine) return "line too short";
  if (cells.length > state.cells.length) return "line too long";
  const seen = new Set<number>();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    if (!Number.isInteger(c) || c < 0 || c >= state.cells.length) return "no such cell";
    if (seen.has(c)) return "a piece twice";
    seen.add(c);
    const piece = state.cells[c]!;
    if (piece.kind === SALVAGE_CRATE) return "a crate cannot be tethered";
    if (i > 0) {
      const prev = cells[i - 1]!;
      if (!adjacent(state.config, prev, c)) return "pieces do not touch";
      if (!canLink(state.cells[prev]!, piece)) return "pieces do not match";
    }
  }
  if (loop && !canClose(state, cells)) return "the line does not close";
  return null;
}

/**
 * The cells strictly inside the closed line through `cells` (the last joined back to the first).
 * Even-odd rule on the polygon through the cells' centres, in integers: a ray cast right from a
 * cell's centre crosses an edge exactly when the edge steps between that row and the row below it,
 * at the x of the edge's end on that row.
 */
export function enclosedCells(cfg: SalvageConfig, cells: readonly number[]): number[] {
  if (cells.length < 3) return [];
  const on = new Set(cells);
  const out: number[] = [];
  for (let cell = 0; cell < cfg.width * cfg.height; cell++) {
    if (on.has(cell)) continue;
    const cx = colOf(cfg, cell);
    const cy = rowOf(cfg, cell);
    let crossings = 0;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i]!;
      const b = cells[(i + 1) % cells.length]!;
      const ay = rowOf(cfg, a);
      const by = rowOf(cfg, b);
      if (ay > cy === by > cy) continue;
      // One end is on this row and the other on the row below: the edge meets the ray at the end on this row.
      const x = ay === cy ? colOf(cfg, a) : colOf(cfg, b);
      if (x > cx) crossings++;
    }
    if (crossings % 2 === 1) out.push(cell);
  }
  return out;
}

/** What a legal line is worth before the streak. The board shows this while the line is drawn; the reducer scores with it. */
export function lineValue(state: SalvageState, cells: readonly number[], loop: boolean): SalvageValue {
  const cfg = state.config;
  const n = cells.length;
  const isLoop = loop && canClose(state, cells);
  const line = cfg.linePoints * n * n;
  if (!isLoop) return { length: n, loop: false, enclosed: [], netted: [], base: line };
  // A crate inside the loop is netted like any other; only debris counts as enclosed.
  const enclosed = enclosedCells(cfg, cells).filter((c) => state.cells[c]!.kind !== SALVAGE_CRATE);
  const netted: number[] = [];
  for (let c = 0; c < state.cells.length; c++) if (state.cells[c]!.kind === SALVAGE_CRATE) netted.push(c);
  const base = Math.floor((line * cfg.loopPercent) / 100) + enclosed.length * cfg.enclosedPoints + cfg.crateLoopPoints * netted.length * netted.length;
  return { length: n, loop: true, enclosed, netted, base };
}

/** What the streak multiplies by, in percent, at a streak of `streak` long lines. */
export function streakPercentAt(cfg: SalvageConfig, streak: number): number {
  if (streak <= 0) return 100;
  return cfg.streakPercent[Math.min(streak, cfg.streakPercent.length) - 1]!;
}

/** True when some line of minLine pieces can still be drawn. */
export function hasLine(cfg: SalvageConfig, cells: readonly SalvagePiece[]): boolean {
  const path: number[] = [];
  const walk = (cell: number): boolean => {
    path.push(cell);
    if (path.length >= cfg.minLine) return true;
    for (const next of neighbours(cfg, cell)) {
      if (path.includes(next) || !canLink(cells[cell]!, cells[next]!)) continue;
      if (walk(next)) return true;
    }
    path.pop();
    return false;
  };
  for (let c = 0; c < cells.length; c++) {
    if (cells[c]!.kind === SALVAGE_CRATE) continue;
    path.length = 0;
    if (walk(c)) return true;
  }
  return false;
}

/** The cells touching `cell`, clockwise from the one above. */
function neighbours(cfg: SalvageConfig, cell: number): number[] {
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  const out: number[] = [];
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

/**
 * A long line on the field, for the idle hint in unrated practice: the longest a bounded
 * depth-first search finds, so it is good, not always the best. Null when no line can be drawn.
 */
export function hint(state: SalvageState): number[] | null {
  const cfg = state.config;
  let best: number[] = [];
  let budget = HINT_BUDGET;
  const path: number[] = [];
  const walk = (cell: number): void => {
    path.push(cell);
    if (path.length > best.length) best = path.slice();
    for (const next of neighbours(cfg, cell)) {
      if (budget <= 0) break;
      if (path.includes(next) || !canLink(state.cells[cell]!, state.cells[next]!)) continue;
      budget--;
      walk(next);
    }
    path.pop();
  };
  for (let c = 0; c < state.cells.length && budget > 0; c++) {
    if (state.cells[c]!.kind === SALVAGE_CRATE) continue;
    walk(c);
  }
  return best.length >= cfg.minLine ? best : null;
}

/**
 * A line on the field that can close into a loop, or null: the first a bounded search finds, short
 * ones first. For the seed finder and the idle hint; a player will often see a better one.
 */
export function findLoop(state: SalvageState): number[] | null {
  const cfg = state.config;
  let budget = HINT_BUDGET * 4;
  const path: number[] = [];
  for (let limit = cfg.loopMin; limit <= cfg.loopMin + 3; limit++) {
    const walk = (cell: number): boolean => {
      path.push(cell);
      if (path.length >= cfg.loopMin && canClose(state, path)) return true;
      if (path.length < limit) {
        for (const next of neighbours(cfg, cell)) {
          if (budget-- <= 0) break;
          if (path.includes(next) || !canLink(state.cells[cell]!, state.cells[next]!)) continue;
          if (walk(next)) return true;
        }
      }
      path.pop();
      return false;
    };
    for (let c = 0; c < state.cells.length && budget > 0; c++) {
      if (state.cells[c]!.kind === SALVAGE_CRATE) continue;
      path.length = 0;
      if (walk(c)) return path.slice();
    }
  }
  return null;
}

function count(cells: ReadonlyArray<SalvagePiece | null>, kind: number): number {
  let n = 0;
  for (const p of cells) if (p?.kind === kind) n++;
  return n;
}

/** Deal debris into every cell that is not a crate or a coupler, until a line can be drawn. */
function dealDebris(cfg: SalvageConfig, cells: SalvagePiece[], rng: PrngState, nextId: number): { rng: PrngState; nextId: number } {
  for (let attempt = 0; attempt < 50; attempt++) {
    for (let c = 0; c < cells.length; c++) {
      const kind = cells[c]?.kind;
      if (kind === SALVAGE_CRATE || kind === SALVAGE_COUPLER) continue;
      const k = nextInt(rng, cfg.kinds);
      rng = k.state;
      cells[c] = { id: nextId++, kind: k.value };
    }
    if (hasLine(cfg, cells)) return { rng, nextId };
  }
  // Fifty deals without one line of three does not happen on any board worth playing; make one anyway.
  for (let c = 0; c < Math.min(cells.length, cfg.minLine); c++) cells[c] = { id: nextId++, kind: 0 };
  return { rng, nextId };
}

export function createSalvageGame(seed: string, config: SalvageConfig = DEFAULT_SALVAGE_CONFIG): SalvageState {
  validateConfig(config);
  let rng = seedFromString(`salvage:${seed}`);
  let nextId = 1;
  const cells = new Array<SalvagePiece>(config.width * config.height);
  // Crates open in the upper rows, so each has debris under it to be dug out or ringed.
  const free: number[] = [];
  for (let c = 0; c < config.width * Math.max(1, config.height - 2); c++) free.push(c);
  for (let n = 0; n < config.startCrates && free.length > 0; n++) {
    const pick = nextInt(rng, free.length);
    rng = pick.state;
    const cell = free.splice(pick.value, 1)[0]!;
    cells[cell] = { id: nextId++, kind: SALVAGE_CRATE };
  }
  const dealt = dealDebris(config, cells, rng, nextId);
  return {
    config,
    cells,
    rng: dealt.rng,
    nextId: dealt.nextId,
    score: 0,
    moveCount: 0,
    combo: 0,
    bestCombo: 0,
    grace: false,
    hauled: 0,
    cratesNetted: 0,
    cratesFloor: 0,
    loops: 0,
    longest: 0,
    lastMove: null,
    finished: false,
  };
}

interface Settled {
  cells: SalvagePiece[];
  falls: Array<{ id: number; from: number; to: number }>;
  spawned: Array<{ id: number; cell: number; kind: number; drop: number }>;
  rng: PrngState;
  nextId: number;
}

/** Let every piece fall into the gaps under it, then fill each column from the top with new debris. */
function settle(cfg: SalvageConfig, field: ReadonlyArray<SalvagePiece | null>, rngIn: PrngState, nextIdIn: number): Settled {
  let rng = rngIn;
  let nextId = nextIdIn;
  const cells = new Array<SalvagePiece>(field.length);
  const falls: Settled["falls"] = [];
  const spawned: Settled["spawned"] = [];
  let crates = count(field, SALVAGE_CRATE);
  let couplers = count(field, SALVAGE_COUPLER);
  for (let col = 0; col < cfg.width; col++) {
    let row = cfg.height - 1;
    for (let r = cfg.height - 1; r >= 0; r--) {
      const piece = field[idx(cfg, col, r)];
      if (!piece) continue;
      const to = idx(cfg, col, row);
      cells[to] = piece;
      if (r !== row) falls.push({ id: piece.id, from: idx(cfg, col, r), to });
      row--;
    }
    const gaps = row + 1;
    for (let r = row; r >= 0; r--) {
      let kind: number;
      // A crate never drifts in onto the floor: it has to be worked for.
      const crate = crates < cfg.maxCrates && r < cfg.height - 1 ? nextChance(rng, cfg.cratePermille, 1000) : null;
      if (crate) rng = crate.state;
      if (crate?.value) {
        kind = SALVAGE_CRATE;
        crates++;
      } else {
        const coupler = couplers < cfg.maxCouplers ? nextChance(rng, cfg.couplerPermille, 1000) : null;
        if (coupler) rng = coupler.state;
        if (coupler?.value) {
          kind = SALVAGE_COUPLER;
          couplers++;
        } else {
          const k = nextInt(rng, cfg.kinds);
          rng = k.state;
          kind = k.value;
        }
      }
      const cell = idx(cfg, col, r);
      const piece = { id: nextId++, kind };
      cells[cell] = piece;
      spawned.push({ id: piece.id, cell, kind, drop: gaps });
    }
  }
  return { cells, falls, spawned, rng, nextId };
}

export function reduceSalvage(state: SalvageState, move: SalvageMove): SalvageState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "tether":
      return haul(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function haul(state: SalvageState, move: Extract<SalvageMove, { type: "tether" }>): SalvageState {
  const cfg = state.config;
  const reason = lineIllegalReason(state, move.cells, move.loop);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const value = lineValue(state, move.cells, move.loop);

  // A long line builds the streak; a short one spends its grace, and a second short one in a row breaks it.
  let combo = state.combo;
  let grace = state.grace;
  if (value.length >= cfg.streakMin) {
    combo += 1;
    grace = true;
  } else if (combo > 0 && grace) grace = false;
  else {
    combo = 0;
    grace = false;
  }
  const percent = streakPercentAt(cfg, combo);
  const haulPoints = Math.floor((value.base * percent) / 100);

  const taken = (cell: number): SalvageHauled => ({ cell, id: state.cells[cell]!.id, kind: state.cells[cell]!.kind });
  const line = move.cells.map(taken);
  const enclosed = value.enclosed.map(taken);
  const netted = value.netted.map(taken);
  let field: Array<SalvagePiece | null> = state.cells.slice();
  for (const h of line) field[h.cell] = null;
  for (const h of enclosed) field[h.cell] = null;
  for (const h of netted) field[h.cell] = null;

  let rng = state.rng;
  let nextId = state.nextId;
  let cells: SalvagePiece[] = [];
  let floor: SalvageHauled[] = [];
  let floorPoints = 0;
  let cratesFloor = 0;
  const rounds: SalvageRound[] = [];
  for (let n = 0; n < MAX_ROUNDS; n++) {
    const s = settle(cfg, field, rng, nextId);
    rng = s.rng;
    nextId = s.nextId;
    cells = s.cells;
    const points = Math.floor((floor.length * cfg.crateFloorPoints * percent) / 100);
    rounds.push({ floor, points, falls: s.falls, spawned: s.spawned, cells });
    floorPoints += points;
    cratesFloor += floor.length;
    // Crates that have sunk to the floor are taken next, and the field settles again.
    floor = [];
    for (let col = 0; col < cfg.width; col++) {
      const cell = idx(cfg, col, cfg.height - 1);
      if (cells[cell]!.kind === SALVAGE_CRATE) floor.push({ cell, id: cells[cell]!.id, kind: SALVAGE_CRATE });
    }
    if (floor.length === 0) break;
    field = cells.slice();
    for (const h of floor) field[h.cell] = null;
  }

  let shuffled = false;
  if (!hasLine(cfg, cells)) {
    const next = cells.slice();
    const dealt = dealDebris(cfg, next, rng, nextId);
    rng = dealt.rng;
    nextId = dealt.nextId;
    cells = next;
    shuffled = true;
  }

  const points = haulPoints + floorPoints;
  const report: SalvageMoveReport = { move, line, loop: value.loop, enclosed, netted, streak: combo, streakPercent: percent, haulPoints, rounds, shuffled, points };
  const moveCount = state.moveCount + 1;
  return {
    config: cfg,
    cells,
    rng,
    nextId,
    score: state.score + points,
    moveCount,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    grace,
    hauled: state.hauled + line.length + enclosed.length + netted.length + cratesFloor,
    cratesNetted: state.cratesNetted + netted.length,
    cratesFloor: state.cratesFloor + cratesFloor,
    loops: state.loops + (value.loop ? 1 : 0),
    longest: Math.max(state.longest, value.length),
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
}

export function hashSalvageState(state: SalvageState): string {
  const h = new Hasher();
  h.int(state.cells.length);
  for (const p of state.cells) h.int(p.id).int(p.kind);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.score).int(state.moveCount).int(state.combo).int(state.bestCombo).int(state.grace ? 1 : 0);
  h.int(state.hauled).int(state.cratesNetted).int(state.cratesFloor).int(state.loops).int(state.longest).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface SalvageSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeSalvage(state: SalvageState): SalvageSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/** The field as one character a cell, row by row: a digit for debris, `C` for a crate, `W` for a coupler. What the board draws must match it. */
export function viewString(cells: ReadonlyArray<{ readonly kind: number }>): string {
  return cells.map((p) => kindChar(p.kind)).join("");
}

export function kindChar(kind: number): string {
  return kind === SALVAGE_CRATE ? "C" : kind === SALVAGE_COUPLER ? "W" : String(kind);
}
