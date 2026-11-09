import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_GUNNERY_CONFIG,
  GUNNERY_KINDS,
  GunneryKind,
  InvalidMoveError,
  advanceGunnery,
  turretNeeds,
  turretOutcome,
  createGunneryGame,
  gunneryCellAt,
  gunneryDeckProblems,
  gunneryDropInterval,
  gunneryGunReach,
  gunneryNextHeading,
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
  for (const c of state.turrets) {
    expect(c.loaded).toBeGreaterThanOrEqual(0);
    expect(c.loaded).toBeLessThanOrEqual(3);
    if (c.jammed) expect(c.loaded).toBe(0);
    expect(c.firesAt !== null).toBe(c.loaded === 3);
  }
}

/** One fit deck, so the rule tests below have fixed coordinates: guns at rows 3 and 12, crates at 4,7 and around. */
const TEST_DECK: readonly string[] = [
  "#H##B####",
  "#.......#",
  "#.......#",
  "C.......C",
  "#..X.X..#",
  "#.......#",
  "#.......#",
  "#...X...#",
  "#.......#",
  "#.X...X.#",
  "#.XX.XX.#",
  "#.......#",
  "C.......C",
  "#.......#",
  "#H#H###H#",
];

/** No drops, one deck: a quiet deck to set pieces on by hand. */
const quiet: GunneryConfig = { ...cfg, decks: [TEST_DECK], spawnEveryTicks: 100_000, spawnEveryTicksMin: 100_000 };

/** A quiet state with the given pieces and turret 1 (east, row 3) patched. */
function deckWith(pieces: GunneryPiece[], turretPatch: Partial<GunneryState["turrets"][number]> = {}): GunneryState {
  const base = createGunneryGame("quiet", quiet);
  const turrets = base.turrets.map((c, i) => (i === 1 ? { ...c, ...turretPatch } : c));
  return { ...base, lastDrop: 0, pieces, turrets, nextId: 1000 };
}

/** A piece two cells short of the east turret on row 3, rolling at it. */
const atEast = (kind: number, id = 500): GunneryPiece => ({ id, kind, col: 6, row: 3, dir: 0 });

describe("gunnery deck", () => {
  it("parses a deck", () => {
    const d = parseGunneryDeck(TEST_DECK);
    expect(d.width).toBe(9);
    expect(d.height).toBe(15);
    expect(d.turrets).toEqual([
      { col: 0, row: 3 },
      { col: 8, row: 3 },
      { col: 0, row: 12 },
      { col: 8, row: 12 },
    ]);
    expect(d.barrel).toEqual({ col: 4, row: 0 });
    expect(d.drop).toEqual({ col: 4, row: 1, dir: 1 });
  });

  it("rejects malformed decks", () => {
    expect(() => parseGunneryDeck(["##B##", "#...#", "#...#", "#...#", "####"])).toThrow(/width/);
    expect(() => parseGunneryDeck(["##B##", "#...#", "#...#", "#...#", "#####"])).toThrow(/no turrets/);
    expect(() => parseGunneryDeck(["##B##", "#...C", "#.Q.#", "#...#", "#####"])).toThrow(/unknown symbol/);
    expect(() => parseGunneryDeck(["##B##", "#...C", "#...#", "#...#", "##B##"])).toThrow(/more than one feeder/);
    expect(() => parseGunneryDeck(["##B##", "#...C", "#....", "#...#", "#####"])).toThrow(/open rim/);
    expect(() => parseGunneryDeck(["#####", "#...C", "#.B.#", "#...#", "#####"])).toThrow(/exactly one deck cell/);
  });
});

