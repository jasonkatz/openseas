import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_TRACTOR_CONFIG,
  InvalidMoveError,
  TRACTOR_CACHE,
  createTractorGame,
  hashTractorState,
  reduceTractor,
  replayTractor,
  summarizeTractor,
  tractorCacheValue,
  tractorCascadePercentAt,
  tractorFindRuns,
  tractorHasSwap,
  tractorHint,
  tractorMarkCells,
  tractorSwapIllegalReason,
  tractorSwapValue,
  tractorViewString,
  type TractorConfig,
  type TractorMove,
  type TractorPiece,
  type TractorState,
} from "../src/index.js";

const cfg = DEFAULT_TRACTOR_CONFIG;

/** A legal swap picked from the field: a scoring one most of the time, any legal one otherwise. */
function randomSwap(state: TractorState, pick: number, any: boolean): TractorMove | null {
  const cells: number[] = [];
  for (let c = 0; c < state.cells.length; c++) {
    if (tractorSwapIllegalReason(state, c) !== null) continue;
    if (any || tractorSwapValue(state, c).scores) cells.push(c);
  }
  if (cells.length === 0) return null;
  return { type: "swap", cell: cells[pick % cells.length]! };
}

function playRandom(seed: string, picks: readonly number[], config: TractorConfig = cfg): { moves: TractorMove[]; state: TractorState } {
  let state = createTractorGame(seed, config);
  const moves: TractorMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomSwap(state, p, p % 5 === 0);
    if (!m) break;
    moves.push(m);
    state = reduceTractor(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 40 });

/**
 * A field from rows of characters: a digit is loot, `@` a cache, a letter from `a` a cross beacon
 * of that kind, a letter from `n` a saltire beacon.
 */
function field(rows: readonly string[], seed = "t", over: Partial<TractorConfig> = {}): TractorState {
  const config: TractorConfig = { ...cfg, width: rows[0]!.length, height: rows.length, startCaches: 0, cachePermille: 0, beaconEvery: 0, ...over };
  const base = createTractorGame(seed, config);
  let id = 1000;
  const cells: TractorPiece[] = rows
    .join("")
    .split("")
    .map((ch): TractorPiece => {
      if (ch === "@") return { id: id++, kind: TRACTOR_CACHE };
      if (ch >= "a" && ch <= "h") return { id: id++, kind: ch.charCodeAt(0) - 97, mark: "cross" };
      if (ch >= "n" && ch <= "u") return { id: id++, kind: ch.charCodeAt(0) - 110, mark: "saltire" };
      return { id: id++, kind: Number(ch) };
    });
  return { ...base, cells, nextId: id };
}

const at = (s: TractorState, col: number, row: number): number => row * s.config.width + col;

describe("tractor field", () => {
  it("opens full and calm: no run standing, a swap to make, caches in the lower half", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createTractorGame(seed);
        expect(s.cells.length).toBe(cfg.width * cfg.height);
        expect(new Set(s.cells.map((p) => p.id)).size).toBe(s.cells.length);
        expect(tractorFindRuns(cfg, s.cells)).toEqual([]);
        expect(tractorHasSwap(cfg, s.cells)).toBe(true);
        const caches = s.cells.flatMap((p, i) => (p.kind === TRACTOR_CACHE ? [i] : []));
        expect(caches.length).toBe(cfg.startCaches);
        for (const c of caches) expect(Math.floor(c / cfg.width)).toBeGreaterThanOrEqual(Math.ceil(cfg.height / 2));
        expect(s.score).toBe(0);
      }),
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createTractorGame("x", { ...cfg, kinds: 2 })).toThrow();
    expect(() => createTractorGame("x", { ...cfg, startCaches: 4, maxCaches: 3 })).toThrow();
    expect(() => createTractorGame("x", { ...cfg, cascadePercent: [] })).toThrow();
    expect(() => createTractorGame("x", { ...cfg, cascadePercent: [90] })).toThrow();
  });
});

