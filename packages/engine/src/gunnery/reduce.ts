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
  type Cannon,
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

const SYMBOLS: Record<string, DeckCell> = { "#": "wall", ".": "deck", X: "crate", B: "barrel", C: "cannon", H: "hatch" };

/** Parse the deck rows. Throws on a malformed deck; content validation runs this at startup. */
export function parseDeck(rows: readonly string[]): ParsedDeck {
  if (rows.length < 5) throw new Error("gunnery deck: too few rows");
  const width = rows[0]!.length;
  if (width < 5) throw new Error("gunnery deck: too narrow");
  const cells: DeckCell[] = [];
  let barrel: { col: number; row: number } | null = null;
  const cannons: Array<{ col: number; row: number }> = [];
  rows.forEach((line, row) => {
    if (line.length !== width) throw new Error(`gunnery deck: row ${row} has width ${line.length}, expected ${width}`);
    for (let col = 0; col < width; col++) {
      const ch = line[col]!;
      const cell = SYMBOLS[ch];
      if (!cell) throw new Error(`gunnery deck: unknown symbol "${ch}" at ${col},${row}`);
      cells.push(cell);
      if (cell === "barrel") {
        if (barrel) throw new Error("gunnery deck: more than one barrel");
        barrel = { col, row };
      }
      if (cell === "cannon") cannons.push({ col, row });
    }
  });
  if (!barrel) throw new Error("gunnery deck: no barrel");
  if (cannons.length === 0) throw new Error("gunnery deck: no cannons");
  // The rim must be solid so pieces never leave the grid.
  for (let col = 0; col < width; col++) {
    for (const row of [0, rows.length - 1]) if (cells[row * width + col] === "deck") throw new Error("gunnery deck: open rim");
  }
  for (let row = 0; row < rows.length; row++) {
    for (const col of [0, width - 1]) if (cells[row * width + col] === "deck") throw new Error("gunnery deck: open rim");
  }
  return { width, height: rows.length, cells, barrel, cannons };
}

export function validateConfig(cfg: GunneryConfig): void {
  parseDeck(cfg.deck);
  const ok =
    Number.isInteger(cfg.tickMs) &&
    cfg.tickMs >= 20 &&
    cfg.tickMs <= 5000 &&
    Number.isInteger(cfg.maxTick) &&
    cfg.maxTick > 0 &&
    Number.isInteger(cfg.maxMoves) &&
    cfg.maxMoves > 0 &&
    Number.isInteger(cfg.maxArrows) &&
    cfg.maxArrows >= 1 &&
    cfg.maxArrows <= 20 &&
    Number.isInteger(cfg.perKindOnDeck) &&
    cfg.perKindOnDeck >= 1 &&
    cfg.perKindOnDeck <= 8 &&
    Number.isInteger(cfg.spawnEveryTicks) &&
    cfg.spawnEveryTicks >= 1 &&
    Number.isInteger(cfg.fireAfterTicks) &&
    cfg.fireAfterTicks >= 1 &&
    cfg.loadPoints >= 0;
  if (!ok) throw new Error("invalid gunnery config");
}

export const deckIdx = (deck: ParsedDeck, col: number, row: number): number => row * deck.width + col;
export const cellAt = (deck: ParsedDeck, col: number, row: number): DeckCell =>
  col < 0 || col >= deck.width || row < 0 || row >= deck.height ? "wall" : deck.cells[deckIdx(deck, col, row)]!;

