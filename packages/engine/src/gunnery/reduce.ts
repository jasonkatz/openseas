import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_GUNNERY_CONFIG,
  DIRS,
  DX,
  DY,
  GUNNERY_KINDS,
  GunneryKind,
  type Arrow,
  type Turret,
  type TurretOutcome,
  type DeckCell,
  type Dir,
  type GunneryConfig,
  type GunneryEvent,
  type GunneryMove,
  type GunneryMoveReport,
  type GunneryPiece,
  type GunneryState,
  type ParsedDeck,
} from "./types.js";

const SYMBOLS: Record<string, DeckCell> = { "#": "wall", ".": "deck", X: "crate", B: "barrel", C: "turret", H: "hatch" };

/** Parse the deck rows. Throws on a malformed deck; content validation runs this at startup. */
export function parseDeck(rows: readonly string[]): ParsedDeck {
  if (rows.length < 5) throw new Error("gunnery deck: too few rows");
  const width = rows[0]!.length;
  if (width < 5) throw new Error("gunnery deck: too narrow");
  const cells: DeckCell[] = [];
  let barrel: { col: number; row: number } | null = null;
  const turrets: Array<{ col: number; row: number }> = [];
  rows.forEach((line, row) => {
    if (line.length !== width) throw new Error(`gunnery deck: row ${row} has width ${line.length}, expected ${width}`);
    for (let col = 0; col < width; col++) {
      const ch = line[col]!;
      const cell = SYMBOLS[ch];
      if (!cell) throw new Error(`gunnery deck: unknown symbol "${ch}" at ${col},${row}`);
      cells.push(cell);
      if (cell === "barrel") {
        if (barrel) throw new Error("gunnery deck: more than one feeder");
        barrel = { col, row };
      }
      if (cell === "turret") turrets.push({ col, row });
    }
  });
  if (!barrel) throw new Error("gunnery deck: no feeder");
  if (turrets.length === 0) throw new Error("gunnery deck: no turrets");
  // The rim must be solid so pieces never leave the grid.
  for (let col = 0; col < width; col++) {
    for (const row of [0, rows.length - 1]) if (cells[row * width + col] === "deck") throw new Error("gunnery deck: open rim");
  }
  for (let row = 0; row < rows.length; row++) {
    for (const col of [0, width - 1]) if (cells[row * width + col] === "deck") throw new Error("gunnery deck: open rim");
  }
  const b: { col: number; row: number } = barrel;
  const open = DIRS.filter((d) => {
    const col = b.col + DX[d]!;
    const row = b.row + DY[d]!;
    return col >= 0 && col < width && row >= 0 && row < rows.length && cells[row * width + col] === "deck";
  });
  if (open.length !== 1) throw new Error("gunnery deck: the feeder must touch exactly one deck cell");
  const dir = open[0]!;
  return { width, height: rows.length, cells, barrel: b, drop: { col: b.col + DX[dir]!, row: b.row + DY[dir]!, dir }, turrets };
}

const isNat = (n: number): boolean => Number.isInteger(n) && n >= 0;

export function validateConfig(cfg: GunneryConfig): void {
  if (!Array.isArray(cfg.decks) || cfg.decks.length === 0) throw new Error("gunnery config: no decks");
  const first = parseDeck(cfg.decks[0]!);
  cfg.decks.forEach((rows, i) => {
    const deck = parseDeck(rows);
    if (deck.width !== first.width || deck.height !== first.height) throw new Error(`gunnery deck ${i}: every deck must be ${first.width} by ${first.height}`);
    const problems = deckProblems(deck);
    if (problems.length) throw new Error(`gunnery deck ${i}: ${problems.join("; ")}`);
  });
  const ok =
    Number.isInteger(cfg.tickMs) &&
    cfg.tickMs >= 20 &&
    cfg.tickMs <= 5000 &&
    Number.isInteger(cfg.maxTick) &&
    cfg.maxTick > 0 &&
    Number.isInteger(cfg.maxMoves) &&
    cfg.maxMoves > 0 &&
    Number.isInteger(cfg.maxOnDeck) &&
    cfg.maxOnDeck >= 1 &&
    Number.isInteger(cfg.spawnEveryTicks) &&
    Number.isInteger(cfg.spawnEveryTicksMin) &&
    cfg.spawnEveryTicksMin >= 1 &&
    cfg.spawnEveryTicksMin <= cfg.spawnEveryTicks &&
    isNat(cfg.queueLength) &&
    cfg.queueLength <= 8 &&
    cfg.bag.length === GUNNERY_KINDS &&
    cfg.bag.every(isNat) &&
    cfg.bag[GunneryKind.Cell]! >= 1 &&
    cfg.bag[GunneryKind.Sabot]! >= 1 &&
    cfg.bag[GunneryKind.Slug]! >= 1 &&
    Number.isInteger(cfg.fireAfterTicks) &&
    cfg.fireAfterTicks >= 1 &&
    isNat(cfg.stepPoints) &&
    isNat(cfg.loadPoints) &&
    isNat(cfg.comboStep) &&
    isNat(cfg.comboCap) &&
    isNat(cfg.broadsidePoints);
  if (!ok) throw new Error("invalid gunnery config");
}

