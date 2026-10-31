import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_NAVIGATION_CONFIG,
  InvalidMoveError,
  createNavigationGame,
  hashNavigationState,
  navigationLandingSlot,
  navigationSlotOf,
  reduceNavigation,
  replayNavigation,
  type Marker,
  type NavigationMove,
  type NavigationState,
  type Star,
} from "../src/index.js";

const cfg = DEFAULT_NAVIGATION_CONFIG;

/** Picks: 0..rings*2-1 rotate (ring, dir); the rest drop. Roughly one drop per three moves. */
function moveFor(state: NavigationState, pick: number): NavigationMove {
  const n = state.config.rings * 2;
  const k = pick % (n + Math.ceil(n / 2));
  if (k < n) return { type: "rotate", ring: Math.floor(k / 2), dir: k % 2 === 0 ? 1 : -1 };
  return { type: "drop" };
}

function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: NavigationMove[]; state: NavigationState } {
  let state = createNavigationGame(seed, config);
  const moves: NavigationMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = moveFor(state, p);
    moves.push(m);
    state = reduceNavigation(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 120 });

function ringKinds(state: NavigationState, ring: number): number[] {
  const out: number[] = [];
  for (let o = 0; o < state.config.octants; o++) {
    const s = state.slots[navigationSlotOf(state.config, ring, o)];
    if (s) out.push(s.id);
  }
  return out.sort((a, b) => a - b);
}

function isComplete(state: NavigationState): boolean {
  return state.markers.length > 0 && state.markers.every((m) => state.slots[navigationSlotOf(state.config, m.ring, m.octant)]?.kind === m.kind);
}

describe("navigation chart", () => {
  it("starts empty with a constellation of startStars distinct slots", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createNavigationGame(seed);
        expect(s.slots.length).toBe(cfg.rings * cfg.octants);
        expect(s.slots.every((x) => x === null)).toBe(true);
        expect(s.markers.length).toBe(cfg.startStars);
        const slots = new Set(s.markers.map((m) => navigationSlotOf(cfg, m.ring, m.octant)));
        expect(slots.size).toBe(s.markers.length);
        for (const m of s.markers) expect(m.kind).toBeLessThan(cfg.shapes * cfg.colors);
        expect(s.finished).toBe(false);
      }),
    );
  });
});

