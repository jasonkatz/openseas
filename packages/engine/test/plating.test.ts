import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_PLATING_CONFIG,
  InvalidMoveError,
  PENTOMINOES,
  platingCheckPlacement,
  platingIdx,
  platingOrient,
  platingPlacementCells,
  platingRateBreach,
  createPlatingGame,
  hashPlatingState,
  reducePlating,
  replayPlating,
  type PlatingMove,
  type PlatingState,
} from "../src/index.js";

const cfg = DEFAULT_PLATING_CONFIG;

function legalMoves(state: PlatingState): PlatingMove[] {
  const out: PlatingMove[] = [];
  for (let slot = 0; slot < state.slots.length; slot++) {
    for (let rot = 0; rot < 4; rot++) {
      for (const flip of [false, true]) {
        for (let row = 0; row < state.config.height; row++) {
          for (let col = 0; col < state.config.width; col++) {
            if (platingCheckPlacement(state, slot, rot, flip, col, row).legal) out.push({ type: "place", slot, rot, flip, col, row });
          }
        }
      }
    }
  }
  return out;
}

function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: PlatingMove[]; state: PlatingState } {
  let state = createPlatingGame(seed, config);
  const moves: PlatingMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const legal = legalMoves(state);
    if (legal.length === 0) break;
    const m = legal[p % legal.length]!;
    moves.push(m);
    state = reducePlating(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 25 });

function expectInvariants(state: PlatingState): void {
  const { width, height } = state.config;
  const owner = new Map<number, number>();
  for (const h of state.breaches) {
    expect(h.cells.length).toBeGreaterThan(0);
    for (const c of h.cells) {
      expect(owner.has(c), "breaches overlap").toBe(false);
      owner.set(c, h.id);
    }
  }
  // No two breaches touch, even diagonally.
  for (const [c, id] of owner) {
    const col = c % width;
    const row = Math.floor(c / width);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cc = col + dc;
        const rr = row + dr;
        if (cc < 0 || cc >= width || rr < 0 || rr >= height) continue;
        const other = owner.get(rr * width + cc);
        if (other !== undefined) expect(other, "breaches touch").toBe(id);
      }
    }
  }
  // Every plate belongs to a live breach and covers at least one of its cells; hull is covered at most once.
  const breachIds = new Set(state.breaches.map((h) => h.id));
  for (const p of state.plates) {
    expect(breachIds.has(p.breachId)).toBe(true);
    expect(p.cells.some((c) => owner.get(c) === p.breachId)).toBe(true);
  }
  for (let c = 0; c < state.covered.length; c++) {
    if (!owner.has(c)) expect(state.covered[c]).toBeLessThanOrEqual(1);
  }
  // Cover counts agree with the plates.
  const counts = new Array<number>(width * height).fill(0);
  for (const p of state.plates) for (const c of p.cells) counts[c]!++;
  expect(state.covered).toEqual(counts);
  expect(state.slots.length).toBe(3);
}

