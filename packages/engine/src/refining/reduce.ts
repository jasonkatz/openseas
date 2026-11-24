import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_REFINING_CONFIG,
  REFINING_CATALYST,
  REFINING_DIRS,
  REFINING_OIL,
  REFINING_SMOKE,
  REFINING_TAR,
  REFINING_VAPOUR,
  type RefiningConfig,
  type RefiningDir,
  type RefiningDrawValue,
  type RefiningEvent,
  type RefiningGrade,
  type RefiningKind,
  type RefiningMove,
  type RefiningMoveReport,
  type RefiningPiece,
  type RefiningSmoke,
  type RefiningState,
} from "./types.js";

export const idx = (cfg: RefiningConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: RefiningConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: RefiningConfig, cell: number): number => Math.floor(cell / cfg.width);

export function validateConfig(cfg: RefiningConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 3, 10) &&
    int(cfg.height, 3, 10) &&
    int(cfg.vapourPermille, 1, 1000) &&
    int(cfg.oilPermille, 0, 1000) &&
    cfg.vapourPermille + cfg.oilPermille <= 1000 &&
    int(cfg.catalystPermille, 0, 300) &&
    int(cfg.clearPoints, 0, 10_000) &&
    int(cfg.runCap, 1, 50) &&
    int(cfg.smoothPoints, 0, 10_000) &&
    int(cfg.catalystPoints, 0, 10_000) &&
    int(cfg.foulPoints, 0, 10_000) &&
    int(cfg.smokeEvery, 0, 100) &&
    int(cfg.pulseTicks, 5, 10_000) &&
    int(cfg.tickMs, 20, 5000) &&
    int(cfg.maxTick, 1, 100_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid refining config");
}

/** Where a kind stands in the cycle vapour, oil, tar; null for a catalyst, which never swaps. Smoke stands as vapour. */
export function cyclePos(kind: RefiningKind): number | null {
  if (kind === REFINING_CATALYST) return null;
  return kind === REFINING_SMOKE ? 0 : kind;
}

/**
 * True when column `col` sits half a piece low. A column keeps its height as it moves right, so the
 * answer turns over with every draw: the column at the outlet is the one that entered `width - 1`
 * draws ago.
 */
export function lowered(state: Pick<RefiningState, "draws">, col: number): boolean {
  return ((col + state.draws) & 1) === 1;
}

/** The cell a swap from `cell` going `dir` pairs it with, or null off the board. */
export function partner(state: Pick<RefiningState, "config" | "draws">, cell: number, dir: RefiningDir): number | null {
  const cfg = state.config;
  const col = colOf(cfg, cell);
  const row = rowOf(cfg, cell);
  if (col >= cfg.width - 1) return null;
  // From a low column the right-hand neighbours are rows `row` (up) and `row + 1` (down); from a high one, `row - 1` and `row`.
  const low = lowered(state, col);
  const r = dir === "upRight" ? (low ? row : row - 1) : low ? row + 1 : row;
  return r >= 0 && r < cfg.height ? idx(cfg, col + 1, r) : null;
}

/** Every neighbour of `cell`, as the pair a swap would make: the first cell (the one to the left) and its direction. */
export function neighbours(state: Pick<RefiningState, "config" | "draws">, cell: number): Array<{ other: number; first: number; dir: RefiningDir }> {
  const out: Array<{ other: number; first: number; dir: RefiningDir }> = [];
  const n = state.config.width * state.config.height;
  for (const dir of REFINING_DIRS) {
    const o = partner(state, cell, dir);
    if (o !== null) out.push({ other: o, first: cell, dir });
  }
  // The pairs where `cell` is the second: found from each candidate's own side.
  for (let c = 0; c < n; c++) {
    if (c === cell) continue;
    for (const dir of REFINING_DIRS) if (partner(state, c, dir) === cell) out.push({ other: c, first: c, dir });
  }
  return out;
}

