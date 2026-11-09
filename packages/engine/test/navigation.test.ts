import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_NAVIGATION_CONFIG,
  InvalidMoveError,
  NAVIGATION_ENTRY_OCTANT,
  advanceNavigation,
  createNavigationGame,
  hashNavigationState,
  navigationFallDuration,
  navigationFilledCount,
  navigationFindRuns,
  navigationHint,
  navigationLandingSlot,
  navigationSettled,
  navigationSlotOf,
  reduceNavigation,
  replayNavigation,
  type Marker,
  type NavigationConfig,
  type NavigationMove,
  type NavigationState,
  type Star,
} from "../src/index.js";

const cfg = DEFAULT_NAVIGATION_CONFIG;

/** Picks come in pairs: what to do, and how many ticks on. Roughly two turns per drop or wait. */
function moveFor(state: NavigationState, what: number, gap: number): NavigationMove {
  const n = state.config.rings * 2;
  const tick = Math.min(state.config.maxTick, state.tick + (gap % 12));
  const k = what % (n + 2);
  if (k < n) return { type: "rotate", ring: Math.floor(k / 2), dir: k % 2 === 0 ? 1 : -1, tick };
  return k === n ? { type: "drop", tick } : { type: "wait", tick };
}

function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: NavigationMove[]; state: NavigationState } {
  let state = createNavigationGame(seed, config);
  const moves: NavigationMove[] = [];
  for (let i = 0; i + 1 < picks.length; i += 2) {
    if (state.finished) break;
    const m = moveFor(state, picks[i]!, picks[i + 1]!);
    moves.push(m);
    state = reduceNavigation(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 240 });

function ringIds(state: NavigationState, ring: number): number[] {
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

/** A state with the given stars placed, for rule tests. Ids are the slot numbers. */
function withStars(base: NavigationState, stars: Record<number, number>, markers: readonly Marker[] = base.markers): NavigationState {
  const slots: Array<Star | null> = base.slots.slice();
  for (const [slot, kind] of Object.entries(stars)) slots[Number(slot)] = { id: 100 + Number(slot), kind };
  return { ...base, slots, markers };
}

function expectInvariants(state: NavigationState): void {
  expect(state.slots.length).toBe(state.config.rings * state.config.octants);
  const ids = state.slots.filter((s): s is Star => s !== null).map((s) => s.id);
  expect(new Set(ids).size, "one star per slot, one slot per star").toBe(ids.length);
  for (const id of ids) expect(id).toBeLessThan(state.nextId);
  const markerSlots = new Set(state.markers.map((m) => navigationSlotOf(state.config, m.ring, m.octant)));
  expect(markerSlots.size).toBe(state.markers.length);
  expect(state.markers.length).toBeGreaterThan(0);
  expect(state.markers.length).toBeLessThanOrEqual(state.config.maxStars);
  for (let o = 0; o < state.config.octants; o++) {
    let gap = false;
    for (let r = 0; r < state.config.rings; r++) {
      const s = state.slots[navigationSlotOf(state.config, r, o)];
      if (s === null) gap = true;
      else expect(gap, `octant ${o}: a star on ring ${r} above an empty slot`).toBe(false);
    }
  }
  expect(isComplete(state), "a completed constellation never survives a move").toBe(false);
  expect(navigationFindRuns(state.config, state.slots, state.markers), "no run of loose stars survives a move").toEqual([]);
  expect(state.falling.landTick).toBeGreaterThan(state.falling.startTick);
  expect(state.falling.landTick).toBeGreaterThan(state.tick);
  expect(state.score).toBeGreaterThanOrEqual(0);
  expect(state.tick).toBeLessThanOrEqual(state.config.maxTick);
}

describe("navigation chart", () => {
  it("starts empty with a constellation of startStars distinct slots and a star in the sky", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createNavigationGame(seed);
        expect(s.slots.length).toBe(cfg.rings * cfg.octants);
        expect(s.slots.every((x) => x === null)).toBe(true);
        expect(s.markers.length).toBe(cfg.startStars);
        const slots = new Set(s.markers.map((m) => navigationSlotOf(cfg, m.ring, m.octant)));
        expect(slots.size).toBe(s.markers.length);
        for (const m of s.markers) expect(m.kind).toBeLessThan(cfg.shapes * cfg.colors);
        expect(s.falling.startTick).toBe(0);
        expect(s.falling.landTick).toBe(cfg.fallTicks);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("the fall quickens from fallTicks to fallTicksMin over the round", () => {
    expect(navigationFallDuration(cfg, 0)).toBe(cfg.fallTicks);
    expect(navigationFallDuration(cfg, cfg.maxTick)).toBe(cfg.fallTicksMin);
    let last = cfg.fallTicks;
    for (let t = 0; t <= cfg.maxTick; t += 50) {
      const d = navigationFallDuration(cfg, t);
      expect(d).toBeLessThanOrEqual(last);
      expect(d).toBeGreaterThanOrEqual(cfg.fallTicksMin);
      last = d;
    }
  });

  it("rejects a bad config", () => {
    expect(() => createNavigationGame("x", { ...cfg, fallTicksMin: cfg.fallTicks + 1 })).toThrow();
    expect(() => createNavigationGame("x", { ...cfg, maxStars: cfg.rings * cfg.octants + 1 })).toThrow();
    expect(() => createNavigationGame("x", { ...cfg, shapes: 1, colors: 1 })).toThrow();
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
        for (let i = 0; i + 1 < picks.length; i += 2) {
          if (state.finished) break;
          const m = moveFor(state, picks[i]!, picks[i + 1]!);
          const before = JSON.stringify(state);
          reduceNavigation(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reduceNavigation(state, m);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("advancing to a tick shows the same chart a wait logged at that tick produces", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat({ max: 200 }), (seed, picks, ahead) => {
        const { state } = playRandom(seed, picks);
        fc.pre(!state.finished);
        const tick = Math.min(cfg.maxTick, state.tick + ahead);
        fc.pre(tick > state.tick);
        const shown = advanceNavigation(state, tick);
        const logged = reduceNavigation(state, { type: "wait", tick });
        expect(shown.slots).toEqual(logged.slots);
        expect(shown.markers).toEqual(logged.markers);
        expect(shown.falling).toEqual(logged.falling);
        expect(shown.score).toBe(logged.score);
        expect(shown.lastMove?.events).toEqual(logged.lastMove?.events);
        expect(shown.logLength).toBe(state.logLength);
        expect(logged.logLength).toBe(state.logLength + 1);
      }),
      { numRuns: 100 },
    );
  });
});

describe("navigation rules", () => {
  it("keeps every invariant after every move", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createNavigationGame(seed);
        for (let i = 0; i + 1 < picks.length; i += 2) {
          if (state.finished) break;
          const m = moveFor(state, picks[i]!, picks[i + 1]!);
          const next = reduceNavigation(state, m);
          expectInvariants(next);
          expect(next.tick).toBe(m.tick);
          if (m.type === "rotate") {
            // A turn keeps the ring's stars (unless it charted or cleared some).
            if (!next.lastMove!.events.length) expect(ringIds(next, m.ring)).toEqual(ringIds(state, m.ring));
            expect(next.moveCount).toBe(state.moveCount + 1);
          }
          if (m.type === "wait") expect(next.moveCount).toBe(state.moveCount);
          expect(next.logLength).toBe(state.logLength + 1);
          // Every event is newer than the last.
          const seqs = next.lastMove!.events.map((e) => e.seq);
          for (let k = 1; k < seqs.length; k++) expect(seqs[k]).toBeGreaterThan(seqs[k - 1]!);
          if (seqs.length) expect(seqs[0]).toBe(state.eventSeq + 1);
          expect(next.eventSeq).toBe(state.eventSeq + seqs.length);
          state = next;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("time only moves forward and never past the round", () => {
    const s = createNavigationGame("t");
    const later = reduceNavigation(s, { type: "wait", tick: 50 });
    expect(() => reduceNavigation(later, { type: "wait", tick: 49 })).toThrow(InvalidMoveError);
    expect(() => reduceNavigation(later, { type: "rotate", ring: 0, dir: 1, tick: cfg.maxTick + 1 })).toThrow(InvalidMoveError);
    expect(() => reduceNavigation(later, { type: "rotate", ring: cfg.rings, dir: 1, tick: 60 })).toThrow(InvalidMoveError);
    const end = reduceNavigation(later, { type: "wait", tick: cfg.maxTick });
    expect(end.finished).toBe(true);
    expect(() => reduceNavigation(end, { type: "wait", tick: cfg.maxTick })).toThrow(InvalidMoveError);
  });

  it("a star comes down by itself when its fall ends, landing at the center of the entry octant on an empty chart", () => {
    const s = createNavigationGame("fall");
    const before = reduceNavigation(s, { type: "wait", tick: s.falling.landTick - 1 });
    expect(before.landings).toBe(0);
    const after = reduceNavigation(before, { type: "wait", tick: s.falling.landTick });
    expect(after.landings).toBe(1);
    const land = after.lastMove!.events.find((e) => e.type === "land");
    expect(land).toBeDefined();
    if (land?.type === "land") {
      expect(land.slot).toBe(navigationSlotOf(cfg, 0, NAVIGATION_ENTRY_OCTANT));
      expect(land.kind).toBe(s.falling.kind);
      expect(land.tick).toBe(s.falling.landTick);
    }
    // The next star set off the moment the last came down.
    expect(after.falling.kind).toBe(s.next);
    expect(after.falling.startTick).toBe(s.falling.landTick);
    expect(after.falling.landTick).toBe(s.falling.landTick + navigationFallDuration(cfg, s.falling.landTick));
  });

  it("a long wait brings down every star whose fall ended, in order", () => {
    const s = createNavigationGame("many");
    const tick = cfg.fallTicks * 3;
    const after = reduceNavigation(s, { type: "wait", tick });
    const lands = after.lastMove!.events.filter((e) => e.type === "land" || e.type === "lost_heading");
    expect(lands.length).toBe(after.landings);
    expect(after.landings).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < lands.length; i++) expect(lands[i]!.tick).toBeGreaterThanOrEqual(lands[i - 1]!.tick);
  });

  it("a star falls inward until it meets another, and rests outside it", () => {
    const s = createNavigationGame("stack");
    const top = (r: number): number => navigationSlotOf(cfg, r, NAVIGATION_ENTRY_OCTANT);
    expect(navigationLandingSlot(s)).toBe(top(0));
    expect(navigationLandingSlot(withStars(s, { [top(0)]: 0 }))).toBe(top(1));
    expect(navigationLandingSlot(withStars(s, { [top(0)]: 0, [top(1)]: 0 }))).toBe(top(2));
    // Columns are always packed, but the rule on its own still rests a star against the first one it meets.
    expect(navigationLandingSlot(withStars(s, { [top(1)]: 0 }))).toBe(top(2));
    // The outer slot taken means no room at all.
    expect(navigationLandingSlot(withStars(s, { [top(2)]: 0 }))).toBeNull();
  });

  it("a drop brings the star down now", () => {
    const s = createNavigationGame("drop");
    const dropped = reduceNavigation(s, { type: "drop", tick: 5 });
    expect(dropped.landings).toBe(1);
    expect(dropped.lastMove!.events[0]!.type).toBe("land");
    expect(dropped.falling.startTick).toBe(5);
    expect(dropped.moveCount).toBe(1);
  });

  it("a drop on the tick a star came down on its own is not a second drop", () => {
    const s = createNavigationGame("double");
    const dropped = reduceNavigation(s, { type: "drop", tick: s.falling.landTick });
    expect(dropped.landings).toBe(1);
    expect(dropped.falling.kind).toBe(s.next);
  });

  it("a star arriving at a blocked octant is a lost heading: the octant is swept, points are lost, the chain breaks", () => {
    const s = createNavigationGame("lost_heading");
    const top = (r: number): number => navigationSlotOf(cfg, r, NAVIGATION_ENTRY_OCTANT);
    const far: Marker[] = [{ ring: 0, octant: 4, kind: 0 }];
    const kinds = [1, 2, 4];
    const blocked = { ...withStars(s, { [top(0)]: kinds[0]!, [top(1)]: kinds[1]!, [top(2)]: kinds[2]! }, far), score: 100, combo: 3 };
    const after = reduceNavigation(blocked, { type: "drop", tick: 3 });
    const lostHeading = after.lastMove!.events.find((e) => e.type === "lost_heading");
    expect(lostHeading).toBeDefined();
    if (lostHeading?.type === "lost_heading") {
      expect(lostHeading.octant).toBe(NAVIGATION_ENTRY_OCTANT);
      expect(lostHeading.ids.length).toBe(cfg.rings);
    }
    // Only the outer slot need be taken for a lost heading; the sweep takes what is there.
    const thin = withStars(s, { [top(2)]: 2 }, far);
    const swept = reduceNavigation(thin, { type: "drop", tick: 3 });
    const ev = swept.lastMove!.events.find((e) => e.type === "lost_heading");
    if (ev?.type === "lost_heading") {
      expect(ev.ids.length).toBe(1);
      expect(swept.slots[top(2)]).toBeNull();
      expect(ev.penalty).toBe(cfg.lostHeadingPenalty);
    }
    for (let r = 0; r < cfg.rings; r++) expect(after.slots[top(r)]).toBeNull();
    expect(after.score).toBe(100 - cfg.lostHeadingPenalty);
    expect(after.combo).toBe(0);
    expect(after.lostHeadings).toBe(1);
    expect(after.landings).toBe(1);
  });

  it("the score never goes below zero on a lost heading", () => {
    const s = createNavigationGame("floor");
    const top = (r: number): number => navigationSlotOf(cfg, r, NAVIGATION_ENTRY_OCTANT);
    const blocked = withStars(s, { [top(0)]: 1, [top(1)]: 2, [top(2)]: 4 }, [{ ring: 0, octant: 4, kind: 0 }]);
    expect(reduceNavigation(blocked, { type: "drop", tick: 1 }).score).toBe(0);
  });

  it("filling the last marker charts the constellation, scores n*n*starPoints times the chain, and deals a new one", () => {
    const s = createNavigationGame("chart");
    const markers: Marker[] = [
      { ring: 1, octant: 2, kind: 3 },
      { ring: 1, octant: 3, kind: 5 },
      { ring: 2, octant: 6, kind: 1 },
    ];
    // Two of three in place, held up by strangers on the rings inside; the third sits one octant off on ring 2.
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    const ready = {
      ...withStars(s, { [slot(0, 2)]: 7, [slot(0, 3)]: 8, [slot(0, 5)]: 7, [slot(0, 6)]: 8, [slot(1, 5)]: 8, [slot(1, 6)]: 7, [slot(1, 2)]: 3, [slot(1, 3)]: 5, [slot(2, 5)]: 1 }, markers),
      combo: 1,
      landingsSinceDeal: 4,
    };
    expect(navigationFilledCount(cfg, ready.slots, ready.markers)).toBe(2);
    const after = reduceNavigation(ready, { type: "rotate", ring: 2, dir: 1, tick: 2 });
    const charted = after.lastMove!.events.find((e) => e.type === "charted");
    expect(charted).toBeDefined();
    if (charted?.type === "charted") {
      expect(charted.completion.chain).toBe(2);
      expect(charted.completion.efficient).toBe(true);
      // The second in the chain takes the second entry; four landings for three markers saved two.
      expect(charted.completion.chainPercent).toBe(cfg.chainPercent[1]);
      expect(charted.completion.saved).toBe(2);
      expect(charted.completion.points).toBe(Math.floor((3 * 3 * cfg.starPoints * cfg.chainPercent[1]!) / 100) + 2 * 3 * cfg.starPoints);
      expect(charted.completion.ids.length).toBe(3);
    }
    expect(after.completed).toBe(1);
    expect(after.combo).toBe(2);
    expect(after.bestCombo).toBe(2);
    expect(after.landingsSinceDeal).toBe(0);
    for (const m of markers) expect(after.slots[slot(m.ring, m.octant)]).toBeNull();
    expect(after.markers).not.toEqual(markers);
    expect(after.markers.length).toBe(cfg.startStars);
  });

  it("a constellation taking more than 2n landings earns no efficiency bonus", () => {
    const s = createNavigationGame("slow");
    const markers: Marker[] = [{ ring: 0, octant: 1, kind: 2 }];
    const ready = { ...withStars(s, { [navigationSlotOf(cfg, 0, 0)]: 2 }, markers), landingsSinceDeal: 3 };
    const after = reduceNavigation(ready, { type: "rotate", ring: 0, dir: 1, tick: 1 });
    const charted = after.lastMove!.events.find((e) => e.type === "charted");
    if (charted?.type === "charted") {
      expect(charted.completion.efficient).toBe(false);
      expect(charted.completion.points).toBe(cfg.starPoints);
    } else throw new Error("no completion");
  });

  it("constellations grow with completions up to maxStars", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        expect(state.markers.length).toBe(Math.min(cfg.maxStars, cfg.startStars + Math.floor(state.completed / 2)));
      }),
      { numRuns: 30 },
    );
  });

  it("three loose stars of a kind in a row around a ring clear for runPoints * (n - 2)", () => {
    const s = createNavigationGame("run");
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    const markers: Marker[] = [{ ring: 0, octant: 0, kind: 7 }];
    const ready = withStars(s, { [slot(1, 3)]: 4, [slot(1, 4)]: 4, [slot(1, 6)]: 4 }, markers);
    expect(navigationFindRuns(cfg, ready.slots, ready.markers)).toEqual([]);
    // Turning ring 1 can't bring them together; place the third next to them instead and turn ring 0 as the move.
    const lined = withStars(s, { [slot(1, 3)]: 4, [slot(1, 4)]: 4, [slot(1, 5)]: 4 }, markers);
    const runs = navigationFindRuns(cfg, lined.slots, lined.markers);
    expect(runs.length).toBe(1);
    expect(runs[0]!.slots).toEqual([slot(1, 3), slot(1, 4), slot(1, 5)]);
    expect(runs[0]!.points).toBe(cfg.runPoints);
    const after = reduceNavigation(lined, { type: "rotate", ring: 0, dir: 1, tick: 1 });
    expect(after.lastMove!.events.some((e) => e.type === "run")).toBe(true);
    expect(after.score).toBe(cfg.runPoints);
    expect(after.runsCleared).toBe(1);
    for (let o = 3; o <= 5; o++) expect(after.slots[slot(1, o)]).toBeNull();
  });

  it("runs wrap around the ring and are counted once", () => {
    const s = createNavigationGame("wrap");
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    const lined = withStars(s, { [slot(2, 7)]: 1, [slot(2, 0)]: 1, [slot(2, 1)]: 1, [slot(2, 2)]: 1 }, [{ ring: 0, octant: 0, kind: 7 }]);
    const runs = navigationFindRuns(cfg, lined.slots, lined.markers);
    expect(runs.length).toBe(1);
    expect(runs[0]!.slots.length).toBe(4);
    expect(runs[0]!.points).toBe(cfg.runPoints * 2);
    const full: Record<number, number> = {};
    for (let o = 0; o < cfg.octants; o++) full[slot(0, o)] = 2;
    const ring = navigationFindRuns(cfg, withStars(s, full, [{ ring: 2, octant: 0, kind: 7 }]).slots, [{ ring: 2, octant: 0, kind: 7 }]);
    expect(ring.length).toBe(1);
    expect(ring[0]!.slots.length).toBe(cfg.octants);
  });

  it("a full octant of one kind clears down the rings", () => {
    const s = createNavigationGame("column");
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    const lined = withStars(s, { [slot(0, 5)]: 6, [slot(1, 5)]: 6, [slot(2, 5)]: 6 }, [{ ring: 0, octant: 0, kind: 7 }]);
    const runs = navigationFindRuns(cfg, lined.slots, lined.markers);
    expect(runs.length).toBe(1);
    expect(runs[0]!.slots).toEqual([slot(0, 5), slot(1, 5), slot(2, 5)]);
  });

  it("a star on its marker is charted, not loose: it never joins a run", () => {
    const s = createNavigationGame("safe");
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    const markers: Marker[] = [
      { ring: 1, octant: 4, kind: 4 },
      { ring: 0, octant: 0, kind: 7 },
    ];
    const lined = withStars(s, { [slot(1, 3)]: 4, [slot(1, 4)]: 4, [slot(1, 5)]: 4 }, markers);
    expect(navigationFindRuns(cfg, lined.slots, lined.markers)).toEqual([]);
  });

  it("stars slide inward when a turn opens the slot under them", () => {
    const s = createNavigationGame("gravity");
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    const far: Marker[] = [{ ring: 0, octant: 0, kind: 7 }];
    // Octant 3: a star on ring 0 holds one up on ring 1 and another on ring 2. Turning ring 0 away drops both.
    const stacked = withStars(s, { [slot(0, 3)]: 1, [slot(1, 3)]: 2, [slot(2, 3)]: 4 }, far);
    const after = reduceNavigation(stacked, { type: "rotate", ring: 0, dir: 1, tick: 1 });
    expect(after.slots[slot(0, 4)]?.kind).toBe(1);
    expect(after.slots[slot(0, 3)]?.kind).toBe(2);
    expect(after.slots[slot(1, 3)]?.kind).toBe(4);
    expect(after.slots[slot(2, 3)]).toBeNull();
    const fall = after.lastMove!.events.find((e) => e.type === "fall");
    expect(fall).toBeDefined();
    if (fall?.type === "fall") {
      expect(fall.moves).toEqual([
        { id: 100 + slot(1, 3), from: slot(1, 3), to: slot(0, 3) },
        { id: 100 + slot(2, 3), from: slot(2, 3), to: slot(1, 3) },
      ]);
    }
    // A packed chart has nothing to settle.
    expect(navigationSettled(cfg, after.slots).moves).toEqual([]);
  });

  it("a star that slides onto its marker charts, and a run made by the slide clears", () => {
    const s = createNavigationGame("slide");
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    const markers: Marker[] = [{ ring: 0, octant: 5, kind: 3 }];
    // The marker's star waits on ring 1 above a stranger on ring 0; turn ring 0 and it drops onto the marker.
    const held = withStars(s, { [slot(0, 5)]: 0, [slot(1, 5)]: 3 }, markers);
    const after = reduceNavigation(held, { type: "rotate", ring: 0, dir: 1, tick: 1 });
    expect(after.lastMove!.events.map((e) => e.type)).toEqual(["fall", "charted"]);
    expect(after.completed).toBe(1);
    // Ring 0: a stranger at 4, a gap at 5, embers at 6 and 7; an ember held up on ring 1 above the stranger.
    // Turning ring 0 back a step moves the stranger to 3 and the embers to 5 and 6, opens slot 4, and the held
    // ember drops into it: three embers in a row at 4, 5 and 6.
    const run = withStars(s, { [slot(0, 4)]: 0, [slot(0, 6)]: 5, [slot(0, 7)]: 5, [slot(1, 4)]: 5 }, [{ ring: 2, octant: 1, kind: 7 }]);
    const cleared = reduceNavigation(run, { type: "rotate", ring: 0, dir: -1, tick: 1 });
    expect(cleared.lastMove!.events.map((e) => e.type)).toEqual(["fall", "run"]);
    expect(cleared.runsCleared).toBe(1);
    expect(cleared.score).toBe(cfg.runPoints);
    for (const o of [4, 5, 6]) expect(cleared.slots[slot(0, o)]).toBeNull();
    expect(cleared.slots[slot(0, 3)]?.kind).toBe(0);
  });

  it("the hint points at a turn that fills a marker, or at opening the column", () => {
    const s = createNavigationGame("hint");
    const slot = (r: number, o: number): number => navigationSlotOf(cfg, r, o);
    // A gold spark one octant short of its marker, with ring 0 holding it up on both octants: turn ring 1 clockwise.
    const near = withStars(s, { [slot(0, 2)]: 8, [slot(0, 3)]: 7, [slot(1, 2)]: 0 }, [{ ring: 1, octant: 3, kind: 0 }]);
    expect(navigationHint(near)).toEqual({ ring: 1, dir: 1 });
    // The star in the sky wants the outer ring at octant 2 (held up there by two strangers), but the outer slot
    // above the entry is taken: move it.
    const blocked = {
      ...withStars(s, { [slot(2, 0)]: 5, [slot(0, 0)]: 5, [slot(1, 0)]: 6, [slot(0, 2)]: 7, [slot(1, 2)]: 8 }, [{ ring: 2, octant: 2, kind: 1 }]),
      falling: { ...s.falling, kind: 1 },
    };
    const h = navigationHint(blocked);
    expect(h).not.toBeNull();
    expect(h!.ring).toBe(2);
    // Nothing on the chart and a star no marker wants: no hint.
    const idle = { ...withStars(s, {}, [{ ring: 0, octant: 0, kind: 3 }]), falling: { ...s.falling, kind: 4 } };
    expect(navigationHint(idle)).toBeNull();
  });

  it("the round ends on the clock or when the log is full", () => {
    const small: NavigationConfig = { ...cfg, maxMoves: 3 };
    let s = createNavigationGame("log", small);
    s = reduceNavigation(s, { type: "rotate", ring: 0, dir: 1, tick: 1 });
    s = reduceNavigation(s, { type: "wait", tick: 2 });
    expect(s.finished).toBe(false);
    s = reduceNavigation(s, { type: "rotate", ring: 1, dir: -1, tick: 3 });
    expect(s.finished).toBe(true);
    const ended = reduceNavigation(createNavigationGame("end"), { type: "end", tick: 10 });
    expect(ended.finished).toBe(true);
    expect(ended.moveCount).toBe(0);
  });
});
