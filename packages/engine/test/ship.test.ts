import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_SHIP_RULES,
  InvalidMoveError,
  STATIONS,
  createShip,
  crewMember,
  hashShipState,
  legUnits,
  longestAboard,
  outputPercent,
  reduceShip,
  replayShip,
  type LegPlan,
  type ShipConfig,
  type ShipMove,
  type ShipState,
  type Station,
} from "../src/index.js";

const sloop = { id: "sloop", stations: [...STATIONS], maxCrew: 4, cannons: 4, baseTokens: 4 };
const par = { bilging: 20, sailing: 15, carpentry: 12, gunnery: 10, navigation: 8 };
const cfg: ShipConfig = { shipClass: sloop, rules: DEFAULT_SHIP_RULES, par };

const ISLANDS = ["a", "b", "c"];
const legs: LegPlan[] = [];
for (const from of ISLANDS) {
  for (const to of ISLANDS) {
    if (from === to) continue;
    legs.push({ routeId: `${from}-${to}`, from, to, lengthUnits: legUnits(60), encounterChancePercent: 70, brigands: [{ tierId: "cutpurse", weight: 3 }, { tierId: "marauder", weight: 1 }] });
  }
}
const legFrom = (island: string, pick = 0): LegPlan => legs.filter((l) => l.from === island)[pick % 2]!;

const PIRATES = ["p1", "p2", "p3", "p4", "p5"];

/** A plausible move for the state, chosen by `pick`. It may still be illegal; the driver skips those. */
function randomMove(state: ShipState, pick: number): ShipMove {
  const kind = pick % 12;
  const pirate = PIRATES[Math.floor(pick / 12) % PIRATES.length]!;
  const aboard = state.crew[Math.floor(pick / 60) % Math.max(1, state.crew.length)]?.pirateId ?? pirate;
  switch (kind) {
    case 0:
      return { type: "board", pirateId: pirate };
    case 1:
      return { type: "leave", pirateId: aboard };
    case 2:
      return { type: "station", pirateId: aboard, station: STATIONS[Math.floor(pick / 300) % STATIONS.length]! };
    case 3:
      return { type: "station", pirateId: aboard, station: null };
    case 4:
      return { type: "wheel", pirateId: aboard };
    case 5:
      return { type: "sail", leg: legFrom(state.islandId ?? "a", Math.floor(pick / 300)) };
    case 6:
    case 7: {
      const st = STATIONS[Math.floor(pick / 300) % STATIONS.length]!;
      return { type: "duty", station: st, points: Math.floor(pick / 1500) % 60 };
    }
    case 8:
    case 9:
      return { type: "turn" };
    case 10:
      return pick % 2 === 0 ? { type: "away", pirateId: aboard } : { type: "back", pirateId: aboard };
    default:
      return pick % 3 === 0 ? { type: "evade" } : pick % 3 === 1 ? { type: "lock", inviteOnly: pick % 2 === 0 } : { type: "turn" };
  }
}

function play(seed: string, picks: readonly number[], config = cfg): { moves: ShipMove[]; state: ShipState } {
  let state = createShip(seed, config, "a");
  const moves: ShipMove[] = [];
  for (const p of picks) {
    const m = randomMove(state, p);
    try {
      state = reduceShip(state, m);
      moves.push(m);
    } catch (e) {
      if (!(e instanceof InvalidMoveError)) throw e;
    }
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 1_000_000 }), { minLength: 0, maxLength: 120 });

/** Boards p1 as captain at p-station duty, sets sail on the first leg from "a". */
function underway(seed = "s", stations: Partial<Record<Station, string>> = {}): ShipState {
  let s = createShip(seed, cfg, "a");
  s = reduceShip(s, { type: "board", pirateId: "p1" });
  for (const [st, who] of Object.entries(stations)) {
    if (who !== "p1") s = reduceShip(s, { type: "board", pirateId: who });
    s = reduceShip(s, { type: "station", pirateId: who, station: st as Station });
  }
  return reduceShip(s, { type: "sail", leg: legFrom("a") });
}

