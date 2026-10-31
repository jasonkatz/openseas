import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_NAVIGATION_CONFIG,
  type Completion,
  type FallingStar,
  type Marker,
  type NavigationConfig,
  type NavigationMove,
  type NavigationMoveReport,
  type NavigationState,
  type Star,
} from "./types.js";

export const slotOf = (cfg: NavigationConfig, ring: number, octant: number): number => ring * cfg.octants + octant;
export const ringOf = (cfg: NavigationConfig, slot: number): number => Math.floor(slot / cfg.octants);
export const octantOf = (cfg: NavigationConfig, slot: number): number => slot % cfg.octants;
export const kindOf = (cfg: NavigationConfig, shape: number, color: number): number => shape * cfg.colors + color;
export const shapeOf = (cfg: NavigationConfig, kind: number): number => Math.floor(kind / cfg.colors);
export const colorOf = (cfg: NavigationConfig, kind: number): number => kind % cfg.colors;

type Slots = Array<Star | null>;

export function validateConfig(cfg: NavigationConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.rings, 1, 6) &&
    int(cfg.octants, 3, 16) &&
    int(cfg.shapes, 1, 6) &&
    int(cfg.colors, 1, 8) &&
    cfg.shapes * cfg.colors >= 2 &&
    int(cfg.startStars, 1, cfg.rings * cfg.octants) &&
    int(cfg.maxStars, cfg.startStars, cfg.rings * cfg.octants) &&
    int(cfg.reuseChancePercent, 0, 100) &&
    cfg.starPoints >= 0 &&
    cfg.efficiencyBonus >= 0 &&
    cfg.boochPenalty >= 0 &&
    int(cfg.maxDrops, 1, 100_000) &&
    int(cfg.maxMoves, cfg.maxDrops, 1_000_000);
  if (!ok) throw new Error("invalid navigation config");
}

export function createNavigationGame(seed: string, config: NavigationConfig = DEFAULT_NAVIGATION_CONFIG): NavigationState {
  validateConfig(config);
  let rng = seedFromString(`navigation:${seed}`);
  const slots: Slots = new Array<Star | null>(config.rings * config.octants).fill(null);
  const d1 = dealStar(config, rng);
  rng = d1.rng;
  const d2 = dealStar(config, rng);
  rng = d2.rng;
  const dealt = dealConstellation(config, slots, rng, 0);
  return {
    config,
    slots,
    markers: dealt.markers,
    current: d1.star,
    next: d2.star,
    rng: dealt.rng,
    nextId: 1,
    moveCount: 0,
    logLength: 0,
    dropsSinceDeal: 0,
    completed: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    lastMove: null,
    finished: false,
  };
}

function dealStar(cfg: NavigationConfig, rng: PrngState): { star: FallingStar; rng: PrngState } {
  const k = nextInt(rng, cfg.shapes * cfg.colors);
  const o = nextInt(k.state, cfg.octants);
  return { star: { kind: k.value, octant: o.value }, rng: o.state };
}

/** Markers for the next constellation: distinct slots, kinds that half the time copy a star already on the chart. */
function dealConstellation(cfg: NavigationConfig, slots: ReadonlyArray<Star | null>, rng: PrngState, completed: number): { markers: Marker[]; rng: PrngState } {
  const size = Math.min(cfg.maxStars, cfg.startStars + Math.floor(completed / 2));
  const free: number[] = [];
  for (let i = 0; i < slots.length; i++) free.push(i);
  const onChart = slots.filter((s): s is Star => s !== null);
  const markers: Marker[] = [];
  for (let n = 0; n < size && free.length > 0; n++) {
    const pick = nextInt(rng, free.length);
    rng = pick.state;
    const slot = free.splice(pick.value, 1)[0]!;
    let kind: number;
    const reuse = nextChance(rng, cfg.reuseChancePercent, 100);
    rng = reuse.state;
    if (reuse.value && onChart.length > 0) {
      const which = nextInt(rng, onChart.length);
      rng = which.state;
      kind = onChart[which.value]!.kind;
    } else {
      const k = nextInt(rng, cfg.shapes * cfg.colors);
      rng = k.state;
      kind = k.value;
    }
    markers.push({ ring: ringOf(cfg, slot), octant: octantOf(cfg, slot), kind });
  }
  markers.sort((a, b) => slotOf(cfg, a.ring, a.octant) - slotOf(cfg, b.ring, b.octant));
  return { markers, rng };
}

/** The slot the current star would land in, or null when its octant is full (a booch). */
export function landingSlot(state: NavigationState): number | null {
  const cfg = state.config;
  for (let r = 0; r < cfg.rings; r++) {
    const s = slotOf(cfg, r, state.current.octant);
    if (state.slots[s] === null) return s;
  }
  return null;
}

/** True while the marker's slot holds a star of its kind. */
export function markerFilled(state: NavigationState, m: Marker): boolean {
  return state.slots[slotOf(state.config, m.ring, m.octant)]?.kind === m.kind;
}

export function rotateIllegalReason(state: NavigationState, ring: number, dir: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(ring) || ring < 0 || ring >= state.config.rings) return "no such ring";
  if (dir !== 1 && dir !== -1) return "bad direction";
  return null;
}