export function createGunneryGame(seed: string, config: GunneryConfig = DEFAULT_GUNNERY_CONFIG): GunneryState {
  validateConfig(config);
  const deck = parseDeck(config.deck);
  return {
    config,
    deck,
    tick: 0,
    pieces: [],
    arrows: [],
    cannons: deck.cannons.map((c) => ({ col: c.col, row: c.row, loaded: 0, fouled: false, firesAt: null })),
    arrowSeq: 0,
    nextId: 1,
    rng: seedFromString(`gunnery:${seed}`),
    moveCount: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    loads: 0,
    fouls: 0,
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
      const arrow: Arrow = { col: move.col, row: move.row, dir: move.dir, seq: next.arrowSeq };
      let arrows = [...kept, arrow];
      while (arrows.length > next.config.maxArrows) {
        const oldest = arrows.reduce((o, a) => (a.seq < o.seq ? a : o));
        arrows = arrows.filter((a) => a !== oldest);
      }
      next = { ...next, arrows, arrowSeq: next.arrowSeq + 1, arrowsPlaced: next.arrowsPlaced + 1 };
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
  h.int(state.deck.width).int(state.deck.height).int(state.tick);
  for (const p of state.pieces) h.int(p.id).int(p.kind).int(p.col).int(p.row).int(p.dir);
  h.int(-1);
  for (const a of state.arrows) h.int(a.col).int(a.row).int(a.dir).int(a.seq);
  h.int(-2);
  for (const c of state.cannons) h.int(c.loaded).int(c.fouled ? 1 : 0).int(c.firesAt ?? -1);
  h.int(state.arrowSeq).int(state.nextId).int(state.moveCount).int(state.score).int(state.combo).int(state.loads).int(state.fouls).int(state.arrowsPlaced);
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

/** The kind a cannon needs next, or null when it is fouled or fully loaded. */
export function cannonNeeds(c: Cannon): number | null {
  if (c.fouled || c.loaded >= 3) return null;
  return c.loaded;
}

export function isDeck(state: GunneryState, col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && cellAt(state.deck, col, row) === "deck";
}

export function pieceAt(state: GunneryState, col: number, row: number): GunneryPiece | undefined {
  return state.pieces.find((p) => p.col === col && p.row === row);
}

// ---- simulation

interface Sim {
  pieces: GunneryPiece[];
  cannons: Cannon[];
  rng: PrngState;
  nextId: number;
  score: number;
  combo: number;
  bestCombo: number;
  loads: number;
  fouls: number;
  events: GunneryEvent[];
}

function simulate(state: GunneryState, toTick: number): { state: GunneryState; events: GunneryEvent[] } {
  if (toTick <= state.tick) return { state, events: [] };
  const sim: Sim = {
    pieces: state.pieces.slice(),
    cannons: state.cannons.slice(),
    rng: state.rng,
    nextId: state.nextId,
    score: state.score,
    combo: state.combo,
    bestCombo: state.bestCombo,
    loads: state.loads,
    fouls: state.fouls,
    events: [],
  };
  let tick = state.tick;
  while (tick < toTick) {
    tick++;
    fireCannons(sim, tick);
    movePieces(state, sim, tick);
    if (tick % state.config.spawnEveryTicks === 0) spawn(state, sim, tick);
  }
  return {
    state: {
      ...state,
      tick,
      pieces: sim.pieces,
      cannons: sim.cannons,
      rng: sim.rng,
      nextId: sim.nextId,
      score: sim.score,
      combo: sim.combo,
      bestCombo: sim.bestCombo,
      loads: sim.loads,
      fouls: sim.fouls,
    },
    events: sim.events,
  };
}

function fireCannons(sim: Sim, tick: number): void {
  sim.cannons = sim.cannons.map((c, i) => {
    if (c.firesAt === null || c.firesAt > tick) return c;
    sim.events.push({ tick, type: "fire", cannon: i });
    return { ...c, loaded: 0, fouled: true, firesAt: null };
  });
}

const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;
const right = (d: Dir): Dir => ((d + 1) % 4) as Dir;
const left = (d: Dir): Dir => ((d + 3) % 4) as Dir;

/** One tick of rolling, piece by piece in id order. */
function movePieces(state: GunneryState, sim: Sim, tick: number): void {
  const deck = state.deck;
  const order = sim.pieces.map((p) => p.id);
  // A piece bounced by an earlier piece has had its turn: it does not also roll this tick.
  const done = new Set<number>();
  for (const id of order) {
    if (done.has(id)) continue;
    const i = sim.pieces.findIndex((p) => p.id === id);
    if (i < 0) continue; // already consumed this tick
    let piece = sim.pieces[i]!;
    const arrow = state.arrows.find((a) => a.col === piece.col && a.row === piece.row);
    if (arrow && arrow.dir !== piece.dir) piece = { ...piece, dir: arrow.dir };

    const attempt = (d: Dir): "moved" | "piece" | "blocked" => {
      const col = piece.col + DX[d]!;
      const row = piece.row + DY[d]!;
      const cell = cellAt(deck, col, row);
      if (cell === "cannon") {
        const ci = sim.cannons.findIndex((c) => c.col === col && c.row === row);
        consume(state, sim, tick, ci, piece);
        sim.pieces.splice(i, 1);
        return "moved";
      }
      if (cell === "hatch") {
        sim.events.push({ tick, type: "exit", pieceId: piece.id, kind: piece.kind });
        sim.pieces.splice(i, 1);
        return "moved";
      }
      if (cell !== "deck") return "blocked";
      const other = sim.pieces.findIndex((p) => p.col === col && p.row === row);
      if (other >= 0) {
        // Both reverse; neither moves this tick.
        const o = sim.pieces[other]!;
        sim.pieces[other] = { ...o, dir: opposite(o.dir) };
        sim.pieces[i] = { ...piece, dir: opposite(d) };
        done.add(o.id);
        return "piece";
      }
      sim.pieces[i] = { ...piece, col, row, dir: d };
      return "moved";
    };

    const r0 = attempt(piece.dir);
    if (r0 !== "blocked") continue;
    const r1 = attempt(right(piece.dir));
    if (r1 !== "blocked") continue;
    const r2 = attempt(left(piece.dir));
    if (r2 !== "blocked") continue;
    const back = opposite(piece.dir);
    const r3 = attempt(back);
    if (r3 === "blocked") sim.pieces[i] = { ...piece, dir: back };
  }
}

function consume(state: GunneryState, sim: Sim, tick: number, ci: number, piece: GunneryPiece): void {
  const c = sim.cannons[ci]!;
  const ev = (type: GunneryEvent["type"]): void => {
    sim.events.push({ tick, type, cannon: ci, pieceId: piece.id, kind: piece.kind });
  };
  if (piece.kind === GunneryKind.Water) {
    sim.cannons[ci] = { ...c, loaded: 0, fouled: false, firesAt: null };
    ev(c.fouled || c.loaded > 0 ? "clean" : "waste");
    return;
  }
  if (c.fouled) {
    ev("waste");
    return;
  }
  if (c.loaded < 3 && piece.kind === c.loaded) {
    const loaded = c.loaded + 1;
    if (loaded === 3) {
      sim.cannons[ci] = { ...c, loaded, firesAt: tick + state.config.fireAfterTicks };
      sim.score += state.config.loadPoints;
      sim.combo += 1;
      sim.bestCombo = Math.max(sim.bestCombo, sim.combo);
      sim.loads += 1;
      ev("loaded");
    } else {
      sim.cannons[ci] = { ...c, loaded };
      ev("load");
    }
    return;
  }
  sim.cannons[ci] = { ...c, loaded: 0, fouled: true, firesAt: null };
  sim.combo = 0;
  sim.fouls += 1;
  ev("foul");
}

/** The barrel tops up any kind below perKindOnDeck, one piece per spawn tick, into a free neighbour. */
function spawn(state: GunneryState, sim: Sim, tick: number): void {
  const counts = new Array<number>(GUNNERY_KINDS).fill(0);
  for (const p of sim.pieces) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  const deficient: number[] = [];
  for (let k = 0; k < GUNNERY_KINDS; k++) if (counts[k]! < state.config.perKindOnDeck) deficient.push(k);
  if (deficient.length === 0) return;
  const { barrel } = state.deck;
  const exits: Dir[] = [];
  for (const d of DIRS) {
    const col = barrel.col + DX[d]!;
    const row = barrel.row + DY[d]!;
    if (cellAt(state.deck, col, row) !== "deck") continue;
    if (sim.pieces.some((p) => p.col === col && p.row === row)) continue;
    exits.push(d);
  }
  if (exits.length === 0) return;
  const k = nextInt(sim.rng, deficient.length);
  const e = nextInt(k.state, exits.length);
  sim.rng = e.state;
  const kind = deficient[k.value]!;
  const dir = exits[e.value]!;
  const piece: GunneryPiece = { id: sim.nextId++, kind, col: barrel.col + DX[dir]!, row: barrel.row + DY[dir]!, dir };
  sim.pieces.push(piece);
  sim.events.push({ tick, type: "spawn", pieceId: piece.id, kind });
}