function turns(s: ShipState, n: number, each?: (s: ShipState) => ShipState): ShipState {
  for (let i = 0; i < n; i++) {
    if (each) s = each(s);
    s = reduceShip(s, { type: "turn" });
  }
  return s;
}

describe("ship determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = play(seed, picks);
        const b = replayShip(seed, cfg, "a", a.moves);
        expect(hashShipState(b)).toBe(hashShipState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 300 },
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createShip(seed, cfg, "a");
        for (const p of picks) {
          const m = randomMove(state, p);
          const before = JSON.stringify(state);
          let next: ShipState | null = null;
          try {
            next = reduceShip(state, m);
          } catch (e) {
            if (!(e instanceof InvalidMoveError)) throw e;
          }
          expect(JSON.stringify(state)).toBe(before);
          if (next) state = next;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("different seeds roll different encounters", () => {
    const where = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = underway(`seed-${i}`);
      where.add(JSON.stringify(s.voyage?.encounter));
    }
    expect(where.size).toBeGreaterThan(5);
  });
});

describe("ship invariants", () => {
  it("hold after any sequence of moves", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state: s } = play(seed, picks);
        expect(s.water).toBeGreaterThanOrEqual(0);
        expect(s.water).toBeLessThanOrEqual(1000);
        expect(s.damage).toBeGreaterThanOrEqual(0);
        expect(s.damage).toBeLessThanOrEqual(1000);
        expect(s.loaded).toBeLessThanOrEqual(sloop.cannons);
        expect(s.loading).toBeGreaterThanOrEqual(0);
        expect(s.loading).toBeLessThan(1000);
        expect(s.crew.length).toBeLessThanOrEqual(sloop.maxCrew);
        const ids = new Set(s.crew.map((c) => c.pirateId));
        expect(ids.size).toBe(s.crew.length);
        const taken = s.crew.map((c) => c.station).filter((x) => x !== null);
        expect(new Set(taken).size).toBe(taken.length);
        if (s.crew.length === 0) expect(s.captainId).toBeNull();
        else expect(s.crew.some((c) => c.pirateId === s.captainId)).toBe(true);
        expect(s.islandId === null).toBe(s.voyage !== null);
        if (s.voyage) {
          expect(s.voyage.progress).toBeGreaterThanOrEqual(0);
          expect(s.voyage.progress).toBeLessThan(s.voyage.leg.lengthUnits);
          expect(s.crew.length).toBeGreaterThan(0);
        } else {
          expect(ISLANDS).toContain(s.islandId);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("ship crew", () => {
  it("the first aboard takes the wheel; the longest aboard inherits it", () => {
    let s = createShip("crew", cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    expect(s.captainId).toBe("p1");
    expect(s.events).toEqual([{ type: "boarded", pirateId: "p1" }, { type: "wheel", pirateId: "p1" }]);
    s = reduceShip(s, { type: "board", pirateId: "p2" });
    s = reduceShip(s, { type: "board", pirateId: "p3" });
    s = reduceShip(s, { type: "leave", pirateId: "p1" });
    expect(s.captainId).toBe("p2");
    s = reduceShip(s, { type: "wheel", pirateId: "p3" });
    expect(s.captainId).toBe("p3");
    expect(() => reduceShip(s, { type: "wheel", pirateId: "p3" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "wheel", pirateId: "p9" })).toThrow(InvalidMoveError);
  });

  it("refuses boarding past the class's crew limit or twice", () => {
    let s = createShip("full", cfg, "a");
    for (const p of ["p1", "p2", "p3", "p4"]) s = reduceShip(s, { type: "board", pirateId: p });
    expect(() => reduceShip(s, { type: "board", pirateId: "p5" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "board", pirateId: "p1" })).toThrow(InvalidMoveError);
  });

  it("one pirate per station, only stations the class has", () => {
    let s = createShip("st", cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    s = reduceShip(s, { type: "board", pirateId: "p2" });
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "sailing" });
    expect(() => reduceShip(s, { type: "station", pirateId: "p2", station: "sailing" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "station", pirateId: "p2", station: "rigging" as Station })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "bilging" });
    s = reduceShip(s, { type: "station", pirateId: "p2", station: "sailing" });
    expect(s.crew.map((c) => c.station)).toEqual(["bilging", "sailing"]);
    s = reduceShip(s, { type: "station", pirateId: "p2", station: null });
    expect(crewMember(s, "p2")?.station).toBeNull();
  });

  it("prefers a connected pirate for the wheel, then the longest aboard", () => {
    expect(longestAboard([])).toBeNull();
    const crew = [
      { pirateId: "late", station: null, boardedSeq: 3, awaySinceTurn: null },
      { pirateId: "early-away", station: null, boardedSeq: 1, awaySinceTurn: 2 },
      { pirateId: "mid", station: null, boardedSeq: 2, awaySinceTurn: null },
    ];
    expect(longestAboard(crew)?.pirateId).toBe("mid");
  });
});

describe("ship voyage", () => {
  it("a fully crewed sloop at par makes the leg in exactly its nominal time", () => {
    let s = underway("par", { sailing: "p1", bilging: "p2", carpentry: "p3" });
    expect(s.islandId).toBeNull();
    expect(s.voyage?.leg.routeId).toBe("a-b");
    const nominal = 60 / DEFAULT_SHIP_RULES.turnSeconds;
    const atPar = (st: ShipState): ShipState => {
      st = reduceShip(st, { type: "duty", station: "sailing", points: par.sailing });
      st = reduceShip(st, { type: "duty", station: "bilging", points: par.bilging });
      return reduceShip(st, { type: "duty", station: "carpentry", points: par.carpentry });
    };
    s = turns(s, nominal - 1, atPar);
    expect(s.voyage).not.toBeNull();
    expect(s.lastTurn?.speed).toBe(1000);
    expect(s.water).toBe(0);
    s = atPar(s);
    s = reduceShip(s, { type: "turn" });
    expect(s.voyage).toBeNull();
    expect(s.islandId).toBe("b");
    expect(s.voyagesCompleted).toBe(1);
    expect(s.events.at(-1)).toEqual({ type: "arrived", islandId: "b", turns: nominal });
  });

  it("nobody sailing means idle speed, water rising and the hull wearing", () => {
    let s = underway("idle");
    s = turns(s, 5);
    expect(s.lastTurn?.outputs).toEqual({ bilging: 0, sailing: 0, carpentry: 0, gunnery: 0, navigation: 0 });
    // Intake, plus a little more as the hull wears.
    expect(s.water).toBeGreaterThanOrEqual(5 * DEFAULT_SHIP_RULES.waterIntakePerTurn);
    expect(s.water).toBeLessThan(6 * DEFAULT_SHIP_RULES.waterIntakePerTurn);
    expect(s.damage).toBe(5 * DEFAULT_SHIP_RULES.wearPerTurn);
    expect(s.lastTurn!.speed).toBeLessThan(DEFAULT_SHIP_RULES.idleSpeed);
    expect(s.lastTurn!.speed).toBeGreaterThan(0);
  });

  it("output is a percentage of par, capped, and only counts for staffed stations", () => {
    expect(outputPercent(cfg, "sailing", 0)).toBe(0);
    expect(outputPercent(cfg, "sailing", par.sailing)).toBe(100);
    expect(outputPercent(cfg, "sailing", par.sailing * 7)).toBe(DEFAULT_SHIP_RULES.maxOutputPercent);
    let s = underway("out", { sailing: "p1" });
    expect(() => reduceShip(s, { type: "duty", station: "bilging", points: 5 })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "duty", station: "sailing", points: -1 })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "duty", station: "sailing", points: 7 });
    s = reduceShip(s, { type: "duty", station: "sailing", points: 8 });
    expect(s.pending.sailing).toBe(15);
    s = reduceShip(s, { type: "turn" });
    expect(s.lastTurn?.outputs.sailing).toBe(100);
    expect(s.pending.sailing).toBe(0);
    expect(s.tokens).toBe(sloop.baseTokens);
  });

  it("gunnery loads the cannons and stops at the last one", () => {
    let s = underway("guns", { gunnery: "p1" });
    const load = (st: ShipState): ShipState => reduceShip(st, { type: "duty", station: "gunnery", points: par.gunnery });
    s = turns(s, 1, load);
    expect(s.loaded).toBe(0);
    expect(s.loading).toBe(DEFAULT_SHIP_RULES.loadPerTurn);
    s = turns(s, 1, load);
    expect(s.loaded).toBe(1);
    expect(s.loading).toBe(0);
    s = turns(s, 20, load);
    expect(s.loaded).toBe(sloop.cannons);
    expect(s.loading).toBe(0);
  });

  it("cannot sail from an island the ship is not at, or while at sea", () => {
    let s = createShip("sail", cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    expect(() => reduceShip(s, { type: "sail", leg: legFrom("b") })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "sail", leg: legFrom("a") });
    expect(() => reduceShip(s, { type: "sail", leg: legFrom("a") })).toThrow(InvalidMoveError);
    expect(() => reduceShip(createShip("x", cfg, "a"), { type: "sail", leg: legFrom("a") })).toThrow(InvalidMoveError);
  });

  it("arriving docks the ship, pumps the bilge and repairs the hull for free", () => {
    let s = underway("dock");
    s = turns(s, 10);
    expect(s.water).toBeGreaterThan(0);
    expect(s.damage).toBeGreaterThan(0);
    s = turns(s, 200);
    expect(s.islandId).toBe("b");
    expect(s.water).toBe(0);
    expect(s.damage).toBe(0);
    expect(s.voyage).toBeNull();
    // Docked turns change nothing but the clock.
    const docked = reduceShip(s, { type: "turn" });
    expect({ ...docked, turn: 0, events: [] }).toEqual({ ...s, turn: 0, events: [] });
  });
});

