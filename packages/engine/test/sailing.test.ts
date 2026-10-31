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
  sailingLandingCells,
  sailingPlaceIllegalReason,
  type Platform,
  type Rotation,
  type SailingMove,
  type SailingState,
  type Segment,
} from "../src/index.js";

const cfg = DEFAULT_SAILING_CONFIG;

function legalMoves(state: SailingState): SailingMove[] {
  const out: SailingMove[] = [];
  for (let rot = 0; rot < 4; rot++) {
    for (let col = 0; col < state.config.width; col++) {
      if (sailingPlaceIllegalReason(state, col, rot) === null) out.push({ type: "place", col, rot: rot as Rotation });
    }
  }
  return out;
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
  const shelf = new Set<number>();
  for (const p of state.platforms) for (let i = 0; i < p.span; i++) shelf.add(sailingIdx(state.config, p.col + i, p.row));
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
        expect(s.platforms.length).toBe(cfg.platformsAtOnce);
        for (const p of s.platforms) {
          expect(p.targets.some((t) => t !== null)).toBe(true);
          expect(p.col + p.span).toBeLessThanOrEqual(cfg.width);
          expect(p.row).toBeGreaterThanOrEqual(2);
        }
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("platforms never share or neighbour a row", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        const rows = state.platforms.map((p) => p.row).sort((a, b) => a - b);
        for (let i = 1; i < rows.length; i++) expect(rows[i]! - rows[i - 1]!).toBeGreaterThan(1);
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
          const satisfied = p.targets.every((t, i) => t === null || kind(p.col + i, p.row) === t);
          expect(satisfied).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("a pair lands where the ghost said it would", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createSailingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          const m = legal[p % legal.length]!;
          if (m.type !== "place") break;
          const ghost = sailingLandingCells(state, m.col, m.rot)!;
          const next = reduceSailing(state, m);
          expect(next.lastMove?.landed?.cells).toEqual([ghost.a, ghost.b]);
          state = next;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("a satisfied platform clears its targets and scores platformPoints per target", () => {
    // Build a state by hand: one platform of span 2 with two targets of kind 0 on row 2.
    const base = createSailingGame("by-hand");
    const platform: Platform = { id: 99, row: 2, col: 1, span: 2, targets: [0, 0] };
    const state: SailingState = { ...base, platforms: [platform], current: { a: 0, b: 0 }, next: { a: 1, b: 2 } };
    const next = reduceSailing(state, { type: "place", col: 1, rot: 0 });
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
    const platform: Platform = { id: 7, row: 4, col: 2, span: 2, targets: [1, null] };
    const state: SailingState = { ...base, platforms: [platform], current: { a: 0, b: 0 } };
    const next = reduceSailing(state, { type: "place", col: 2, rot: 0 });
    expect(next.lastMove?.landed?.cells).toEqual([sailingIdx(cfg, 2, 4), sailingIdx(cfg, 3, 4)]);
  });

  it("four in a row clears and cascades multiply by chain", () => {
    const base = createSailingGame("runs");
    const cells = base.cells.slice();
    // Three kind-0 segments on the floor, columns 0..2; the drop adds a vertical pair at column 3 with a at the bottom.
    for (let c = 0; c < 3; c++) cells[sailingIdx(cfg, c, 0)] = { id: 1000 + c, kind: 0, pair: 500 + c };
    const state: SailingState = { ...base, cells, platforms: [], current: { a: 0, b: 1 } };
    const next = reduceSailing(state, { type: "place", col: 3, rot: 1 });
    expect(next.lastMove?.rounds[0]?.groups[0]?.cause).toBe("run");
    expect(next.lastMove?.rounds[0]?.points).toBe(cfg.runPoints);
    // The surviving half (kind 1) fell to the floor.
    expect(next.cells[sailingIdx(cfg, 3, 0)]?.kind).toBe(1);
  });

  it("rejects placements on occupied spawn cells and moves after the end", () => {
    const base = createSailingGame("illegal");
    expect(() => reduceSailing(base, { type: "place", col: cfg.width - 1, rot: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceSailing(base, { type: "place", col: 2, rot: 5 as Rotation })).toThrow(InvalidMoveError);
    const ended = reduceSailing(base, { type: "end" });
    expect(ended.finished).toBe(true);
    expect(() => reduceSailing(ended, { type: "place", col: 0, rot: 0 })).toThrow(InvalidMoveError);
  });

  it("finishes at maxMoves", () => {
    const { state } = playRandom("short", Array.from({ length: 50 }, (_, i) => i * 31), { ...cfg, maxMoves: 5 });
    expect(state.moveCount).toBeLessThanOrEqual(5);
    expect(state.finished).toBe(true);
  });

  it("tops out when the spawn row is blocked", () => {
    const { state } = playRandom("stack", Array.from({ length: 200 }, () => 0), { ...cfg, pieceKinds: 8, platformsAtOnce: 0, maxMoves: 500 });
    expect(state.finished).toBe(true);
    expect(state.moveCount).toBeLessThan(500);
  });
});
