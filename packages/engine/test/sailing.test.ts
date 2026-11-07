import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_SAILING_CONFIG,
  InvalidMoveError,
  createSailingGame,
  hashSailingState,
  reduceSailing,
  replaySailing,
  sailingIdx,
  sailingLandingRow,
  sailingPairCells,
  sailingRestingPlacements,
  sailingShelfMask,
  sailingSpawnFree,
  type Platform,
  type Rotation,
  type SailingMove,
  type SailingState,
  type Segment,
} from "../src/index.js";

const cfg = DEFAULT_SAILING_CONFIG;

function legalMoves(state: SailingState): SailingMove[] {
  return sailingRestingPlacements(state).map((p) => ({ type: "place" as const, ...p }));
}

function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: SailingMove[]; state: SailingState } {
  let state = createSailingGame(seed, config);
  const moves: SailingMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const legal = legalMoves(state);
    if (legal.length === 0) break;
    const m = legal[p % legal.length]!;
    moves.push(m);
    state = reduceSailing(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 70 });

/** Every segment must rest on something: the floor, a shelf, another segment, or its linked half. */
function expectSettled(state: SailingState): void {
  const { width, height } = state.config;
  const mask = sailingShelfMask(state.config, state.platforms);
  const shelf = new Set<number>();
  mask.forEach((v, i) => {
    if (v) shelf.add(i);
  });
  for (let i = 0; i < state.cells.length; i++) {
    const s = state.cells[i];
    if (!s) continue;
    const row = Math.floor(i / width);
    if (row === 0 || shelf.has(i)) continue;
    const below = state.cells[i - width];
    if (below) continue;
    // Hanging half of a horizontal pair: the partner must be supported.
    const partnerAt = [i - 1, i + 1].find((j) => j >= 0 && j < width * height && Math.floor(j / width) === row && state.cells[j]?.pair === s.pair);
    expect(partnerAt, `segment ${s.id} at ${i} is floating`).toBeDefined();
    const p = partnerAt!;
    const pRow = Math.floor(p / width);
    const supported = pRow === 0 || shelf.has(p) || state.cells[p - width] !== null;
    expect(supported, `pair ${s.pair} is floating`).toBe(true);
  }
}

