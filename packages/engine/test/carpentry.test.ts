import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_CARPENTRY_CONFIG,
  InvalidMoveError,
  PENTOMINOES,
  carpentryCheckPlacement,
  carpentryIdx,
  carpentryOrient,
  carpentryRateHole,
  createCarpentryGame,
  hashCarpentryState,
  reduceCarpentry,
  replayCarpentry,
  type CarpentryMove,
  type CarpentryState,
} from "../src/index.js";

const cfg = DEFAULT_CARPENTRY_CONFIG;

function legalMoves(state: CarpentryState): CarpentryMove[] {
  const out: CarpentryMove[] = [];
  for (let slot = 0; slot < state.slots.length; slot++) {
    for (let rot = 0; rot < 4; rot++) {
      for (const flip of [false, true]) {
        for (let row = 0; row < state.config.height; row++) {
          for (let col = 0; col < state.config.width; col++) {
            if (carpentryCheckPlacement(state, slot, rot, flip, col, row).legal) out.push({ type: "place", slot, rot, flip, col, row });
          }
        }
      }
    }
  }
  return out;
}

function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: CarpentryMove[]; state: CarpentryState } {
  let state = createCarpentryGame(seed, config);
  const moves: CarpentryMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const legal = legalMoves(state);
    if (legal.length === 0) break;
    const m = legal[p % legal.length]!;
    moves.push(m);
    state = reduceCarpentry(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 25 });

function expectInvariants(state: CarpentryState): void {
  const { width, height } = state.config;
  const owner = new Map<number, number>();
  for (const h of state.holes) {
    expect(h.cells.length).toBeGreaterThan(0);
    for (const c of h.cells) {
      expect(owner.has(c), "holes overlap").toBe(false);
      owner.set(c, h.id);
    }
  }
  // No two holes touch, even diagonally.
  for (const [c, id] of owner) {
    const col = c % width;
    const row = Math.floor(c / width);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cc = col + dc;
        const rr = row + dr;
        if (cc < 0 || cc >= width || rr < 0 || rr >= height) continue;
        const other = owner.get(rr * width + cc);
        if (other !== undefined) expect(other, "holes touch").toBe(id);
      }
    }
  }
  // Every plank belongs to a live hole and covers at least one of its cells; hull is covered at most once.
  const holeIds = new Set(state.holes.map((h) => h.id));
  for (const p of state.planks) {
    expect(holeIds.has(p.holeId)).toBe(true);
    expect(p.cells.some((c) => owner.get(c) === p.holeId)).toBe(true);
  }
  for (let c = 0; c < state.covered.length; c++) {
    if (!owner.has(c)) expect(state.covered[c]).toBeLessThanOrEqual(1);
  }
  // Cover counts agree with the planks.
  const counts = new Array<number>(width * height).fill(0);
  for (const p of state.planks) for (const c of p.cells) counts[c]!++;
  expect(state.covered).toEqual(counts);
  expect(state.slots.length).toBe(3);
}

describe("carpentry shapes", () => {
  it("has twelve distinct free pentominoes", () => {
    const canon = new Set<string>();
    for (let s = 0; s < PENTOMINOES.length; s++) {
      let best = "";
      for (let rot = 0; rot < 4; rot++) {
        for (const flip of [false, true]) {
          const key = carpentryOrient(s, rot, flip)
            .map(([x, y]) => `${x},${y}`)
            .join(" ");
          if (best === "" || key < best) best = key;
        }
      }
      canon.add(best);
    }
    expect(canon.size).toBe(12);
    for (const p of PENTOMINOES) expect(p.length).toBe(5);
  });
});

describe("carpentry board", () => {
  it("opens with the configured holes, each a multiple of five cells, and no planks", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createCarpentryGame(seed);
        expect(s.holes.length).toBe(cfg.holesAtOnce);
        for (const h of s.holes) {
          expect(h.cells.length % 5).toBe(0);
          expect(h.cells.length / 5).toBeGreaterThanOrEqual(cfg.minHolePieces);
          expect(h.cells.length / 5).toBeLessThanOrEqual(cfg.maxHolePieces);
        }
        expect(s.planks).toEqual([]);
        expect(s.finished).toBe(false);
        expectInvariants(s);
      }),
      { numRuns: 60 },
    );
  });
});

