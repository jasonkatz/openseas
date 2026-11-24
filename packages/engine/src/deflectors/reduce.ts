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
  type DeflectorsConfig,
  type DeflectorsEvent,
  type DeflectorsMove,
  type DeflectorsMoveReport,
  type DeflectorsOutcome,
  type DeflectorsShot,
  type DeflectorsState,
  type DeflectorsTarget,
  type DeflectorsTrace,
} from "./types.js";

const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

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

/** The most lenses a recipe can ask for under `cfg`: 0 when recipes are off. */
export const recipeLenses = (cfg: DeflectorsConfig): number => cfg.recipeWeights.length - 1;

/** The emitters' ports: spread down the left edge, top to bottom. */
export function emitterPorts(cfg: DeflectorsConfig): number[] {
  const n = cfg.size;
  return Array.from({ length: cfg.emitters }, (_, i) => 3 * n + Math.floor(((2 * i + 1) * n) / (2 * cfg.emitters)));
}

export function validateConfig(cfg: DeflectorsConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const cells = cfg.size * cfg.size;
  const weights = cfg.recipeWeights;
  const ok =
    int(cfg.size, 3, 10) &&
    int(cfg.emitters, 1, cfg.size) &&
    int(cfg.targets, 1, Math.min(8, cfg.size * 3)) &&
    int(cfg.mirrors, 0, cells) &&
    int(cfg.lenses, 0, cells - cfg.mirrors) &&
    Array.isArray(weights) &&
    weights.length >= 1 &&
    weights.length <= DEFLECTORS_LENS_KINDS + 1 &&
    weights.every((w) => int(w, 0, 1000)) &&
    weights.some((w) => w > 0) &&
    int(cfg.lensPercent, 0, 1000) &&
    int(cfg.bouncePoints, 0, 1000) &&
    int(cfg.bounceCap, 1, 64) &&
    Array.isArray(cfg.litPercent) &&
    cfg.litPercent.length === cfg.emitters &&
    cfg.litPercent.every((p) => int(p, 0, 10_000)) &&
    typeof cfg.spend === "boolean" &&
    int(cfg.pieceTicks, 1, 10_000) &&
    int(cfg.queueSize, 1, 8) &&
    int(cfg.lensChance, 0, 100) &&
    // A recipe asking for lenses needs lenses to keep coming.
    (weights.length === 1 || cfg.lensChance > 0) &&
    int(cfg.fireTicks, 0, 10_000) &&
    int(cfg.tickMs, 20, 5000) &&
    int(cfg.maxTick, 1, 100_000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid deflectors config");
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

/** A beam's own points for lighting a target with a recipe of `recipe` (a mask) after `bounces` turns: (turns + 1) squared, and lensPercent more for each lens. */
export function beamPoints(cfg: DeflectorsConfig, bounces: number, recipe = 0): number {
  const b = Math.min(bounces, cfg.bounceCap);
  const turned = cfg.bouncePoints * (b + 1) * (b + 1);
  return Math.floor((turned * (100 + cfg.lensPercent * recipeSize(recipe))) / 100);
}

/** What a shot lighting `lit` targets is multiplied by, in percent. */
export function litPercentAt(cfg: DeflectorsConfig, lit: number): number {
  if (lit <= 0) return 0;
  return cfg.litPercent[Math.min(lit, cfg.litPercent.length) - 1]!;
}

/** True when a beam that left by `out` having passed `lenses` lights `target`: its port, and exactly its recipe. */
export function lights(target: DeflectorsTarget, out: number, lenses: number): boolean {
  return out === target.port && lenses === target.recipe;
}

/** What firing every emitter through `cells` does to `targets`: beams in emitter order, each target lit once. */
export function resolve(cfg: DeflectorsConfig, cells: readonly number[], emitters: readonly number[], targets: readonly DeflectorsTarget[]): DeflectorsOutcome {
  const lit = new Set<number>();
  const shots: DeflectorsShot[] = emitters.map((entry) => {
    const t = trace(cfg, cells, entry);
    const target = targets.find((g) => !lit.has(g.id) && lights(g, t.out, t.lenses));
    if (!target) return { entry, ...t, target: -1, points: 0 };
    lit.add(target.id);
    return { entry, ...t, target: target.id, points: beamPoints(cfg, t.bounces, target.recipe) };
  });
  const base = shots.reduce((a, s) => a + s.points, 0);
  const pct = litPercentAt(cfg, lit.size);
  return { shots, lit: lit.size, base, litPercent: pct, points: Math.floor((base * pct) / 100) };
}

/** What firing now would do. */
export function outlook(state: DeflectorsState): DeflectorsOutcome {
  return resolve(state.config, state.mirrors, state.emitters, state.targets);
}

/** Why the next piece cannot go on `cell` now, or null when it can. */
export function placeIllegalReason(state: DeflectorsState, cell: number): string | null {
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.mirrors.length) return "no such cell";
  if (state.queue.length === 0) return "no piece waiting";
  return null;
}

/** Why the emitters cannot fire now, or null when they can. */
export function fireIllegalReason(state: DeflectorsState, tick: number): string | null {
  return tick < state.fireTick ? "the emitters are not ready" : null;
}

/** A recipe drawn by the weights: how many lenses, then which. */
function drawRecipe(cfg: DeflectorsConfig, rng: PrngState): { recipe: number; rng: PrngState } {
  const total = cfg.recipeWeights.reduce((a, w) => a + w, 0);
  let r = nextInt(rng, total);
  let pick = r.value;
  let size = 0;
  while (pick >= cfg.recipeWeights[size]!) pick -= cfg.recipeWeights[size++]!;
  let mask = 0;
  while (recipeSize(mask) < size) {
    r = nextInt(r.state, DEFLECTORS_LENS_KINDS);
    mask |= 1 << r.value;
  }
  return { recipe: mask, rng: r.state };
}

/** A piece drawn: a lens of some kind lensChance in a hundred, else a mirror set at random. */
function drawPiece(cfg: DeflectorsConfig, rng: PrngState): { piece: number; rng: PrngState } {
  const lens = nextInt(rng, 100);
  if (lens.value < cfg.lensChance) {
    const k = nextInt(lens.state, DEFLECTORS_LENS_KINDS);
    return { piece: DEFLECTORS_LENS + k.value, rng: k.state };
  }
  const way = nextInt(lens.state, 2);
  return { piece: way.value === 0 ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH, rng: way.state };
}

/** A cell picked at random from the empty ones, or from all when none is empty. */
function pickCell(cells: readonly number[], rng: PrngState): { cell: number; rng: PrngState } {
  const empty = cells.flatMap((c, i) => (c === DEFLECTORS_EMPTY ? [i] : []));
  const from = empty.length > 0 ? empty : cells.map((_, i) => i);
  const r = nextInt(rng, from.length);
  return { cell: from[r.value]!, rng: r.state };
}

export function createDeflectorsGame(seed: string, config: DeflectorsConfig = DEFAULT_DEFLECTORS_CONFIG): DeflectorsState {
  validateConfig(config);
  const n = config.size;
  let rng = seedFromString(`deflectors:${seed}`);
  const mirrors = new Array<number>(n * n).fill(DEFLECTORS_EMPTY);
  for (let i = 0; i < config.mirrors; i++) {
    const c = pickCell(mirrors, rng);
    const way = nextInt(c.rng, 2);
    mirrors[c.cell] = way.value === 0 ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH;
    rng = way.state;
  }
  for (let i = 0; i < config.lenses; i++) {
    const c = pickCell(mirrors, rng);
    mirrors[c.cell] = DEFLECTORS_LENS + (i % DEFLECTORS_LENS_KINDS);
    rng = c.rng;
  }
  // Targets on the top, right and bottom edges, no two on one port.
  const ports = Array.from({ length: 3 * n }, (_, i) => i);
  const targets: DeflectorsTarget[] = [];
  for (let id = 0; id < config.targets; id++) {
    const p = nextInt(rng, ports.length);
    const port = ports.splice(p.value, 1)[0]!;
    const r = drawRecipe(config, p.state);
    targets.push({ id, port, recipe: r.recipe });
    rng = r.rng;
  }
  targets.sort((a, b) => a.port - b.port);
  const first = drawPiece(config, rng);
  return {
    config,
    tick: 0,
    mirrors,
    emitters: emitterPorts(config),
    targets: targets.map((t, id) => ({ ...t, id })),
    queue: [first.piece],
    nextPieceTick: config.pieceTicks,
    fireTick: 0,
    rng: first.rng,
    eventSeq: 0,
    logLength: 0,
    placed: 0,
    dropped: 0,
    shots: 0,
    lit: 0,
    spent: 0,
    bestShot: 0,
    bestLit: 0,
    longest: 0,
    score: 0,
    lastMove: null,
    finished: false,
  };
}

/** The mutable copy a move works on. */
interface Work {
  cfg: DeflectorsConfig;
  tick: number;
  mirrors: number[];
  targets: DeflectorsTarget[];
  queue: number[];
  nextPieceTick: number;
  fireTick: number;
  rng: PrngState;
  eventSeq: number;
  placed: number;
  dropped: number;
  shots: number;
  lit: number;
  spent: number;
  bestShot: number;
  bestLit: number;
  longest: number;
  score: number;
  events: DeflectorsEvent[];
}

function startWork(s: DeflectorsState): Work {
  return {
    cfg: s.config,
    tick: s.tick,
    mirrors: [...s.mirrors],
    targets: [...s.targets],
    queue: [...s.queue],
    nextPieceTick: s.nextPieceTick,
    fireTick: s.fireTick,
    rng: s.rng,
    eventSeq: s.eventSeq,
    placed: s.placed,
    dropped: s.dropped,
    shots: s.shots,
    lit: s.lit,
    spent: s.spent,
    bestShot: s.bestShot,
    bestLit: s.bestLit,
    longest: s.longest,
    score: s.score,
    events: [],
  };
}

function finishWork(s: DeflectorsState, w: Work): DeflectorsState {
  return {
    ...s,
    tick: w.tick,
    mirrors: w.mirrors,
    targets: w.targets,
    queue: w.queue,
    nextPieceTick: w.nextPieceTick,
    fireTick: w.fireTick,
    rng: w.rng,
    eventSeq: w.eventSeq,
    placed: w.placed,
    dropped: w.dropped,
    shots: w.shots,
    lit: w.lit,
    spent: w.spent,
    bestShot: w.bestShot,
    bestLit: w.bestLit,
    longest: w.longest,
    score: w.score,
  };
}

/** Carry the queue forward to `tick`: every piece due comes, and a full queue drops its oldest. */
function simulate(state: DeflectorsState, tick: number): Work {
  const w = startWork(state);
  while (w.nextPieceTick <= tick) {
    const at = w.nextPieceTick;
    const d = drawPiece(w.cfg, w.rng);
    w.rng = d.rng;
    w.queue.push(d.piece);
    w.events.push({ seq: ++w.eventSeq, tick: at, type: "piece", piece: d.piece });
    if (w.queue.length > w.cfg.queueSize) {
      const piece = w.queue.shift()!;
      const c = pickCell(w.mirrors, w.rng);
      w.rng = c.rng;
      w.mirrors[c.cell] = piece;
      w.dropped++;
      w.events.push({ seq: ++w.eventSeq, tick: at, type: "drop", piece, cell: c.cell });
    }
    w.nextPieceTick = at + w.cfg.pieceTicks;
  }
  w.tick = Math.max(w.tick, tick);
  return w;
}

/** Fire every emitter at `tick`: score the shot, spend what it used, and give lit targets new recipes. */
function fire(w: Work, emitters: readonly number[], tick: number): void {
  const outcome = resolve(w.cfg, w.mirrors, emitters, w.targets);
  w.shots++;
  w.lit += outcome.lit;
  w.score += outcome.points;
  w.bestShot = Math.max(w.bestShot, outcome.points);
  w.bestLit = Math.max(w.bestLit, outcome.lit);
  for (const shot of outcome.shots) if (shot.target >= 0) w.longest = Math.max(w.longest, shot.bounces);
  let spent: number[] = [];
  if (w.cfg.spend) {
    const cells = new Set<number>();
    for (const shot of outcome.shots) {
      for (const c of shot.turns) cells.add(c);
      if (shot.target >= 0) for (const c of shot.lensCells) cells.add(c);
    }
    spent = [...cells].sort((a, b) => a - b);
    for (const c of spent) w.mirrors[c] = DEFLECTORS_EMPTY;
    w.spent += spent.length;
  }
  const litIds = new Set(outcome.shots.filter((s) => s.target >= 0).map((s) => s.target));
  w.targets = w.targets.map((t) => {
    if (!litIds.has(t.id)) return t;
    const r = drawRecipe(w.cfg, w.rng);
    w.rng = r.rng;
    return { ...t, recipe: r.recipe };
  });
  w.fireTick = tick + w.cfg.fireTicks;
  w.events.push({ seq: ++w.eventSeq, tick, type: "fire", outcome, spent, targets: w.targets });
}

export function reduceDeflectors(state: DeflectorsState, move: DeflectorsMove): DeflectorsState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (!Number.isInteger(move.tick) || move.tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
  if (move.tick > state.config.maxTick) throw new InvalidMoveError("tick beyond the round", move);
  const w = simulate(state, move.tick);
  const now = finishWork(state, w);
  switch (move.type) {
    case "wait":
      break;
    case "end":
      break;
    case "place": {
      const reason = placeIllegalReason(now, move.cell);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      w.mirrors[move.cell] = w.queue.shift()!;
      w.placed++;
      break;
    }
    case "turn": {
      const next = w.queue[0];
      if (next === undefined || !isMirror(next)) throw new InvalidMoveError("no mirror waiting", move);
      w.queue[0] = next === DEFLECTORS_SLASH ? DEFLECTORS_BACKSLASH : DEFLECTORS_SLASH;
      break;
    }
    case "fire": {
      const reason = fireIllegalReason(now, move.tick);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      fire(w, state.emitters, move.tick);
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
    finished: move.type === "end" || logLength >= state.config.maxMoves || w.tick >= state.config.maxTick,
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
  h.int(state.emitters.length);
  for (const e of state.emitters) h.int(e);
  h.int(state.targets.length);
  for (const t of state.targets) h.int(t.id).int(t.port).int(t.recipe);
  h.int(state.queue.length);
  for (const q of state.queue) h.int(q);
  h.int(state.nextPieceTick).int(state.fireTick).int(state.eventSeq).int(state.logLength);
  h.int(state.placed).int(state.dropped).int(state.shots).int(state.lit).int(state.spent);
  h.int(state.bestShot).int(state.bestLit).int(state.longest).int(state.score);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface DeflectorsSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/** `moves` is shots fired, and `bestCombo` the most targets one shot lit: the counts a player would recognise. */
export function summarizeDeflectors(state: DeflectorsState): DeflectorsSummary {
  return { score: state.score, moves: state.shots, bestCombo: state.bestLit };
}

/**
 * Where the next piece would make the shot worth the most right now, for the idle hint in unrated
 * practice, and whether to turn it first. One way among many, and a short-sighted one: it never
 * looks past the next shot. Null when no cell makes the shot worth more than it is, or no piece waits.
 */
export function hint(state: DeflectorsState): { cell: number; turn: boolean } | null {
  const next = state.queue[0];
  if (next === undefined || state.finished) return null;
  const cfg = state.config;
  const cells = [...state.mirrors];
  const now = resolve(cfg, cells, state.emitters, state.targets).points;
  const ways = isMirror(next) ? [next, next === DEFLECTORS_SLASH ? DEFLECTORS_BACKSLASH : DEFLECTORS_SLASH] : [next];
  let best: { cell: number; turn: boolean; points: number } | null = null;
  for (let cell = 0; cell < cells.length; cell++) {
    const was = cells[cell]!;
    ways.forEach((way, k) => {
      cells[cell] = way;
      const points = resolve(cfg, cells, state.emitters, state.targets).points;
      if (points > now && (!best || points > best.points)) best = { cell, turn: k === 1, points };
    });
    cells[cell] = was;
  }
  const found = best as { cell: number; turn: boolean; points: number } | null;
  return found ? { cell: found.cell, turn: found.turn } : null;
}

/** A cell as one character: `.` empty, `/` and `\\` mirrors, `a`, `b`, `c` lenses. */
export function cellChar(cell: number): string {
  return cell === DEFLECTORS_SLASH ? "/" : cell === DEFLECTORS_BACKSLASH ? "\\" : cell >= DEFLECTORS_LENS ? String.fromCharCode(97 + cell - DEFLECTORS_LENS) : ".";
}

/**
 * The board as text: one character a cell, row by row, then a bar and the targets as port~recipe in
 * port order, then a bar and the queue, next first. What the board draws must match it.
 */
export function viewString(cells: readonly number[], targets: ReadonlyArray<{ readonly port: number; readonly recipe: number }>, queue: readonly number[]): string {
  const grid = cells.map(cellChar).join("");
  const goals = targets
    .slice()
    .sort((a, b) => a.port - b.port)
    .map((t) => `${t.port}~${t.recipe}`)
    .join(",");
  return `${grid}|${goals}|${queue.map(cellChar).join("")}`;
}