/** The pair two neighbouring cells make, as its first cell and direction; null when they do not touch. */
export function pairOf(state: Pick<RefiningState, "config" | "draws">, a: number, b: number): { cell: number; dir: RefiningDir } | null {
  for (const dir of REFINING_DIRS) {
    if (partner(state, a, dir) === b) return { cell: a, dir };
    if (partner(state, b, dir) === a) return { cell: b, dir };
  }
  return null;
}

/**
 * True when a diagonal pair may swap, given its upper and its lower piece: vapour over tar, tar over
 * oil, oil over vapour. Each fraction so rises past one partner and sinks past another, the same
 * everywhere: the lower is the one before the upper in the cycle vapour, oil, tar.
 */
export function linked(upper: RefiningKind, lower: RefiningKind): boolean {
  const a = cyclePos(upper);
  const b = cyclePos(lower);
  return a !== null && b !== null && b === (a + 2) % 3;
}

/** True when the pair `cell` makes going `dir` may swap: from `cell`, up-right puts its partner above it, down-right below. */
export function pairLinked(state: Pick<RefiningState, "config" | "draws" | "cells">, cell: number, dir: RefiningDir): boolean {
  const other = partner(state, cell, dir);
  if (other === null) return false;
  const a = state.cells[cell]!.kind;
  const b = state.cells[other]!.kind;
  return dir === "upRight" ? linked(b, a) : linked(a, b);
}

export function swapIllegalReason(state: RefiningState, cell: number, dir: RefiningDir): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) return "no such cell";
  if (!REFINING_DIRS.includes(dir)) return "no such direction";
  const other = partner(state, cell, dir);
  if (other === null) return "off the tower";
  if (!pairLinked(state, cell, dir)) return "not linked";
  return null;
}

/** Every legal swap on the board, as its first cell and direction. */
export function links(state: RefiningState): Array<{ cell: number; dir: RefiningDir }> {
  const out: Array<{ cell: number; dir: RefiningDir }> = [];
  for (let c = 0; c < state.cells.length; c++) {
    for (const dir of REFINING_DIRS) {
      if (pairLinked(state, c, dir)) out.push({ cell: c, dir });
    }
  }
  return out;
}

/** One piece of fresh feed: a catalyst by its own stream, else a fraction by the feed's weights. */
function feedPiece(cfg: RefiningConfig, feed: PrngState, cat: PrngState): { feed: PrngState; cat: PrngState; kind: RefiningKind } {
  const c = nextChance(cat, cfg.catalystPermille, 1000);
  const f = nextInt(feed, 1000);
  if (c.value) return { feed: f.state, cat: c.state, kind: REFINING_CATALYST };
  const kind: RefiningKind = f.value < cfg.vapourPermille ? REFINING_VAPOUR : f.value < cfg.vapourPermille + cfg.oilPermille ? REFINING_OIL : REFINING_TAR;
  return { feed: f.state, cat: c.state, kind };
}

export function createRefiningGame(seed: string, config: RefiningConfig = DEFAULT_REFINING_CONFIG): RefiningState {
  validateConfig(config);
  let deal = seedFromString(`refining:${seed}:deal`);
  let dealCat = seedFromString(`refining:${seed}:deal-catalyst`);
  const cells: RefiningPiece[] = [];
  for (let c = 0; c < config.width * config.height; c++) {
    const p = feedPiece(config, deal, dealCat);
    deal = p.feed;
    dealCat = p.cat;
    cells.push({ id: c + 1, kind: p.kind });
  }
  return {
    config,
    tick: 0,
    cells,
    rng: seedFromString(`refining:${seed}:feed`),
    catalystRng: seedFromString(`refining:${seed}:catalyst`),
    nextId: cells.length + 1,
    nextDraw: config.pulseTicks,
    run: 0,
    bestRun: 0,
    spilled: 0,
    eventSeq: 0,
    events: [],
    score: 0,
    moveCount: 0,
    logLength: 0,
    draws: 0,
    clears: 0,
    smooths: 0,
    fouls: 0,
    dumps: 0,
    spills: 0,
    lastMove: null,
    finished: false,
  };
}

