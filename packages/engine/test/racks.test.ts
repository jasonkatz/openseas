import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_RACKS_CONFIG,
  InvalidMoveError,
  createRacksGame,
  hashRacksState,
  racksChainPercentAt,
  racksCrateFits,
  racksCrateWouldShip,
  racksHint,
  racksIsShipment,
  racksMovable,
  racksMoveIllegalReason,
  racksNextShipment,
  racksShipmentPoints,
  racksTopGroup,
  racksViewString,
  racksWouldShip,
  reduceRacks,
  replayRacks,
  type RacksCell,
  type RacksConfig,
  type RacksMove,
  type RacksState,
} from "../src/index.js";

const cfg = DEFAULT_RACKS_CONFIG;

/** An action the engine accepts, chosen by two picks: one in eight is a call, the rest a legal move. */
function randomAction(state: RacksState, a: number, b: number): RacksMove {
  const moves: RacksMove[] = [];
  for (let from = 0; from < state.config.racks; from++)
    for (let to = 0; to < state.config.racks; to++) if (racksMovable(state, from, to) > 0) moves.push({ type: "move", from, to });
  if (moves.length === 0 || a % 8 === 0) return { type: "call" };
  return moves[b % moves.length]!;
}

function playRandom(seed: string, picks: readonly number[], config: RacksConfig = cfg): { moves: RacksMove[]; state: RacksState } {
  let state = createRacksGame(seed, config);
  const moves: RacksMove[] = [];
  for (let i = 0; i + 2 <= picks.length && !state.finished; i += 2) {
    const m = randomAction(state, picks[i]!, picks[i + 1]!);
    moves.push(m);
    state = reduceRacks(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 240 });

/**
 * Racks from strings of kinds, bottom first, with the crate given as its kinds, its rack and its
 * count: `set(["000", "11", "", "2", ""], "01", 2, 3)`.
 */
function set(racks: readonly string[], crate: string, rack: number, lands: number, config: Partial<RacksConfig> = {}): RacksState {
  const full: RacksConfig = { ...cfg, racks: racks.length, startCells: 0, ...config };
  const base = createRacksGame("t", full);
  let id = 1000;
  const cells = (s: string): RacksCell[] => s.split("").map((ch) => ({ id: id++, kind: Number(ch) }));
  return { ...base, racks: racks.map(cells), crate: { cells: cells(crate), rack, lands }, nextId: id };
}

const kinds = (s: RacksState): string[] => s.racks.map((r) => r.map((c) => c.kind).join(""));
const count = (s: RacksState): number => s.racks.reduce((a, r) => a + r.length, 0);
const move = (from: number, to: number): RacksMove => ({ type: "move", from, to });

describe("racks opening", () => {
  it("deals the opening cells low and even, and hangs a crate with a full count", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createRacksGame(seed);
        expect(s.racks.length).toBe(cfg.racks);
        expect(count(s)).toBe(cfg.startCells);
        for (const r of s.racks) expect(r.length).toBeLessThanOrEqual(Math.ceil(cfg.startCells / cfg.racks));
        expect(s.racks.some((r) => racksIsShipment(cfg, r))).toBe(false);
        expect(s.crate.cells.length).toBeGreaterThanOrEqual(cfg.crateMin);
        expect(s.crate.cells.length).toBeLessThanOrEqual(cfg.crateMax);
        expect(s.crate.rack).toBeGreaterThanOrEqual(0);
        expect(s.crate.rack).toBeLessThan(cfg.racks);
        expect(s.crate.lands).toBe(cfg.landEvery);
        const all = [...s.racks.flat(), ...s.crate.cells];
        expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
        expect(all.every((c) => Number.isInteger(c.kind) && c.kind >= 0 && c.kind < cfg.kinds)).toBe(true);
        expect(s.score).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createRacksGame("x", { ...cfg, kinds: 1 })).toThrow();
    expect(() => createRacksGame("x", { ...cfg, crateMin: 4, crateMax: 3 })).toThrow();
    expect(() => createRacksGame("x", { ...cfg, crateMax: cfg.height + 1 })).toThrow();
    expect(() => createRacksGame("x", { ...cfg, startCells: cfg.racks * cfg.height })).toThrow();
    expect(() => createRacksGame("x", { ...cfg, chainPercent: [] })).toThrow();
    expect(() => createRacksGame("x", { ...cfg, crateMixPercent: 101 })).toThrow();
    expect(() => createRacksGame("x", { ...cfg, markRoom: 1 as unknown as boolean })).toThrow();
  });
});

