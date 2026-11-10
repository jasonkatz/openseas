import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import { DEFAULT_RACKS_CONFIG, type RacksCell, type RacksConfig, type RacksCrate, type RacksEvent, type RacksMove, type RacksMoveReport, type RacksState } from "./types.js";

export function validateConfig(cfg: RacksConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.racks, 3, 8) &&
    int(cfg.height, 3, 8) &&
    int(cfg.kinds, 2, 8) &&
    int(cfg.startCells, 0, cfg.racks * (cfg.height - 1)) &&
    int(cfg.crateMin, 1, cfg.height) &&
    int(cfg.crateMax, cfg.crateMin, cfg.height) &&
    int(cfg.crateMixPercent, 0, 100) &&
    int(cfg.landEvery, 1, 20) &&
    int(cfg.bagCopies, 1, 8) &&
    int(cfg.shipPoints, 0, 100_000) &&
    int(cfg.chainWindow, 1, 20) &&
    Array.isArray(cfg.chainPercent) &&
    cfg.chainPercent.length >= 1 &&
    cfg.chainPercent.length <= 16 &&
    cfg.chainPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 2000) &&
    int(cfg.spillPenalty, 0, 100_000) &&
    typeof cfg.markRoom === "boolean" &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid racks config");
}

/** The cells of one kind sitting together at the top of a rack: their kind and how many. Null for an empty rack. */
export function topGroup(rack: readonly RacksCell[]): { kind: number; count: number } | null {
  const top = rack[rack.length - 1];
  if (!top) return null;
  let count = 1;
  while (count < rack.length && rack[rack.length - 1 - count]!.kind === top.kind) count++;
  return { kind: top.kind, count };
}

/** Why a move from one rack to another is refused, or null when it is legal. */
export function moveIllegalReason(state: RacksState, from: number, to: number): string | null {
  if (state.finished) return "game is finished";
  const n = state.config.racks;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) return "no such rack";
  if (from === to) return "the same rack";
  if (state.racks[from]!.length === 0) return "nothing to lift";
  if (state.racks[to]!.length >= state.config.height) return "no room";
  return null;
}

/** How many cells a move from `from` to `to` would carry: the top group, as many as fit. 0 when the move is illegal. */
export function movable(state: RacksState, from: number, to: number): number {
  if (moveIllegalReason(state, from, to) !== null) return 0;
  const group = topGroup(state.racks[from]!)!;
  return Math.min(group.count, state.config.height - state.racks[to]!.length);
}

/** True when the rack holds `height` cells of one kind. */
export function isShipment(cfg: RacksConfig, rack: ReadonlyArray<{ readonly kind: number }>): boolean {
  return rack.length === cfg.height && rack.every((c) => c.kind === rack[0]!.kind);
}

/** True when a move from `from` to `to` would fill `to` with one kind and ship it. */
export function wouldShip(state: RacksState, from: number, to: number): boolean {
  const count = movable(state, from, to);
  if (count === 0) return false;
  const dest = state.racks[to]!;
  const kind = topGroup(state.racks[from]!)!.kind;
  return dest.length + count === state.config.height && dest.every((c) => c.kind === kind);
}

/** True when the waiting crate has room on its rack as things stand. When false, landing now would smash the rack. */
export function crateFits(state: RacksState): boolean {
  return state.racks[state.crate.rack]!.length + state.crate.cells.length <= state.config.height;
}

/** True when the waiting crate, landing as things stand, would complete its rack and ship it. */
export function crateWouldShip(state: RacksState): boolean {
  return crateFits(state) && isShipment(state.config, [...state.racks[state.crate.rack]!, ...state.crate.cells]);
}

/** What the chain multiplies by, in percent, at a chain of `chain` shipments. */
export function chainPercentAt(cfg: RacksConfig, chain: number): number {
  if (chain <= 0) return 100;
  return cfg.chainPercent[Math.min(chain, cfg.chainPercent.length) - 1]!;
}

