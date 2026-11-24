import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_DEFLECTORS_CONFIG,
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_EMPTY,
  DEFLECTORS_SLASH,
  InvalidMoveError,
  advanceDeflectors,
  createDeflectorsGame,
  DEFLECTORS_LENS,
  deflectorsBeamPoints,
  deflectorsBestPoints,
  deflectorsHint,
  deflectorsIsHome,
  deflectorsIsMirror,
  deflectorsRecipeSize,
  deflectorsSettle,
  deflectorsOutlook,
  deflectorsPortCount,
  deflectorsStreakPercentAt,
  deflectorsTrace,
  deflectorsViewString,
  deflectorsVolleyBest,
  deflectorsVolleyOptions,
  deflectorsVolleyPoints,
  deflectorsVolleyRoute,
  hashDeflectorsState,
  reduceDeflectors,
  replayDeflectors,
  summarizeDeflectors,
  type DeflectorsBeam,
  type DeflectorsConfig,
  type DeflectorsEvent,
  type DeflectorsMove,
  type DeflectorsState,
} from "../src/index.js";

const cfg = DEFAULT_DEFLECTORS_CONFIG;

/** A round played by picks: each step lets some ticks pass, then flips a mirror, fires the waiting volley or only waits. */
function playRandom(seed: string, picks: readonly number[], config: DeflectorsConfig = cfg): { moves: DeflectorsMove[]; state: DeflectorsState } {
  let state = createDeflectorsGame(seed, config);
  const moves: DeflectorsMove[] = [];
  for (let i = 0; i + 3 <= picks.length && !state.finished; i += 3) {
    const tick = Math.min(config.maxTick, state.tick + (picks[i]! % 40));
    const at = advanceDeflectors(state, tick);
    const kind = picks[i + 1]! % 5;
    let move: DeflectorsMove;
    if (kind <= 2) {
      const cells = at.mirrors.flatMap((m, c) => (deflectorsIsMirror(m) ? [c] : []));
      move = { type: "flip", cell: cells[picks[i + 2]! % cells.length]!, tick };
    } else if (kind === 3 && at.volley) move = { type: "fire", volley: at.volley.id, tick };
    else move = { type: "wait", tick };
    moves.push(move);
    state = reduceDeflectors(state, move);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 240 });

/**
 * A grid from rows of characters: `.` empty, `/` and `\` mirrors, `a`, `b`, `c` lenses. No volley is
 * waiting and none is due for a long while. Mirrors are not spent unless `over` says so, and a grid
 * with no lenses has recipes off.
 */
function grid(rows: readonly string[], over: Partial<DeflectorsConfig> = {}): DeflectorsState {
  const text = rows.join("");
  const lenses = text.replace(/[^abc]/g, "").length;
  const mirrors = Math.max(1, text.replace(/[^/\\]/g, "").length);
  const config: DeflectorsConfig = { ...cfg, size: rows.length, mirrors, lenses, recipeLenses: lenses ? cfg.recipeLenses : 0, spend: false, ...over };
  const base = createDeflectorsGame("t", config);
  const cell = (ch: string): number => (ch === "/" ? DEFLECTORS_SLASH : ch === "\\" ? DEFLECTORS_BACKSLASH : ch >= "a" && ch <= "c" ? DEFLECTORS_LENS + ch.charCodeAt(0) - 97 : DEFLECTORS_EMPTY);
  return { ...base, nextDealTick: config.maxTick, mirrors: text.split("").map(cell) };
}

/** `state` with a volley of these beams waiting, worth `best` at most. A beam's recipe is 0 unless given. */
function waiting(state: DeflectorsState, beams: ReadonlyArray<readonly [entry: number, exit: number, recipe?: number]>, best: number): DeflectorsState {
  return { ...state, nextVolleyId: 2, volley: { id: 1, beams: beams.map(([entry, exit, recipe], sign) => ({ sign, entry, exit, recipe: recipe ?? 0 })), dealTick: 0, best } };
}

/** Set the mirrors to a best setting for the waiting volley, by the engine's own flips, at `tick`. */
function routeBest(state: DeflectorsState, tick: number): DeflectorsState {
  const at = advanceDeflectors(state, tick);
  let s = state;
  for (const cell of deflectorsVolleyRoute(s.config, at.mirrors, at.volley!.beams)!.flips) s = reduceDeflectors(s, { type: "flip", cell, tick });
  return s;
}

const fires = (s: DeflectorsState): Extract<DeflectorsEvent, { type: "fire" }>[] => (s.lastMove?.events ?? []).flatMap((e) => (e.type === "fire" ? [e] : []));