/** The pieces of one column, top to bottom. */
export function column(state: Pick<RefiningState, "config" | "cells">, col: number): RefiningPiece[] {
  const out: RefiningPiece[] = [];
  for (let r = 0; r < state.config.height; r++) out.push(state.cells[idx(state.config, col, r)]!);
  return out;
}

/** How a column of these kinds leaves, with a clear run of `run` behind it. Uses no randomness. */
export function gradeColumn(cfg: RefiningConfig, kinds: readonly RefiningKind[], run: number): RefiningDrawValue {
  let vapour = 0;
  let oil = 0;
  let tar = 0;
  let smoke = 0;
  let catalysts = 0;
  for (const k of kinds) {
    if (k === REFINING_VAPOUR) vapour++;
    else if (k === REFINING_OIL) oil++;
    else if (k === REFINING_TAR) tar++;
    else if (k === REFINING_SMOKE) smoke++;
    else catalysts++;
  }
  const up = tar <= vapour + smoke;
  let grade: RefiningGrade;
  let points = 0;
  let nextRun = 0;
  if (!up) {
    grade = vapour === 0 ? "dump" : "spill";
    nextRun = vapour === 0 ? run : 0;
  } else if (tar === 0 && smoke === 0 && oil === 0 && vapour > 0) {
    grade = "clear";
    nextRun = run + 1;
    points = cfg.clearPoints * Math.min(nextRun, cfg.runCap) + cfg.catalystPoints * catalysts;
  } else if (tar === 0 && smoke === 0 && vapour > oil) {
    grade = "smooth";
    points = cfg.smoothPoints + cfg.catalystPoints * catalysts;
  } else if (tar === 0 && smoke === 0) {
    grade = "plain";
  } else {
    grade = "foul";
    points = -cfg.foulPoints * (tar + smoke);
  }
  return { up, grade, run: nextRun, points, spilled: up ? 0 : vapour, catalysts };
}

/** What drawing the outlet would do right now. For the board's strip and the bots; asking changes nothing. */
export function drawValue(state: RefiningState): RefiningDrawValue {
  return gradeColumn(
    state.config,
    column(state, state.config.width - 1).map((p) => p.kind),
    state.run,
  );
}

/** What the k-th clear column of a run pays, before catalysts. */
export function clearValue(cfg: RefiningConfig, k: number): number {
  return cfg.clearPoints * Math.min(Math.max(1, k), cfg.runCap);
}

