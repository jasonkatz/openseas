import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextChance, nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_NAVIGATION_CONFIG,
  type Completion,
  type FallingStar,
  type Marker,
  type NavigationConfig,
  type NavigationEvent,
  type NavigationMove,
  type NavigationMoveReport,
  type NavigationState,
  type Run,
  type Star,
} from "./types.js";

export const slotOf = (cfg: NavigationConfig, ring: number, octant: number): number => ring * cfg.octants + octant;
export const ringOf = (cfg: NavigationConfig, slot: number): number => Math.floor(slot / cfg.octants);
export const octantOf = (cfg: NavigationConfig, slot: number): number => slot % cfg.octants;
export const kindOf = (cfg: NavigationConfig, shape: number, color: number): number => shape * cfg.colors + color;
export const shapeOf = (cfg: NavigationConfig, kind: number): number => Math.floor(kind / cfg.colors);
export const colorOf = (cfg: NavigationConfig, kind: number): number => kind % cfg.colors;

/** The octant stars fall into. */
export const ENTRY_OCTANT = 0;

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
    Array.isArray(cfg.chainPercent) &&
    cfg.chainPercent.length >= 1 &&
    cfg.chainPercent.length <= 16 &&
    cfg.chainPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000) &&
    cfg.runPoints >= 0 &&
    cfg.lostHeadingPenalty >= 0 &&
    int(cfg.tickMs, 20, 5000) &&
    int(cfg.maxTick, 1, 100_000) &&
    int(cfg.maxMoves, 1, 1_000_000) &&
    int(cfg.fallTicks, 1, 10_000) &&
    int(cfg.fallTicksMin, 1, cfg.fallTicks);
  if (!ok) throw new Error("invalid navigation config");
}

export function createNavigationGame(seed: string, config: NavigationConfig = DEFAULT_NAVIGATION_CONFIG): NavigationState {
  validateConfig(config);
  let rng = seedFromString(`navigation:${seed}`);
  const slots: Slots = new Array<Star | null>(config.rings * config.octants).fill(null);
  const k1 = nextInt(rng, config.shapes * config.colors);
  rng = k1.state;
  const k2 = nextInt(rng, config.shapes * config.colors);
  rng = k2.state;
  const dealt = dealConstellation(config, slots, rng, 0);
  return {
    config,
    tick: 0,
    slots,
    markers: dealt.markers,
    falling: { kind: k1.value, startTick: 0, landTick: fallDuration(config, 0) },
    next: k2.value,
    rng: dealt.rng,
    nextId: 1,
    eventSeq: 0,
    moveCount: 0,
    logLength: 0,
    landings: 0,
    landingsSinceDeal: 0,
    completed: 0,
    lostHeadings: 0,
    runsCleared: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    lastMove: null,
    finished: false,
  };
}