describe("plating shapes", () => {
  it("has twelve distinct free pentominoes", () => {
    const canon = new Set<string>();
    for (let s = 0; s < PENTOMINOES.length; s++) {
      let best = "";
      for (let rot = 0; rot < 4; rot++) {
        for (const flip of [false, true]) {
          const key = platingOrient(s, rot, flip)
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

describe("plating board", () => {
  it("opens with the configured breaches, each a multiple of five cells, and no plates", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createPlatingGame(seed);
        expect(s.breaches.length).toBe(cfg.breachesAtOnce);
        for (const h of s.breaches) {
          expect(h.cells.length % 5).toBe(0);
          expect(h.cells.length / 5).toBeGreaterThanOrEqual(cfg.minBreachPieces);
          expect(h.cells.length / 5).toBeLessThanOrEqual(cfg.maxBreachPieces);
        }
        expect(s.plates).toEqual([]);
        expect(s.finished).toBe(false);
        expectInvariants(s);
      }),
      { numRuns: 60 },
    );
  });
});

describe("plating determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replayPlating(seed, a.moves);
        expect(hashPlatingState(b)).toBe(hashPlatingState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 200 },
    );
  });

  it("different seeds deal different openings", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(hashPlatingState(createPlatingGame(a))).not.toBe(hashPlatingState(createPlatingGame(b)));
      }),
      { numRuns: 60 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createPlatingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          const m = legal[p % legal.length]!;
          const before = JSON.stringify(state);
          reducePlating(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reducePlating(state, m);
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe("plating rules", () => {
  it("keeps the board invariants after every move and replaces sealed breaches", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createPlatingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalMoves(state);
          if (!legal.length) break;
          const next = reducePlating(state, legal[p % legal.length]!);
          expectInvariants(next);
          const rep = next.lastMove!;
          expect(rep.placed).not.toBeNull();
          if (rep.sealed) {
            expect(next.breaches.find((h) => h.id === rep.sealed!.breachId)).toBeUndefined();
            expect(next.sealedCount).toBe(state.sealedCount + 1);
            expect(next.score).toBe(state.score + rep.sealed.points);
            // A grown breach can never be a flawless.
            const was = state.breaches.find((h) => h.id === rep.sealed!.breachId)!;
            if (was.grown) expect(rep.sealed.rating).not.toBe("flawless");
          }
          expect(next.breaches.length).toBeLessThanOrEqual(cfg.breachesAtOnce);
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  it("rates by extra plates, and waste denies a flawless", () => {
    expect(platingRateBreach(10, 2, 0)).toEqual({ rating: "flawless", extra: 0 });
    expect(platingRateBreach(10, 2, 3)).toEqual({ rating: "solid", extra: 0 });
    expect(platingRateBreach(10, 3, 5)).toEqual({ rating: "solid", extra: 1 });
    expect(platingRateBreach(10, 4, 5)).toEqual({ rating: "holds", extra: 2 });
    expect(platingRateBreach(10, 5, 5)).toEqual({ rating: "tape", extra: 3 });
    expect(platingRateBreach(10, 9, 5)).toEqual({ rating: "gum", extra: 7 });
    expect(platingRateBreach(11, 3, 4)).toEqual({ rating: "solid", extra: 0 });
  });

  it("a perfect single-plate fill is a flawless worth the full multiplier, and the streak chains", () => {
    const base = createPlatingGame("fit");
    const cells = [platingIdx(cfg, 1, 1), platingIdx(cfg, 2, 1), platingIdx(cfg, 3, 1), platingIdx(cfg, 4, 1), platingIdx(cfg, 5, 1)];
    const state: PlatingState = {
      ...base,
      breaches: [{ id: 50, cells, pieces: 0, waste: 0, idleMoves: 0, grown: false, allHorizontal: true }],
      plates: [],
      covered: new Array<number>(cfg.width * cfg.height).fill(0),
      slots: [
        { shape: 1, brush: "h", kind: 0 },
        { shape: 1, brush: "v", kind: 1 },
        { shape: 1, brush: "h", kind: 2 },
      ],
      combo: 2,
    };
    // Brush "v" rotated a quarter turn runs horizontally; the I piece lies flat at rot 1.
    const next = reducePlating(state, { type: "place", slot: 1, rot: 1, flip: false, col: 1, row: 1 });
    const sealed = next.lastMove!.sealed!;
    expect(sealed.rating).toBe("flawless");
    expect(sealed.brushBonus).toBe(true);
    expect(sealed.chain).toBe(3);
    // The third flawless in a row takes the streak table's third entry, not three times the points.
    expect(sealed.streakPercent).toBe(cfg.streakPercent[2]);
    expect(sealed.points).toBe(Math.round((5 * cfg.basePerCell * 3 * 1.25 * cfg.streakPercent[2]!) / 100));
    expect(next.combo).toBe(3);
    expect(next.plates.length).toBe(0);
    expect(next.covered.every((c) => c === 0)).toBe(true);
    expect(next.lastMove!.spawned.length).toBeGreaterThan(0);
  });

  it("an idle breach grows after growAfterMoves placements elsewhere", () => {
    const config = { ...cfg, growAfterMoves: 1, breachesAtOnce: 2 };
    const { moves } = playRandom("grow", Array.from({ length: 30 }, (_, i) => i * 977), config);
    expect(moves.length).toBeGreaterThan(2);
    let grew = 0;
    let s = createPlatingGame("grow", config);
    for (const m of moves) {
      s = reducePlating(s, m);
      if (s.lastMove?.grown) {
        grew++;
        const h = s.breaches.find((x) => x.id === s.lastMove!.grown!.breachId)!;
        expect(h.grown).toBe(true);
        expect(h.cells).toContain(s.lastMove!.grown!.cell);
      }
    }
    expect(grew).toBeGreaterThan(0);
  });

  it("a plate may hang off the board or lie over another breach; those parts are waste and lay nothing", () => {
    const base = createPlatingGame("overhang");
    const at = (c: number, r: number): number => platingIdx(cfg, c, r);
    const breach = (id: number, cells: number[]): PlatingState["breaches"][number] => ({ id, cells, pieces: 0, waste: 0, idleMoves: 0, grown: false, allHorizontal: true });
    const state: PlatingState = {
      ...base,
      breaches: [breach(50, [0, 1, 2, 3, 4].map((r) => at(0, r))), breach(51, [2, 3, 4, 5, 6].map((c) => at(c, 0)))],
      plates: [],
      covered: new Array<number>(cfg.width * cfg.height).fill(0),
      slots: [{ shape: 1, brush: "h", kind: 0 }, base.slots[1]!, base.slots[2]!],
    };
    // The I plate lies flat at rot 1: two cells left of the board, then breach 50, hull, breach 51.
    const check = platingCheckPlacement(state, 0, 1, false, -2, 0);
    expect(check.legal).toBe(true);
    expect(check.breachId).toBe(50);
    expect(check.overhang).toBe(2);
    expect(check.cells).toEqual([at(0, 0), at(1, 0)]);
    expect(check.wasteCells).toEqual([at(1, 0), at(2, 0)]);
    const next = reducePlating(state, { type: "place", slot: 0, rot: 1, flip: false, col: -2, row: 0 });
    expect(next.covered[at(2, 0)]).toBe(0);
    expect(next.covered[at(0, 0)]).toBe(1);
    expect(next.breaches.find((h) => h.id === 50)!.waste).toBe(4);
    // A plate wholly off every breach still lays nothing.
    expect(platingCheckPlacement(state, 0, 1, false, -4, 8).legal).toBe(false);
  });

  it("rejects bad slots, moves after the end, and plates covering no breach", () => {
    const s = createPlatingGame("illegal");
    expect(() => reducePlating(s, { type: "place", slot: 5, rot: 0, flip: false, col: 0, row: 0 })).toThrow(InvalidMoveError);
    const breachCells = new Set(s.breaches.flatMap((h) => h.cells));
    let found = false;
    for (let row = 0; row < cfg.height && !found; row++) {
      for (let col = 0; col < cfg.width && !found; col++) {
        const check = platingCheckPlacement(s, 0, 0, false, col, row);
        const cells = platingPlacementCells(cfg, s.slots[0]!.shape, 0, false, col, row);
        if (cells && cells.every((c) => !breachCells.has(c))) {
          expect(check.legal).toBe(false);
          expect(() => reducePlating(s, { type: "place", slot: 0, rot: 0, flip: false, col, row })).toThrow(InvalidMoveError);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
    const ended = reducePlating(s, { type: "end" });
    expect(ended.finished).toBe(true);
    expect(() => reducePlating(ended, { type: "end" })).toThrow(InvalidMoveError);
  });

  it("finishes at maxMoves", () => {
    const { state } = playRandom("short", Array.from({ length: 20 }, (_, i) => i * 31), { ...cfg, maxMoves: 4 });
    expect(state.moveCount).toBe(4);
    expect(state.finished).toBe(true);
  });
});