describe("gunnery decks", () => {
  it("every deck in the default config is fit: no loop built in, a stream that leaves, every gun in reach", () => {
    expect(cfg.decks.length).toBeGreaterThan(1);
    cfg.decks.forEach((rows, i) => {
      const deck = parseGunneryDeck(rows);
      expect(gunneryDeckProblems(deck), `deck ${i}`).toEqual([]);
      for (const r of gunneryGunReach(deck)) expect(r!.arrows, `deck ${i}`).toBeGreaterThanOrEqual(1);
    });
  });

  it("rejects a deck with a loop built in, naming where", () => {
    // Open deck, a hatch only straight below the feeder: pieces following the rails circle forever.
    const loopy = ["####B####", "#.......#", "#.......#", "C.......C", ...Array.from({ length: 8 }, () => "#.......#"), "C.......C", "#.......#", "####H####"];
    expect(gunneryDeckProblems(parseGunneryDeck(loopy))[0]).toMatch(/circles forever/);
    expect(() => createGunneryGame("x", { ...cfg, decks: [...cfg.decks, loopy] })).toThrow(/deck \d+: a piece at/);
  });

  it("rejects a deck whose stream runs into a gun, or a gun nothing can reach", () => {
    // A crate under row 3 of the stream turns it right (screen left) along row 3, into the west gun.
    const streamed = TEST_DECK.map((r, i) => (i === 4 ? "#..XXX..#" : r));
    expect(gunneryDeckProblems(parseGunneryDeck(streamed))).toContain("the unsteered stream does not leave by a hatch");
    // A crate in the west gun's port on row 3: nothing can roll into it.
    const walled = TEST_DECK.map((r, i) => (i === 3 ? "CX......C" : r));
    expect(gunneryDeckProblems(parseGunneryDeck(walled))).toContain("the gun at 0,3 cannot be reached from the feeder in 3 arrows");
  });

  it("the seed picks the deck: the same seed always, and every deck turns up", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const a = createGunneryGame(`s${i}`);
      expect(createGunneryGame(`s${i}`).deckIndex).toBe(a.deckIndex);
      expect(a.deck).toEqual(parseGunneryDeck(cfg.decks[a.deckIndex]!));
      seen.add(a.deckIndex);
    }
    expect(seen.size).toBe(cfg.decks.length);
  });

  it("rejects decks of different sizes", () => {
    const small = TEST_DECK.slice(0, 14).map((r, i) => (i === 13 ? "#H#H###H#" : r));
    expect(() => createGunneryGame("x", { ...cfg, decks: [TEST_DECK, small] })).toThrow(/same|9 by 15|deck 1/);
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

  it("the feeder deals each bag in full before the next, in the order it previews", () => {
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

  it("with no arrows, on every deck, the stream leaves by a hatch without touching a gun", () => {
    cfg.decks.forEach((_, i) => {
      let s = { ...createGunneryGame("fall", { ...cfg, decks: [cfg.decks[i]!] }) };
      s = advanceGunnery(s, 2);
      expect(s.pieces).toEqual([{ id: 1, kind: s.pieces[0]!.kind, col: 4, row: 1, dir: 1 }]);
      s = advanceGunnery(s, 30);
      expect(s.pieces.find((p) => p.id === 1), `deck ${i}`).toBeUndefined();
      const exit = s.lastMove?.events.find((e) => e.type === "exit" && e.pieceId === 1);
      // The event names the hatch, so the client can show the piece going out where it really did.
      expect(gunneryCellAt(s.deck, exit!.col!, exit!.row!), `deck ${i}`).toBe("hatch");
      expect(s.lastMove?.events.some((e) => e.turret !== undefined), `deck ${i}`).toBe(false);
      expect(s.score).toBe(0);
    });
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
    let s = createGunneryGame("arrows", { ...cfg, decks: [TEST_DECK] });
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

describe("gunnery turrets", () => {
  it("loads cell, sabot, slug in order, scores each step, fires and comes back clean", () => {
    let s = deckWith([atEast(GunneryKind.Cell)]);
    expect(turretNeeds(s.turrets[1]!)).toBe(GunneryKind.Cell);
    s = advanceGunnery(s, 2);
    expect(s.pieces.length).toBe(0);
    expect(s.turrets[1]!.loaded).toBe(1);
    expect(s.score).toBe(cfg.stepPoints);
    expect(turretNeeds(s.turrets[1]!)).toBe(GunneryKind.Sabot);
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Sabot, 501)] }, 4);
    expect(s.turrets[1]!.loaded).toBe(2);
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Slug, 502)] }, 6);
    expect(s.turrets[1]!.loaded).toBe(3);
    expect(turretNeeds(s.turrets[1]!)).toBeNull();
    expect(s.score).toBe(cfg.stepPoints * 2 + cfg.loadPoints);
    expect(s.combo).toBe(1);
    expect(s.loads).toBe(1);
    expect(s.lastMove?.events.find((e) => e.type === "loaded")).toMatchObject({ turret: 1, points: cfg.loadPoints });
    expect(s.turrets[1]!.firesAt).toBe(6 + cfg.fireAfterTicks);
    s = advanceGunnery(s, 6 + cfg.fireAfterTicks);
    expect(s.turrets[1]).toMatchObject({ loaded: 0, jammed: false, firesAt: null });
    expect(s.lastMove?.events.some((e) => e.type === "fire" && e.turret === 1)).toBe(true);
  });

  it("each load in a combo is worth comboStep more, up to the cap", () => {
    let s = deckWith([atEast(GunneryKind.Slug)], { loaded: 2 });
    s = { ...s, combo: 2 };
    s = advanceGunnery(s, 2);
    expect(s.combo).toBe(3);
    expect(s.score).toBe(cfg.loadPoints + cfg.comboStep * 2);
    let capped = deckWith([atEast(GunneryKind.Slug)], { loaded: 2 });
    capped = advanceGunnery({ ...capped, combo: 50 }, 2);
    expect(capped.score).toBe(cfg.loadPoints + cfg.comboStep * cfg.comboCap);
  });

  it("a wrong piece jams the turret and breaks the combo; a jammed turret turns all but coolant away", () => {
    let s = deckWith([atEast(GunneryKind.Slug)], { loaded: 1 });
    s = { ...s, combo: 3 };
    s = advanceGunnery(s, 2);
    expect(s.turrets[1]).toMatchObject({ loaded: 0, jammed: true });
    expect(turretNeeds(s.turrets[1]!)).toBe(GunneryKind.Coolant);
    expect(s.combo).toBe(0);
    expect(s.jams).toBe(1);
    // Cell at the gun port turns right (down) along the gunwale instead of going in.
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Cell, 600)] }, 4);
    expect(s.pieces).toEqual([{ id: 600, kind: GunneryKind.Cell, col: 7, row: 4, dir: 1 }]);
    expect(s.turrets[1]!.jammed).toBe(true);
    s = advanceGunnery({ ...s, pieces: [atEast(GunneryKind.Coolant, 601)] }, 6);
    expect(s.turrets[1]).toMatchObject({ loaded: 0, jammed: false });
    expect(s.lastMove?.events.some((e) => e.type === "clean")).toBe(true);
  });

  it("coolant in a clean turret splashes harmlessly, whatever it holds", () => {
    let s = deckWith([atEast(GunneryKind.Coolant)], { loaded: 2 });
    s = advanceGunnery(s, 2);
    expect(s.pieces.length).toBe(0);
    expect(s.turrets[1]).toMatchObject({ loaded: 2, jammed: false });
    expect(s.lastMove?.events.some((e) => e.type === "splash")).toBe(true);
  });

  it("a full turret waiting to fire turns pieces away", () => {
    const c = { col: 8, row: 3, loaded: 3, jammed: false, firesAt: 50 };
    for (let k = 0; k < GUNNERY_KINDS; k++) expect(turretOutcome(c, k)).toBe("blocked");
    const s = advanceGunnery(deckWith([atEast(GunneryKind.Cell)], c), 2);
    expect(s.pieces[0]).toMatchObject({ col: 7, row: 4 });
  });
});