/** Ticks a star set off at `tick` takes to come down: `fallTicks` at the start, quickening to the minimum. */
export function fallDuration(cfg: NavigationConfig, tick: number): number {
  const span = cfg.fallTicks - cfg.fallTicksMin;
  if (span <= 0) return cfg.fallTicks;
  const steps = Math.floor(((span + 1) * Math.max(0, Math.min(tick, cfg.maxTick))) / cfg.maxTick);
  return Math.max(cfg.fallTicksMin, cfg.fallTicks - steps);
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

/**
 * Where a star falling into the entry octant comes to rest on these slots: it falls inward until
 * it meets a star, and rests in the ring outside it (or at the center). Columns are always packed
 * toward the center, so this is the innermost empty slot. Null when the outermost slot is taken,
 * so there is no room: a lost heading.
 */
export function landingSlotOn(cfg: NavigationConfig, slots: ReadonlyArray<Star | null>): number | null {
  for (let r = cfg.rings - 1; r >= 0; r--) {
    if (slots[slotOf(cfg, r, ENTRY_OCTANT)] !== null) return r === cfg.rings - 1 ? null : slotOf(cfg, r + 1, ENTRY_OCTANT);
  }
  return slotOf(cfg, 0, ENTRY_OCTANT);
}

/** The slot the falling star would land in right now, or null when the entry octant is blocked. */
export function landingSlot(state: NavigationState): number | null {
  return landingSlotOn(state.config, state.slots);
}

/** True while the marker's slot holds a star of its kind. */
export function markerFilled(state: NavigationState, m: Marker): boolean {
  return state.slots[slotOf(state.config, m.ring, m.octant)]?.kind === m.kind;
}

export function filledCount(cfg: NavigationConfig, slots: ReadonlyArray<Star | null>, markers: readonly Marker[]): number {
  let n = 0;
  for (const m of markers) if (slots[slotOf(cfg, m.ring, m.octant)]?.kind === m.kind) n++;
  return n;
}

export function rotateIllegalReason(state: NavigationState, ring: number, dir: number): string | null {
  if (state.finished) return "game is finished";
  if (!Number.isInteger(ring) || ring < 0 || ring >= state.config.rings) return "no such ring";
  if (dir !== 1 && dir !== -1) return "bad direction";
  return null;
}

export function reduceNavigation(state: NavigationState, move: NavigationMove): NavigationState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (!Number.isInteger(move.tick) || move.tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
  if (move.tick > state.config.maxTick) throw new InvalidMoveError("tick beyond the round", move);
  const sim = simulate(state, move.tick);
  let w = sim.work;
  switch (move.type) {
    case "wait":
      break;
    case "end":
      w = { ...w, finished: true };
      break;
    case "rotate": {
      const reason = rotateIllegalReason(state, move.ring, move.dir);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      w = rotateRing(w, move.ring, move.dir);
      w = resolve(w);
      break;
    }
    case "drop":
      // A drop sent on the very tick a star came down was meant for that star; the new one keeps falling.
      if (!sim.landedNow) w = land(w, move.tick);
      break;
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
  const moveCount = move.type === "rotate" || move.type === "drop" ? state.moveCount + 1 : state.moveCount;
  const logLength = state.logLength + 1;
  const report: NavigationMoveReport = { move, events: w.events, points: w.score - state.score };
  return {
    ...finishWork(state, w),
    moveCount,
    logLength,
    lastMove: report,
    finished: w.finished || logLength >= state.config.maxMoves || w.tick >= state.config.maxTick,
  };
}

/** The state at a later tick, without logging a move. Clients call this to show time passing. */
export function advanceNavigation(state: NavigationState, tick: number): NavigationState {
  if (tick <= state.tick || state.finished) return state;
  const sim = simulate(state, Math.min(tick, state.config.maxTick));
  return { ...finishWork(state, sim.work), lastMove: { move: { type: "wait", tick: sim.work.tick }, events: sim.work.events, points: sim.work.score - state.score } };
}

export function replayNavigation(seed: string, moves: readonly NavigationMove[], config: NavigationConfig = DEFAULT_NAVIGATION_CONFIG): NavigationState {
  let s = createNavigationGame(seed, config);
  for (const m of moves) s = reduceNavigation(s, m);
  return s;
}

export function hashNavigationState(state: NavigationState): string {
  const h = new Hasher();
  h.int(state.config.rings).int(state.config.octants).int(state.config.shapes).int(state.config.colors);
  h.int(state.tick);
  for (const s of state.slots) {
    if (s === null) h.int(-1);
    else h.int(s.id).int(s.kind);
  }
  h.int(state.markers.length);
  for (const m of state.markers) h.int(m.ring).int(m.octant).int(m.kind);
  h.int(state.falling.kind).int(state.falling.startTick).int(state.falling.landTick).int(state.next);
  h.int(state.nextId).int(state.eventSeq).int(state.moveCount).int(state.logLength).int(state.landings).int(state.landingsSinceDeal);
  h.int(state.completed).int(state.lostHeadings).int(state.runsCleared).int(state.score).int(state.combo).int(state.bestCombo);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface NavigationSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

/** `moves` is stars that came down: the count a navigator would recognise. */
export function summarizeNavigation(state: NavigationState): NavigationSummary {
  return { score: state.score, moves: state.landings, bestCombo: state.bestCombo };
}

// ---- hint, for unrated practice

export interface NavigationHint {
  readonly ring: number;
  readonly dir: -1 | 1;
}

/**
 * The next turn worth making: one that fills a marker right now, else the first step of the
 * cheapest plan that lands the falling star where, after one more turn of its ring, more markers
 * are filled than now. Null when nothing helps or the chart is too big to search. Presentation
 * only; rated rounds never see it.
 */
export function hint(state: NavigationState): NavigationHint | null {
  const cfg = state.config;
  const half = Math.floor(cfg.octants / 2);
  const before = filledCount(cfg, state.slots, state.markers);
  // 1. A turn of one ring that fills more markers than now.
  let best: { steps: number; gain: number; ring: number; dir: -1 | 1 } | null = null;
  for (let r = 0; r < cfg.rings; r++) {
    for (let d = -half; d <= half; d++) {
      if (d === 0) continue;
      const gain = filledCount(cfg, settled(cfg, rotated(cfg, state.slots, r, d)).slots, state.markers) - before;
      if (gain <= 0) continue;
      const steps = Math.abs(d);
      if (!best || gain > best.gain || (gain === best.gain && steps < best.steps)) best = { steps, gain, ring: r, dir: d > 0 ? 1 : -1 };
    }
  }
  if (best) return { ring: best.ring, dir: best.dir };
  if (Math.pow(cfg.octants, cfg.rings) > 4096) return null;
  // 2. Turn the rings so the star lands on a ring where, once that ring is turned to suit, more markers hold.
  const kind = state.falling.kind;
  const offsets = new Array<number>(cfg.rings).fill(-half);
  let plan: { steps: number; gain: number; first: NavigationHint | null } | null = null;
  for (;;) {
    let slots: ReadonlyArray<Star | null> = state.slots;
    let steps = 0;
    for (let r = 0; r < cfg.rings; r++) {
      if (offsets[r] !== 0) {
        slots = rotated(cfg, slots, r, offsets[r]!);
        steps += Math.abs(offsets[r]!);
      }
    }
    if (steps > 0) slots = settled(cfg, slots).slots;
    const slot = landingSlotOn(cfg, slots);
    if (slot !== null) {
      const L = ringOf(cfg, slot);
      const withStar: Slots = slots.slice();
      withStar[slot] = { id: -1, kind };
      for (let e = -half; e <= half; e++) {
        const after = e === 0 ? withStar : settled(cfg, rotated(cfg, withStar, L, e)).slots;
        const gain = filledCount(cfg, after, state.markers) - before;
        if (gain <= 0) continue;
        const total = steps + Math.abs(e);
        if (!plan || gain > plan.gain || (gain === plan.gain && total < plan.steps)) {
          let first: NavigationHint | null = null;
          // Open the column from the outside in, so the blocking ring moves first.
          for (let r = cfg.rings - 1; r >= 0; r--) {
            if (offsets[r] !== 0) {
              first = { ring: r, dir: offsets[r]! > 0 ? 1 : -1 };
              break;
            }
          }
          plan = { steps: total, gain, first };
        }
      }
    }
    // Next offset combination.
    let i = 0;
    while (i < cfg.rings) {
      offsets[i]!++;
      if (offsets[i]! <= half) break;
      offsets[i] = -half;
      i++;
    }
    if (i === cfg.rings) break;
  }
  return plan?.first ?? null;
}

/** `slots` with every column packed toward the center, and which stars moved to do it. */
export function settled(cfg: NavigationConfig, slots: ReadonlyArray<Star | null>): { slots: Slots; moves: Array<{ id: number; from: number; to: number }> } {
  const out: Slots = slots.slice();
  const moves: Array<{ id: number; from: number; to: number }> = [];
  for (let o = 0; o < cfg.octants; o++) {
    let to = 0;
    for (let r = 0; r < cfg.rings; r++) {
      const from = slotOf(cfg, r, o);
      const star = slots[from];
      if (!star) continue;
      const dest = slotOf(cfg, to, o);
      if (dest !== from) {
        out[dest] = star;
        out[from] = null;
        moves.push({ id: star.id, from, to: dest });
      }
      to++;
    }
  }
  return { slots: out, moves };
}

/** `slots` with ring `ring` turned `steps` octants clockwise (negative for the other way). */
function rotated(cfg: NavigationConfig, slots: ReadonlyArray<Star | null>, ring: number, steps: number): Slots {
  const out: Slots = slots.slice();
  const base = ring * cfg.octants;
  for (let o = 0; o < cfg.octants; o++) {
    const to = (((o + steps) % cfg.octants) + cfg.octants) % cfg.octants;
    out[base + to] = slots[base + o]!;
  }
  return out;
}

// ---- internals

/** The mutable-by-replacement working copy a move builds up before it becomes a state. */
interface Work {
  readonly cfg: NavigationConfig;
  tick: number;
  slots: Slots;
  markers: readonly Marker[];
  falling: FallingStar;
  next: number;
  rng: PrngState;
  nextId: number;
  eventSeq: number;
  landings: number;
  landingsSinceDeal: number;
  completed: number;
  lostHeadings: number;
  runsCleared: number;
  score: number;
  combo: number;
  bestCombo: number;
  events: NavigationEvent[];
  finished: boolean;
}

function startWork(state: NavigationState): Work {
  return {
    cfg: state.config,
    tick: state.tick,
    slots: state.slots.slice(),
    markers: state.markers,
    falling: state.falling,
    next: state.next,
    rng: state.rng,
    nextId: state.nextId,
    eventSeq: state.eventSeq,
    landings: state.landings,
    landingsSinceDeal: state.landingsSinceDeal,
    completed: state.completed,
    lostHeadings: state.lostHeadings,
    runsCleared: state.runsCleared,
    score: state.score,
    combo: state.combo,
    bestCombo: state.bestCombo,
    events: [],
    finished: state.finished,
  };
}

function finishWork(state: NavigationState, w: Work): NavigationState {
  return {
    ...state,
    tick: w.tick,
    slots: w.slots,
    markers: w.markers,
    falling: w.falling,
    next: w.next,
    rng: w.rng,
    nextId: w.nextId,
    eventSeq: w.eventSeq,
    landings: w.landings,
    landingsSinceDeal: w.landingsSinceDeal,
    completed: w.completed,
    lostHeadings: w.lostHeadings,
    runsCleared: w.runsCleared,
    score: w.score,
    combo: w.combo,
    bestCombo: w.bestCombo,
    finished: w.finished,
  };
}

/** Bring the chart up to `tick`: every star whose fall ends by then comes down, in order. */
function simulate(state: NavigationState, tick: number): { work: Work; landedNow: boolean } {
  let w = startWork(state);
  let landedNow = false;
  while (!w.finished && w.falling.landTick <= tick) {
    const at = w.falling.landTick;
    w = land(w, at);
    landedNow = at === tick;
    if (w.tick >= w.cfg.maxTick) break;
  }
  w.tick = Math.max(w.tick, tick);
  return { work: w, landedNow };
}

/** The falling star comes down at `tick`, then the next one sets off. */
function land(w: Work, tick: number): Work {
  const cfg = w.cfg;
  w.tick = tick;
  const slot = landingSlotOn(cfg, w.slots);
  w.landings++;
  w.landingsSinceDeal++;
  if (slot !== null) {
    const star: Star = { id: w.nextId++, kind: w.falling.kind };
    w.slots[slot] = star;
    const onMarker = w.markers.some((m) => slotOf(cfg, m.ring, m.octant) === slot && m.kind === star.kind);
    w.events.push({ seq: ++w.eventSeq, tick, type: "land", slot, id: star.id, kind: star.kind, onMarker });
  } else {
    // The whole entry octant is swept; only its outer slot is sure to hold a star.
    const ids: number[] = [];
    for (let r = 0; r < cfg.rings; r++) {
      const s = slotOf(cfg, r, ENTRY_OCTANT);
      const star = w.slots[s];
      if (star) ids.push(star.id);
      w.slots[s] = null;
    }
    w.lostHeadings++;
    w.combo = 0;
    w.score = Math.max(0, w.score - cfg.lostHeadingPenalty);
    w.events.push({ seq: ++w.eventSeq, tick, type: "lost_heading", octant: ENTRY_OCTANT, ids, penalty: cfg.lostHeadingPenalty });
  }
  w = resolve(w);
  const k = nextInt(w.rng, cfg.shapes * cfg.colors);
  w.rng = k.state;
  w.falling = { kind: w.next, startTick: tick, landTick: tick + fallDuration(cfg, tick) };
  w.next = k.value;
  return w;
}

function rotateRing(w: Work, ring: number, dir: -1 | 1): Work {
  w.slots = rotated(w.cfg, w.slots, ring, dir);
  return w;
}

/** Pack every column toward the center; a fall event when anything moved. */
function settle(w: Work): boolean {
  const r = settled(w.cfg, w.slots);
  if (!r.moves.length) return false;
  w.slots = r.slots;
  w.events.push({ seq: ++w.eventSeq, tick: w.tick, type: "fall", moves: r.moves });
  return true;
}

/**
 * After any change to the slots: stars slide inward to pack their columns, completed
 * constellations are charted (the redeal may complete at once, so that loops), runs of loose stars
 * clear, and since each of those opens slots, the whole thing repeats until the chart is still.
 */
function resolve(w: Work): Work {
  const cfg = w.cfg;
  for (;;) {
    settle(w);
    let changed = false;
    for (;;) {
      const filled = w.markers.length > 0 && w.markers.every((m) => w.slots[slotOf(cfg, m.ring, m.octant)]?.kind === m.kind);
      if (!filled) break;
      changed = true;
      const n = w.markers.length;
      const ids = w.markers.map((m) => w.slots[slotOf(cfg, m.ring, m.octant)]!.id);
      for (const m of w.markers) w.slots[slotOf(cfg, m.ring, m.octant)] = null;
      const chain = w.combo + 1;
      const chainPercent = cfg.chainPercent[Math.min(chain, cfg.chainPercent.length) - 1]!;
      const saved = Math.max(0, 2 * n - w.landingsSinceDeal);
      const points = Math.floor((n * n * cfg.starPoints * chainPercent) / 100) + saved * n * cfg.starPoints;
      const completion: Completion = { markers: w.markers, ids, chain, chainPercent, saved, efficient: saved > 0, points };
      w.events.push({ seq: ++w.eventSeq, tick: w.tick, type: "charted", completion });
      w.score += points;
      w.combo = chain;
      w.bestCombo = Math.max(w.bestCombo, chain);
      w.completed++;
      w.landingsSinceDeal = 0;
      const dealt = dealConstellation(cfg, w.slots, w.rng, w.completed);
      w.markers = dealt.markers;
      w.rng = dealt.rng;
    }
    const runs = findRuns(cfg, w.slots, w.markers);
    if (runs.length) {
      changed = true;
      const cleared = new Set<number>();
      for (const run of runs) {
        w.events.push({ seq: ++w.eventSeq, tick: w.tick, type: "run", run });
        w.score += run.points;
        w.runsCleared++;
        for (const s of run.slots) cleared.add(s);
      }
      for (const s of cleared) w.slots[s] = null;
    }
    if (!changed) return w;
  }
}

/**
 * Runs of three or more loose stars of one kind: consecutive around a ring, or consecutive rings
 * down an octant. A star sitting on its marker is charted, not loose, and never part of a run.
 */
export function findRuns(cfg: NavigationConfig, slots: ReadonlyArray<Star | null>, markers: readonly Marker[]): Run[] {
  const loose = (slot: number): Star | null => {
    const s = slots[slot];
    if (!s) return null;
    for (const m of markers) if (slotOf(cfg, m.ring, m.octant) === slot && m.kind === s.kind) return null;
    return s;
  };
  const runs: Run[] = [];
  const push = (kind: number, run: number[]): void => {
    if (run.length < 3) return;
    runs.push({ kind, slots: run, ids: run.map((s) => slots[s]!.id), points: cfg.runPoints * (run.length - 2) });
  };
  // Around each ring, starting just after a break so a run that wraps is counted once.
  for (let r = 0; r < cfg.rings; r++) {
    const at = (o: number): Star | null => loose(slotOf(cfg, r, ((o % cfg.octants) + cfg.octants) % cfg.octants));
    let start = -1;
    for (let o = 0; o < cfg.octants; o++) {
      const a = at(o);
      const b = at(o - 1);
      if (a === null || b === null || a.kind !== b.kind) {
        start = o;
        break;
      }
    }
    if (start === -1) {
      // Every slot of the ring holds a loose star of one kind.
      const all: number[] = [];
      for (let o = 0; o < cfg.octants; o++) all.push(slotOf(cfg, r, o));
      push(at(0)!.kind, all);
      continue;
    }
    let run: number[] = [];
    let kind = -1;
    for (let i = 0; i < cfg.octants; i++) {
      const o = (start + i) % cfg.octants;
      const s = at(o);
      if (s !== null && s.kind === kind) run.push(slotOf(cfg, r, o));
      else {
        push(kind, run);
        run = s === null ? [] : [slotOf(cfg, r, o)];
        kind = s === null ? -1 : s.kind;
      }
    }
    push(kind, run);
  }
  // Down each octant.
  for (let o = 0; o < cfg.octants; o++) {
    let run: number[] = [];
    let kind = -1;
    for (let r = 0; r < cfg.rings; r++) {
      const s = loose(slotOf(cfg, r, o));
      if (s !== null && s.kind === kind) run.push(slotOf(cfg, r, o));
      else {
        push(kind, run);
        run = s === null ? [] : [slotOf(cfg, r, o)];
        kind = s === null ? -1 : s.kind;
      }
    }
    push(kind, run);
  }
  return runs;
}
