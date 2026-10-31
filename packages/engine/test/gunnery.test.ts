import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_GUNNERY_CONFIG,
  GUNNERY_KINDS,
  GunneryKind,
  InvalidMoveError,
  advanceGunnery,
  cannonNeeds,
  createGunneryGame,
  gunneryCellAt,
  hashGunneryState,
  parseGunneryDeck,
  reduceGunnery,
  replayGunnery,
  type Dir,
  type GunneryMove,
  type GunneryPiece,
  type GunneryState,
} from "../src/index.js";

const cfg = DEFAULT_GUNNERY_CONFIG;

/** Deck cells a player may put an arrow on. */
function deckCells(state: GunneryState): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < state.deck.height; row++) {
    for (let col = 0; col < state.deck.width; col++) if (gunneryCellAt(state.deck, col, row) === "deck") out.push({ col, row });
  }
  return out;
}

/** Random arrow placements at increasing ticks; `picks` are (cell, dir, tick gap) triples flattened. */
function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: GunneryMove[]; state: GunneryState } {
  let state = createGunneryGame(seed, config);
  const moves: GunneryMove[] = [];
  const cells = deckCells(state);
  for (let i = 0; i + 2 < picks.length; i += 3) {
    if (state.finished) break;
    const cell = cells[picks[i]! % cells.length]!;
    const tick = Math.min(config.maxTick, state.tick + (picks[i + 2]! % 9));
    const m: GunneryMove =
      picks[i + 1]! % 7 === 6 ? { type: "wait", tick } : { type: "arrow", col: cell.col, row: cell.row, dir: (picks[i + 1]! % 4) as Dir, tick };
    moves.push(m);
    state = reduceGunnery(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 150 });

function expectInvariants(state: GunneryState): void {
  const seen = new Set<string>();
  for (const p of state.pieces) {
    const key = `${p.col},${p.row}`;
    expect(seen.has(key), `two pieces at ${key}`).toBe(false);
    seen.add(key);
    expect(gunneryCellAt(state.deck, p.col, p.row)).toBe("deck");
  }
  expect(state.arrows.length).toBeLessThanOrEqual(state.config.maxArrows);
  const ids = state.pieces.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("gunnery deck", () => {
  it("parses the default deck", () => {
    const d = parseGunneryDeck(cfg.deck);
    expect(d.width).toBe(9);
    expect(d.height).toBe(11);
    expect(d.cannons.length).toBe(4);
    expect(d.barrel).toEqual({ col: 4, row: 5 });
  });

  it("rejects malformed decks", () => {
    expect(() => parseGunneryDeck(["#####", "#...#", "#.B.#", "#...#", "####"])).toThrow(/width/);
    expect(() => parseGunneryDeck(["#####", "#...#", "#.B.#", "#...#", "#####"])).toThrow(/no cannons/);
    expect(() => parseGunneryDeck(["#####", "#...C", "#.Q.#", "#...#", "#####"])).toThrow(/unknown symbol/);
    expect(() => parseGunneryDeck(["#####", "#...C", "#.B.#", "#.B.#", "#####"])).toThrow(/more than one barrel/);
    expect(() => parseGunneryDeck(["#####", "#...C", "#.B..", "#...#", "#####"])).toThrow(/open rim/);
  });
});

describe("gunnery determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replayGunnery(seed, a.moves);
        expect(hashGunneryState(b)).toBe(hashGunneryState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 200 },
    );
  });

  it("waiting is the same as advancing, tick by tick or in one jump", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 120 }), (seed, ticks) => {
        const start = createGunneryGame(seed);
        const jumped = advanceGunnery(start, ticks);
        let stepped = start;
        for (let t = 1; t <= ticks; t++) stepped = advanceGunnery(stepped, t);
        const waited = ticks > 0 ? reduceGunnery(start, { type: "wait", tick: ticks }) : start;
        expect(hashGunneryState(stepped)).toBe(hashGunneryState(jumped));
        expect({ ...waited, moveCount: 0, lastMove: null }).toEqual({ ...jumped, lastMove: null });
      }),
      { numRuns: 60 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves } = playRandom(seed, picks);
        let state = createGunneryGame(seed);
        for (const m of moves) {
          const before = JSON.stringify(state);
          reduceGunnery(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reduceGunnery(state, m);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("gunnery rules", () => {
  it("keeps every invariant through random play", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createGunneryGame(seed);
        const cells = deckCells(state);
        for (let i = 0; i + 2 < picks.length; i += 3) {
          if (state.finished) break;
          const cell = cells[picks[i]! % cells.length]!;
          const tick = Math.min(cfg.maxTick, state.tick + (picks[i + 2]! % 9));
          state = reduceGunnery(state, { type: "arrow", col: cell.col, row: cell.row, dir: (picks[i + 1]! % 4) as Dir, tick });
          expectInvariants(state);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("the barrel never over-supplies a kind", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 200 }), (seed, ticks) => {
        const s = advanceGunnery(createGunneryGame(seed), ticks);
        const spawnedNow = s.lastMove?.events.filter((e) => e.type === "spawn" && e.tick === s.tick) ?? [];
        if (spawnedNow.length === 0) return;
        const counts = new Array<number>(GUNNERY_KINDS).fill(0);
        for (const p of s.pieces) counts[p.kind]!++;
        for (const e of spawnedNow) expect(counts[e.kind!]).toBeLessThanOrEqual(cfg.perKindOnDeck);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects ticks that go backwards, beyond the round, or after the end", () => {
    const s = reduceGunnery(createGunneryGame("ticks"), { type: "wait", tick: 10 });
    expect(() => reduceGunnery(s, { type: "wait", tick: 9 })).toThrow(InvalidMoveError);
    expect(() => reduceGunnery(s, { type: "wait", tick: cfg.maxTick + 1 })).toThrow(InvalidMoveError);
    expect(() => reduceGunnery(s, { type: "arrow", col: 0, row: 0, dir: 0, tick: 10 })).toThrow(InvalidMoveError);
    expect(() => reduceGunnery(s, { type: "arrow", col: 1, row: 1, dir: 7 as Dir, tick: 10 })).toThrow(InvalidMoveError);
    const ended = reduceGunnery(s, { type: "end", tick: 12 });
    expect(ended.finished).toBe(true);
    expect(() => reduceGunnery(ended, { type: "wait", tick: 13 })).toThrow(InvalidMoveError);
    const capped = reduceGunnery(s, { type: "wait", tick: cfg.maxTick });
    expect(capped.finished).toBe(true);
  });

  it("evicts the oldest arrow past maxArrows and replaces an arrow on the same cell", () => {
    let s = createGunneryGame("arrows");
    s = reduceGunnery(s, { type: "arrow", col: 1, row: 1, dir: 0, tick: 0 });
    s = reduceGunnery(s, { type: "arrow", col: 2, row: 1, dir: 1, tick: 0 });
    s = reduceGunnery(s, { type: "arrow", col: 3, row: 1, dir: 2, tick: 0 });
    s = reduceGunnery(s, { type: "arrow", col: 1, row: 1, dir: 3, tick: 0 });
    expect(s.arrows.map((a) => [a.col, a.dir])).toEqual([
      [2, 1],
      [3, 2],
      [1, 3],
    ]);
    s = reduceGunnery(s, { type: "arrow", col: 5, row: 1, dir: 0, tick: 0 });
    expect(s.arrows.map((a) => a.col)).toEqual([3, 1, 5]);
    expect(s.arrowsPlaced).toBe(5);
    s = reduceGunnery(s, { type: "remove", col: 3, row: 1, tick: 0 });
    expect(s.arrows.map((a) => a.col)).toEqual([1, 5]);
  });
});

/** A state with a single piece of `kind` rolling toward the cannon at row 2 on the east side. */
function aimed(kind: number, cannonsPatch: Partial<GunneryState["cannons"][number]> = {}, pieceOverride: Partial<GunneryPiece> = {}): GunneryState {
  const base = createGunneryGame("aim", { ...cfg, perKindOnDeck: 1, spawnEveryTicks: 10_000 });
  const piece: GunneryPiece = { id: 500, kind, col: 6, row: 2, dir: 0, ...pieceOverride };
  const cannons = base.cannons.map((c, i) => (i === 1 ? { ...c, ...cannonsPatch } : c));
  return { ...base, pieces: [piece], cannons, nextId: 501 };
}

describe("gunnery cannons", () => {
  it("loads powder, wad, shot in order and scores on the third, then fires itself", () => {
    let s = aimed(GunneryKind.Powder);
    s = advanceGunnery(s, 2);
    expect(s.pieces.length).toBe(0);
    expect(s.cannons[1]!.loaded).toBe(1);
    expect(cannonNeeds(s.cannons[1]!)).toBe(GunneryKind.Wad);
    s = { ...s, pieces: [{ id: 501, kind: GunneryKind.Wad, col: 6, row: 2, dir: 0 }] };
    s = advanceGunnery(s, 4);
    expect(s.cannons[1]!.loaded).toBe(2);
    s = { ...s, pieces: [{ id: 502, kind: GunneryKind.Shot, col: 6, row: 2, dir: 0 }] };
    s = advanceGunnery(s, 6);
    expect(s.cannons[1]!.loaded).toBe(3);
    expect(s.score).toBe(cfg.loadPoints);
    expect(s.combo).toBe(1);
    expect(s.loads).toBe(1);
    expect(s.lastMove?.events.some((e) => e.type === "loaded" && e.cannon === 1)).toBe(true);
    expect(s.cannons[1]!.firesAt).toBe(6 + cfg.fireAfterTicks);
    s = advanceGunnery(s, 6 + cfg.fireAfterTicks);
    expect(s.cannons[1]!.fouled).toBe(true);
    expect(s.cannons[1]!.loaded).toBe(0);
    expect(s.lastMove?.events.some((e) => e.type === "fire")).toBe(true);
  });

  it("a wrong piece fouls the cannon and breaks the combo; water cleans it", () => {
    let s = aimed(GunneryKind.Shot);
    s = { ...s, combo: 3 };
    s = advanceGunnery(s, 2);
    expect(s.cannons[1]!.fouled).toBe(true);
    expect(s.combo).toBe(0);
    expect(s.fouls).toBe(1);
    s = { ...s, pieces: [{ id: 600, kind: GunneryKind.Powder, col: 6, row: 2, dir: 0 }] };
    s = advanceGunnery(s, 4);
    expect(s.cannons[1]!.fouled).toBe(true);
    expect(s.lastMove?.events.some((e) => e.type === "waste")).toBe(true);
    s = { ...s, pieces: [{ id: 601, kind: GunneryKind.Water, col: 6, row: 2, dir: 0 }] };
    s = advanceGunnery(s, 6);
    expect(s.cannons[1]!.fouled).toBe(false);
    expect(s.lastMove?.events.some((e) => e.type === "clean")).toBe(true);
  });

  it("water washes a part-loaded cannon back to empty", () => {
    let s = aimed(GunneryKind.Water, { loaded: 2 });
    s = advanceGunnery(s, 2);
    expect(s.cannons[1]!.loaded).toBe(0);
    expect(s.cannons[1]!.fouled).toBe(false);
  });

  it("a hatch swallows a piece", () => {
    let s = aimed(GunneryKind.Powder, {}, { col: 6, row: 4, dir: 0 });
    s = advanceGunnery(s, 2);
    expect(s.pieces.length).toBe(0);
    expect(s.lastMove?.events.some((e) => e.type === "exit")).toBe(true);
  });

  it("an arrow turns a piece, a wall turns it right, and two pieces bounce apart", () => {
    let s = aimed(GunneryKind.Powder, {}, { col: 2, row: 1, dir: 0 });
    s = reduceGunnery(s, { type: "arrow", col: 3, row: 1, dir: 1, tick: 0 });
    s = advanceGunnery(s, 2);
    expect(s.pieces[0]).toMatchObject({ col: 3, row: 2, dir: 1 });
    // Heading right along row 1 into the east wall at col 8: turns right (down) along the wall.
    let w = aimed(GunneryKind.Powder, {}, { col: 7, row: 1, dir: 0 });
    w = advanceGunnery(w, 1);
    expect(w.pieces[0]).toMatchObject({ col: 7, row: 2, dir: 1 });
    // Head on: both reverse without moving.
    let b = aimed(GunneryKind.Powder, {}, { col: 2, row: 1, dir: 0 });
    b = { ...b, pieces: [...b.pieces, { id: 777, kind: GunneryKind.Wad, col: 3, row: 1, dir: 2 }] };
    b = advanceGunnery(b, 1);
    expect(b.pieces.map((p) => [p.col, p.dir])).toEqual([
      [2, 2],
      [3, 0],
    ]);
  });
});
