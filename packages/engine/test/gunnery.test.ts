import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_GUNNERY_CONFIG,
  GUNNERY_KINDS,
  GunneryKind,
  InvalidMoveError,
  advanceGunnery,
  cannonNeeds,
  cannonOutcome,
  createGunneryGame,
  gunneryCellAt,
  gunneryDropInterval,
  hashGunneryState,
  parseGunneryDeck,
  predictGunneryPath,
  reduceGunnery,
  replayGunnery,
  type Dir,
  type GunneryConfig,
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
  const arrowCells = state.arrows.map((a) => `${a.col},${a.row}`);
  expect(new Set(arrowCells).size, "one arrow per cell").toBe(arrowCells.length);
  expect(state.pieces.length).toBeLessThanOrEqual(state.config.maxOnDeck);
  expect(state.queue.length).toBe(state.config.queueLength);
  const ids = state.pieces.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const c of state.cannons) {
    expect(c.loaded).toBeGreaterThanOrEqual(0);
    expect(c.loaded).toBeLessThanOrEqual(3);
    if (c.fouled) expect(c.loaded).toBe(0);
    expect(c.firesAt !== null).toBe(c.loaded === 3);
  }
}

/** No drops: a quiet deck to set pieces on by hand. */
const quiet: GunneryConfig = { ...cfg, spawnEveryTicks: 100_000, spawnEveryTicksMin: 100_000 };

/** A quiet state with the given pieces and cannon 1 (east, row 3) patched. */
function deckWith(pieces: GunneryPiece[], cannonPatch: Partial<GunneryState["cannons"][number]> = {}): GunneryState {
  const base = createGunneryGame("quiet", quiet);
  const cannons = base.cannons.map((c, i) => (i === 1 ? { ...c, ...cannonPatch } : c));
  return { ...base, lastDrop: 0, pieces, cannons, nextId: 1000 };
}

/** A piece two cells short of the east cannon on row 3, rolling at it. */
const atEast = (kind: number, id = 500): GunneryPiece => ({ id, kind, col: 8, row: 3, dir: 0 });