describe("carpentry determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replayCarpentry(seed, a.moves);
        expect(hashCarpentryState(b)).toBe(hashCarpentryState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 200 },
    );
  });

  it("different seeds deal different openings", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(hashCarpentryState(createCarpentryGame(a))).not.toBe(hashCarpentryState(createCarpentryGame(b)));
      }),
      { numRuns: 60 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCarpentryGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          const m = legal[p % legal.length]!;
          const before = JSON.stringify(state);
          reduceCarpentry(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reduceCarpentry(state, m);
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe("carpentry rules", () => {
  it("keeps the board invariants after every move and replaces patched holes", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCarpentryGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          const next = reduceCarpentry(state, legal[p % legal.length]!);
          expectInvariants(next);
          const rep = next.lastMove!;
          expect(rep.placed).not.toBeNull();
          if (rep.patched) {
            expect(next.holes.find((h) => h.id === rep.patched!.holeId)).toBeUndefined();
            expect(next.patchedCount).toBe(state.patchedCount + 1);
            expect(next.score).toBe(state.score + rep.patched.points);
            // A grown hole can never be a masterpiece.
            const was = state.holes.find((h) => h.id === rep.patched!.holeId)!;
            if (was.grown) expect(rep.patched.rating).not.toBe("masterpiece");
          }
          expect(next.holes.length).toBeLessThanOrEqual(cfg.holesAtOnce);
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  it("rates by extra planks, and waste denies a masterpiece", () => {
    expect(carpentryRateHole(10, 2, 0)).toEqual({ rating: "masterpiece", extra: 0 });
    expect(carpentryRateHole(10, 2, 3)).toEqual({ rating: "craftsmanship", extra: 0 });
    expect(carpentryRateHole(10, 3, 5)).toEqual({ rating: "craftsmanship", extra: 1 });
    expect(carpentryRateHole(10, 4, 5)).toEqual({ rating: "fair", extra: 2 });
    expect(carpentryRateHole(10, 5, 5)).toEqual({ rating: "sloppy", extra: 3 });
    expect(carpentryRateHole(10, 9, 5)).toEqual({ rating: "pig", extra: 7 });
    expect(carpentryRateHole(11, 3, 4)).toEqual({ rating: "craftsmanship", extra: 0 });
  });

  it("a perfect single-plank fill is a masterpiece worth the full multiplier, and the streak chains", () => {
    const base = createCarpentryGame("fit");
    const cells = [carpentryIdx(cfg, 1, 1), carpentryIdx(cfg, 2, 1), carpentryIdx(cfg, 3, 1), carpentryIdx(cfg, 4, 1), carpentryIdx(cfg, 5, 1)];
    const state: CarpentryState = {
      ...base,
      holes: [{ id: 50, cells, pieces: 0, waste: 0, idleMoves: 0, grown: false, allHorizontal: true }],
      planks: [],
      covered: new Array<number>(cfg.width * cfg.height).fill(0),
      slots: [
        { shape: 1, grain: "h", kind: 0 },
        { shape: 1, grain: "v", kind: 1 },
        { shape: 1, grain: "h", kind: 2 },
      ],
      combo: 2,
    };
    // Grain "v" rotated a quarter turn runs horizontally; the I piece lies flat at rot 1.
    const next = reduceCarpentry(state, { type: "place", slot: 1, rot: 1, flip: false, col: 1, row: 1 });
    const patched = next.lastMove!.patched!;
    expect(patched.rating).toBe("masterpiece");
    expect(patched.grainBonus).toBe(true);
    expect(patched.chain).toBe(3);
    expect(patched.points).toBe(Math.round(5 * cfg.basePerCell * 3 * 1.25 * 3));
    expect(next.combo).toBe(3);
    expect(next.planks.length).toBe(0);
    expect(next.covered.every((c) => c === 0)).toBe(true);
    expect(next.lastMove!.spawned.length).toBeGreaterThan(0);
  });

  it("an idle hole grows after growAfterMoves placements elsewhere", () => {
    const config = { ...cfg, growAfterMoves: 1, holesAtOnce: 2 };
    const { moves } = playRandom("grow", Array.from({ length: 30 }, (_, i) => i * 977), config);
    expect(moves.length).toBeGreaterThan(2);
    let grew = 0;
    let s = createCarpentryGame("grow", config);
    for (const m of moves) {
      s = reduceCarpentry(s, m);
      if (s.lastMove?.grown) {
        grew++;
        const h = s.holes.find((x) => x.id === s.lastMove!.grown!.holeId)!;
        expect(h.grown).toBe(true);
        expect(h.cells).toContain(s.lastMove!.grown!.cell);
      }
    }
    expect(grew).toBeGreaterThan(0);
  });

  it("rejects planks off the board, bad slots, moves after the end, and planks covering no hole", () => {
    const s = createCarpentryGame("illegal");
    expect(() => reduceCarpentry(s, { type: "place", slot: 0, rot: 0, flip: false, col: -1, row: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceCarpentry(s, { type: "place", slot: 5, rot: 0, flip: false, col: 0, row: 0 })).toThrow(InvalidMoveError);
    const holeCells = new Set(s.holes.flatMap((h) => h.cells));
    let found = false;
    for (let row = 0; row < cfg.height && !found; row++) {
      for (let col = 0; col < cfg.width && !found; col++) {
        const check = carpentryCheckPlacement(s, 0, 0, false, col, row);
        if (check.cells.length && check.cells.every((c) => !holeCells.has(c))) {
          expect(check.legal).toBe(false);
          expect(() => reduceCarpentry(s, { type: "place", slot: 0, rot: 0, flip: false, col, row })).toThrow(InvalidMoveError);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
    const ended = reduceCarpentry(s, { type: "end" });
    expect(ended.finished).toBe(true);
    expect(() => reduceCarpentry(ended, { type: "end" })).toThrow(InvalidMoveError);
  });

  it("finishes at maxMoves", () => {
    const { state } = playRandom("short", Array.from({ length: 20 }, (_, i) => i * 31), { ...cfg, maxMoves: 4 });
    expect(state.moveCount).toBe(4);
    expect(state.finished).toBe(true);
  });
});