describe("deflectors grid", () => {
  it("opens with the configured mirrors and lenses, no volley waiting, and the first one due", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createDeflectorsGame(seed);
        expect(s.mirrors.length).toBe(cfg.size * cfg.size);
        expect(s.mirrors.filter((m) => deflectorsIsMirror(m)).length).toBe(cfg.mirrors);
        const lenses = s.mirrors.filter((m) => m >= DEFLECTORS_LENS).map((m) => m - DEFLECTORS_LENS);
        expect(lenses.sort()).toEqual([0, 1, 2]);
        expect(s.mirrors.every((m) => m >= DEFLECTORS_EMPTY && m <= DEFLECTORS_LENS + 2)).toBe(true);
        expect(s.volley).toBeNull();
        expect(s.nextDealTick).toBe(cfg.openingTicks);
        expect(s.score).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createDeflectorsGame("x", { ...cfg, size: 2 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, mirrors: 37 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, mirrors: 34, lenses: 3 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, lenses: 0 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, recipeLenses: 4 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, streakPercent: [] })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, beams: 4 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, respawnTicks: -1 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, spend: 1 as unknown as boolean })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, lenses: 0, recipeLenses: 0 })).not.toThrow();
  });
});

describe("deflectors determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayDeflectors(seed, cfg, moves);
        expect(hashDeflectorsState(replayed)).toBe(hashDeflectorsState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("time passing in one step or in many comes to the same grid", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.array(fc.integer({ min: 1, max: 90 }), { minLength: 1, maxLength: 20 }), (seed, picks, gaps) => {
        const { state } = playRandom(seed, picks.slice(0, 60));
        if (state.finished) return;
        // The same stretch of time, logged as one wait and as several.
        let stepped = state;
        for (const g of gaps) {
          if (stepped.finished) break;
          stepped = reduceDeflectors(stepped, { type: "wait", tick: Math.min(cfg.maxTick, stepped.tick + g) });
        }
        const once = reduceDeflectors(state, { type: "wait", tick: stepped.tick });
        // Everything but the length of the log and the last report agrees.
        const strip = (s: DeflectorsState): unknown => ({ ...s, logLength: 0, lastMove: null, finished: false });
        expect(strip(once)).toEqual(strip(stepped));
        // And the display state at that tick is the logged one.
        const shown = advanceDeflectors(state, stepped.tick);
        expect(strip(shown)).toEqual(strip(once));
        expect(shown.lastMove?.events ?? []).toEqual(once.lastMove!.events);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different grids", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashDeflectorsState(createDeflectorsGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce and advance never mutate their input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 30));
        if (state.finished) return;
        const before = JSON.stringify(state);
        const tick = Math.min(cfg.maxTick, state.tick + 200);
        advanceDeflectors(state, tick);
        const cell = state.mirrors.findIndex((m) => deflectorsIsMirror(m));
        reduceDeflectors(state, { type: "flip", cell, tick });
        if (state.volley) reduceDeflectors(state, { type: "fire", volley: state.volley.id, tick });
        deflectorsOutlook(state);
        deflectorsHint(state);
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 40 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceDeflectors(createDeflectorsGame("x"), { type: "end", tick: 0 });
    expect(s.finished).toBe(true);
    expect(summarizeDeflectors(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceDeflectors(s, { type: "end", tick: 0 })).toThrow(InvalidMoveError);
  });
});

describe("deflectors beams and mirrors", () => {
  it("a beam runs straight through empty cells and turns at a mirror", () => {
    // Port 10 is the left edge, row 1, heading right; ports 1 and 7 are the top and bottom of column 1.
    const slash = grid(["...", "./.", "..."]);
    expect(slash.config.size).toBe(3);
    const none = { lenses: 0, lensCells: [] };
    expect(deflectorsTrace(slash.config, slash.mirrors, 10)).toEqual({ out: 1, bounces: 1, turns: [4], ...none });
    const back = grid(["...", ".\\.", "..."]);
    expect(deflectorsTrace(back.config, back.mirrors, 10)).toEqual({ out: 7, bounces: 1, turns: [4], ...none });
    // No mirror on the row: straight out the far side (the right edge, row 0).
    expect(deflectorsTrace(back.config, back.mirrors, 9)).toEqual({ out: 3, bounces: 0, turns: [], ...none });
    // Two mirrors make a dog-leg: right, up at the first, right again at the second.
    const two = grid(["./.", "./.", "..."]);
    expect(deflectorsTrace(two.config, two.mirrors, 10)).toEqual({ out: 3, bounces: 2, turns: [4, 1], ...none });
    // A lens is passed straight through, and the beam carries its kind.
    const lens = grid(["...", "a/c", ".b."]);
    expect(deflectorsTrace(lens.config, lens.mirrors, 10)).toEqual({ out: 1, bounces: 1, turns: [4], lenses: 0b001, lensCells: [3] });
    expect(deflectorsTrace(lens.config, lens.mirrors, 7)).toEqual({ out: 4, bounces: 1, turns: [4], lenses: 0b110, lensCells: [7, 5] });
  });

  it("a route runs the same backwards", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 23 }), (seed, entry) => {
        const s = createDeflectorsGame(seed);
        const there = deflectorsTrace(cfg, s.mirrors, entry);
        const back = deflectorsTrace(cfg, s.mirrors, there.out);
        expect(there.out).not.toBe(entry);
        expect(back.out).toBe(entry);
        expect(back.bounces).toBe(there.bounces);
        expect(back.turns).toEqual(there.turns.slice().reverse());
        expect(back.lenses).toBe(there.lenses);
      }),
    );
  });

  it.each([
    ["with recipes", { size: 4, mirrors: 8, lenses: 3, recipeLenses: 2 }],
    ["without recipes", { size: 4, mirrors: 8, lenses: 0, recipeLenses: 0 }],
  ] as const)("the search agrees with trying every setting of the mirrors, for one beam and for two together, %s", (_, over) => {
    const small: DeflectorsConfig = { ...cfg, ...over };
    const ports = deflectorsPortCount(small);
    const recipes = small.recipeLenses > 0;
    for (let g = 0; g < 8; g++) {
      const s = createDeflectorsGame(`brute-${g}`, small);
      const cells = s.mirrors.flatMap((m, c) => (deflectorsIsMirror(m) ? [c] : []));
      const settings: number[][] = [];
      for (let mask = 0; mask < 1 << cells.length; mask++) {
        const m = s.mirrors.slice();
        cells.forEach((c, i) => (m[c] = mask & (1 << i) ? DEFLECTORS_SLASH : DEFLECTORS_BACKSLASH));
        settings.push(m);
      }
      const brute = (entries: readonly number[]): Map<string, { best: number; least: number }> => {
        const found = new Map<string, { best: number; least: number }>();
        for (const m of settings) {
          const traces = entries.map((e) => deflectorsTrace(small, m, e));
          const outs = traces.map((t) => t.out);
          if (outs.some((o) => entries.includes(o)) || new Set(outs).size !== outs.length) continue;
          const masks = traces.map((t) => (recipes ? t.lenses : 0));
          if (recipes && masks.some((m) => m === 0 || deflectorsRecipeSize(m) > small.recipeLenses)) continue;
          const total = traces.reduce((a, t, i) => a + deflectorsBeamPoints(small, t.bounces, masks[i]), 0);
          const key = `${outs.join(",")}~${masks.join(",")}`;
          const seen = found.get(key);
          found.set(key, { best: Math.max(seen?.best ?? total, total), least: Math.min(seen?.least ?? total, total) });
        }
        return found;
      };
      const check = (entries: readonly number[]): void => {
        const want = brute(entries);
        const got = deflectorsVolleyOptions(small, s.mirrors, entries);
        expect(got.length).toBe(want.size);
        for (const o of got) expect({ best: o.best, least: o.least }, `${entries.join()} to ${o.exits.join()}`).toEqual(want.get(`${o.exits.join(",")}~${o.recipes.join(",")}`));
        // In a fixed order: by the first beam's exit and recipe, then the next.
        const keys = got.map((o) => o.exits.reduce((a, e, i) => (a * ports + e) * 8 + o.recipes[i]!, 0));
        expect(keys).toEqual(keys.slice().sort((a, b) => a - b));
        // And the best a set of exits and recipes is worth is what the route to it comes to.
        for (const o of got) {
          const beams: DeflectorsBeam[] = entries.map((entry, sign) => ({ sign, entry, exit: o.exits[sign]!, recipe: o.recipes[sign]! }));
          expect(deflectorsVolleyBest(small, s.mirrors, beams)).toBe(o.best);
        }
      };
      for (let entry = 0; entry < ports; entry++) check([entry]);
      for (let a = 0; a < ports; a += 3) for (let b = 1; b < ports; b += 5) if (a !== b) check([a, b]);
    }
  });

  it("no setting reaches an exit and recipe the search does not list", () => {
    const s = createDeflectorsGame("none");
    const reachable = new Set(deflectorsVolleyOptions(cfg, s.mirrors, [0]).map((o) => `${o.exits[0]}~${o.recipes[0]}`));
    for (let exit = 1; exit < deflectorsPortCount(cfg); exit++) {
      for (let recipe = 1; recipe < 8; recipe++) {
        const beam = { sign: 0, entry: 0, exit, recipe };
        const listed = reachable.has(`${exit}~${recipe}`) || (deflectorsRecipeSize(recipe) > cfg.recipeLenses && deflectorsVolleyRoute(cfg, s.mirrors, [beam]) !== null);
        expect(deflectorsVolleyRoute(cfg, s.mirrors, [beam]) === null).toBe(!listed);
        expect(deflectorsVolleyBest(cfg, s.mirrors, [beam]) === -1).toBe(!listed);
      }
    }
  });

  it("the best route's flips set the mirrors up for exactly that volley", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 23 }), fc.nat({ max: 22 }), (seed, a, step) => {
        const s = createDeflectorsGame(seed);
        const entries = [a, (a + 1 + step) % 24];
        for (const o of deflectorsVolleyOptions(cfg, s.mirrors, entries).slice(0, 12)) {
          const beams: DeflectorsBeam[] = entries.map((entry, sign) => ({ sign, entry, exit: o.exits[sign]!, recipe: o.recipes[sign]! }));
          const route = deflectorsVolleyRoute(cfg, s.mirrors, beams)!;
          expect(route.base).toBe(o.best);
          const m = s.mirrors.slice();
          for (const cell of route.flips) {
            expect(deflectorsIsMirror(m[cell]!)).toBe(true);
            m[cell] = m[cell] === DEFLECTORS_SLASH ? DEFLECTORS_BACKSLASH : DEFLECTORS_SLASH;
          }
          expect(new Set(route.flips).size).toBe(route.flips.length);
          const traces = beams.map((b) => deflectorsTrace(cfg, m, b.entry));
          expect(traces.map((t) => t.out)).toEqual(o.exits);
          expect(traces.map((t) => t.lenses)).toEqual(o.recipes);
          expect(traces.reduce((sum, t, i) => sum + deflectorsBeamPoints(cfg, t.bounces, o.recipes[i]), 0)).toBe(o.best);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("a flip turns a mirror over and nothing else", () => {
    const s = grid(["/..", ".\\.", "..."]);
    const one = reduceDeflectors(s, { type: "flip", cell: 0, tick: 0 });
    expect(one.mirrors).toEqual([DEFLECTORS_BACKSLASH, 0, 0, 0, DEFLECTORS_BACKSLASH, 0, 0, 0, 0]);
    expect(one.flips).toBe(1);
    const two = reduceDeflectors(one, { type: "flip", cell: 0, tick: 0 });
    expect(two.mirrors).toEqual(s.mirrors);
    expect(two.score).toBe(0);
  });

  it("refuses moves that are not legal", () => {
    const s = advanceDeflectors(createDeflectorsGame("illegal"), 50);
    const empty = s.mirrors.findIndex((m) => m === DEFLECTORS_EMPTY);
    const lens = s.mirrors.findIndex((m) => m >= DEFLECTORS_LENS);
    const mirror = s.mirrors.findIndex((m) => deflectorsIsMirror(m));
    const bad = (move: DeflectorsMove): void => {
      expect(() => reduceDeflectors(s, move)).toThrow(InvalidMoveError);
    };
    bad({ type: "flip", cell: empty, tick: 50 });
    bad({ type: "flip", cell: lens, tick: 50 });
    bad({ type: "flip", cell: -1, tick: 50 });
    bad({ type: "flip", cell: 36, tick: 50 });
    bad({ type: "flip", cell: mirror, tick: 49 });
    bad({ type: "flip", cell: mirror, tick: cfg.maxTick + 1 });
    bad({ type: "flip", cell: mirror, tick: 50.5 });
    bad({ type: "fire", volley: 999, tick: 50 });
    bad({ type: "bogus", tick: 50 } as unknown as DeflectorsMove);
    expect(s.volley).not.toBeNull();
    expect(() => reduceDeflectors(s, { type: "fire", volley: s.volley!.id, tick: 50 })).not.toThrow();
  });
});