describe("navigation determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replayNavigation(seed, a.moves);
        expect(hashNavigationState(b)).toBe(hashNavigationState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 200 },
    );
  });

  it("different seeds deal different openings", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(hashNavigationState(createNavigationGame(a))).not.toBe(hashNavigationState(createNavigationGame(b)));
      }),
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createNavigationGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = moveFor(state, p);
          const before = JSON.stringify(state);
          reduceNavigation(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reduceNavigation(state, m);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("navigation rules", () => {
  it("keeps every invariant after every move", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createNavigationGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = moveFor(state, p);
          const next = reduceNavigation(state, m);
          // Markers are distinct slots and a completed constellation never survives a move.
          const slots = new Set(next.markers.map((x) => navigationSlotOf(cfg, x.ring, x.octant)));
          expect(slots.size).toBe(next.markers.length);
          expect(isComplete(next)).toBe(false);
          // Ids are unique; a rotation keeps the same stars on the ring.
          const ids = next.slots.filter((s): s is Star => s !== null).map((s) => s.id);
          expect(new Set(ids).size).toBe(ids.length);
          if (m.type === "rotate" && next.lastMove?.completions.length === 0) {
            expect(ringKinds(next, m.ring)).toEqual(ringKinds(state, m.ring));
            for (let r = 0; r < cfg.rings; r++) if (r !== m.ring) expect(ringKinds(next, r)).toEqual(ringKinds(state, r));
          }
          expect(next.score).toBeGreaterThanOrEqual(0);
          state = next;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("a rotation carries every star one octant clockwise for dir +1", () => {
    const base = createNavigationGame("spin");
    const slots = base.slots.slice();
    slots[navigationSlotOf(cfg, 1, 0)] = { id: 100, kind: 0 };
    slots[navigationSlotOf(cfg, 1, cfg.octants - 1)] = { id: 101, kind: 1 };
    const state: NavigationState = { ...base, slots, markers: [] };
    const next = reduceNavigation(state, { type: "rotate", ring: 1, dir: 1 });
    expect(next.slots[navigationSlotOf(cfg, 1, 1)]?.id).toBe(100);
    expect(next.slots[navigationSlotOf(cfg, 1, 0)]?.id).toBe(101);
    expect(next.moveCount).toBe(0);
    expect(next.logLength).toBe(1);
  });

  it("a dropped star lands on the innermost empty slot of its octant", () => {
    const base = createNavigationGame("land");
    const o = base.current.octant;
    const slots = base.slots.slice();
    slots[navigationSlotOf(cfg, 0, o)] = { id: 100, kind: 0 };
    const state: NavigationState = { ...base, slots, markers: [] };
    expect(navigationLandingSlot(state)).toBe(navigationSlotOf(cfg, 1, o));
    const next = reduceNavigation(state, { type: "drop" });
    expect(next.lastMove?.landed?.slot).toBe(navigationSlotOf(cfg, 1, o));
    expect(next.slots[navigationSlotOf(cfg, 1, o)]?.kind).toBe(base.current.kind);
    expect(next.current).toEqual(base.next);
    expect(next.moveCount).toBe(1);
  });

  it("a drop into a full octant is a booch: the octant is swept, points are lost, the combo resets", () => {
    const base = createNavigationGame("booch");
    const o = base.current.octant;
    const slots = base.slots.slice();
    for (let r = 0; r < cfg.rings; r++) slots[navigationSlotOf(cfg, r, o)] = { id: 100 + r, kind: 0 };
    const state: NavigationState = { ...base, slots, markers: [], score: 100, combo: 3 };
    const next = reduceNavigation(state, { type: "drop" });
    expect(next.lastMove?.booch).toEqual({ octant: o, ids: [100, 101, 102], penalty: cfg.boochPenalty });
    for (let r = 0; r < cfg.rings; r++) expect(next.slots[navigationSlotOf(cfg, r, o)]).toBeNull();
    expect(next.score).toBe(100 - cfg.boochPenalty);
    expect(next.combo).toBe(0);
    const broke = reduceNavigation({ ...state, score: 5 }, { type: "drop" });
    expect(broke.score).toBe(0);
  });

  it("completing a constellation scores n*n*starPoints times the chain, plus the efficiency bonus, and deals a new one", () => {
    const base = createNavigationGame("complete");
    const o = base.current.octant;
    const markers: Marker[] = [
      { ring: 0, octant: (o + 1) % cfg.octants, kind: 2 },
      { ring: 1, octant: o, kind: base.current.kind },
    ];
    const slots = base.slots.slice();
    slots[navigationSlotOf(cfg, 0, (o + 1) % cfg.octants)] = { id: 100, kind: 2 };
    slots[navigationSlotOf(cfg, 0, o)] = { id: 101, kind: 5 };
    const state: NavigationState = { ...base, slots, markers, combo: 1, dropsSinceDeal: 0 };
    const next = reduceNavigation(state, { type: "drop" });
    expect(next.lastMove?.completions.length).toBe(1);
    const c = next.lastMove!.completions[0]!;
    expect(c.chain).toBe(2);
    expect(c.efficient).toBe(true);
    expect(c.points).toBe(2 * 2 * cfg.starPoints * 2 + cfg.efficiencyBonus);
    expect(next.score).toBe(c.points);
    expect(next.combo).toBe(2);
    expect(next.completed).toBe(1);
    expect(next.dropsSinceDeal).toBe(0);
    expect(next.slots[navigationSlotOf(cfg, 0, (o + 1) % cfg.octants)]).toBeNull();
    expect(next.slots[navigationSlotOf(cfg, 1, o)]).toBeNull();
    expect(next.slots[navigationSlotOf(cfg, 0, o)]?.id).toBe(101);
    expect(next.markers.length).toBe(cfg.startStars);
    expect(isComplete(next)).toBe(false);
  });

  it("a slow completion earns no efficiency bonus and constellations grow with completions", () => {
    const base = createNavigationGame("slow");
    const o = base.current.octant;
    const markers: Marker[] = [{ ring: 0, octant: o, kind: base.current.kind }];
    const state: NavigationState = { ...base, markers, dropsSinceDeal: 10, completed: 4 };
    const next = reduceNavigation(state, { type: "drop" });
    expect(next.lastMove?.completions[0]?.efficient).toBe(false);
    expect(next.lastMove?.completions[0]?.points).toBe(cfg.starPoints);
    expect(next.markers.length).toBe(Math.min(cfg.maxStars, cfg.startStars + Math.floor(5 / 2)));
  });

  it("rotating a ring onto its markers completes the constellation too", () => {
    const base = createNavigationGame("turn");
    const markers: Marker[] = [{ ring: 2, octant: 3, kind: 1 }];
    const slots = base.slots.slice();
    slots[navigationSlotOf(cfg, 2, 2)] = { id: 100, kind: 1 };
    const state: NavigationState = { ...base, slots, markers };
    const next = reduceNavigation(state, { type: "rotate", ring: 2, dir: 1 });
    expect(next.lastMove?.completions.length).toBe(1);
    expect(next.slots.every((s) => s === null)).toBe(true);
  });

  it("rejects bad rings and directions, and moves after the end", () => {
    const base = createNavigationGame("illegal");
    expect(() => reduceNavigation(base, { type: "rotate", ring: cfg.rings, dir: 1 })).toThrow(InvalidMoveError);
    expect(() => reduceNavigation(base, { type: "rotate", ring: 0, dir: 2 as 1 })).toThrow(InvalidMoveError);
    const ended = reduceNavigation(base, { type: "end" });
    expect(ended.finished).toBe(true);
    expect(() => reduceNavigation(ended, { type: "drop" })).toThrow(InvalidMoveError);
  });

  it("finishes at maxDrops, and at maxMoves of log even without drops", () => {
    const { state } = playRandom("short", Array.from({ length: 200 }, (_, i) => i * 31), { ...cfg, maxDrops: 5, maxMoves: 500 });
    expect(state.moveCount).toBe(5);
    expect(state.finished).toBe(true);
    let s = createNavigationGame("spinny", { ...cfg, maxDrops: 4, maxMoves: 4 });
    for (let i = 0; i < 4; i++) s = reduceNavigation(s, { type: "rotate", ring: 0, dir: 1 });
    expect(s.finished).toBe(true);
    expect(s.moveCount).toBe(0);
  });
});