export function reduceNavigation(state: NavigationState, move: NavigationMove): NavigationState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, finished: true, logLength: state.logLength + 1, lastMove: { move, landed: null, booch: null, completions: [], points: 0 } };
    case "rotate":
      return applyRotate(state, move);
    case "drop":
      return applyDrop(state, move);
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

export function replayNavigation(seed: string, moves: readonly NavigationMove[], config: NavigationConfig = DEFAULT_NAVIGATION_CONFIG): NavigationState {
  let s = createNavigationGame(seed, config);
  for (const m of moves) s = reduceNavigation(s, m);
  return s;
}

export function hashNavigationState(state: NavigationState): string {
  const h = new Hasher();
  h.int(state.config.rings).int(state.config.octants).int(state.config.shapes).int(state.config.colors);
  for (const s of state.slots) {
    if (s === null) h.int(-1);
    else h.int(s.id).int(s.kind);
  }
  h.int(state.markers.length);
  for (const m of state.markers) h.int(m.ring).int(m.octant).int(m.kind);
  h.int(state.current.kind).int(state.current.octant).int(state.next.kind).int(state.next.octant);
  h.int(state.nextId).int(state.moveCount).int(state.logLength).int(state.dropsSinceDeal).int(state.completed).int(state.score).int(state.combo);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface NavigationSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeNavigation(state: NavigationState): NavigationSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

// ---- internals

function applyRotate(state: NavigationState, move: Extract<NavigationMove, { type: "rotate" }>): NavigationState {
  const reason = rotateIllegalReason(state, move.ring, move.dir);
  if (reason !== null) throw new InvalidMoveError(reason, move);
  const cfg = state.config;
  const slots: Slots = state.slots.slice();
  const base = move.ring * cfg.octants;
  for (let o = 0; o < cfg.octants; o++) {
    const to = (o + move.dir + cfg.octants) % cfg.octants;
    slots[base + to] = state.slots[base + o]!;
  }
  return finishMove(state, move, slots, state.rng, state.nextId, null, null, state.moveCount, state.dropsSinceDeal);
}

function applyDrop(state: NavigationState, move: Extract<NavigationMove, { type: "drop" }>): NavigationState {
  const cfg = state.config;
  const slots: Slots = state.slots.slice();
  let nextId = state.nextId;
  let landed: NavigationMoveReport["landed"] = null;
  let booch: NavigationMoveReport["booch"] = null;
  const slot = landingSlot(state);
  if (slot !== null) {
    const star: Star = { id: nextId++, kind: state.current.kind };
    slots[slot] = star;
    landed = { slot, id: star.id };
  } else {
    const ids: number[] = [];
    for (let r = 0; r < cfg.rings; r++) {
      const s = slotOf(cfg, r, state.current.octant);
      ids.push(slots[s]!.id);
      slots[s] = null;
    }
    booch = { octant: state.current.octant, ids, penalty: cfg.boochPenalty };
  }
  return finishMove(state, move, slots, state.rng, nextId, landed, booch, state.moveCount + 1, state.dropsSinceDeal + 1);
}

/** Shared tail of every move: resolve completions, deal stars and constellations, score, and finish. */
function finishMove(
  state: NavigationState,
  move: NavigationMove,
  slots: Slots,
  rng: PrngState,
  nextId: number,
  landed: NavigationMoveReport["landed"],
  booch: NavigationMoveReport["booch"],
  moveCount: number,
  dropsSinceDeal: number,
): NavigationState {
  const cfg = state.config;
  let markers = state.markers;
  let combo = booch ? 0 : state.combo;
  let score = booch ? Math.max(0, state.score - booch.penalty) : state.score;
  let completed = state.completed;
  const completions: Completion[] = [];
  // A completed constellation comes off the chart; the redeal may itself be complete, so loop.
  for (;;) {
    const filled = markers.length > 0 && markers.every((m) => slots[slotOf(cfg, m.ring, m.octant)]?.kind === m.kind);
    if (!filled) break;
    const n = markers.length;
    const ids = markers.map((m) => slots[slotOf(cfg, m.ring, m.octant)]!.id);
    for (const m of markers) slots[slotOf(cfg, m.ring, m.octant)] = null;
    const chain = combo + 1;
    const efficient = dropsSinceDeal <= 2 * n;
    const points = n * n * cfg.starPoints * chain + (efficient ? cfg.efficiencyBonus : 0);
    completions.push({ markers, ids, chain, efficient, points });
    score += points;
    combo = chain;
    completed++;
    dropsSinceDeal = 0;
    const dealt = dealConstellation(cfg, slots, rng, completed);
    markers = dealt.markers;
    rng = dealt.rng;
  }
  let current = state.current;
  let next = state.next;
  if (move.type === "drop") {
    current = state.next;
    const d = dealStar(cfg, rng);
    next = d.star;
    rng = d.rng;
  }
  const points = completions.reduce((sum, c) => sum + c.points, 0);
  const logLength = state.logLength + 1;
  return {
    config: cfg,
    slots,
    markers,
    current,
    next,
    rng,
    nextId,
    moveCount,
    logLength,
    dropsSinceDeal,
    completed,
    score,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    lastMove: { move, landed, booch, completions, points },
    finished: moveCount >= cfg.maxDrops || logLength >= cfg.maxMoves,
  };
}