describe("gunnery broadsides", () => {
  /** The quiet deck with turret i full and firing at firesAt[i] (null: left empty). */
  const firing = (firesAt: Array<number | null>): GunneryState => {
    const s = deckWith([]);
    return { ...s, turrets: s.turrets.map((c, i) => (firesAt[i] === null ? c : { ...c, loaded: 3, firesAt: firesAt[i]! })) };
  };

  it("once every gun has fired, in any order, a broadside scores and the set starts again", () => {
    let s = firing([4, 1, 3, 2]);
    s = advanceGunnery(s, 3);
    expect(s.firedSince).toEqual([false, true, true, true]);
    expect(s.broadsides).toBe(0);
    expect(s.score).toBe(0);
    s = advanceGunnery(s, 4);
    expect(s.broadsides).toBe(1);
    expect(s.score).toBe(cfg.broadsidePoints);
    expect(s.firedSince).toEqual([false, false, false, false]);
    expect(s.lastMove?.events.filter((e) => e.type === "broadside")).toEqual([{ tick: 4, type: "broadside", points: cfg.broadsidePoints }]);
  });

  it("firing the same gun again does not fill the set", () => {
    let s = firing([1, null, null, null]);
    s = advanceGunnery(s, 2);
    s = { ...s, turrets: s.turrets.map((c, i) => (i === 0 ? { ...c, loaded: 3, firesAt: 3 } : c)) };
    s = advanceGunnery(s, 5);
    expect(s.firedSince).toEqual([true, false, false, false]);
    expect(s.broadsides).toBe(0);
  });

  it("four guns firing on the same tick make one broadside", () => {
    const s = advanceGunnery(firing([2, 2, 2, 2]), 2);
    expect(s.broadsides).toBe(1);
    expect(s.lastMove?.events.filter((e) => e.type === "fire")).toHaveLength(4);
  });
});