describe("ship encounters", () => {
  const certain = (seed: string): ShipState => {
    let s = createShip(seed, cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    return reduceShip(s, { type: "sail", leg: { ...legFrom("a"), encounterChancePercent: 100 } });
  };

  it("rolls inside the window and hails when the ship reaches it", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = certain(seed);
        const e = s.voyage!.encounter!;
        expect(["cutpurse", "marauder"]).toContain(e.tierId);
        const len = s.voyage!.leg.lengthUnits;
        expect(e.atUnits).toBeGreaterThanOrEqual(Math.floor((len * DEFAULT_SHIP_RULES.encounterWindow.from) / 1000));
        expect(e.atUnits).toBeLessThanOrEqual(Math.floor((len * DEFAULT_SHIP_RULES.encounterWindow.to) / 1000));
      }),
      { numRuns: 50 },
    );
    let s = certain("hail");
    while (!s.voyage!.hail) {
      s = reduceShip(s, { type: "turn" });
      expect(s.voyage).not.toBeNull();
    }
    expect(s.events).toContainEqual({ type: "hailed", tierId: s.voyage!.hail!.tierId });
    expect(s.voyage!.progress).toBeGreaterThanOrEqual(s.voyage!.encounter!.atUnits);
  });

  it("the captain can evade; an unanswered hail evades on its own", () => {
    let s = certain("evade");
    while (!s.voyage!.hail) s = reduceShip(s, { type: "turn" });
    const tier = s.voyage!.hail!.tierId;
    const evaded = reduceShip(s, { type: "evade" });
    expect(evaded.voyage!.hail).toBeNull();
    expect(evaded.voyage!.encounter!.resolved).toBe(true);
    expect(evaded.events).toEqual([{ type: "evaded", tierId: tier, auto: false }]);
    expect(() => reduceShip(evaded, { type: "evade" })).toThrow(InvalidMoveError);

    const ignored = turns(s, DEFAULT_SHIP_RULES.hailTurns);
    expect(ignored.voyage!.hail).toBeNull();
    expect(ignored.voyage!.encounter!.resolved).toBe(true);
    // A second hail never comes on the same leg.
    const later = turns(ignored, 100);
    expect(later.islandId).toBe("b");
  });

  it("a zero chance leg is always clear", () => {
    let s = createShip("clear", cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    s = reduceShip(s, { type: "sail", leg: { ...legFrom("a"), encounterChancePercent: 0 } });
    expect(s.voyage!.encounter).toBeNull();
  });
});