describe("gunnery deck", () => {
  it("parses the default deck", () => {
    const d = parseGunneryDeck(cfg.deck);
    expect(d.width).toBe(11);
    expect(d.height).toBe(13);
    expect(d.cannons).toEqual([
      { col: 0, row: 3 },
      { col: 10, row: 3 },
      { col: 0, row: 10 },
      { col: 10, row: 10 },
    ]);
    expect(d.barrel).toEqual({ col: 5, row: 0 });
    expect(d.drop).toEqual({ col: 5, row: 1, dir: 1 });
  });

  it("rejects malformed decks", () => {
    expect(() => parseGunneryDeck(["##B##", "#...#", "#...#", "#...#", "####"])).toThrow(/width/);
    expect(() => parseGunneryDeck(["##B##", "#...#", "#...#", "#...#", "#####"])).toThrow(/no cannons/);
    expect(() => parseGunneryDeck(["##B##", "#...C", "#.Q.#", "#...#", "#####"])).toThrow(/unknown symbol/);
    expect(() => parseGunneryDeck(["##B##", "#...C", "#...#", "#...#", "##B##"])).toThrow(/more than one chute/);
    expect(() => parseGunneryDeck(["##B##", "#...C", "#....", "#...#", "#####"])).toThrow(/open rim/);
    expect(() => parseGunneryDeck(["#####", "#...C", "#.B.#", "#...#", "#####"])).toThrow(/exactly one deck cell/);
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

  it("the chute deals each bag in full before the next, in the order it previews", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const start = createGunneryGame(seed);
        const s = advanceGunnery(start, 160);
        const dropped = (s.lastMove?.events ?? []).filter((e) => e.type === "spawn").map((e) => e.kind!);
        expect(dropped.slice(0, start.queue.length)).toEqual(start.queue);
        const size = cfg.bag.reduce((a, b) => a + b, 0);
        for (let at = 0; at + size <= dropped.length; at += size) {
          const counts = new Array<number>(GUNNERY_KINDS).fill(0);
          for (const k of dropped.slice(at, at + size)) counts[k]!++;
          expect(counts).toEqual([...cfg.bag]);
        }
        expect(dropped.length).toBeGreaterThanOrEqual(size * 2);
      }),
      { numRuns: 40 },
    );
  });

  it("drops quicken from spawnEveryTicks to spawnEveryTicksMin over the round", () => {
    expect(gunneryDropInterval(cfg, 0)).toBe(cfg.spawnEveryTicks);
    expect(gunneryDropInterval(cfg, cfg.maxTick)).toBe(cfg.spawnEveryTicksMin);
    for (let t = 1; t <= cfg.maxTick; t++) expect(gunneryDropInterval(cfg, t)).toBeLessThanOrEqual(gunneryDropInterval(cfg, t - 1));
  });

  it("with no arrows every piece falls down the middle, turns off the centre crates and goes out the port hatch", () => {
    let s = createGunneryGame("fall");
    s = advanceGunnery(s, 2);
    expect(s.pieces).toEqual([{ id: 1, kind: s.pieces[0]!.kind, col: 5, row: 1, dir: 1 }]);
    s = advanceGunnery(s, 7);
    expect(s.pieces.find((p) => p.id === 1)).toMatchObject({ col: 5, row: 6 });
    s = advanceGunnery(s, 8);
    expect(s.pieces.find((p) => p.id === 1)).toMatchObject({ col: 4, row: 6, dir: 2 });
    s = advanceGunnery(s, 12);
    expect(s.pieces.find((p) => p.id === 1)).toBeUndefined();
    expect(s.lastMove?.events.some((e) => e.type === "exit" && e.pieceId === 1)).toBe(true);
    expect(s.score).toBe(0);
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

  it("takes any number of arrows, one per cell: a new arrow on a cell replaces the old", () => {
    let s = createGunneryGame("arrows");
    const cells = deckCells(s).slice(0, 30);
    cells.forEach((c, i) => {
      s = reduceGunnery(s, { type: "arrow", col: c.col, row: c.row, dir: (i % 4) as Dir, tick: 0 });
    });
    expect(s.arrows.length).toBe(30);
    s = reduceGunnery(s, { type: "arrow", col: cells[0]!.col, row: cells[0]!.row, dir: 3, tick: 0 });
    expect(s.arrows.length).toBe(30);
    expect(s.arrows.find((a) => a.col === cells[0]!.col && a.row === cells[0]!.row)?.dir).toBe(3);
    expect(s.arrowsPlaced).toBe(31);
    s = reduceGunnery(s, { type: "remove", col: cells[1]!.col, row: cells[1]!.row, tick: 0 });
    expect(s.arrows.length).toBe(29);
    expect(() => reduceGunnery(s, { type: "arrow", col: 4, row: 7, dir: 0, tick: 0 })).toThrow(InvalidMoveError);
  });
});