/** Draw the outlet: score it, move every column right, feed a fresh one in at the left, and place any smoke. */
function draw(state: RefiningState, tick: number, early: boolean, seq: number): { state: RefiningState; event: RefiningEvent } {
  const cfg = state.config;
  const out = column(state, cfg.width - 1);
  const value = gradeColumn(
    cfg,
    out.map((p) => p.kind),
    state.run,
  );
  const score = Math.max(0, state.score + value.points);
  const points = score - state.score;

  let feed = state.rng;
  let cat = state.catalystRng;
  let nextId = state.nextId;
  const fresh: RefiningPiece[] = [];
  for (let r = 0; r < cfg.height; r++) {
    const p = feedPiece(cfg, feed, cat);
    feed = p.feed;
    cat = p.cat;
    fresh.push({ id: nextId++, kind: p.kind });
  }
  const cells: RefiningPiece[] = new Array<RefiningPiece>(state.cells.length);
  for (let r = 0; r < cfg.height; r++) {
    cells[idx(cfg, 0, r)] = fresh[r]!;
    for (let c = 1; c < cfg.width; c++) cells[idx(cfg, c, r)] = state.cells[idx(cfg, c - 1, r)]!;
  }

  // Every smokeEvery-th vapour spilled comes back as smoke, in place of the top vapour nearest the outlet.
  const smoke: RefiningSmoke[] = [];
  const spilledBefore = state.spilled;
  const spilled = spilledBefore + value.spilled;
  if (cfg.smokeEvery > 0) {
    const made = Math.floor(spilled / cfg.smokeEvery) - Math.floor(spilledBefore / cfg.smokeEvery);
    for (let n = 0; n < made; n++) {
      let placed = false;
      for (let c = cfg.width - 1; c >= 0 && !placed; c--) {
        for (let r = 0; r < cfg.height; r++) {
          const at = idx(cfg, c, r);
          if (cells[at]!.kind !== REFINING_VAPOUR) continue;
          const id = nextId++;
          smoke.push({ cell: at, was: cells[at]!.id, id });
          cells[at] = { id, kind: REFINING_SMOKE };
          placed = true;
          break;
        }
      }
    }
  }

  const g = value.grade;
  const event: RefiningEvent = { seq, tick, type: "draw", early, column: out, value, points, fresh, smoke };
  return {
    state: {
      ...state,
      cells,
      rng: feed,
      catalystRng: cat,
      nextId,
      nextDraw: tick + cfg.pulseTicks,
      run: value.run,
      bestRun: Math.max(state.bestRun, value.run),
      spilled,
      eventSeq: seq,
      score,
      draws: state.draws + 1,
      clears: state.clears + (g === "clear" ? 1 : 0),
      smooths: state.smooths + (g === "smooth" ? 1 : 0),
      fouls: state.fouls + (g === "foul" ? 1 : 0),
      dumps: state.dumps + (g === "dump" ? 1 : 0),
      spills: state.spills + (g === "spill" ? 1 : 0),
    },
    event,
  };
}

/** Every draw the clock makes up to and including `tick`. */
function drawsDue(state: RefiningState, tick: number): { state: RefiningState; events: RefiningEvent[] } {
  let s = state;
  const events: RefiningEvent[] = [];
  // The clock draws once every pulseTicks, so the round's length bounds the loop.
  while (s.nextDraw <= tick && s.nextDraw <= s.config.maxTick) {
    const r = draw(s, s.nextDraw, false, s.eventSeq + 1);
    s = r.state;
    events.push(r.event);
  }
  return { state: s, events };
}

/** The state at a later tick, without logging a move: the draws the clock made by then, appended to `events`. Clients call this to show time passing. */
export function advanceRefining(state: RefiningState, tick: number): RefiningState {
  if (tick <= state.tick || state.finished) return state;
  const at = Math.min(tick, state.config.maxTick);
  if (at <= state.tick) return state;
  const due = drawsDue(state, at);
  return { ...due.state, tick: at, events: due.events.length > 0 ? [...state.events, ...due.events] : state.events };
}

/** Ticks until the clock draws, from the state's tick. */
export function ticksToDraw(state: RefiningState): number {
  return Math.max(0, state.nextDraw - state.tick);
}