describe("ship disconnects (DESIGN.md 3.4)", () => {
  it("holds a dropped pirate's seat for the grace period, then puts them ashore", () => {
    let s = underway("grace", { sailing: "p2" });
    s = reduceShip(s, { type: "away", pirateId: "p2" });
    expect(() => reduceShip(s, { type: "away", pirateId: "p2" })).toThrow(InvalidMoveError);
    s = turns(s, DEFAULT_SHIP_RULES.graceTurns - 1);
    expect(crewMember(s, "p2")?.station).toBe("sailing");
    expect(() => reduceShip(s, { type: "station", pirateId: "p1", station: "sailing" })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, "p2")).toBeNull();
    expect(s.events[0]).toEqual({ type: "left", pirateId: "p2", reason: "timed_out" });
    expect(s.voyage).not.toBeNull();
  });

  it("coming back in time keeps the seat", () => {
    let s = underway("back", { sailing: "p2" });
    s = reduceShip(s, { type: "away", pirateId: "p2" });
    s = turns(s, DEFAULT_SHIP_RULES.graceTurns - 1);
    s = reduceShip(s, { type: "back", pirateId: "p2" });
    s = turns(s, 5);
    expect(crewMember(s, "p2")?.station).toBe("sailing");
    expect(() => reduceShip(s, { type: "back", pirateId: "p2" })).toThrow(InvalidMoveError);
  });

  it("holds the ship while the captain is away, then hands the wheel to the longest aboard", () => {
    let s = underway("captain", { sailing: "p2" });
    s = reduceShip(s, { type: "board", pirateId: "p3" });
    s = reduceShip(s, { type: "away", pirateId: "p1" });
    const before = s.voyage!.progress;
    s = reduceShip(s, { type: "duty", station: "sailing", points: 99 });
    s = reduceShip(s, { type: "turn" });
    expect(s.lastTurn).toMatchObject({ held: true, speed: 0, advanced: 0 });
    expect(s.voyage!.progress).toBe(before);
    expect(s.water).toBe(0);
    s = turns(s, DEFAULT_SHIP_RULES.graceTurns - 1);
    expect(s.captainId).toBe("p2");
    expect(crewMember(s, "p1")).toBeNull();
    expect(s.lastTurn!.held).toBe(false);
    expect(s.voyage!.progress).toBeGreaterThan(before);
  });

  it("an empty ship at sea goes back to the island it left", () => {
    let s = underway("empty");
    s = turns(s, 3);
    s = reduceShip(s, { type: "leave", pirateId: "p1" });
    expect(s.voyage).toBeNull();
    expect(s.islandId).toBe("a");
    expect(s.captainId).toBeNull();
    expect(s.water).toBe(0);
    expect(s.events).toEqual([{ type: "left", pirateId: "p1", reason: "left" }, { type: "abandoned", islandId: "a" }]);
  });
});

describe("ship config", () => {
  it("rejects nonsense", () => {
    expect(() => createShip("x", { ...cfg, par: { ...par, sailing: 0 } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...sloop, stations: ["sailing", "sailing"] } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, rules: { ...DEFAULT_SHIP_RULES, maxSpeed: 10 } }, "a")).toThrow();
    expect(() => createShip("x", cfg, "")).toThrow();
  });
});