describe("tractor determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayTractor(seed, cfg, moves);
        expect(hashTractorState(replayed)).toBe(hashTractorState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different openings", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashTractorState(createTractorGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(), (seed, pick) => {
        const state = createTractorGame(seed);
        const before = JSON.stringify(state);
        const m = randomSwap(state, pick, false);
        if (m) reduceTractor(state, m);
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceTractor(createTractorGame("x"), { type: "end" });
    expect(s.finished).toBe(true);
    expect(summarizeTractor(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceTractor(s, { type: "end" })).toThrow(InvalidMoveError);
  });
});

describe("tractor rules", () => {
  it("keeps the field's invariants after every swap", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createTractorGame(seed);
        for (const p of picks) {
          const m = randomSwap(state, p, p % 5 === 0);
          if (!m) break;
          const next = reduceTractor(state, m);
          const r = next.lastMove!;
          expect(next.cells.length).toBe(cfg.width * cfg.height);
          expect(new Set(next.cells.map((q) => q.id)).size).toBe(next.cells.length);
          expect(next.cells.filter((q) => q.kind === TRACTOR_CACHE).length).toBeLessThanOrEqual(cfg.maxCaches);
          // Nothing is left standing in a run, and no cache sits on the top row.
          expect(tractorFindRuns(cfg, next.cells)).toEqual([]);
          for (let col = 0; col < cfg.width; col++) expect(next.cells[col]!.kind).not.toBe(TRACTOR_CACHE);
          // The score is what the report says.
          expect(next.score).toBe(state.score + r.points);
          expect(r.points).toBe(r.waves.reduce((a, w) => a + w.points, 0) + r.cachePoints);
          expect(r.cachePoints).toBe(tractorCacheValue(cfg, r.caches.length));
          expect(tractorHasSwap(cfg, next.cells)).toBe(true);
          if (r.waves.length > 0) {
            expect(r.points).toBeGreaterThan(0);
            // The first wave scores what the preview said, before caches.
            const v = tractorSwapValue(state, m.type === "swap" ? m.cell : -1);
            expect(v.points - tractorCacheValue(cfg, v.caches.length)).toBe(r.waves[0]!.points);
          } else {
            expect(r.points).toBe(0);
            if (!r.shuffled) expect(next.cells).toEqual(r.swapped);
          }
          if (!r.shuffled && r.waves.length > 0) {
            const last = r.waves[r.waves.length - 1]!;
            expect(last.settles[last.settles.length - 1]!.cells).toEqual(next.cells);
          }
          state = next;
        }
      }),
      { numRuns: 50 },
    );
  });

  it("a swap trades a piece with the one under it; a dud scores nothing and is counted", () => {
    const s = field(["0123", "1230", "2331", "3312"]);
    expect(tractorSwapIllegalReason(s, at(s, 0, 3))).toBe("nothing below to swap with");
    const next = reduceTractor(s, { type: "swap", cell: at(s, 1, 0) });
    expect(next.cells[at(s, 1, 0)]!.kind).toBe(2);
    expect(next.cells[at(s, 1, 1)]!.kind).toBe(1);
    expect(next.lastMove!.waves).toEqual([]);
    expect(next.lastMove!.shuffled).toBe(false);
    expect(next.duds).toBe(1);
    expect(next.clears).toBe(0);
    expect(next.score).toBe(0);
    expect(next.moveCount).toBe(1);
  });

  it("a run of n scores runPoints * n * n, and what is below rises into the gap", () => {
    // Swapping the 2 at (3,0) down with the 1 under it makes a row of four 1s on top.
    const s = field(["1112", "2321", "3203", "0310"]);
    const next = reduceTractor(s, { type: "swap", cell: at(s, 3, 0) });
    const r = next.lastMove!;
    expect(r.waves[0]!.runs).toEqual([{ cells: [0, 1, 2, 3], kind: 1, points: cfg.runPoints * 16 }]);
    expect(r.waves[0]!.points).toBe(cfg.runPoints * 16);
    // Row 1 rose into row 0; four new pieces drifted in on the bottom row.
    expect(r.waves[0]!.settles[0]!.cells.slice(0, 4).map((p) => p.kind)).toEqual([2, 3, 2, 2]);
    expect(r.waves[0]!.settles[0]!.spawned.map((p) => p.cell)).toEqual([12, 13, 14, 15]);
    expect(r.waves[0]!.settles[0]!.rises.length).toBe(12);
  });

  it("a cache cannot be swapped, and rises as what is over it goes", () => {
    const s = field(["1203", "2321", "1013", "1310", "@032"]);
    expect(tractorSwapIllegalReason(s, at(s, 0, 3))).toBe("a cache cannot be swapped");
    // Swapping (0,0) down makes column 0 read 2,1,1,1: a run of three in rows 1 to 3.
    const next = reduceTractor(s, { type: "swap", cell: at(s, 0, 0) });
    expect(next.lastMove!.waves[0]!.runs[0]!.cells).toEqual([at(s, 0, 1), at(s, 0, 2), at(s, 0, 3)]);
    const cache = s.cells[at(s, 0, 4)]!;
    expect(next.cells[at(s, 0, 1)]!.id).toBe(cache.id);
    expect(next.lastMove!.waves[0]!.settles[0]!.rises).toContainEqual({ id: cache.id, from: at(s, 0, 4), to: at(s, 0, 1) });
  });

  it("caches that reach the top in one swap count together: k caches score cachePoints * k * k", () => {
    // Two caches under a row of 1s made by the swap at (3,0): when the row goes, both rise to the top.
    const s = field(["1112", "@@31", "2023", "3230"]);
    const next = reduceTractor(s, { type: "swap", cell: at(s, 3, 0) });
    const r = next.lastMove!;
    expect(r.caches.map((c) => c.kind)).toEqual([TRACTOR_CACHE, TRACTOR_CACHE]);
    expect(r.cachePoints).toBe(cfg.cachePoints * 4);
    expect(next.cachesHauled).toBe(2);
    expect(next.bestCaches).toBe(2);
    expect(r.waves[0]!.settles.length).toBeGreaterThanOrEqual(2);
    expect(r.waves[0]!.settles[1]!.topped.length).toBe(2);
  });

  it("a cross beacon in a run sweeps its row and column, and hauls a cache on them", () => {
    // Row 0 becomes 0,0,a(cross 0) once the swap at (2,0) brings the beacon up; it fires down column 2 and along row 0.
    const s = field(["0032", "21a1", "32@3", "1310"]);
    const v = tractorSwapValue(s, at(s, 2, 0));
    expect(v.scores).toBe(true);
    expect(v.fired).toBe(1);
    expect(v.caches).toEqual([at(s, 2, 2)]);
    const next = reduceTractor(s, { type: "swap", cell: at(s, 2, 0) });
    const w = next.lastMove!.waves[0]!;
    expect(w.fired.length).toBe(1);
    expect(w.fired[0]!.mark).toBe("cross");
    // Swept: the rest of row 0 (the 2 at (3,0)) and column 2 below (the 3 moved to (2,1), the cache, the 1).
    expect(w.swept.map((t) => t.cell).sort((a, b) => a - b)).toEqual([at(s, 3, 0), at(s, 2, 1), at(s, 2, 3)]);
    expect(w.caches.map((t) => t.cell)).toEqual([at(s, 2, 2)]);
    expect(w.points).toBe(cfg.runPoints * 9 + 3 * cfg.sweepPoints);
    expect(next.beaconsFired).toBe(1);
  });

  it("a beacon swept by another fires in turn", () => {
    // The swap brings the cross up into a row of three 0s; its column reaches the saltire at (2,2).
    const s = field(["0032", "21a1", "31n3", "1310"]);
    const w = reduceTractor(s, { type: "swap", cell: at(s, 2, 0) }).lastMove!.waves[0]!;
    expect(w.fired.map((f) => [f.cell, f.mark])).toEqual([
      [at(s, 2, 0), "cross"],
      [at(s, 2, 2), "saltire"],
    ]);
    expect(w.fired[1]!.swept).toEqual([at(s, 3, 1), at(s, 3, 3), at(s, 1, 3), at(s, 1, 1)]);
    expect(w.swept.length).toBe(8);
    expect(w.points).toBe(cfg.runPoints * 9 + 8 * cfg.sweepPoints);
  });

  it("a field left with no scoring swap is dealt again, caches and beacons kept", () => {
    // Swapping (1,0) down leaves a field where no swap makes a run.
    const s = field(["0a@3", "1230", "2301", "3012"]);
    expect(tractorHasSwap(s.config, s.cells)).toBe(false);
    const next = reduceTractor(s, { type: "swap", cell: at(s, 0, 1) });
    expect(next.lastMove!.shuffled).toBe(true);
    expect(tractorHasSwap(next.config, next.cells)).toBe(true);
    expect(tractorFindRuns(next.config, next.cells)).toEqual([]);
    expect(next.cells[at(s, 2, 0)]!.kind).toBe(TRACTOR_CACHE);
    expect(next.cells[at(s, 1, 0)]!.mark).toBe("cross");
  });

  it("the wave percent climbs and holds at its last entry", () => {
    expect(tractorCascadePercentAt(cfg, 0)).toBe(100);
    expect(tractorCascadePercentAt(cfg, 1)).toBe(150);
    expect(tractorCascadePercentAt(cfg, 2)).toBe(200);
    expect(tractorCascadePercentAt(cfg, 9)).toBe(200);
  });

  it("a beacon's mark reaches every cell on its lines, nearest first", () => {
    const c4: TractorConfig = { ...cfg, width: 4, height: 4 };
    expect(tractorMarkCells(c4, 5, "cross")).toEqual([1, 6, 9, 4, 7, 13]);
    expect(tractorMarkCells(c4, 5, "saltire")).toEqual([2, 10, 8, 0, 15]);
  });

  it("the hint is a scoring swap worth the most at once", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createTractorGame(seed);
        const h = tractorHint(s);
        expect(h).not.toBeNull();
        const best = tractorSwapValue(s, h!).points;
        for (let c = 0; c < s.cells.length; c++) expect(tractorSwapValue(s, c).points).toBeLessThanOrEqual(best);
      }),
      { numRuns: 30 },
    );
  });

  it("a stage with caches and beacons off deals neither", () => {
    const off: TractorConfig = { ...cfg, startCaches: 0, maxCaches: 0, cachePermille: 0, beaconEvery: 0 };
    const { state } = playRandom("stage", Array.from({ length: 40 }, (_, i) => i * 7), off);
    expect(state.cells.some((p) => p.kind === TRACTOR_CACHE || p.mark !== undefined)).toBe(false);
    expect(state.beaconsFired).toBe(0);
    expect(state.cachesHauled).toBe(0);
  });

  it("deals a beacon after every beaconEvery scoring swaps", () => {
    const every: TractorConfig = { ...cfg, beaconEvery: 1, startCaches: 0, maxCaches: 0, cachePermille: 0 };
    let s = createTractorGame("beacons", every);
    const m = randomSwap(s, 0, false)!;
    s = reduceTractor(s, m);
    const spawned = s.lastMove!.waves[0]!.settles[0]!.spawned;
    expect(spawned.filter((p) => p.mark !== undefined).length).toBe(1);
  });

  it("draws the field as one character a cell", () => {
    expect(
      tractorViewString([
        { kind: 0 },
        { kind: 3 },
        { kind: TRACTOR_CACHE },
        { kind: 1, mark: "cross" },
        { kind: 2, mark: "saltire" },
      ]),
    ).toBe("03@bp");
  });
});