export function reduceRefining(state: RefiningState, move: RefiningMove): RefiningState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  // An end may come without a tick: the round then ends where it stands.
  const tick = move.type === "end" && move.tick === undefined ? state.tick : move.tick;
  if (tick === undefined || !Number.isInteger(tick) || tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
  if (tick > state.config.maxTick) throw new InvalidMoveError("tick beyond the round", move);
  const cfg = state.config;
  const due = drawsDue(state, tick);
  let next: RefiningState = { ...due.state, tick };
  const events: RefiningEvent[] = due.events;
  let ended = false;
  switch (move.type) {
    case "wait":
      break;
    case "end":
      ended = true;
      break;
    case "swap": {
      const reason = swapIllegalReason(next, move.cell, move.dir);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      const other = partner(next, move.cell, move.dir)!;
      const cells = next.cells.slice();
      cells[move.cell] = next.cells[other]!;
      cells[other] = next.cells[move.cell]!;
      const seq = next.eventSeq + 1;
      events.push({ seq, tick, type: "swap", a: move.cell, b: other });
      next = { ...next, cells, eventSeq: seq, moveCount: next.moveCount + 1 };
      break;
    }
    case "draw": {
      const r = draw(next, tick, true, next.eventSeq + 1);
      events.push(r.event);
      next = { ...r.state, moveCount: r.state.moveCount + 1 };
      break;
    }
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
  const logLength = state.logLength + 1;
  const report: RefiningMoveReport = { move, events, points: next.score - state.score };
  return { ...next, events, logLength, lastMove: report, finished: ended || logLength >= cfg.maxMoves || next.tick >= cfg.maxTick };
}

/**
 * How well sorted the tower is, for the hint and the bots: each column is worth the square of its
 * larger side, vapour or the rest, weighted towards the outlet. A column all one side is worth most.
 */
export function sortedness(state: Pick<RefiningState, "config" | "cells">): number {
  const cfg = state.config;
  let total = 0;
  for (let c = 0; c < cfg.width; c++) {
    let v = 0;
    let rest = 0;
    for (let r = 0; r < cfg.height; r++) {
      const k = state.cells[idx(cfg, c, r)]!.kind;
      if (k === REFINING_VAPOUR) v++;
      else if (k !== REFINING_CATALYST) rest++;
    }
    const side = Math.max(v, rest);
    total += (c + 1) * side * side;
  }
  return total;
}

/** The board after a swap, without logging it. Null when the swap is illegal. */
export function afterSwap(state: RefiningState, cell: number, dir: RefiningDir): RefiningState | null {
  if (swapIllegalReason(state, cell, dir) !== null) return null;
  const other = partner(state, cell, dir)!;
  const cells = state.cells.slice();
  cells[cell] = state.cells[other]!;
  cells[other] = state.cells[cell]!;
  return { ...state, cells };
}

/** A swap worth making, for the idle hint in unrated practice: the one that sorts the tower most. Null when none helps. */
export function hint(state: RefiningState): { cell: number; dir: RefiningDir } | null {
  const base = sortedness(state);
  let best: { cell: number; dir: RefiningDir; gain: number } | null = null;
  for (const l of links(state)) {
    const after = afterSwap(state, l.cell, l.dir)!;
    const gain = sortedness(after) - base;
    if (gain > 0 && (!best || gain > best.gain)) best = { ...l, gain };
  }
  return best ? { cell: best.cell, dir: best.dir } : null;
}

export function replayRefining(seed: string, config: RefiningConfig, moves: readonly RefiningMove[]): RefiningState {
  let s = createRefiningGame(seed, config);
  for (const m of moves) s = reduceRefining(s, m);
  return s;
}

export function hashRefiningState(state: RefiningState): string {
  const h = new Hasher();
  h.int(state.config.width).int(state.config.height).int(state.tick);
  for (const c of state.cells) h.int(c.id).int(c.kind);
  for (const r of [state.rng, state.catalystRng]) h.int(r.a).int(r.b).int(r.c).int(r.d);
  h.int(state.nextId).int(state.nextDraw).int(state.run).int(state.bestRun).int(state.spilled).int(state.eventSeq);
  h.int(state.score).int(state.moveCount).int(state.logLength).int(state.draws);
  h.int(state.clears).int(state.smooths).int(state.fouls).int(state.dumps).int(state.spills).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface RefiningSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/** `moves` is swaps and early draws: waits are the clock's. The best combo is the longest clear run. */
export function summarizeRefining(state: RefiningState): RefiningSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestRun };
}

const CHARS = "vots*";

/** The tower as one character a cell, row by row: v vapour, o oil, t tar, s smoke, * catalyst. What the board draws must match it. */
export function viewString(cells: ReadonlyArray<{ readonly kind: RefiningKind }>): string {
  return cells.map((c) => kindChar(c.kind)).join("");
}

export function kindChar(kind: RefiningKind): string {
  return CHARS[kind] ?? "?";
}