/** What a shipment `chain` long in its chain scores. */
export function shipmentPoints(cfg: RacksConfig, chain: number): number {
  return Math.floor((cfg.shipPoints * chainPercentAt(cfg, chain)) / 100);
}

/** What a shipment made on the next action would be: its place in the chain, the percent and the points. */
export function nextShipment(state: RacksState): { chain: number; percent: number; points: number } {
  const chain = state.combo + 1;
  return { chain, percent: chainPercentAt(state.config, chain), points: shipmentPoints(state.config, chain) };
}

interface Work {
  racks: RacksCell[][];
  bag: number[];
  rng: PrngState;
  nextId: number;
}

/** Draw one kind from the bag, refilling and shuffling it when it is empty. */
function draw(cfg: RacksConfig, w: Work): number {
  if (w.bag.length === 0) {
    const bag: number[] = [];
    for (let k = 0; k < cfg.kinds; k++) for (let n = 0; n < cfg.bagCopies; n++) bag.push(k);
    for (let i = bag.length - 1; i > 0; i--) {
      const r = nextInt(w.rng, i + 1);
      w.rng = r.state;
      const t = bag[i]!;
      bag[i] = bag[r.value]!;
      bag[r.value] = t;
    }
    w.bag = bag;
  }
  return w.bag.pop()!;
}

/**
 * Hang the next crate: its cells from the bag, over a rack drawn at random. With `markRoom` the
 * draw is among the racks that have room for it, while any has.
 */
function dealCrate(cfg: RacksConfig, w: Work): RacksCrate {
  const size = nextInt(w.rng, cfg.crateMax - cfg.crateMin + 1);
  w.rng = size.state;
  const cells: RacksCell[] = [];
  for (let i = 0; i < cfg.crateMin + size.value; i++) {
    // The first cell is from the bag; each one after it is too, or repeats the cell under it.
    let fresh = true;
    if (i > 0 && cfg.crateMixPercent < 100) {
      const roll = nextInt(w.rng, 100);
      w.rng = roll.state;
      fresh = roll.value < cfg.crateMixPercent;
    }
    cells.push({ id: w.nextId++, kind: fresh ? draw(cfg, w) : cells[i - 1]!.kind });
  }
  let open: number[] = [];
  for (let r = 0; r < cfg.racks; r++) if (!cfg.markRoom || w.racks[r]!.length + cells.length <= cfg.height) open.push(r);
  if (open.length === 0) open = w.racks.map((_, r) => r);
  const pick = nextInt(w.rng, open.length);
  w.rng = pick.state;
  return { cells, rack: open[pick.value]!, lands: cfg.landEvery };
}

export function createRacksGame(seed: string, config: RacksConfig = DEFAULT_RACKS_CONFIG): RacksState {
  validateConfig(config);
  const w: Work = { racks: Array.from({ length: config.racks }, () => []), bag: [], rng: seedFromString(`racks:${seed}`), nextId: 1 };
  // The opening cells are spread low and even, so no rack opens full.
  const cap = Math.max(1, Math.ceil(config.startCells / config.racks));
  for (let n = 0; n < config.startCells; n++) {
    const open: number[] = [];
    for (let r = 0; r < config.racks; r++) if (w.racks[r]!.length < cap) open.push(r);
    if (open.length === 0) break;
    const pick = nextInt(w.rng, open.length);
    w.rng = pick.state;
    w.racks[open[pick.value]!]!.push({ id: w.nextId++, kind: draw(config, w) });
  }
  const crate = dealCrate(config, w);
  return {
    config,
    racks: w.racks,
    crate,
    bag: w.bag,
    rng: w.rng,
    nextId: w.nextId,
    score: 0,
    moveCount: 0,
    combo: 0,
    bestCombo: 0,
    lastShipAt: -1,
    shipped: 0,
    shippedByCrate: 0,
    spills: 0,
    calls: 0,
    lastMove: null,
    finished: false,
  };
}