describe("gunnery rolling", () => {
  it("an arrow turns a piece and a wall turns it right", () => {
    let s = deckWith([{ id: 1, kind: 0, col: 2, row: 1, dir: 0 }]);
    s = reduceGunnery(s, { type: "arrow", col: 3, row: 1, dir: 1, tick: 0 });
    s = advanceGunnery(s, 2);
    expect(s.pieces[0]).toMatchObject({ col: 3, row: 2, dir: 1 });
    // Heading right along row 1 into the east rail: turns right (down) along it.
    const w = advanceGunnery(deckWith([{ id: 1, kind: 0, col: 7, row: 1, dir: 0 }]), 1);
    expect(w.pieces[0]).toMatchObject({ col: 7, row: 2, dir: 1 });
    // Rolling down onto the centre crates: turns right, which is screen left.
    const c = advanceGunnery(deckWith([{ id: 1, kind: 0, col: 4, row: 6, dir: 1 }]), 1);
    expect(c.pieces[0]).toMatchObject({ col: 3, row: 6, dir: 2 });
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
        const piece: GunneryPiece = { id: 7, kind: GunneryKind.Coolant, col: start.col, row: start.row, dir: dir as Dir };
        // One turret is full and fires a few ticks in, so the path must see it change.
        const turrets = s.turrets.map((c, i) => (i === firing % s.turrets.length ? { ...c, loaded: 3, firesAt: 1 + (at % 6) } : c));
        s = { ...s, pieces: [piece], turrets };
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

  it("a piece turned by the rail on its last step goes out the hatch it turned to, and says so first", () => {
    // Bottom-right corner of the test deck: the rail is ahead, the hatch at 7,14 below.
    let s = deckWith([{ id: 1, kind: 0, col: 7, row: 13, dir: 0 }]);
    expect(gunneryNextHeading(s, s.pieces[0]!)).toBe(1);
    s = advanceGunnery(s, 1);
    expect(s.pieces).toHaveLength(0);
    expect(s.lastMove?.events).toEqual([{ tick: 1, type: "exit", pieceId: 1, kind: 0, col: 7, row: 14 }]);
  });

  it("predicts what a turret will make of a piece", () => {
    const s = deckWith([atEast(GunneryKind.Slug)], { loaded: 2 });
    expect(predictGunneryPath(s, s.pieces[0]!, 5)).toEqual({ cells: [{ col: 7, row: 3 }], end: { type: "turret", turret: 1, outcome: "loaded" } });
    const f = deckWith([atEast(GunneryKind.Sabot)]);
    expect(predictGunneryPath(f, f.pieces[0]!, 5).end).toEqual({ type: "turret", turret: 1, outcome: "jam" });
    // A full turret that will have fired by the time the piece arrives takes it as empty.
    const later = deckWith([{ ...atEast(GunneryKind.Slug), col: 5 }], { loaded: 3, firesAt: 2 });
    expect(predictGunneryPath(later, later.pieces[0]!, 5).end).toEqual({ type: "turret", turret: 1, outcome: "jam" });
    const o = deckWith([{ id: 1, kind: 0, col: 3, row: 12, dir: 1 }]);
    expect(predictGunneryPath(o, o.pieces[0]!, 5)).toEqual({ cells: [{ col: 3, row: 13 }], end: { type: "overboard" } });
  });
});