export const deckIdx = (deck: ParsedDeck, col: number, row: number): number => row * deck.width + col;
export const cellAt = (deck: ParsedDeck, col: number, row: number): DeckCell =>
  col < 0 || col >= deck.width || row < 0 || row >= deck.height ? "wall" : deck.cells[deckIdx(deck, col, row)]!;

export function createGunneryGame(seed: string, config: GunneryConfig = DEFAULT_GUNNERY_CONFIG): GunneryState {
  validateConfig(config);
  // The seed picks the deck first, then deals the bag.
  const pick = nextInt(seedFromString(`gunnery:${seed}`), config.decks.length);
  const deckIndex = pick.value;
  const deck = parseDeck(config.decks[deckIndex]!);
  const supply: Supply = { rng: pick.state, bag: [] };
  const queue: number[] = [];
  for (let i = 0; i < config.queueLength; i++) queue.push(draw(config, supply));
  return {
    config,
    deckIndex,
    deck,
    tick: 0,
    pieces: [],
    arrows: [],
    turrets: deck.turrets.map((c) => ({ col: c.col, row: c.row, loaded: 0, jammed: false, firesAt: null })),
    queue,
    bag: supply.bag,
    // The first piece drops two ticks in, so the round opens with something already moving.
    lastDrop: 2 - config.spawnEveryTicks,
    nextId: 1,
    rng: supply.rng,
    moveCount: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    loads: 0,
    jams: 0,
    firedSince: deck.turrets.map(() => false),
    broadsides: 0,
    arrowsPlaced: 0,
    lastMove: null,
    finished: false,
  };
}