describe("racks determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayRacks(seed, cfg, moves);
        expect(hashRacksState(replayed)).toBe(hashRacksState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 80 },
    );
  });

  it("different seeds deal different openings", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashRacksState(createRacksGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 60));
        if (state.finished) return;
        const before = JSON.stringify(state);
        reduceRacks(state, randomAction(state, picks[0] ?? 1, picks[1] ?? 0));
        reduceRacks(state, { type: "call" });
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 80 },
    );
  });

  it("an end move finishes an untouched round at zero, with a tick or without", () => {
    const s = reduceRacks(createRacksGame("x"), { type: "end" });
    expect(s.finished).toBe(true);
    expect({ score: s.score, moves: s.moveCount, bestCombo: s.bestCombo }).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceRacks(s, { type: "end" })).toThrow(InvalidMoveError);
    expect(() => reduceRacks(s, { type: "call" })).toThrow(InvalidMoveError);
    const ticked = reduceRacks(createRacksGame("x"), { type: "end", tick: 0 } as unknown as RacksMove);
    expect(ticked.finished).toBe(true);
  });
});

describe("racks rules", () => {
  it("keeps its invariants after every action", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createRacksGame(seed);
        for (let i = 0; i + 2 <= picks.length; i += 2) {
          const m = randomAction(state, picks[i]!, picks[i + 1]!);
          const next = reduceRacks(state, m);
          const r = next.lastMove!;
          // No rack over its height, no rack left full of one kind, no cell twice.
          for (const rack of next.racks) {
            expect(rack.length).toBeLessThanOrEqual(cfg.height);
            expect(racksIsShipment(cfg, rack)).toBe(false);
          }
          const all = [...next.racks.flat(), ...next.crate.cells];
          expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
          // The score is what the report says, shipments less spills, and never negative.
          let points = 0;
          let landed = 0;
          let gone = 0;
          for (const e of r.events) {
            if (e.type === "ship") {
              points += e.points;
              gone += e.ids.length;
              expect(e.ids.length).toBe(cfg.height);
              expect(e.points).toBe(racksShipmentPoints(cfg, e.chain));
            }
            if (e.type === "spill") {
              points -= e.penalty;
              gone += e.ids.length;
            }
            if (e.type === "land") landed += e.ids.length;
          }
          expect(r.points).toBe(points);
          expect(next.score).toBe(state.score + r.points);
          expect(next.score).toBeGreaterThanOrEqual(0);
          // Cells are conserved: what was there, plus the crate if it landed, less what shipped or spilled.
          expect(count(next)).toBe(count(state) + landed - gone);
          // The crate counts down on a move and is replaced when it lands.
          const dealt = r.events.some((e) => e.type === "deal");
          if (m.type === "call") expect(dealt).toBe(true);
          if (dealt) expect(next.crate.lands).toBe(cfg.landEvery);
          else expect(next.crate).toEqual({ ...state.crate, lands: state.crate.lands - 1 });
          expect(next.crate.lands).toBeGreaterThanOrEqual(1);
          // A chain runs only straight after a shipment.
          const last = (type: string): number => r.events.reduce((at, e, n) => (e.type === type ? n : at), -1);
          const shippedNow = last("ship") >= 0;
          const spilledLast = last("spill") > last("ship");
          if (!shippedNow || spilledLast) expect(next.combo).toBe(0);
          else expect(next.combo).toBeGreaterThan(0);
          expect(next.bestCombo).toBeGreaterThanOrEqual(next.combo);
          expect(next.moveCount).toBe(state.moveCount + 1);
          state = next;
        }
      }),
      { numRuns: 80 },
    );
  });

  it("a move carries the top group, as many as fit, and any cell may sit on any other", () => {
    const s = set(["0111", "22", "3333", "", ""], "01", 4, 4);
    expect(racksTopGroup(s.racks[0]!)).toEqual({ kind: 1, count: 3 });
    expect(racksTopGroup(s.racks[3]!)).toBeNull();
    expect(racksMovable(s, 0, 1)).toBe(3);
    // Only one fits on a rack of four.
    expect(racksMovable(s, 0, 2)).toBe(1);
    const whole = reduceRacks(s, move(0, 1));
    expect(kinds(whole)).toEqual(["0", "22111", "3333", "", ""]);
    expect(whole.lastMove!.events[0]).toEqual({ type: "move", from: 0, to: 1, ids: s.racks[0]!.slice(1).map((c) => c.id) });
    const part = reduceRacks(s, move(0, 2));
    expect(kinds(part)).toEqual(["011", "22", "33331", "", ""]);
  });

  it("refuses moves from an empty rack, onto a full one, onto itself and off the row", () => {
    const s = set(["01230", "22", "", "", ""], "01", 4, 4);
    expect(racksMoveIllegalReason(s, 2, 1)).toBe("nothing to lift");
    expect(racksMoveIllegalReason(s, 1, 0)).toBe("no room");
    expect(racksMoveIllegalReason(s, 1, 1)).toBe("the same rack");
    expect(racksMoveIllegalReason(s, 1, 5)).toBe("no such rack");
    expect(racksMoveIllegalReason(s, 1, 2)).toBeNull();
    for (const [from, to] of [
      [2, 1],
      [1, 0],
      [1, 1],
      [1, 5],
      [-1, 0],
      [0.5, 1],
    ])
      expect(() => reduceRacks(s, move(from!, to!))).toThrow(InvalidMoveError);
    expect(() => reduceRacks(s, { type: "bogus" } as unknown as RacksMove)).toThrow(InvalidMoveError);
  });

  it("a rack filled with one kind ships for the shipment's points and comes back empty", () => {
    const s = set(["0000", "10", "22", "", ""], "12", 4, 4);
    expect(racksWouldShip(s, 1, 0)).toBe(true);
    expect(racksWouldShip(s, 2, 0)).toBe(false);
    expect(racksNextShipment(s)).toEqual({ chain: 1, percent: 100, points: cfg.shipPoints });
    const next = reduceRacks(s, move(1, 0));
    expect(kinds(next)).toEqual(["", "1", "22", "", ""]);
    expect(next.score).toBe(cfg.shipPoints);
    expect(next.shipped).toBe(1);
    const ship = next.lastMove!.events[1]!;
    expect(ship).toMatchObject({ type: "ship", rack: 0, kind: 0, chain: 1, chainPercent: 100, points: cfg.shipPoints, byCrate: false });
    // A full rack of mixed kinds ships nothing.
    const mixed = reduceRacks(set(["0001", "0", "", "", ""], "12", 4, 4), move(1, 0));
    expect(mixed.score).toBe(0);
    expect(kinds(mixed)[0]).toBe("00010");
  });

  it("part of a group completes a rack and the rest stays behind", () => {
    const s = set(["0000", "100", "", "", ""], "12", 4, 4);
    expect(racksMovable(s, 1, 0)).toBe(1);
    expect(racksWouldShip(s, 1, 0)).toBe(true);
    const next = reduceRacks(s, move(1, 0));
    expect(kinds(next)).toEqual(["", "10", "", "", ""]);
    expect(next.shipped).toBe(1);
  });

  it("shipments on back-to-back actions chain, and any other action breaks the chain", () => {
    const s = set(["0000", "1111", "2222", "3012", ""], "33", 4, 4);
    let next = reduceRacks(s, move(3, 2));
    expect(next.combo).toBe(1);
    expect(racksNextShipment(next)).toEqual({ chain: 2, percent: cfg.chainPercent[1], points: racksShipmentPoints(cfg, 2) });
    next = reduceRacks(next, move(3, 1));
    expect(next.combo).toBe(2);
    expect(next.lastMove!.events[1]).toMatchObject({ type: "ship", chain: 2, chainPercent: cfg.chainPercent[1], points: 200 });
    next = reduceRacks(next, move(3, 0));
    expect(next.combo).toBe(3);
    expect(next.score).toBe(100 + 200 + 300);
    expect(next.bestCombo).toBe(3);
    // The crate landed with the fourth move; one more move that ships nothing ends the chain.
    next = reduceRacks(next, move(3, 0));
    expect(next.combo).toBe(0);
    expect(next.bestCombo).toBe(3);
    expect(racksNextShipment(next).chain).toBe(1);
    // With a break between them, two shipments score singly.
    let apart = reduceRacks(s, move(3, 2));
    apart = reduceRacks(apart, move(3, 4));
    expect(apart.combo).toBe(0);
    apart = reduceRacks(apart, move(4, 1));
    expect(apart.lastMove!.events[1]).toMatchObject({ type: "ship", chain: 1, points: 100 });
    expect(apart.score).toBe(200);
  });

  it("the chain percent stops at the end of its table, and a wider window forgives a move", () => {
    expect(racksChainPercentAt(cfg, 0)).toBe(100);
    expect(racksChainPercentAt(cfg, 1)).toBe(cfg.chainPercent[0]);
    expect(racksChainPercentAt(cfg, 99)).toBe(cfg.chainPercent[cfg.chainPercent.length - 1]);
    const s = set(["0000", "1111", "20", "31", ""], "33", 4, 4, { chainWindow: 2 });
    let next = reduceRacks(s, move(2, 0));
    next = reduceRacks(next, move(2, 4));
    expect(next.combo).toBe(1);
    next = reduceRacks(next, move(3, 1));
    expect(next.lastMove!.events[1]).toMatchObject({ type: "ship", chain: 2, points: 200 });
  });

  it("the crate comes one step nearer with every move and lands on its rack, burying the top", () => {
    const s = set(["00", "11", "", "", ""], "23", 0, 2);
    let next = reduceRacks(s, move(1, 2));
    expect(next.crate).toEqual({ ...s.crate, lands: 1 });
    expect(next.lastMove!.events.map((e) => e.type)).toEqual(["move"]);
    next = reduceRacks(next, move(2, 1));
    expect(kinds(next)).toEqual(["0023", "11", "", "", ""]);
    expect(next.lastMove!.events.map((e) => e.type)).toEqual(["move", "land", "deal"]);
    expect(next.lastMove!.events[1]).toEqual({ type: "land", rack: 0, ids: s.crate.cells.map((c) => c.id), called: false });
    // The next crate is new cells with a full count.
    expect(next.crate.lands).toBe(cfg.landEvery);
    expect(next.crate.cells.every((c) => c.id >= s.nextId)).toBe(true);
    expect(next.calls).toBe(0);
  });

  it("a call brings the crate down at once", () => {
    const s = set(["00", "11", "", "", ""], "23", 1, 4);
    const next = reduceRacks(s, { type: "call" });
    expect(kinds(next)).toEqual(["00", "1123", "", "", ""]);
    expect(next.lastMove!.events[0]).toMatchObject({ type: "land", rack: 1, called: true });
    expect(next.calls).toBe(1);
    expect(next.moveCount).toBe(1);
  });

  it("a crate that completes its rack ships it, and counts in the chain", () => {
    const s = set(["000", "1111", "21", "", ""], "00", 0, 3);
    expect(racksCrateWouldShip(s)).toBe(true);
    let next = reduceRacks(s, move(2, 1));
    expect(next.combo).toBe(1);
    next = reduceRacks(next, { type: "call" });
    const ship = next.lastMove!.events.find((e) => e.type === "ship")!;
    expect(ship).toMatchObject({ type: "ship", rack: 0, kind: 0, chain: 2, points: 200, byCrate: true });
    expect(next.shippedByCrate).toBe(1);
    expect(next.score).toBe(300);
    expect(kinds(next)[0]).toBe("");
    // A move's own shipment and the crate's, in one action.
    const both = reduceRacks(set(["000", "1111", "21", "", ""], "00", 0, 1), move(2, 1));
    expect(both.lastMove!.events.map((e) => e.type)).toEqual(["move", "ship", "land", "ship", "deal"]);
    expect(both.score).toBe(300);
    expect(both.combo).toBe(2);
  });

  it("a crate with too little room smashes the rack: its cells are dumped for a penalty and the chain ends", () => {
    const s = { ...set(["0000", "1111", "21", "", ""], "23", 0, 1), score: 120 };
    expect(racksCrateFits(s)).toBe(false);
    expect(racksCrateWouldShip(s)).toBe(false);
    const next = reduceRacks(s, move(2, 1));
    expect(next.lastMove!.events.map((e) => e.type)).toEqual(["move", "ship", "spill", "land", "deal"]);
    expect(next.lastMove!.events[2]).toEqual({ type: "spill", rack: 0, ids: s.racks[0]!.map((c) => c.id), penalty: cfg.spillPenalty });
    expect(kinds(next)).toEqual(["23", "", "2", "", ""]);
    expect(next.score).toBe(120 + 100 - cfg.spillPenalty);
    expect(next.spills).toBe(1);
    expect(next.combo).toBe(0);
    // The score never goes below zero.
    const poor = reduceRacks({ ...s, score: 20 }, { type: "call" });
    expect(poor.score).toBe(0);
    expect(poor.lastMove!.events[0]).toMatchObject({ type: "spill", penalty: 20 });
    expect(poor.lastMove!.points).toBe(-20);
  });

  it("shipping the marked rack first lets the crate land in the empty rack", () => {
    const s = set(["0000", "10", "", "", ""], "23", 0, 1);
    const next = reduceRacks(s, move(1, 0));
    expect(next.lastMove!.events.map((e) => e.type)).toEqual(["move", "ship", "land", "deal"]);
    expect(kinds(next)).toEqual(["23", "1", "", "", ""]);
    expect(next.spills).toBe(0);
  });

  it("any rack may be marked, a full one too; with markRoom the mark keeps to racks with room", () => {
    let tight = 0;
    for (let i = 0; i < 60; i++) {
      let s = createRacksGame(`any-${i}`);
      for (let n = 0; n < 30; n++) {
        s = reduceRacks(s, { type: "call" });
        if (!racksCrateFits(s)) tight++;
      }
    }
    expect(tight).toBeGreaterThan(0);
    const gentle: RacksConfig = { ...cfg, markRoom: true };
    for (let i = 0; i < 60; i++) {
      let s = createRacksGame(`room-${i}`, gentle);
      for (let n = 0; n < 30; n++) {
        const room = s.racks.some((r) => r.length + s.crate.cells.length <= gentle.height);
        // Dealt where it fits whenever any rack had room when it was hung.
        if (s.lastMove === null || s.lastMove.events.some((e) => e.type === "deal")) {
          if (room) expect(racksCrateFits(s)).toBe(true);
        }
        s = reduceRacks(s, { type: "call" });
      }
    }
  });

  it("crates come from a bag, so the kinds stay even, and crateMixPercent 0 makes every crate one kind", () => {
    let s = createRacksGame("bag");
    const seen = new Array<number>(cfg.kinds).fill(0);
    for (const c of s.racks.flat()) seen[c.kind]!++;
    // The opening is one whole bag: every kind the same number of times.
    expect(seen).toEqual(new Array<number>(cfg.kinds).fill(cfg.bagCopies));
    const pureCfg: RacksConfig = { ...cfg, crateMixPercent: 0 };
    s = createRacksGame("pure", pureCfg);
    for (let n = 0; n < 60; n++) {
      expect(new Set(s.crate.cells.map((c) => c.kind)).size).toBe(1);
      s = reduceRacks(s, { type: "call" });
    }
    // Fully mixed, every cell is a draw from the bag: no kind falls far behind.
    const mixedCfg: RacksConfig = { ...cfg, crateMixPercent: 100 };
    s = createRacksGame("even", mixedCfg);
    const drawn = new Array<number>(cfg.kinds).fill(0);
    for (let n = 0; n < 200; n++) {
      for (const c of s.crate.cells) drawn[c.kind]!++;
      s = reduceRacks(s, { type: "call" });
    }
    expect(Math.max(...drawn) - Math.min(...drawn)).toBeLessThanOrEqual(cfg.bagCopies);
  });

  it("the hint is always an action the engine takes, and ships when it can", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 80));
        if (state.finished) {
          expect(racksHint(state)).toBeNull();
          return;
        }
        const h = racksHint(state);
        expect(h).not.toBeNull();
        expect(() => reduceRacks(state, h!)).not.toThrow();
      }),
      { numRuns: 80 },
    );
    const s = set(["0000", "10", "22", "", ""], "12", 4, 4);
    expect(racksHint(s)).toEqual({ type: "move", from: 1, to: 0 });
    // A crate that would ship its rack is worth calling.
    expect(racksHint(set(["000", "11", "22", "", ""], "00", 0, 3))).toEqual({ type: "call" });
    // A rack the crate would smash is cleared first.
    const tight = racksHint(set(["0101", "22", "", "", ""], "23", 0, 2))!;
    expect(tight).toMatchObject({ type: "move", from: 0 });
    // Racks in order: bring the crate down.
    expect(racksHint(set(["00", "11", "22", "33", ""], "01", 4, 4))).toEqual({ type: "call" });
  });

  it("a player who follows the hint keeps shipping and seldom spills", () => {
    let shipped = 0;
    let spills = 0;
    for (let i = 0; i < 20; i++) {
      let s = createRacksGame(`hint-${i}`);
      for (let n = 0; n < 70; n++) s = reduceRacks(s, racksHint(s)!);
      shipped += s.shipped;
      spills += s.spills;
    }
    expect(shipped / 20).toBeGreaterThan(8);
    expect(spills / 20).toBeLessThan(1);
  });

  it("stops at the move cap", () => {
    let s = createRacksGame("cap", { ...cfg, maxMoves: 2 });
    s = reduceRacks(s, { type: "call" });
    expect(s.finished).toBe(false);
    s = reduceRacks(s, { type: "call" });
    expect(s.finished).toBe(true);
    expect(() => reduceRacks(s, { type: "call" })).toThrow(InvalidMoveError);
  });

  it("the view string names every rack and the crate", () => {
    const s = set(["012", "", "33", "1", ""], "20", 3, 2);
    expect(racksViewString(s.racks, s.crate)).toBe("012||33|1|;3:20:2");
  });
});