describe("gunnery cannons", () => {
  it("loads powder, wad, shot in order, scores each step, fires and comes back clean", () => {
    let s = deckWith([atEast(GunneryKind.Powder)]);
    expect(cannonNeeds(s.cannons[1]!)).toBe(GunneryKind.Powder);
    s = advanceGunnery(s, 2);
    expect(s.pieces.length).toBe(0);
    expect(s.cannons[1]!.loaded).toBe(1);
    expect(s.score).toBe(cfg.stepPoints);
    expect(cannonNeeds(s.cannons[1]!)).toBe(GunneryKind.Wad);
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Wad, 501)] }, 4);
    expect(s.cannons[1]!.loaded).toBe(2);
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Shot, 502)] }, 6);
    expect(s.cannons[1]!.loaded).toBe(3);
    expect(cannonNeeds(s.cannons[1]!)).toBeNull();
    expect(s.score).toBe(cfg.stepPoints * 2 + cfg.loadPoints);
    expect(s.combo).toBe(1);
    expect(s.loads).toBe(1);
    expect(s.lastMove?.events.find((e) => e.type === "loaded")).toMatchObject({ cannon: 1, points: cfg.loadPoints });
    expect(s.cannons[1]!.firesAt).toBe(6 + cfg.fireAfterTicks);
    s = advanceGunnery(s, 6 + cfg.fireAfterTicks);
    expect(s.cannons[1]).toMatchObject({ loaded: 0, fouled: false, firesAt: null });
    expect(s.lastMove?.events.some((e) => e.type === "fire" && e.cannon === 1)).toBe(true);
  });

  it("each load in a combo is worth comboStep more, up to the cap", () => {
    let s = deckWith([atEast(GunneryKind.Shot)], { loaded: 2 });
    s = { ...s, combo: 2 };
    s = advanceGunnery(s, 2);
    expect(s.combo).toBe(3);
    expect(s.score).toBe(cfg.loadPoints + cfg.comboStep * 2);
    let capped = deckWith([atEast(GunneryKind.Shot)], { loaded: 2 });
    capped = advanceGunnery({ ...capped, combo: 50 }, 2);
    expect(capped.score).toBe(cfg.loadPoints + cfg.comboStep * cfg.comboCap);
  });

  it("a wrong piece fouls the cannon and breaks the combo; a fouled cannon turns all but water away", () => {
    let s = deckWith([atEast(GunneryKind.Shot)], { loaded: 1 });
    s = { ...s, combo: 3 };
    s = advanceGunnery(s, 2);
    expect(s.cannons[1]).toMatchObject({ loaded: 0, fouled: true });
    expect(cannonNeeds(s.cannons[1]!)).toBe(GunneryKind.Water);
    expect(s.combo).toBe(0);
    expect(s.fouls).toBe(1);
    // Powder at the gun port turns right (down) along the gunwale instead of going in.
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Powder, 600)] }, 4);
    expect(s.pieces).toEqual([{ id: 600, kind: GunneryKind.Powder, col: 9, row: 4, dir: 1 }]);
    expect(s.cannons[1]!.fouled).toBe(true);
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Water, 601)] }, 6);
    expect(s.cannons[1]).toMatchObject({ loaded: 0, fouled: false });
    expect(s.lastMove?.events.some((e) => e.type === "clean")).toBe(true);
  });

  it("water in a clean cannon splashes harmlessly, whatever it holds", () => {
    let s = deckWith([atEast(GunneryKind.Water)], { loaded: 2 });
    s = advanceGunnery(s, 2);
    expect(s.pieces.length).toBe(0);
    expect(s.cannons[1]).toMatchObject({ loaded: 2, fouled: false });
    expect(s.lastMove?.events.some((e) => e.type === "splash")).toBe(true);
  });

  it("a full cannon waiting to fire turns pieces away", () => {
    const c = { col: 10, row: 3, loaded: 3, fouled: false, firesAt: 50 };
    for (let k = 0; k < GUNNERY_KINDS; k++) expect(cannonOutcome(c, k)).toBe("blocked");
    const s = advanceGunnery(deckWith([atEast(GunneryKind.Powder)], c), 2);
    expect(s.pieces[0]).toMatchObject({ col: 9, row: 4 });
  });
});