export function reduceGunnery(state: GunneryState, move: GunneryMove): GunneryState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (!Number.isInteger(move.tick) || move.tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
  if (move.tick > state.config.maxTick) throw new InvalidMoveError("tick beyond the round", move);
  const sim = simulate(state, move.tick);
  let next: GunneryState = sim.state;
  const events = sim.events;
  switch (move.type) {
    case "wait":
      break;
    case "end":
      next = { ...next, finished: true };
      break;
    case "remove": {
      if (!isDeck(next, move.col, move.row)) throw new InvalidMoveError("not a deck cell", move);
      next = { ...next, arrows: next.arrows.filter((a) => a.col !== move.col || a.row !== move.row) };
      break;
    }
    case "arrow": {
      if (!isDeck(next, move.col, move.row)) throw new InvalidMoveError("not a deck cell", move);
      if (!(DIRS as readonly number[]).includes(move.dir)) throw new InvalidMoveError("bad direction", move);
      const kept = next.arrows.filter((a) => a.col !== move.col || a.row !== move.row);
      const arrows: Arrow[] = [...kept, { col: move.col, row: move.row, dir: move.dir }];
      next = { ...next, arrows, arrowsPlaced: next.arrowsPlaced + 1 };
      break;
    }
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
  // Ending the round is not a move, as in every other engine.
  const moveCount = move.type === "end" ? state.moveCount : state.moveCount + 1;
  const points = next.score - state.score;
  const report: GunneryMoveReport = { move, events, points };
  return {
    ...next,
    moveCount,
    lastMove: report,
    finished: next.finished || moveCount >= state.config.maxMoves || next.tick >= state.config.maxTick,
  };
}

/** The state at a later tick, without logging a move. Clients call this to show time passing. */
export function advanceGunnery(state: GunneryState, tick: number): GunneryState {
  if (tick <= state.tick) return state;
  const sim = simulate(state, Math.min(tick, state.config.maxTick));
  return { ...sim.state, lastMove: { move: { type: "wait", tick: sim.state.tick }, events: sim.events, points: sim.state.score - state.score } };
}

export function replayGunnery(seed: string, moves: readonly GunneryMove[], config: GunneryConfig = DEFAULT_GUNNERY_CONFIG): GunneryState {
  let s = createGunneryGame(seed, config);
  for (const m of moves) s = reduceGunnery(s, m);
  return s;
}

export function hashGunneryState(state: GunneryState): string {
  const h = new Hasher();
  h.int(state.deckIndex).int(state.deck.width).int(state.deck.height).int(state.tick);
  for (const p of state.pieces) h.int(p.id).int(p.kind).int(p.col).int(p.row).int(p.dir);
  h.int(-1);
  for (const a of state.arrows) h.int(a.col).int(a.row).int(a.dir);
  h.int(-2);
  for (const c of state.turrets) h.int(c.loaded).int(c.jammed ? 1 : 0).int(c.firesAt ?? -1);
  h.int(-3);
  for (const k of state.queue) h.int(k);
  h.int(-4);
  for (const k of state.bag) h.int(k);
  h.int(-5);
  h.int(state.lastDrop).int(state.nextId).int(state.moveCount).int(state.score);
  h.int(state.combo).int(state.bestCombo).int(state.loads).int(state.jams).int(state.arrowsPlaced);
  for (const f of state.firedSince) h.int(f ? 1 : 0);
  h.int(state.broadsides);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface GunnerySummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeGunnery(state: GunneryState): GunnerySummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/** The kind a turret wants next: coolant when jammed, nothing while it is full and about to fire. */
export function turretNeeds(c: Turret): number | null {
  if (c.firesAt !== null || c.loaded >= 3) return null;
  if (c.jammed) return GunneryKind.Coolant;
  return c.loaded;
}

/** What a piece of `kind` would do to this turret if it rolled in now. */
export function turretOutcome(c: Turret, kind: number): TurretOutcome {
  if (c.firesAt !== null || c.loaded >= 3) return "blocked";
  if (kind === GunneryKind.Coolant) return c.jammed ? "clean" : "splash";
  if (c.jammed) return "blocked";
  if (kind === c.loaded) return c.loaded === 2 ? "loaded" : "load";
  return "jam";
}

/** Ticks between drops at `tick`: `spawnEveryTicks` at the start, quickening to the minimum. */
export function dropInterval(cfg: GunneryConfig, tick: number): number {
  const span = cfg.spawnEveryTicks - cfg.spawnEveryTicksMin;
  if (span <= 0) return cfg.spawnEveryTicks;
  const steps = Math.floor(((span + 1) * Math.max(0, tick)) / cfg.maxTick);
  return Math.max(cfg.spawnEveryTicksMin, cfg.spawnEveryTicks - steps);
}

/**
 * For each gun, the fewest arrows (then fewest ticks) a piece needs to roll from the feeder into it,
 * within MAX_ARROWS_TO_A_GUN arrows and MAX_TICKS_TO_A_GUN ticks; null where it can't be done. A piece
 * may turn at a plank only with an arrow (cost 1), unless that is the way it would roll anyway.
 * Arrows are counted per turn, not per plank, so this is a guide to a deck's difficulty.
 */
export function gunReach(deck: ParsedDeck): Array<{ arrows: number; ticks: number } | null> {
  const natural = (col: number, row: number, d: Dir): Dir | null => {
    for (const x of [d, right(d), left(d), opposite(d)]) {
      const c = cellAt(deck, col + DX[x]!, row + DY[x]!);
      if (c === "deck" || c === "hatch") return x;
    }
    return null;
  };
  const best = new Map<number, { arrows: number; ticks: number }>();
  const reached = new Map<number, { arrows: number; ticks: number }>();
  let frontier: Array<{ col: number; row: number; d: Dir; arrows: number; ticks: number }> = [{ ...deck.drop, d: deck.drop.dir, arrows: 0, ticks: 0 }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const s of frontier) {
      const key = (s.row * deck.width + s.col) * 4 + s.d;
      const b = best.get(key);
      if (b && (b.arrows < s.arrows || (b.arrows === s.arrows && b.ticks <= s.ticks))) continue;
      best.set(key, { arrows: s.arrows, ticks: s.ticks });
      const nat = natural(s.col, s.row, s.d);
      for (const x of DIRS) {
        const col = s.col + DX[x]!;
        const row = s.row + DY[x]!;
        const c = cellAt(deck, col, row);
        const arrows = s.arrows + (x === nat ? 0 : 1);
        const ticks = s.ticks + 1;
        if (arrows > MAX_ARROWS_TO_A_GUN || ticks > MAX_TICKS_TO_A_GUN) continue;
        if (c === "turret") {
          const gi = deck.turrets.findIndex((g) => g.col === col && g.row === row);
          const r = reached.get(gi);
          if (!r || arrows < r.arrows || (arrows === r.arrows && ticks < r.ticks)) reached.set(gi, { arrows, ticks });
        } else if (c === "deck") next.push({ col, row, d: x, arrows, ticks });
      }
    }
    frontier = next;
  }
  return deck.turrets.map((_, i) => reached.get(i) ?? null);
}

/** How many arrows a gun may need, at most, to be reached from the feeder. */
export const MAX_ARROWS_TO_A_GUN = 3;
/** How long the lane to a gun may be, at most, in ticks. */
export const MAX_TICKS_TO_A_GUN = 30;

/**
 * Why a deck is not fit to play, or nothing. A fit deck has no loop built in: with no arrows,
 * a piece starting on any plank heading any way leaves by a hatch (counting turrets as walls,
 * since a gun may turn a piece away). The stream from the feeder leaves without running into a
 * gun. And every gun can be reached from the feeder with at most MAX_ARROWS_TO_A_GUN arrows, in at
 * most MAX_TICKS_TO_A_GUN ticks.
 */
export function deckProblems(deck: ParsedDeck): string[] {
  const problems: string[] = [];
  const open = (col: number, row: number, gunsOpen: boolean): boolean => {
    const c = cellAt(deck, col, row);
    return c === "deck" || c === "hatch" || (gunsOpen && c === "turret");
  };
  const natural = (col: number, row: number, d: Dir, gunsOpen: boolean): Dir | null => {
    for (const x of [d, right(d), left(d), opposite(d)]) if (open(col + DX[x]!, row + DY[x]!, gunsOpen)) return x;
    return null;
  };
  /** Follows an unsteered piece: where it ends up, or "loop". */
  const follow = (col: number, row: number, d: Dir, gunsOpen: boolean): "hatch" | "turret" | "loop" => {
    const seen = new Set<number>();
    for (;;) {
      const key = (row * deck.width + col) * 4 + d;
      if (seen.has(key)) return "loop";
      seen.add(key);
      const nd = natural(col, row, d, gunsOpen);
      if (nd === null) return "loop";
      col += DX[nd]!;
      row += DY[nd]!;
      d = nd;
      const c = cellAt(deck, col, row);
      if (c === "hatch") return "hatch";
      if (c === "turret") return "turret";
    }
  };
  // Every start, guns shut. Paths merge, so each (plank, heading) is settled once: walking from a
  // start, every state on the way shares the walk's ending (1 leaves by a hatch, 2 never does).
  const ending = new Uint8Array(deck.width * deck.height * 4);
  const settle = (col: number, row: number, d0: Dir): number => {
    const path: number[] = [];
    const onPath = new Set<number>();
    let d = d0;
    let result = 2;
    for (;;) {
      const key = (row * deck.width + col) * 4 + d;
      if (ending[key]) {
        result = ending[key]!;
        break;
      }
      if (onPath.has(key)) break;
      onPath.add(key);
      path.push(key);
      const nd = natural(col, row, d, false);
      if (nd === null) break;
      col += DX[nd]!;
      row += DY[nd]!;
      d = nd;
      if (cellAt(deck, col, row) === "hatch") {
        result = 1;
        break;
      }
    }
    for (const k of path) ending[k] = result;
    return result;
  };
  outer: for (let row = 0; row < deck.height; row++) {
    for (let col = 0; col < deck.width; col++) {
      if (cellAt(deck, col, row) !== "deck") continue;
      const d = DIRS.find((x) => settle(col, row, x) === 2);
      if (d !== undefined) {
        problems.push(`a piece at ${col},${row} heading ${d} circles forever`);
        break outer;
      }
    }
  }
  if (follow(deck.drop.col, deck.drop.row, deck.drop.dir, true) !== "hatch") problems.push("the unsteered stream does not leave by a hatch");

  const reach = gunReach(deck);
  deck.turrets.forEach((g, i) => {
    if (!reach[i]) problems.push(`the gun at ${g.col},${g.row} cannot be reached from the feeder in ${MAX_ARROWS_TO_A_GUN} arrows`);
  });
  return problems;
}

export function isDeck(state: GunneryState, col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && cellAt(state.deck, col, row) === "deck";
}

export function pieceAt(state: GunneryState, col: number, row: number): GunneryPiece | undefined {
  return state.pieces.find((p) => p.col === col && p.row === row);
}

const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;
const right = (d: Dir): Dir => ((d + 1) % 4) as Dir;
const left = (d: Dir): Dir => ((d + 3) % 4) as Dir;

/** Whether a piece of `kind` is turned away by the cell at col,row. Other pieces never count here. */
function solid(deck: ParsedDeck, turrets: readonly Turret[], col: number, row: number, kind: number): boolean {
  const cell = cellAt(deck, col, row);
  if (cell === "deck" || cell === "hatch") return false;
  if (cell !== "turret") return true;
  const c = turrets.find((x) => x.col === col && x.row === row);
  return !c || turretOutcome(c, kind) === "blocked";
}

/**
 * The way a piece rolls next: the arrow under it if any, else its heading; if that is shut, turn
 * right, else left, else back. Null when boxed in on every side.
 */
function heading(deck: ParsedDeck, turrets: readonly Turret[], arrows: readonly Arrow[], p: GunneryPiece): Dir | null {
  const arrow = arrows.find((a) => a.col === p.col && a.row === p.row);
  const d0 = arrow ? arrow.dir : p.dir;
  for (const d of [d0, right(d0), left(d0), opposite(d0)]) {
    if (!solid(deck, turrets, p.col + DX[d]!, p.row + DY[d]!, p.kind)) return d;
  }
  return null;
}

export interface PredictedPath {
  /** Deck cells the piece will roll through, in order, not counting where it is now. */
  readonly cells: ReadonlyArray<{ readonly col: number; readonly row: number }>;
  /** Where the path ends within the look-ahead, if it ends: into a turret or overboard. */
  readonly end:
    | { readonly type: "turret"; readonly turret: number; readonly outcome: TurretOutcome }
    | { readonly type: "overboard" }
    | null;
}

/**
 * Where a piece is headed over the next `steps` ticks if nothing else gets in its way, with
 * `arrows` (default: the ones on deck) and the turrets as they will be (full ones fire on time).
 * Other pieces are ignored, so this is a guide for the player, not a promise.
 */
export function predictPath(state: GunneryState, piece: GunneryPiece, steps: number, arrows: readonly Arrow[] = state.arrows): PredictedPath {
  const cells: Array<{ col: number; row: number }> = [];
  let p = piece;
  for (let i = 0; i < steps; i++) {
    // Turrets as they will be on that tick: a full one has fired by then if its time has come.
    const tick = state.tick + i + 1;
    const turrets = state.turrets.map((c) => (c.firesAt !== null && c.firesAt <= tick ? { ...c, loaded: 0, jammed: false, firesAt: null } : c));
    const d = heading(state.deck, turrets, arrows, p);
    if (d === null) break;
    const col = p.col + DX[d]!;
    const row = p.row + DY[d]!;
    const cell = cellAt(state.deck, col, row);
    if (cell === "turret") {
      const ci = turrets.findIndex((c) => c.col === col && c.row === row);
      return { cells, end: { type: "turret", turret: ci, outcome: turretOutcome(turrets[ci]!, p.kind) } };
    }
    if (cell === "hatch") return { cells, end: { type: "overboard" } };
    p = { ...p, col, row, dir: d };
    cells.push({ col, row });
  }
  return { cells, end: null };
}

/**
 * The way a piece will roll on the next tick (with `arrows`, default the ones on deck): the arrow
 * under it, else its heading, else whatever the rails and crates turn it to. Null when boxed in.
 * A piece about to turn at a wall or go out of a hatch shows it here before it moves.
 */
export function nextHeading(state: GunneryState, piece: GunneryPiece, arrows: readonly Arrow[] = state.arrows): Dir | null {
  const tick = state.tick + 1;
  const turrets = state.turrets.map((c) => (c.firesAt !== null && c.firesAt <= tick ? { ...c, loaded: 0, jammed: false, firesAt: null } : c));
  return heading(state.deck, turrets, arrows, piece);
}

// ---- simulation

interface Supply {
  rng: PrngState;
  bag: number[];
}

interface Sim extends Supply {
  pieces: GunneryPiece[];
  turrets: Turret[];
  queue: number[];
  lastDrop: number;
  nextId: number;
  score: number;
  combo: number;
  bestCombo: number;
  loads: number;
  jams: number;
  firedSince: boolean[];
  broadsides: number;
  events: GunneryEvent[];
}

/** Next kind out of the bag, refilling and shuffling it when empty. */
function draw(cfg: GunneryConfig, s: Supply): number {
  if (s.bag.length === 0) {
    const bag: number[] = [];
    cfg.bag.forEach((n, kind) => {
      for (let i = 0; i < n; i++) bag.push(kind);
    });
    for (let i = bag.length - 1; i > 0; i--) {
      const r = nextInt(s.rng, i + 1);
      s.rng = r.state;
      const j = r.value;
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    s.bag = bag;
  }
  const [kind, ...rest] = s.bag;
  s.bag = rest;
  return kind!;
}

function simulate(state: GunneryState, toTick: number): { state: GunneryState; events: GunneryEvent[] } {
  if (toTick <= state.tick) return { state, events: [] };
  const sim: Sim = {
    pieces: state.pieces.slice(),
    turrets: state.turrets.slice(),
    queue: state.queue.slice(),
    bag: state.bag.slice(),
    lastDrop: state.lastDrop,
    rng: state.rng,
    nextId: state.nextId,
    score: state.score,
    combo: state.combo,
    bestCombo: state.bestCombo,
    loads: state.loads,
    jams: state.jams,
    firedSince: state.firedSince.slice(),
    broadsides: state.broadsides,
    events: [],
  };
  let tick = state.tick;
  while (tick < toTick) {
    tick++;
    fireTurrets(state, sim, tick);
    movePieces(state, sim, tick);
    spawn(state, sim, tick);
  }
  return {
    state: {
      ...state,
      tick,
      pieces: sim.pieces,
      turrets: sim.turrets,
      queue: sim.queue,
      bag: sim.bag,
      lastDrop: sim.lastDrop,
      rng: sim.rng,
      nextId: sim.nextId,
      score: sim.score,
      combo: sim.combo,
      bestCombo: sim.bestCombo,
      loads: sim.loads,
      jams: sim.jams,
      firedSince: sim.firedSince,
      broadsides: sim.broadsides,
    },
    events: sim.events,
  };
}

/** Full turrets whose time has come fire; once every gun has fired since the last broadside, that is one. */
function fireTurrets(state: GunneryState, sim: Sim, tick: number): void {
  sim.turrets = sim.turrets.map((c, i) => {
    if (c.firesAt === null || c.firesAt > tick) return c;
    sim.events.push({ tick, type: "fire", turret: i });
    sim.firedSince[i] = true;
    return { ...c, loaded: 0, jammed: false, firesAt: null };
  });
  if (sim.firedSince.length > 0 && sim.firedSince.every(Boolean)) {
    const points = state.config.broadsidePoints;
    sim.score += points;
    sim.broadsides += 1;
    sim.firedSince = sim.firedSince.map(() => false);
    sim.events.push({ tick, type: "broadside", points });
  }
}

type Target = { dir: Dir; col: number; row: number; into: "deck" | "turret" | "hatch" } | null;

/**
 * One tick of rolling, all pieces at once. Each piece picks its heading from the arrows and the
 * deck alone. Two pieces meeting head on both turn back and stay put. A piece waits a tick when
 * the cell ahead holds a piece that is not leaving, or when a piece with a lower id is moving into
 * the same cell (or the same turret) this tick. Pieces in a line all roll together.
 */
function movePieces(state: GunneryState, sim: Sim, tick: number): void {
  const deck = state.deck;
  const pieces = sim.pieces;
  const n = pieces.length;
  if (n === 0) return;
  const key = (col: number, row: number): number => row * deck.width + col;
  const at = new Map<number, number>();
  pieces.forEach((p, i) => at.set(key(p.col, p.row), i));

  const targets: Target[] = pieces.map((p) => {
    const dir = heading(deck, sim.turrets, state.arrows, p);
    if (dir === null) return null;
    const col = p.col + DX[dir]!;
    const row = p.row + DY[dir]!;
    const cell = cellAt(deck, col, row);
    return { dir, col, row, into: cell === "turret" ? "turret" : cell === "hatch" ? "hatch" : "deck" };
  });
  const dirs: Dir[] = pieces.map((p, i) => targets[i]?.dir ?? opposite(p.dir));
  const moving: boolean[] = targets.map((t) => t !== null);

  // Head on: two pieces trying to swap cells both turn back.
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    if (!t || t.into !== "deck" || !moving[i]) continue;
    const j = at.get(key(t.col, t.row));
    if (j === undefined || j === i) continue;
    const u = targets[j];
    if (u && u.into === "deck" && u.col === pieces[i]!.col && u.row === pieces[i]!.row) {
      moving[i] = false;
      moving[j] = false;
      dirs[i] = opposite(t.dir);
      dirs[j] = opposite(u.dir);
    }
  }

  // Settle who waits: only ever stops pieces, so it ends.
  for (let changed = true; changed; ) {
    changed = false;
    const claimed = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (!moving[i]) continue;
      const t = targets[i]!;
      const k = key(t.col, t.row);
      const occ = t.into === "deck" ? at.get(k) : undefined;
      if ((occ !== undefined && occ !== i && !moving[occ]) || claimed.has(k)) {
        moving[i] = false;
        changed = true;
        continue;
      }
      claimed.add(k);
    }
  }

  const next: GunneryPiece[] = [];
  for (let i = 0; i < n; i++) {
    const p = pieces[i]!;
    const t = targets[i];
    if (!moving[i] || !t) {
      next.push(dirs[i] === p.dir ? p : { ...p, dir: dirs[i]! });
      continue;
    }
    if (t.into === "turret") {
      const ci = sim.turrets.findIndex((c) => c.col === t.col && c.row === t.row);
      consume(state, sim, tick, ci, p);
      continue;
    }
    if (t.into === "hatch") {
      sim.events.push({ tick, type: "exit", pieceId: p.id, kind: p.kind, col: t.col, row: t.row });
      continue;
    }
    next.push({ ...p, col: t.col, row: t.row, dir: t.dir });
  }
  sim.pieces = next;
}