export function reduceRacks(state: RacksState, move: RacksMove): RacksState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "move": {
      const reason = moveIllegalReason(state, move.from, move.to);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      return act(state, move);
    }
    case "call":
      return act(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function act(state: RacksState, move: Extract<RacksMove, { type: "move" | "call" }>): RacksState {
  const cfg = state.config;
  const w: Work = { racks: state.racks.map((r) => r.slice()), bag: state.bag.slice(), rng: state.rng, nextId: state.nextId };
  const events: RacksEvent[] = [];
  const action = state.moveCount + 1;
  let combo = state.combo;
  let bestCombo = state.bestCombo;
  let lastShipAt = state.lastShipAt;
  let score = state.score;
  let shipped = state.shipped;
  let shippedByCrate = state.shippedByCrate;
  let spills = state.spills;
  let crate = state.crate;

  const shipIfFull = (rack: number, byCrate: boolean): void => {
    const cells = w.racks[rack]!;
    if (!isShipment(cfg, cells)) return;
    // A chain still running is carried on; `combo` is already 0 when the chain has lapsed.
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    lastShipAt = action;
    const points = shipmentPoints(cfg, combo);
    score += points;
    shipped++;
    if (byCrate) shippedByCrate++;
    events.push({ type: "ship", rack, kind: cells[0]!.kind, ids: cells.map((c) => c.id), chain: combo, chainPercent: chainPercentAt(cfg, combo), points, byCrate });
    w.racks[rack] = [];
  };

  if (move.type === "move") {
    const count = movable(state, move.from, move.to);
    const from = w.racks[move.from]!;
    const moved = from.splice(from.length - count, count);
    w.racks[move.to]!.push(...moved);
    events.push({ type: "move", from: move.from, to: move.to, ids: moved.map((c) => c.id) });
    shipIfFull(move.to, false);
  }

  // Every move brings the crate one step nearer; a call brings it down at once.
  const left = move.type === "move" ? crate.lands - 1 : 0;
  if (left > 0) crate = { ...crate, lands: left };
  else {
    const rack = crate.rack;
    if (w.racks[rack]!.length + crate.cells.length > cfg.height) {
      const dumped = w.racks[rack]!;
      const penalty = Math.min(score, cfg.spillPenalty);
      score -= penalty;
      spills++;
      combo = 0;
      events.push({ type: "spill", rack, ids: dumped.map((c) => c.id), penalty });
      w.racks[rack] = [];
    }
    w.racks[rack]!.push(...crate.cells);
    events.push({ type: "land", rack, ids: crate.cells.map((c) => c.id), called: move.type === "call" });
    shipIfFull(rack, true);
    crate = dealCrate(cfg, w);
    events.push({ type: "deal", crate });
  }

  // A chain is over once the next action would come too late to carry it on.
  if (combo > 0 && action - lastShipAt >= cfg.chainWindow) combo = 0;

  const report: RacksMoveReport = { move, events, points: score - state.score };
  return {
    config: cfg,
    racks: w.racks,
    crate,
    bag: w.bag,
    rng: w.rng,
    nextId: w.nextId,
    score,
    moveCount: action,
    combo,
    bestCombo,
    lastShipAt,
    shipped,
    shippedByCrate,
    spills,
    calls: state.calls + (move.type === "call" ? 1 : 0),
    lastMove: report,
    finished: action >= cfg.maxMoves,
  };
}

export function replayRacks(seed: string, config: RacksConfig, moves: readonly RacksMove[]): RacksState {
  let s = createRacksGame(seed, config);
  for (const m of moves) s = reduceRacks(s, m);
  return s;
}

const pure = (rack: readonly RacksCell[]): boolean => rack.every((c) => c.kind === rack[0]!.kind);

/** How good a move looks to a tidy sorter who watches the mark. Null means never. */
function tidyScore(state: RacksState, from: number, to: number): number | null {
  const cfg = state.config;
  const n = movable(state, from, to);
  if (n === 0) return null;
  const src = state.racks[from]!;
  const dst = state.racks[to]!;
  const group = topGroup(src)!;
  const marked = state.crate.rack;
  const crate = state.crate.cells.length;
  if (wouldShip(state, from, to)) return 1000;
  // A rack the crate will smash is worth emptying even when it is in good order.
  const clearing = from === marked && src.length + crate > cfg.height;
  // Part of a group that ships nothing only fills another rack up.
  if (n < group.count) return null;
  const srcPure = pure(src) && !clearing;
  const dstTop = topGroup(dst);
  let v: number;
  if (dstTop === null) {
    if (srcPure) return null;
    v = 20 + 5 * n;
  } else if (dstTop.kind === group.kind) {
    if (srcPure && !pure(dst)) return null;
    // Two racks of one kind: the shorter goes onto the taller.
    if (srcPure && (src.length > dst.length || (src.length === dst.length && from < to))) return null;
    v = 50 + 10 * (dstTop.count + n) + (pure(dst) ? 30 : 0);
  } else {
    if (srcPure) return null;
    v = -30 - 5 * dst.length - (pure(dst) ? 20 : 0);
  }
  // What the move uncovers: a cell that can join something next is worth digging for.
  if (src.length > n) {
    const under = src[src.length - n - 1]!.kind;
    for (let r = 0; r < cfg.racks; r++) {
      if (r === from || r === to) continue;
      const t = topGroup(state.racks[r]!);
      if (t && t.kind === under) {
        v += 30;
        break;
      }
    }
  }
  // The mark: never fill the rack the crate needs, and clear it when the crate will not fit.
  if (to === marked && dst.length + n + crate > cfg.height) v -= 200;
  if (clearing) v += 120;
  return v;
}

/**
 * An action worth taking, for the board's idle hint: a shipment if one is there, room under a crate
 * that will not fit, the best tidying move, and the call when the racks are in order. Null only when
 * the round is over.
 */
export function hint(state: RacksState): Extract<RacksMove, { type: "move" | "call" }> | null {
  if (state.finished) return null;
  let best: { from: number; to: number; v: number } | null = null;
  for (let from = 0; from < state.config.racks; from++)
    for (let to = 0; to < state.config.racks; to++) {
      const v = tidyScore(state, from, to);
      if (v !== null && (best === null || v > best.v)) best = { from, to, v };
    }
  // A shipment by hand comes first: the crate that would ship its rack is then the next link of the chain.
  if (best && best.v >= 1000) return { type: "move", from: best.from, to: best.to };
  if (crateWouldShip(state)) return { type: "call" };
  if (best && best.v > 0) return { type: "move", from: best.from, to: best.to };
  // Nothing tidier to do: bring the crate down if it fits, and make the least bad move if it does not.
  if (crateFits(state) || best === null) return { type: "call" };
  return { type: "move", from: best.from, to: best.to };
}

export function hashRacksState(state: RacksState): string {
  const h = new Hasher();
  h.int(state.racks.length);
  for (const rack of state.racks) {
    h.int(rack.length);
    for (const c of rack) h.int(c.id).int(c.kind);
  }
  h.int(state.crate.rack).int(state.crate.lands).int(state.crate.cells.length);
  for (const c of state.crate.cells) h.int(c.id).int(c.kind);
  h.int(state.bag.length);
  for (const k of state.bag) h.int(k);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.nextId).int(state.score).int(state.moveCount).int(state.combo).int(state.bestCombo).int(state.lastShipAt);
  h.int(state.shipped).int(state.shippedByCrate).int(state.spills).int(state.calls).int(state.finished ? 1 : 0);
  return h.digest();
}

export interface RacksSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeRacks(state: RacksState): RacksSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/**
 * The racks and the waiting crate as one string: each rack's kinds bottom first, racks joined by
 * `|`, then `;` and the crate as rack:kinds:moves. What the board draws must match it.
 */
export function viewString(
  racks: ReadonlyArray<ReadonlyArray<{ readonly kind: number }>>,
  crate: { readonly cells: ReadonlyArray<{ readonly kind: number }>; readonly rack: number; readonly lands: number },
): string {
  return `${racks.map((r) => r.map((c) => c.kind).join("")).join("|")};${crate.rack}:${crate.cells.map((c) => c.kind).join("")}:${crate.lands}`;
}