describe("deflectors rounds", () => {
  it("every volley is dealt ports of its own, exits and recipes one setting reaches together, and the most they are worth", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.constantFrom<Partial<DeflectorsConfig>>({}, { beams: 3 }, { recipeLenses: 1 }, { recipeLenses: 0, lenses: 0, spend: false }), (seed, picks, over) => {
        const config = { ...cfg, ...over };
        let state = createDeflectorsGame(seed, config);
        let seq = 0;
        for (let i = 0; i + 3 <= picks.length && !state.finished; i += 3) {
          const tick = Math.min(config.maxTick, state.tick + (picks[i]! % 60));
          const before = state;
          const at = advanceDeflectors(before, tick);
          state = reduceDeflectors(state, picks[i + 1]! % 2 === 0 && at.volley ? { type: "fire", volley: at.volley.id, tick } : { type: "wait", tick });
          for (const e of state.lastMove!.events) {
            expect(e.seq).toBe(++seq);
            expect(e.tick).toBeGreaterThanOrEqual(before.tick);
            expect(e.tick).toBeLessThanOrEqual(tick);
            if (e.type !== "deal") continue;
            const v = e.volley;
            expect(v.beams.length).toBeGreaterThanOrEqual(1);
            expect(v.beams.length).toBeLessThanOrEqual(config.beams);
            for (const b of v.beams) {
              if (config.recipeLenses === 0) expect(b.recipe).toBe(0);
              else expect(deflectorsRecipeSize(b.recipe)).toBeGreaterThanOrEqual(1);
              expect(deflectorsRecipeSize(b.recipe)).toBeLessThanOrEqual(config.recipeLenses);
            }
            expect(v.beams.map((b) => b.sign)).toEqual(v.beams.map((_, n) => n));
            // No port is used twice: every entry and every exit is its own.
            const ports = v.beams.flatMap((b) => [b.entry, b.exit]);
            expect(new Set(ports).size).toBe(ports.length);
            expect(v.best).toBeGreaterThan(0);
            // Checked on the grid it was dealt on: the volley still waits, or the move fired it and spent the grid.
            if (state.volley?.id === v.id) expect(deflectorsVolleyBest(config, state.mirrors, v.beams)).toBe(v.best);
            else expect(deflectorsVolleyBest(config, at.mirrors, v.beams)).toBe(v.best);
            expect(v.dealTick).toBe(e.tick);
          }
          // The grid keeps its mirrors and lenses, however many were spent.
          expect(state.mirrors.filter((m) => deflectorsIsMirror(m)).length).toBe(config.mirrors);
          expect(state.mirrors.filter((m) => m >= DEFLECTORS_LENS).length).toBe(config.lenses);
          // The tallies agree with each other and with the report.
          expect(state.score).toBe(before.score + state.lastMove!.points);
          expect(state.score).toBeGreaterThanOrEqual(0);
          expect(state.lastMove!.points).toBe(state.lastMove!.events.reduce((a, e) => a + (e.type === "fire" ? e.outcome.points : 0), 0));
          expect(state.volleys).toBe(before.volleys + fires(state).length);
          expect(state.hits + state.misses).toBe(before.hits + before.misses + fires(state).reduce((a, e) => a + e.volley.beams.length, 0));
        }
      }),
      { numRuns: 40 },
    );
  });

  it("what the board is told a volley would do is what firing it does", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        if (state.finished) return;
        const at = advanceDeflectors(state, Math.min(cfg.maxTick - 1, state.tick + 30));
        if (!at.volley || at.finished) return;
        const told = deflectorsOutlook(at)!;
        const fired = reduceDeflectors(state, { type: "fire", volley: at.volley.id, tick: at.tick });
        const e = fires(fired).at(-1)!;
        expect(e.outcome).toEqual(told);
        expect(fired.score).toBe(at.score + told.points);
        expect(fired.combo).toBe(told.streak);
        // The shots are the beams as the mirrors send them.
        for (const shot of told.shots) {
          expect(deflectorsTrace(cfg, at.mirrors, shot.entry)).toEqual({ out: shot.out, bounces: shot.bounces, turns: shot.turns, lenses: shot.lenses, lensCells: shot.lensCells });
          expect(shot.atExit).toBe(shot.out === shot.exit);
          expect(shot.hit).toBe(shot.atExit && shot.lenses === shot.recipe);
        }
        expect(told.points).toBe(told.gained - told.lost);
        expect(told.clean).toBe(told.hits === told.shots.length);
      }),
      { numRuns: 60 },
    );
  });

  it("deals the first volley at the opening, and it waits until it is fired", () => {
    const s = createDeflectorsGame("count");
    expect(advanceDeflectors(s, cfg.openingTicks - 1).volley).toBeNull();
    const dealt = advanceDeflectors(s, cfg.openingTicks);
    const volley = dealt.volley!;
    expect(volley).toMatchObject({ id: 1, dealTick: cfg.openingTicks });
    // Every volley holds every beam, from the first second.
    expect(volley.beams.length).toBe(cfg.beams);
    // Left alone to the end of the round, nothing fires.
    const late = reduceDeflectors(s, { type: "wait", tick: cfg.maxTick - 1 });
    expect(late.volleys).toBe(0);
    expect(late.volley).toEqual(volley);
    const fired = reduceDeflectors(s, { type: "fire", volley: 1, tick: 100 });
    expect(fired.volleys).toBe(1);
    expect(fires(fired)[0]).toMatchObject({ tick: 100 });
    // The next volley is dealt once the grid has settled.
    expect(fired.volley).toBeNull();
    expect(advanceDeflectors(fired, 100 + cfg.respawnTicks - 1).volley).toBeNull();
    expect(advanceDeflectors(fired, 100 + cfg.respawnTicks).volley?.id).toBe(2);
  });

  it("a volley left alone goes into the hull: no beam is dealt the exit it runs to already", () => {
    let needFlip = 0;
    for (let i = 0; i < 20; i++) {
      const s = advanceDeflectors(createDeflectorsGame(`alone-${i}`), cfg.openingTicks);
      const out = deflectorsOutlook(s)!;
      if (out.hits === 0) needFlip++;
      expect(deflectorsHint(s)).not.toBeNull();
    }
    // Only a grid too bare for a choice deals a beam its own way, and the content grid is not bare.
    expect(needFlip).toBeGreaterThanOrEqual(19);
  });

  it("a beam out through its exit scores by its turns, and a perfect volley is worth half as much again", () => {
    // One mirror in the middle: from the left edge it sends the beam up as `/`, down as `\`.
    const s = waiting(grid(["...", "./.", "..."]), [[10, 1]], 4);
    expect(deflectorsOutlook(s)).toMatchObject({ hits: 1, clean: true, perfect: true, base: 4, streak: 1, streakPercent: cfg.streakPercent[0], gained: 6, lost: 0, points: 6 });
    const hit = reduceDeflectors(s, { type: "fire", volley: 1, tick: 5 });
    const e = fires(hit)[0]!;
    expect(e).toMatchObject({ tick: 5, spent: [] });
    expect(e.outcome.shots).toEqual([{ sign: 0, entry: 10, exit: 1, recipe: 0, out: 1, bounces: 1, turns: [4], lenses: 0, lensCells: [], atExit: true, hit: true, points: 4 }]);
    expect(e.outcome.gained).toBe(Math.floor((deflectorsBeamPoints(s.config, 1) * cfg.perfectPercent) / 100));
    expect(hit).toMatchObject({ score: 6, volleys: 1, hits: 1, misses: 0, perfects: 1, combo: 1, bestCombo: 1, longest: 1, volley: null });
    expect(summarizeDeflectors(hit)).toEqual({ score: 6, moves: 1, bestCombo: 1 });
    // Firing brings the next volley after the short pause.
    expect(hit.nextDealTick).toBe(5 + cfg.respawnTicks);
    // The same route with a longer one left unfound is clean and not perfect.
    const short = reduceDeflectors({ ...s, volley: { ...s.volley!, best: 9 } }, { type: "fire", volley: 1, tick: 5 });
    expect(fires(short)[0]!.outcome).toMatchObject({ clean: true, perfect: false, gained: 4, points: 4 });
    expect(short).toMatchObject({ score: 4, perfects: 0, combo: 1 });
    // More turns score by the square, up to the cap.
    expect([0, 1, 2, 5].map((b) => deflectorsBeamPoints(cfg, b))).toEqual([1, 4, 9, 36].map((p) => p * cfg.bouncePoints));
    expect(deflectorsBeamPoints(cfg, cfg.bounceCap + 4)).toBe(deflectorsBeamPoints(cfg, cfg.bounceCap));
  });

  it("a beam out through the wrong port hits the hull: a penalty, never below zero, and the streak is gone", () => {
    const base = waiting(grid(["...", ".\\.", "..."]), [[10, 1]], 4);
    // With a score and a streak to lose.
    const rich = reduceDeflectors({ ...base, score: 100, combo: 3, bestCombo: 3 }, { type: "fire", volley: 1, tick: 0 });
    expect(fires(rich)[0]!.outcome).toMatchObject({ hits: 0, clean: false, perfect: false, base: 0, streak: 0, streakPercent: 100, gained: 0, lost: cfg.hullPenalty, points: -cfg.hullPenalty });
    expect(fires(rich)[0]!.outcome.shots[0]).toMatchObject({ out: 7, hit: false, points: -cfg.hullPenalty });
    expect(rich).toMatchObject({ score: 100 - cfg.hullPenalty, combo: 0, bestCombo: 3, misses: 1, hits: 0, volleys: 1 });
    // With less than the penalty, the hull takes what there is.
    const poor = reduceDeflectors({ ...base, score: 15 }, { type: "fire", volley: 1, tick: 0 });
    expect(fires(poor)[0]!.outcome).toMatchObject({ lost: 15, points: -15 });
    expect(poor.score).toBe(0);
    // With nothing to lose, a miss costs nothing.
    const zero = reduceDeflectors(base, { type: "fire", volley: 1, tick: 0 });
    expect(fires(zero)[0]!.outcome).toMatchObject({ lost: 0, points: 0 });
    expect(Object.is(fires(zero)[0]!.outcome.shots[0]!.points, 0)).toBe(true);
    expect(zero.score).toBe(0);
  });

  it("a beam is home only through exactly its recipe: a lens short or a lens too many is the hull", () => {
    // From the left edge, row 1: through the a lens, up at the mirror, out the top of column 1.
    // From the bottom of column 1: through the b lens, right at the mirror, through the c lens, out the right edge, row 1 (port 4).
    const g = grid(["...", "a/c", ".b."]);
    const one = waiting(g, [[10, 1, 0b001]], 6);
    expect(deflectorsOutlook(one)).toMatchObject({ hits: 1, clean: true, base: 6 });
    // One lens in the recipe: (1 + 1) squared, and half as much again.
    expect(deflectorsBeamPoints(g.config, 1, 0b001)).toBe(6);
    expect(deflectorsBeamPoints(g.config, 1, 0b011)).toBe(8);
    // Two lenses, and the beam passes both.
    const two = waiting(g, [[7, 4, 0b110]], 8);
    expect(deflectorsOutlook(two)).toMatchObject({ hits: 1, base: 8 });
    // The right exit, a lens short: not home.
    const short = waiting(g, [[7, 4, 0b100]], 6);
    expect(deflectorsOutlook(short)!.shots[0]).toMatchObject({ atExit: true, hit: false });
    expect(deflectorsOutlook({ ...short, score: 100 })).toMatchObject({ hits: 0, clean: false, lost: cfg.hullPenalty });
    // The right exit, a lens too many.
    const extra = waiting(g, [[10, 1, 0b010]], 6);
    expect(deflectorsOutlook(extra)!.shots[0]).toMatchObject({ atExit: true, hit: false, lenses: 0b001 });
    expect(deflectorsIsHome(g.config, { exit: 1, recipe: 0b001 }, 1, 0b001)).toBe(true);
    expect(deflectorsIsHome(g.config, { exit: 1, recipe: 0b001 }, 1, 0b011)).toBe(false);
    // With recipes off, a lens is only glass.
    const off = { ...g.config, recipeLenses: 0 };
    expect(deflectorsIsHome(off, { exit: 1, recipe: 0 }, 1, 0b011)).toBe(true);
    expect(deflectorsBeamPoints(off, 1, 0b011)).toBe(4);
  });

  it("the grid settles: spent mirrors go, what stood above drops, and fresh mirrors come in at the top", () => {
    const g = grid(["/a.", "\\..", "/.\\"]);
    const n = 3;
    // Spend the mirror in the middle of column 0 and the one at the bottom of column 2.
    const { cells, fell } = deflectorsSettle(g.config, g.mirrors, [3, 8], g.rng);
    // Column 0: a fresh mirror on top, the top one dropped one, the bottom one stayed.
    expect(deflectorsIsMirror(cells[0]!)).toBe(true);
    expect(cells[3]).toBe(DEFLECTORS_SLASH);
    expect(cells[6]).toBe(DEFLECTORS_SLASH);
    expect([fell[0], fell[3], fell[6]]).toEqual([1, 1, 0]);
    // Column 1 is untouched, lens and all.
    expect([cells[1], cells[4], cells[7]]).toEqual([g.mirrors[1], g.mirrors[4], g.mirrors[7]]);
    // Column 2: a fresh mirror on top, the empty cells below it.
    expect(deflectorsIsMirror(cells[2]!)).toBe(true);
    expect([cells[5], cells[8]]).toEqual([DEFLECTORS_EMPTY, DEFLECTORS_EMPTY]);
    expect([fell[2], fell[5], fell[8]]).toEqual([1, 0, 0]);
    expect(cells.length).toBe(n * n);
    // A lens drops like anything else.
    const lens = deflectorsSettle(g.config, g.mirrors.map((m, c) => (c === 4 ? DEFLECTORS_SLASH : m)), [4], g.rng);
    expect(lens.cells[4]).toBe(DEFLECTORS_LENS);
    expect(lens.fell[4]).toBe(1);
  });

  it("a fired volley spends every mirror its beams turned at, home or not; spending off, the grid stays", () => {
    // The first beam turns at the top left; the second at the bottom right and goes astray.
    const half = waiting(grid(["/..", "...", "..\\"], { spend: true }), [[9, 0], [5, 8]], 8);
    const fired = reduceDeflectors(half, { type: "fire", volley: 1, tick: 0 });
    const e = fires(fired)[0]!;
    expect(e.spent).toEqual([0, 8]);
    expect(fired.spent).toBe(2);
    expect(fired.mirrors.filter((m) => deflectorsIsMirror(m)).length).toBe(2);
    expect(deflectorsIsMirror(fired.mirrors[0]!) && deflectorsIsMirror(fired.mirrors[2]!)).toBe(true);
    expect(e.fell[0]).toBe(1);
    const kept = reduceDeflectors({ ...half, config: { ...half.config, spend: false } }, { type: "fire", volley: 1, tick: 0 });
    expect(fires(kept)[0]!.spent).toEqual([]);
    expect(kept.mirrors).toEqual(half.mirrors);
  });

  it("two beams fire together: the hits are banked, the hull takes its due, and only a clean volley builds the streak", () => {
    // Top left sends the first beam up and out as `/`; bottom right sends the second down and out as `/`, up as `\`.
    const half = waiting(grid(["/..", "...", "..\\"]), [[9, 0], [5, 8]], 8);
    const told = deflectorsOutlook({ ...half, score: 10, combo: 2 })!;
    expect(told).toMatchObject({ hits: 1, clean: false, perfect: false, base: 4, streak: 0, streakPercent: 100, gained: 4, lost: 14, points: -10 });
    expect(told.shots.map((x) => [x.sign, x.out, x.hit, x.points])).toEqual([[0, 0, true, 4], [1, 2, false, -14]]);
    const fired = reduceDeflectors({ ...half, score: 10, combo: 2, bestCombo: 2 }, { type: "fire", volley: 1, tick: 0 });
    expect(fired).toMatchObject({ score: 0, hits: 1, misses: 1, volleys: 1, combo: 0, bestCombo: 2, perfects: 0 });
    // One flip brings the second beam home: the volley is clean, perfect, and third in a streak.
    const whole = reduceDeflectors({ ...half, score: 10, combo: 2, bestCombo: 2 }, { type: "flip", cell: 8, tick: 0 });
    const clean = reduceDeflectors(whole, { type: "fire", volley: 1, tick: 1 });
    const want = Math.floor((Math.floor((8 * cfg.perfectPercent) / 100) * cfg.streakPercent[2]!) / 100);
    expect(fires(clean)[0]!.outcome).toMatchObject({ hits: 2, clean: true, perfect: true, base: 8, streak: 3, streakPercent: cfg.streakPercent[2], gained: want, lost: 0, points: want });
    expect(clean).toMatchObject({ score: 10 + want, hits: 2, misses: 0, combo: 3, bestCombo: 3, perfects: 1 });
    expect(deflectorsBestPoints({ ...half, score: 10, combo: 2 })).toBe(want);
  });

  it("the streak multiplies clean volleys by the table and stops at its last entry", () => {
    expect(deflectorsStreakPercentAt(cfg, 0)).toBe(100);
    expect(deflectorsStreakPercentAt(cfg, 1)).toBe(cfg.streakPercent[0]);
    expect(deflectorsStreakPercentAt(cfg, cfg.streakPercent.length + 5)).toBe(cfg.streakPercent[cfg.streakPercent.length - 1]);
    expect(deflectorsVolleyPoints(cfg, 25, false, 3)).toBe(Math.floor((25 * cfg.streakPercent[2]!) / 100));
    expect(deflectorsVolleyPoints(cfg, 25, true, 3)).toBe(Math.floor((Math.floor((25 * cfg.perfectPercent) / 100) * cfg.streakPercent[2]!) / 100));
    expect(deflectorsVolleyPoints(cfg, 25, false, 0)).toBe(25);
  });

  it("a played round banks what the best routes are worth, volley after volley", () => {
    let s = createDeflectorsGame("played");
    let want = 0;
    for (let n = 1; n <= 6; n++) {
      const tick = s.nextDealTick + 3;
      s = routeBest(s, tick);
      const volley = advanceDeflectors(s, tick).volley!;
      s = reduceDeflectors(s, { type: "fire", volley: volley.id, tick });
      const e = fires(s).at(-1)!;
      expect(e.outcome).toMatchObject({ clean: true, perfect: true, base: volley.best, streak: n });
      want += deflectorsVolleyPoints(cfg, volley.best, true, n);
      expect(s.score).toBe(want);
    }
    expect(s).toMatchObject({ volleys: 6, perfects: 6, combo: 6, bestCombo: 6, misses: 0 });
    expect(s.longest).toBeGreaterThan(0);
  });

  it("a fire for a volley gone by finds nothing to fire", () => {
    const s = createDeflectorsGame("late");
    const volley = advanceDeflectors(s, cfg.openingTicks).volley!;
    const fired = reduceDeflectors(s, { type: "fire", volley: volley.id, tick: 20 });
    expect(fired.volleys).toBe(1);
    expect(() => reduceDeflectors(fired, { type: "fire", volley: volley.id, tick: 21 })).toThrow(InvalidMoveError);
    // A tap meant for the first volley that lands once the second is waiting fires neither.
    const next = 20 + cfg.respawnTicks + 2;
    expect(advanceDeflectors(fired, next).volley?.id).toBe(2);
    expect(() => reduceDeflectors(fired, { type: "fire", volley: volley.id, tick: next })).toThrow(InvalidMoveError);
  });

  it("the round is over at its last tick, and at the move cap", () => {
    const s = reduceDeflectors(createDeflectorsGame("over"), { type: "wait", tick: cfg.maxTick });
    expect(s.finished).toBe(true);
    expect(s.tick).toBe(cfg.maxTick);
    expect(() => reduceDeflectors(s, { type: "wait", tick: cfg.maxTick })).toThrow(InvalidMoveError);
    const capped: DeflectorsConfig = { ...cfg, maxMoves: 2 };
    let c = createDeflectorsGame("cap", capped);
    c = reduceDeflectors(c, { type: "wait", tick: 1 });
    expect(c.finished).toBe(false);
    c = reduceDeflectors(c, { type: "wait", tick: 2 });
    expect(c.finished).toBe(true);
  });

  it("the hint is a flip towards the best the volley can be, and following it arrives", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (seed, two) => {
        const config: DeflectorsConfig = two ? cfg : { ...cfg, beams: 1 };
        let s = advanceDeflectors(createDeflectorsGame(seed, config), config.openingTicks);
        const volley = s.volley!;
        const far = deflectorsVolleyRoute(config, s.mirrors, volley.beams)!.flips.length;
        let followed = 0;
        for (; followed < 40; followed++) {
          const h = deflectorsHint(s);
          if (!h) break;
          expect(deflectorsIsMirror(s.mirrors[h.cell]!)).toBe(true);
          s = reduceDeflectors(s, { type: "flip", cell: h.cell, tick: s.tick });
        }
        // Each flip is one fewer to go, so it takes no more than the route was long.
        expect(followed).toBeLessThanOrEqual(far);
        expect(deflectorsHint(s)).toBeNull();
        expect(deflectorsOutlook(s)).toMatchObject({ clean: true, perfect: true, base: volley.best });
      }),
      { numRuns: 30 },
    );
    expect(deflectorsHint(createDeflectorsGame("no volley"))).toBeNull();
  });

  it("a small or bare grid still deals volleys", () => {
    // Fire every volley as it comes, for a while.
    const run = (config: DeflectorsConfig, seed: string): DeflectorsState => {
      let s = createDeflectorsGame(seed, config);
      for (let i = 0; i < 40 && s.tick < 600; i++) {
        const tick = s.volley ? s.tick + 1 : Math.max(s.tick, s.nextDealTick);
        s = reduceDeflectors(s, s.volley ? { type: "fire", volley: s.volley.id, tick } : { type: "wait", tick });
      }
      return s;
    };
    const bare = run({ ...cfg, size: 3, mirrors: 1, lenses: 0, recipeLenses: 0, beams: 3 }, "bare");
    expect(bare.volleys).toBeGreaterThan(0);
    expect(bare.hits + bare.misses).toBeGreaterThanOrEqual(bare.volleys);
    expect(run({ ...cfg, size: 3, mirrors: 1, beams: 3 }, "bare lenses").volleys).toBeGreaterThan(0);
    expect(run({ ...cfg, size: 10, mirrors: 97, beams: 3 }, "full").volleys).toBeGreaterThan(0);
  });

  it("the view string names every cell and every waiting beam", () => {
    const s = grid(["/..", ".\\b", "..."]);
    expect(deflectorsViewString(s.mirrors, [])).toBe("/...\\b...|");
    expect(deflectorsViewString(s.mirrors, [{ sign: 1, entry: 3, exit: 7, recipe: 2 }, { sign: 0, entry: 10, exit: 1, recipe: 0 }])).toBe("/...\\b...|0:10>1~0,1:3>7~2");
  });
});