describe("gunnery rolling", () => {
  it("an arrow turns a piece and a wall turns it right", () => {
    let s = deckWith([{ id: 1, kind: 0, col: 2, row: 1, dir: 0 }]);
    s = reduceGunnery(s, { type: "arrow", col: 3, row: 1, dir: 1, tick: 0 });
    s = advanceGunnery(s, 2);
    expect(s.pieces[0]).toMatchObject({ col: 3, row: 2, dir: 1 });
    // Heading right along row 1 into the east rail: turns right (down) along it.
    const w = advanceGunnery(deckWith([{ id: 1, kind: 0, col: 9, row: 1, dir: 0 }]), 1);
    expect(w.pieces[0]).toMatchObject({ col: 9, row: 2, dir: 1 });
    // Rolling down onto the centre crates: turns right, which is screen left.
    const c = advanceGunnery(deckWith([{ id: 1, kind: 0, col: 5, row: 6, dir: 1 }]), 1);
    expect(c.pieces[0]).toMatchObject({ col: 4, row: 6, dir: 2 });
  });

  it("two pieces meeting head on both turn back", () => {
    let b = deckWith([
      { id: 1, kind: 0, col: 2, row: 1, dir: 0 },
      { id: 2, kind: 1, col: 3, row: 1, dir: 2 },
    ]);
    b = advanceGunnery(b, 1);
    expect(b.pieces.map((p) => [p.col, p.dir])).toEqual([
      [2, 2],
      [3, 0],
    ]);
  });

  it("a line of pieces rolls together, and a piece behind a stopped one waits", () => {
    let s = deckWith([
      { id: 1, kind: 0, col: 4, row: 4, dir: 1 },
      { id: 2, kind: 1, col: 4, row: 3, dir: 1 },
      { id: 3, kind: 2, col: 4, row: 2, dir: 1 },
    ]);
    s = advanceGunnery(s, 1);
    expect(s.pieces.map((p) => p.row)).toEqual([5, 4, 3]);
    // Box the leader in by meeting it head on; the two behind it wait in line.
    s = { ...s, pieces: [...s.pieces, { id: 4, kind: 3, col: 4, row: 6, dir: 3 }] };
    s = advanceGunnery(s, 2);
    expect(s.pieces.map((p) => [p.id, p.row])).toEqual([
      [1, 5],
      [2, 4],
      [3, 3],
      [4, 6],
    ]);
  });

  it("two pieces after the same cell: the older goes, the younger waits", () => {
    let s = deckWith([
      { id: 1, kind: 0, col: 1, row: 2, dir: 0 },
      { id: 2, kind: 1, col: 2, row: 1, dir: 1 },
    ]);
    s = advanceGunnery(s, 1);
    expect(s.pieces).toEqual([
      { id: 1, kind: 0, col: 2, row: 2, dir: 0 },
      { id: 2, kind: 1, col: 2, row: 1, dir: 1 },
    ]);
  });

  it("the predicted path is where a lone piece actually rolls", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(), fc.nat({ max: 3 })), { maxLength: 4 }), fc.nat(), fc.nat({ max: 3 }), fc.nat(), (arrowPicks, at, dir, firing) => {
        let s = deckWith([]);
        const cells = deckCells(s);
        for (const [c, d] of arrowPicks) {
          const cell = cells[c % cells.length]!;
          s = reduceGunnery(s, { type: "arrow", col: cell.col, row: cell.row, dir: d as Dir, tick: 0 });
        }
        const start = cells[at % cells.length]!;
        const piece: GunneryPiece = { id: 7, kind: GunneryKind.Water, col: start.col, row: start.row, dir: dir as Dir };
        // One cannon is full and fires a few ticks in, so the path must see it change.
        const cannons = s.cannons.map((c, i) => (i === firing % s.cannons.length ? { ...c, loaded: 3, firesAt: 1 + (at % 6) } : c));
        s = { ...s, pieces: [piece], cannons };
        const path = predictGunneryPath(s, piece, 12);
        let t = s;
        for (let i = 0; i < path.cells.length; i++) {
          t = advanceGunnery(t, i + 1);
          expect(t.pieces[0]).toMatchObject(path.cells[i]!);
        }
        if (path.end) {
          t = advanceGunnery(t, path.cells.length + 1);
          expect(t.pieces.length).toBe(0);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("predicts what a cannon will make of a piece", () => {
    const s = deckWith([atEast(GunneryKind.Shot)], { loaded: 2 });
    expect(predictGunneryPath(s, s.pieces[0]!, 5)).toEqual({ cells: [{ col: 9, row: 3 }], end: { type: "cannon", cannon: 1, outcome: "loaded" } });
    const f = deckWith([atEast(GunneryKind.Wad)]);
    expect(predictGunneryPath(f, f.pieces[0]!, 5).end).toEqual({ type: "cannon", cannon: 1, outcome: "foul" });
    // A full cannon that will have fired by the time the piece arrives takes it as empty.
    const later = deckWith([{ ...atEast(GunneryKind.Shot), col: 7 }], { loaded: 3, firesAt: 2 });
    expect(predictGunneryPath(later, later.pieces[0]!, 5).end).toEqual({ type: "cannon", cannon: 1, outcome: "foul" });
    const o = deckWith([{ id: 1, kind: 0, col: 5, row: 10, dir: 1 }]);
    expect(predictGunneryPath(o, o.pieces[0]!, 5)).toEqual({ cells: [{ col: 5, row: 11 }], end: { type: "overboard" } });
  });
});