describe("sailing board", () => {
  it("starts empty with the configured platforms and no clears pending", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createSailingGame(seed);
        expect(s.cells.every((c) => c === null)).toBe(true);
        // Random spots can crowd each other out of the row spacing; the shortfall is dealt after the next move.
        expect(s.platforms.length).toBeGreaterThanOrEqual(cfg.platformsAtOnce - 2);
        expect(s.platforms.length).toBeLessThanOrEqual(cfg.platformsAtOnce);
        for (const p of s.platforms) {
          expect(p.cells.some((c) => c.want !== null)).toBe(true);
          for (const c of p.cells) {
            expect(c.col).toBeGreaterThanOrEqual(0);
            expect(c.col).toBeLessThan(cfg.width);
            expect(c.row).toBeGreaterThanOrEqual(2);
            expect(c.row).toBeLessThanOrEqual(cfg.height - 4);
          }
        }
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("platforms never touch, not even at a corner", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        const ps = state.platforms;
        for (let i = 0; i < ps.length; i++) {
          for (let j = i + 1; j < ps.length; j++) {
            for (const a of ps[i]!.cells) for (const b of ps[j]!.cells) expect(Math.abs(a.col - b.col) > 1 || Math.abs(a.row - b.row) > 1).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("sailing determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replaySailing(seed, a.moves);
        expect(hashSailingState(b)).toBe(hashSailingState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 200 },
    );
  });

  it("different seeds deal different openings", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(hashSailingState(createSailingGame(a))).not.toBe(hashSailingState(createSailingGame(b)));
      }),
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createSailingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          const m = legal[p % legal.length]!;
          const before = JSON.stringify(state);
          reduceSailing(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reduceSailing(state, m);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("sailing rules", () => {
  it("every board is settled after every move, and ids are unique", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createSailingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          state = reduceSailing(state, legal[p % legal.length]!);
          expectSettled(state);
          const ids = state.cells.filter((c): c is Segment => c !== null).map((c) => c.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("no run of four and no satisfied platform survives a move", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        const { width, height } = state.config;
        const kind = (c: number, r: number): number => state.cells[r * width + c]?.kind ?? -1;
        for (let r = 0; r < height; r++) {
          for (let c = 0; c + 3 < width; c++) {
            const k = kind(c, r);
            if (k >= 0) expect([kind(c + 1, r), kind(c + 2, r), kind(c + 3, r)].every((x) => x === k)).toBe(false);
          }
        }
        for (let c = 0; c < width; c++) {
          for (let r = 0; r + 3 < height; r++) {
            const k = kind(c, r);
            if (k >= 0) expect([kind(c, r + 1), kind(c, r + 2), kind(c, r + 3)].every((x) => x === k)).toBe(false);
          }
        }
        for (const p of state.platforms) {
          const satisfied = p.cells.every((c) => c.want === null || kind(c.col, c.row) === c.want);
          expect(satisfied).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("a pair rests exactly where it was placed, and every resting place is a floor for a straight fall", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createSailingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          const m = legal[p % legal.length]!;
          if (m.type !== "place") break;
          expect(sailingLandingRow(state, m.col, m.row, m.rot)).toBe(m.row);
          const cells = sailingPairCells(state.config, m.col, m.row, m.rot)!;
          const next = reduceSailing(state, m);
          expect(next.lastMove?.landed?.cells).toEqual([cells.a, cells.b]);
          state = next;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("a pair can be steered under a platform", () => {
    const base = createSailingGame("tuck");
    const platform: Platform = { id: 5, cells: [{ col: 4, row: 10, want: 0 }, { col: 5, row: 10, want: null }, { col: 6, row: 10, want: 1 }] };
    const state: SailingState = { ...base, platforms: [platform] };
    const rests = legalMoves(state);
    // The floor cells directly beneath the platform are reachable by falling beside it and sliding in.
    expect(rests).toContainEqual({ type: "place", col: 4, row: 0, rot: 0 });
    expect(rests).toContainEqual({ type: "place", col: 5, row: 1, rot: 1 });
    // The platform itself is a landing spot too.
    expect(rests).toContainEqual({ type: "place", col: 4, row: 10, rot: 0 });
    // A vertical pair can never straddle the shelf: top half on the platform, bottom half beneath it.
    expect(rests).not.toContainEqual({ type: "place", col: 4, row: 10, rot: 1 });
    expect(rests).not.toContainEqual({ type: "place", col: 5, row: 10, rot: 3 });
    // Nothing rests in mid-air.
    for (const r of rests) if (r.type === "place") expect(sailingLandingRow(state, r.col, r.row, r.rot)).toBe(r.row);
  });

  it("a pair turns either way: a counter-clockwise turn from the entry, with its kick, is accepted", () => {
    const base = createSailingGame("turns");
    const { width, height } = base.config;
    const s = Math.floor((width - 2) / 2);
    // Wall off the column under the entry and the one to its left, leaving a shaft to the right.
    const cells = base.cells.slice();
    for (let row = 0; row < height - 1; row++) {
      for (let col = 0; col < width; col++) {
        if (col !== s + 1) cells[sailingIdx(base.config, col, row)] = { id: 10_000 + row * width + col, kind: 0, pair: 10_000 + row * width + col };
      }
    }
    const state: SailingState = { ...base, cells, platforms: [] };
    const rests = legalMoves(state);
    // Counter-clockwise from rotation 0 is rotation 3; the kick of +1 drops it down the shaft.
    expect(rests).toContainEqual({ type: "place", col: s + 1, row: 1, rot: 3 });
    expect(rests).toContainEqual({ type: "place", col: s + 1, row: 1, rot: 1 });
    expect(() => reduceSailing(state, { type: "place", col: s + 1, row: 1, rot: 3 })).not.toThrow();
  });

  it("a satisfied platform clears its targets and scores platformPoints per target", () => {
    // Build a state by hand: one platform of span 2 with two targets of kind 0 on row 2.
    const base = createSailingGame("by-hand");
    const platform: Platform = { id: 99, cells: [{ col: 1, row: 2, want: 0 }, { col: 2, row: 2, want: 0 }] };
    const state: SailingState = { ...base, platforms: [platform], current: { a: 0, b: 0 }, next: { a: 1, b: 2 } };
    const next = reduceSailing(state, { type: "place", col: 1, row: 2, rot: 0 });
    expect(next.lastMove?.rounds.length).toBe(1);
    const round = next.lastMove!.rounds[0]!;
    expect(round.groups[0]?.cause).toBe("platform");
    expect(round.points).toBe(cfg.platformPoints * 2);
    expect(next.platforms.find((p) => p.id === 99)).toBeUndefined();
    expect(next.platforms.length).toBe(cfg.platformsAtOnce);
    expect(next.cells[sailingIdx(cfg, 1, 2)]).toBeNull();
    expect(next.combo).toBe(1);
  });

  it("a platform is a shelf: segments rest in it instead of falling through", () => {
    const base = createSailingGame("shelf");
    const platform: Platform = { id: 7, cells: [{ col: 2, row: 4, want: 1 }, { col: 3, row: 4, want: null }] };
    const state: SailingState = { ...base, platforms: [platform], current: { a: 0, b: 0 } };
    const next = reduceSailing(state, { type: "place", col: 2, row: 4, rot: 0 });
    expect(next.lastMove?.landed?.cells).toEqual([sailingIdx(cfg, 2, 4), sailingIdx(cfg, 3, 4)]);
    // Falling through the shelf is not a legal rest.
    expect(() => reduceSailing(state, { type: "place", col: 2, row: 3, rot: 0 })).toThrow(InvalidMoveError);
  });

  it("a stack has its shelf under its bottom cell only, so it fills from the top by falling in", () => {
    const base = createSailingGame("stack-shape");
    const platform: Platform = { id: 99, cells: [{ col: 3, row: 5, want: 0 }, { col: 3, row: 6, want: 1 }, { col: 3, row: 7, want: null }] };
    const state: SailingState = { ...base, platforms: [platform], current: { a: 0, b: 1 } };
    // A vertical pair dropped down column 3 passes the upper cells and rests on the shelf under row 5.
    expect(sailingLandingRow(state, 3, state.config.height - 1, 1)).toBe(6);
    const next = reduceSailing(state, { type: "place", col: 3, row: 6, rot: 1 });
    // Both targets satisfied at once: the stack clears.
    expect(next.lastMove?.rounds[0]?.groups[0]?.cause).toBe("platform");
    expect(next.platforms.find((p) => p.id === 99)).toBeUndefined();
  });

  it("four in a row clears and cascades multiply by chain", () => {
    const base = createSailingGame("runs");
    const cells = base.cells.slice();
    // Three kind-0 segments on the floor, columns 0..2; the drop adds a vertical pair at column 3 with a at the bottom.
    for (let c = 0; c < 3; c++) cells[sailingIdx(cfg, c, 0)] = { id: 1000 + c, kind: 0, pair: 500 + c };
    const state: SailingState = { ...base, cells, platforms: [], current: { a: 0, b: 1 } };
    const next = reduceSailing(state, { type: "place", col: 3, row: 1, rot: 1 });
    expect(next.lastMove?.rounds[0]?.groups[0]?.cause).toBe("run");
    expect(next.lastMove?.rounds[0]?.points).toBe(cfg.runPoints);
    // The surviving half (kind 1) fell to the floor.
    expect(next.cells[sailingIdx(cfg, 3, 0)]?.kind).toBe(1);
  });

  it("rejects floating, out-of-bounds and malformed placements, and moves after the end", () => {
    const base: SailingState = { ...createSailingGame("illegal"), platforms: [] };
    expect(() => reduceSailing(base, { type: "place", col: cfg.width - 1, row: 0, rot: 0 })).toThrow(InvalidMoveError);
    // Mid-air on an empty board: it fits, but nothing holds it there.
    expect(() => reduceSailing(base, { type: "place", col: 2, row: 5, rot: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceSailing(base, { type: "place", col: 2, row: 0, rot: 5 as Rotation })).toThrow(InvalidMoveError);
    const ended = reduceSailing(base, { type: "end" });
    expect(ended.finished).toBe(true);
    expect(() => reduceSailing(ended, { type: "place", col: 0, row: 0, rot: 0 })).toThrow(InvalidMoveError);
  });

  it("finishes at maxMoves", () => {
    const { state } = playRandom("short", Array.from({ length: 50 }, (_, i) => i * 31), { ...cfg, maxMoves: 5 });
    expect(state.moveCount).toBeLessThanOrEqual(5);
    expect(state.finished).toBe(true);
  });

  it("a top-out wipes the rigging, charges the penalty, deals new platforms, and play goes on", () => {
    const config = { ...cfg, pieceKinds: 8, maxMoves: 500 };
    let state = createSailingGame("stack", config);
    let wiped: SailingState | null = null;
    for (let i = 0; i < 400 && !wiped; i++) {
      const legal = legalMoves(state);
      expect(legal.length).toBeGreaterThan(0);
      // Pile everything up in the middle so the entry blocks.
      const mid = legal.filter((m) => m.type === "place" && Math.abs(m.col - cfg.width / 2) <= 1);
      state = reduceSailing(state, (mid[0] ?? legal[0])!);
      if (state.lastMove?.wipe) wiped = state;
    }
    expect(wiped).not.toBeNull();
    const w = wiped!;
    expect(w.finished).toBe(false);
    expect(w.cells.every((c) => c === null)).toBe(true);
    expect(w.platforms.length).toBe(config.platformsAtOnce);
    expect(w.lastMove!.wipe!.penalty).toBe(config.topOutPenalty);
    expect(w.lastMove!.wipe!.ids.length).toBeGreaterThan(0);
    expect(w.combo).toBe(0);
    expect(w.score).toBeGreaterThanOrEqual(0);
    // And a placement is always available afterwards.
    expect(legalMoves(w).length).toBeGreaterThan(0);
  });

  it("the entry is always free while the round runs", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        if (!state.finished) {
          expect(sailingSpawnFree(state)).toBe(true);
          expect(legalMoves(state).length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("sailing chains", () => {
  it("every step of a chain multiplies by its entry in the chain table, the last entry past its end", () => {
    const mult = (n: number): number => cfg.chainMultipliers[Math.min(n, cfg.chainMultipliers.length) - 1]!;
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.array(fc.nat({ max: 10_000 }), { minLength: 1, maxLength: 40 }), (seed, picks) => {
        let state = createSailingGame(seed, cfg);
        for (const pick of picks) {
          const legal = legalMoves(state);
          if (state.finished || legal.length === 0) break;
          state = reduceSailing(state, legal[pick % legal.length]!);
          for (const r of state.lastMove!.rounds) expect(r.points).toBe(r.groups.reduce((n, g) => n + g.points, 0) * r.groups.length * mult(r.chain));
        }
      }),
      { numRuns: 40 },
    );
  });
});