function consume(state: GunneryState, sim: Sim, tick: number, ci: number, piece: GunneryPiece): void {
  const c = sim.turrets[ci]!;
  const cfg = state.config;
  const ev = (type: GunneryEvent["type"], points = 0): void => {
    sim.events.push({ tick, type, turret: ci, pieceId: piece.id, kind: piece.kind, ...(points ? { points } : {}) });
  };
  switch (turretOutcome(c, piece.kind)) {
    case "load":
      sim.turrets[ci] = { ...c, loaded: c.loaded + 1 };
      sim.score += cfg.stepPoints;
      ev("load", cfg.stepPoints);
      return;
    case "loaded": {
      sim.turrets[ci] = { ...c, loaded: 3, firesAt: tick + cfg.fireAfterTicks };
      sim.combo += 1;
      sim.bestCombo = Math.max(sim.bestCombo, sim.combo);
      sim.loads += 1;
      const points = cfg.loadPoints + cfg.comboStep * Math.min(sim.combo - 1, cfg.comboCap);
      sim.score += points;
      ev("loaded", points);
      return;
    }
    case "clean":
      sim.turrets[ci] = { ...c, loaded: 0, jammed: false };
      ev("clean");
      return;
    case "splash":
      ev("splash");
      return;
    case "jam":
      sim.turrets[ci] = { ...c, loaded: 0, jammed: true };
      sim.combo = 0;
      sim.jams += 1;
      ev("jam");
      return;
    case "blocked":
      // Pieces turn away from a blocked turret before they reach it; nothing to do.
      return;
  }
}

/** The feeder drops the head of the queue when the rhythm says so, the deck has room and the drop cell is clear. */
function spawn(state: GunneryState, sim: Sim, tick: number): void {
  const cfg = state.config;
  if (tick - sim.lastDrop < dropInterval(cfg, tick)) return;
  if (sim.pieces.length >= cfg.maxOnDeck) return;
  const { drop } = state.deck;
  if (sim.pieces.some((p) => p.col === drop.col && p.row === drop.row)) return;
  const kind = cfg.queueLength > 0 ? sim.queue.shift()! : draw(cfg, sim);
  if (cfg.queueLength > 0) sim.queue.push(draw(cfg, sim));
  const piece: GunneryPiece = { id: sim.nextId++, kind, col: drop.col, row: drop.row, dir: drop.dir };
  sim.pieces.push(piece);
  sim.lastDrop = tick;
  sim.events.push({ tick, type: "spawn", pieceId: piece.id, kind });
}
