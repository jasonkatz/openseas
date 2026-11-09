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
  bots,
  outputPercent,
  pirates,
  crewAtStation,
  reduceShip,
  replayShip,
  type LegPlan,
  type ShipConfig,
  type ShipMove,
  type ShipState,
  type Station,
  turnPlunderOutputs,
  meleePlunderOutput,
} from "../src/index.js";

const BOT_STATIONS: Station[] = ["engines", "cooling", "plating", "gunnery"];
const skiff = { id: "skiff", stations: [...STATIONS], maxCrew: 4, minCrew: 4, botStations: BOT_STATIONS, turrets: 4, baseTokens: 4 };
const par = { cooling: 20, engines: 15, plating: 12, gunnery: 10, navigation: 8 };
const cfg: ShipConfig = { shipClass: skiff, rules: DEFAULT_SHIP_RULES, par };
/** The same skiff with no bots, for tests about an unstaffed ship. */
const bare: ShipConfig = { ...cfg, shipClass: { ...skiff, minCrew: 0 } };

const OUTPOSTS = ["a", "b", "c"];
const legs: LegPlan[] = [];
for (const from of OUTPOSTS) {
  for (const to of OUTPOSTS) {
    if (from === to) continue;
    legs.push({ laneId: `${from}-${to}`, from, to, lengthUnits: legUnits(60), encounterChancePercent: 70, raiders: [{ tierId: "junker", weight: 3 }, { tierId: "marauder", weight: 1 }] });
  }
}
const legFrom = (outpost: string, pick = 0): LegPlan => legs.filter((l) => l.from === outpost)[pick % 2]!;

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
      return { type: "helm", pirateId: aboard };
    case 5:
      return { type: "launch", leg: legFrom(state.outpostId ?? "a", Math.floor(pick / 300)) };
    case 6:
    case 7: {
      const st = STATIONS[Math.floor(pick / 300) % STATIONS.length]!;
      return { type: "duty", station: st, points: Math.floor(pick / 1500) % 60 };
    }
    case 8:
    case 9:
      return { type: "turn" };
    case 10:
      if (pick % 3 === 2) return { type: "assign", pirateId: aboard, station: pick % 2 === 0 ? null : STATIONS[Math.floor(pick / 300) % STATIONS.length]! };
      return pick % 2 === 0 ? { type: "away", pirateId: aboard } : { type: "back", pirateId: aboard };
    default: {
      const k = pick % 7;
      if (k === 0) return { type: "evade" };
      if (k === 1) return { type: "lock", inviteOnly: pick % 2 === 0 };
      if (k === 2) return { type: "engage" };
      if (k === 3) return { type: "hit", damage: Math.floor(pick / 7) % 300 };
      if (k === 4) return { type: "fired", shots: Math.floor(pick / 7) % 5 };
      if (k === 5) return { type: "battle_end", outcome: pick % 2 === 0 ? "boarded" : "broke_off", plunder: Math.floor(pick / 7) % 1000, turns: Math.floor(pick / 7) % 20 };
      return { type: "turn" };
    }
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

/** Boards p1 as captain at p-station duty, launches on the first leg from "a". */
function underway(seed = "s", stations: Partial<Record<Station, string>> = {}, config = cfg): ShipState {
  let s = createShip(seed, config, "a");
  s = reduceShip(s, { type: "board", pirateId: "p1" });
  for (const [st, who] of Object.entries(stations)) {
    if (who !== "p1") s = reduceShip(s, { type: "board", pirateId: who });
    s = reduceShip(s, { type: "station", pirateId: who, station: st as Station });
  }
  return reduceShip(s, { type: "launch", leg: legFrom("a") });
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
        expect(s.heat).toBeGreaterThanOrEqual(0);
        expect(s.heat).toBeLessThanOrEqual(1000);
        expect(s.damage).toBeGreaterThanOrEqual(0);
        expect(s.damage).toBeLessThanOrEqual(1000);
        expect(s.loaded).toBeLessThanOrEqual(skiff.turrets);
        expect(s.loading).toBeGreaterThanOrEqual(0);
        expect(s.loading).toBeLessThan(1000);
        expect(s.crew.length).toBeLessThanOrEqual(skiff.maxCrew);
        const ids = new Set(s.crew.map((c) => c.pirateId));
        expect(ids.size).toBe(s.crew.length);
        const taken = s.crew.map((c) => c.station).filter((x) => x !== null);
        expect(new Set(taken).size).toBe(taken.length);
        if (s.crew.length === 0) expect(s.captainId).toBeNull();
        else expect(s.crew.some((c) => c.pirateId === s.captainId)).toBe(true);
        expect(s.outpostId === null).toBe(s.voyage !== null);
        if (s.voyage) {
          expect(s.voyage.progress).toBeGreaterThanOrEqual(0);
          expect(s.voyage.progress).toBeLessThan(s.voyage.leg.lengthUnits);
          expect(pirates(s.crew).length).toBeGreaterThan(0);
        } else {
          expect(OUTPOSTS).toContain(s.outpostId);
          // Bots are powered down in port.
          expect(bots(s.crew)).toEqual([]);
        }
        for (const m of bots(s.crew)) {
          expect(m.pirateId).not.toBe(s.captainId);
          expect(m.awaySinceTurn).toBeNull();
          expect(m.station === null).toBe(m.idleFromTurn !== null);
          if (m.station) expect(BOT_STATIONS).toContain(m.station);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("ship crew", () => {
  it("the first aboard takes the helm; the longest aboard inherits it", () => {
    let s = createShip("crew", cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    expect(s.captainId).toBe("p1");
    expect(s.events).toEqual([{ type: "boarded", pirateId: "p1" }, { type: "helm", pirateId: "p1" }]);
    s = reduceShip(s, { type: "board", pirateId: "p2" });
    s = reduceShip(s, { type: "board", pirateId: "p3" });
    s = reduceShip(s, { type: "leave", pirateId: "p1" });
    expect(s.captainId).toBe("p2");
    s = reduceShip(s, { type: "helm", pirateId: "p3" });
    expect(s.captainId).toBe("p3");
    expect(() => reduceShip(s, { type: "helm", pirateId: "p3" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "helm", pirateId: "p9" })).toThrow(InvalidMoveError);
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
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "engines" });
    expect(() => reduceShip(s, { type: "station", pirateId: "p2", station: "engines" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "station", pirateId: "p2", station: "core" as Station })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "cooling" });
    s = reduceShip(s, { type: "station", pirateId: "p2", station: "engines" });
    expect(s.crew.map((c) => c.station)).toEqual(["cooling", "engines"]);
    s = reduceShip(s, { type: "station", pirateId: "p2", station: null });
    expect(crewMember(s, "p2")?.station).toBeNull();
  });

  it("prefers a connected pirate for the helm, then the longest aboard", () => {
    expect(longestAboard([])).toBeNull();
    const crew = [
      { pirateId: "bot:0", station: null, boardedSeq: 0, awaySinceTurn: null, bot: true, idleFromTurn: 0 },
      { pirateId: "late", station: null, boardedSeq: 3, awaySinceTurn: null, bot: false, idleFromTurn: null },
      { pirateId: "early-away", station: null, boardedSeq: 1, awaySinceTurn: 2, bot: false, idleFromTurn: null },
      { pirateId: "mid", station: null, boardedSeq: 2, awaySinceTurn: null, bot: false, idleFromTurn: null },
    ];
    expect(longestAboard(crew)?.pirateId).toBe("mid");
    expect(longestAboard([crew[0]!])).toBeNull();
  });
});

describe("ship voyage", () => {
  it("a fully crewed skiff at par makes the leg in exactly its nominal time", () => {
    let s = underway("par", { engines: "p1", cooling: "p2", plating: "p3" });
    expect(s.outpostId).toBeNull();
    expect(s.voyage?.leg.laneId).toBe("a-b");
    const nominal = 60 / DEFAULT_SHIP_RULES.turnSeconds;
    const atPar = (st: ShipState): ShipState => {
      st = reduceShip(st, { type: "duty", station: "engines", points: par.engines });
      st = reduceShip(st, { type: "duty", station: "cooling", points: par.cooling });
      return reduceShip(st, { type: "duty", station: "plating", points: par.plating });
    };
    s = turns(s, nominal - 1, atPar);
    expect(s.voyage).not.toBeNull();
    expect(s.lastTurn?.speed).toBe(1000);
    expect(s.heat).toBe(0);
    s = atPar(s);
    s = reduceShip(s, { type: "turn" });
    expect(s.voyage).toBeNull();
    expect(s.outpostId).toBe("b");
    expect(s.voyagesCompleted).toBe(1);
    expect(s.events.at(-1)).toEqual({ type: "arrived", outpostId: "b", turns: nominal });
  });

  it("nobody flying means idle speed, heat rising and the hull wearing", () => {
    let s = underway("idle", {}, bare);
    s = turns(s, 5);
    expect(s.lastTurn?.outputs).toEqual({ cooling: 0, engines: 0, plating: 0, gunnery: 0, navigation: 0 });
    // Intake, plus a little more as the hull wears.
    expect(s.heat).toBeGreaterThanOrEqual(5 * DEFAULT_SHIP_RULES.heatIntakePerTurn);
    expect(s.heat).toBeLessThan(6 * DEFAULT_SHIP_RULES.heatIntakePerTurn);
    expect(s.damage).toBe(5 * DEFAULT_SHIP_RULES.wearPerTurn);
    expect(s.lastTurn!.speed).toBeLessThan(DEFAULT_SHIP_RULES.idleSpeed);
    expect(s.lastTurn!.speed).toBeGreaterThan(0);
  });

  it("output is a percentage of par, capped, and only counts for staffed stations", () => {
    expect(outputPercent(cfg, "engines", 0)).toBe(0);
    expect(outputPercent(cfg, "engines", par.engines)).toBe(100);
    expect(outputPercent(cfg, "engines", par.engines * 7)).toBe(DEFAULT_SHIP_RULES.outputCapPercent.engines);
    // Each station has its own cap: a lumpy puzzle's patch reaches the ship whole where a steady one's would be cut.
    expect(outputPercent(cfg, "plating", par.plating * 7)).toBe(700);
    let s = underway("out", { engines: "p1" });
    expect(() => reduceShip(s, { type: "duty", station: "cooling", points: 5 })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "duty", station: "engines", points: -1 })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "duty", station: "engines", points: 7 });
    s = reduceShip(s, { type: "duty", station: "engines", points: 8 });
    expect(s.pending.engines).toBe(15);
    s = reduceShip(s, { type: "turn" });
    expect(s.lastTurn?.outputs.engines).toBe(100);
    expect(s.pending.engines).toBe(0);
    expect(s.tokens).toBe(skiff.baseTokens);
  });

  it("gunnery loads the turrets and stops at the last one", () => {
    let s = underway("guns", { gunnery: "p1" }, bare);
    const load = (st: ShipState): ShipState => reduceShip(st, { type: "duty", station: "gunnery", points: par.gunnery });
    s = turns(s, 1, load);
    expect(s.loaded).toBe(0);
    expect(s.loading).toBe(DEFAULT_SHIP_RULES.loadPerTurn);
    s = turns(s, 1, load);
    expect(s.loaded).toBe(1);
    expect(s.loading).toBe(0);
    s = turns(s, 20, load);
    expect(s.loaded).toBe(skiff.turrets);
    expect(s.loading).toBe(0);
  });

  it("cannot fly from an outpost the ship is not at, or while in flight", () => {
    let s = createShip("launch", cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    expect(() => reduceShip(s, { type: "launch", leg: legFrom("b") })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "launch", leg: legFrom("a") });
    expect(() => reduceShip(s, { type: "launch", leg: legFrom("a") })).toThrow(InvalidMoveError);
    expect(() => reduceShip(createShip("x", cfg, "a"), { type: "launch", leg: legFrom("a") })).toThrow(InvalidMoveError);
  });

  it("arriving docks the ship, vents the heat and repairs the hull for free", () => {
    let s = underway("dock", {}, bare);
    s = turns(s, 10);
    expect(s.heat).toBeGreaterThan(0);
    expect(s.damage).toBeGreaterThan(0);
    s = turns(s, 200);
    expect(s.outpostId).toBe("b");
    expect(s.heat).toBe(0);
    expect(s.damage).toBe(0);
    expect(s.voyage).toBeNull();
    // Docked turns change nothing but the clock.
    const docked = reduceShip(s, { type: "turn" });
    expect({ ...docked, turn: 0, events: [] }).toEqual({ ...s, turn: 0, events: [] });
  });
});

describe("ship encounters", () => {
  const certain = (seed: string): ShipState => {
    let s = createShip(seed, bare, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    return reduceShip(s, { type: "launch", leg: { ...legFrom("a"), encounterChancePercent: 100 } });
  };

  it("rolls inside the window and hails when the ship reaches it", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = certain(seed);
        const e = s.voyage!.encounter!;
        expect(["junker", "marauder"]).toContain(e.tierId);
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
    expect(later.outpostId).toBe("b");
  });

  it("the captain can engage; the ship then holds position until the fight ends", () => {
    let s = certain("engage");
    expect(() => reduceShip(s, { type: "engage" })).toThrow(InvalidMoveError);
    while (!s.voyage!.hail) s = reduceShip(s, { type: "turn" });
    const tier = s.voyage!.hail!.tierId;
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "engines" });
    const fighting = reduceShip(s, { type: "engage" });
    expect(fighting.voyage!.hail).toBeNull();
    expect(fighting.voyage!.battle).toEqual({ tierId: tier, sinceTurn: s.turn });
    expect(fighting.events).toEqual([{ type: "engaged", tierId: tier }]);
    expect(() => reduceShip(fighting, { type: "engage" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(fighting, { type: "evade" })).toThrow(InvalidMoveError);
    // Turns pass without the ship advancing, but the stations still produce.
    const held = turns(fighting, 3, (st) => reduceShip(st, { type: "duty", station: "engines", points: par.engines }));
    expect(held.voyage!.progress).toBe(fighting.voyage!.progress);
    expect(held.lastTurn!.tokens).toBeGreaterThan(0);
    expect(held.voyage!.battle).not.toBeNull();
    // The battle board's hits and shots reach the hull and the magazine.
    const hitShip = reduceShip({ ...held, loaded: 3 }, { type: "hit", damage: 150 });
    expect(hitShip.damage).toBe(held.damage + 150);
    const firedShip = reduceShip(hitShip, { type: "fired", shots: 2 });
    expect(firedShip.loaded).toBe(1);
    expect(reduceShip(firedShip, { type: "fired", shots: 5 }).loaded).toBe(0);
    expect(() => reduceShip(firedShip, { type: "hit", damage: -1 })).toThrow(InvalidMoveError);
    // Ending the fight resolves the encounter for good and the leg resumes.
    const over = reduceShip(firedShip, { type: "battle_end", outcome: "boarded", plunder: 600, turns: 7 });
    expect(over.voyage!.battle).toBeNull();
    expect(over.voyage!.encounter!.resolved).toBe(true);
    expect(over.events).toEqual([{ type: "battle_ended", tierId: tier, outcome: "boarded", plunder: 600, turns: 7 }]);
    expect(() => reduceShip(over, { type: "hit", damage: 1 })).toThrow(InvalidMoveError);
    expect(() => reduceShip(over, { type: "battle_end", outcome: "boarded", plunder: 0, turns: 0 })).toThrow(InvalidMoveError);
    const on = turns(over, 1);
    expect(on.voyage!.progress).toBeGreaterThan(over.voyage!.progress);
    expect(on.voyage!.hail).toBeNull();
    expect(hashShipState(fighting)).not.toBe(hashShipState(s));
  });

  it("a raider in a fight never hails again, and the fight outlasts the hail's clock", () => {
    let s = certain("rehail");
    while (!s.voyage!.hail) s = reduceShip(s, { type: "turn" });
    let fighting = reduceShip(s, { type: "engage" });
    for (let i = 0; i < DEFAULT_SHIP_RULES.hailTurns * 3; i++) {
      fighting = reduceShip(fighting, { type: "turn" });
      expect(fighting.events.filter((e) => e.type === "hailed" || e.type === "evaded")).toEqual([]);
      expect(fighting.voyage!.hail).toBeNull();
      expect(fighting.voyage!.encounter!.resolved).toBe(false);
    }
    expect(() => reduceShip(fighting, { type: "evade" })).toThrow(InvalidMoveError);
  });

  it("a zero chance leg is always clear", () => {
    let s = createShip("clear", cfg, "a");
    s = reduceShip(s, { type: "board", pirateId: "p1" });
    s = reduceShip(s, { type: "launch", leg: { ...legFrom("a"), encounterChancePercent: 0 } });
    expect(s.voyage!.encounter).toBeNull();
  });
});

describe("ship disconnects (DESIGN.md 3.4)", () => {
  it("holds a dropped pirate's seat for the grace period, then puts them on the outpost", () => {
    let s = underway("grace", { engines: "p2" });
    s = reduceShip(s, { type: "away", pirateId: "p2" });
    expect(() => reduceShip(s, { type: "away", pirateId: "p2" })).toThrow(InvalidMoveError);
    s = turns(s, DEFAULT_SHIP_RULES.graceTurns - 1);
    expect(crewMember(s, "p2")?.station).toBe("engines");
    expect(() => reduceShip(s, { type: "station", pirateId: "p1", station: "engines" })).toThrow(InvalidMoveError);
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, "p2")).toBeNull();
    expect(s.events[0]).toEqual({ type: "left", pirateId: "p2", reason: "timed_out" });
    expect(s.voyage).not.toBeNull();
  });

  it("coming back in time keeps the seat", () => {
    let s = underway("back", { engines: "p2" });
    s = reduceShip(s, { type: "away", pirateId: "p2" });
    s = turns(s, DEFAULT_SHIP_RULES.graceTurns - 1);
    s = reduceShip(s, { type: "back", pirateId: "p2" });
    s = turns(s, 5);
    expect(crewMember(s, "p2")?.station).toBe("engines");
    expect(() => reduceShip(s, { type: "back", pirateId: "p2" })).toThrow(InvalidMoveError);
  });

  it("holds the ship while the captain is away, then hands the helm to the longest aboard", () => {
    let s = underway("captain", { engines: "p2" });
    s = reduceShip(s, { type: "board", pirateId: "p3" });
    s = reduceShip(s, { type: "away", pirateId: "p1" });
    const before = s.voyage!.progress;
    s = reduceShip(s, { type: "duty", station: "engines", points: 99 });
    s = reduceShip(s, { type: "turn" });
    expect(s.lastTurn).toMatchObject({ held: true, speed: 0, advanced: 0 });
    expect(s.voyage!.progress).toBe(before);
    expect(s.heat).toBe(0);
    s = turns(s, DEFAULT_SHIP_RULES.graceTurns - 1);
    expect(s.captainId).toBe("p2");
    expect(crewMember(s, "p1")).toBeNull();
    expect(s.lastTurn!.held).toBe(false);
    expect(s.voyage!.progress).toBeGreaterThan(before);
  });

  it("an empty ship in flight goes back to the outpost it left", () => {
    let s = underway("empty", {}, bare);
    s = turns(s, 3);
    s = reduceShip(s, { type: "leave", pirateId: "p1" });
    expect(s.voyage).toBeNull();
    expect(s.outpostId).toBe("a");
    expect(s.captainId).toBeNull();
    expect(s.heat).toBe(0);
    expect(s.events).toEqual([{ type: "left", pirateId: "p1", reason: "left" }, { type: "abandoned", outpostId: "a" }]);
  });
});

describe("ship bots (DESIGN.md 3.4)", () => {
  const rules = DEFAULT_SHIP_RULES;
  const botIds = (s: ShipState): string[] => bots(s.crew).map((m) => m.pirateId);

  it("launching short-handed boots up bots up to minCrew, at the bot stations in order", () => {
    const s = underway("hands", { gunnery: "p1" });
    expect(s.crew).toHaveLength(4);
    expect(pirates(s.crew).map((c) => c.pirateId)).toEqual(["p1"]);
    expect(bots(s.crew).map((m) => m.station)).toEqual(["engines", "cooling", "plating"]);
    expect(bots(s.crew).every((m) => m.pirateId.startsWith("bot:") && m.idleFromTurn === null && m.awaySinceTurn === null)).toBe(true);
    expect(s.events).toEqual([
      { type: "launched", laneId: "a-b" },
      ...bots(s.crew).map((m) => ({ type: "booted_up", pirateId: m.pirateId, station: m.station })),
    ]);
    expect(s.captainId).toBe("p1");
    // A bot is not a pirate: it holds no board, drops no connection, takes no helm and never leaves on its own.
    const bot = botIds(s)[0]!;
    for (const move of [
      { type: "duty", station: "engines", points: 5 },
      { type: "away", pirateId: bot },
      { type: "back", pirateId: bot },
      { type: "helm", pirateId: bot },
      { type: "leave", pirateId: bot },
      { type: "station", pirateId: bot, station: "gunnery" },
      { type: "board", pirateId: "bot:9" },
    ] as ShipMove[]) {
      expect(() => reduceShip(s, move)).toThrow(InvalidMoveError);
    }
  });

  it("a full crew flies without bots; one short gets one, left waiting if its stations are taken", () => {
    let full = createShip("full", cfg, "a");
    for (const p of ["p1", "p2", "p3", "p4"]) full = reduceShip(full, { type: "board", pirateId: p });
    full = reduceShip(full, { type: "launch", leg: legFrom("a") });
    expect(bots(full.crew)).toEqual([]);
    expect(full.events).toEqual([{ type: "launched", laneId: "a-b" }]);

    let s = createShip("one-short", cfg, "a");
    for (const [i, p] of ["p1", "p2", "p3"].entries()) {
      s = reduceShip(s, { type: "board", pirateId: p });
      s = reduceShip(s, { type: "station", pirateId: p, station: BOT_STATIONS[i]! });
    }
    s = reduceShip(s, { type: "launch", leg: legFrom("a") });
    expect(bots(s.crew).map((m) => m.station)).toEqual(["gunnery"]);

    // Every station a bot would work is taken: it waits on deck and takes the first that opens.
    let busy = createShip("busy", { ...cfg, shipClass: { ...skiff, maxCrew: 6, minCrew: 5 } }, "a");
    for (const [i, p] of ["p1", "p2", "p3", "p4"].entries()) {
      busy = reduceShip(busy, { type: "board", pirateId: p });
      busy = reduceShip(busy, { type: "station", pirateId: p, station: BOT_STATIONS[i]! });
    }
    busy = reduceShip(busy, { type: "launch", leg: legFrom("a") });
    expect(bots(busy.crew)).toMatchObject([{ station: null, idleFromTurn: 0 }]);
    expect(busy.events.at(-1)).toEqual({ type: "booted_up", pirateId: botIds(busy)[0], station: null });
    busy = turns(busy, 2);
    expect(bots(busy.crew)[0]!.station).toBeNull();
    busy = reduceShip(busy, { type: "station", pirateId: "p3", station: null });
    busy = reduceShip(busy, { type: "turn" });
    expect(bots(busy.crew)[0]).toMatchObject({ station: "plating", idleFromTurn: null });
    expect(busy.events).toContainEqual({ type: "station", pirateId: botIds(busy)[0], station: "plating" });
  });

  it("bots do a passable job: output between botOutput.min and max every turn, from the ship's PRNG", () => {
    let s = underway("work");
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      s = reduceShip(s, { type: "turn" });
      if (!s.voyage) break;
      for (const st of ["engines", "cooling", "plating"] as const) {
        const out = s.lastTurn!.outputs[st];
        expect(out).toBeGreaterThanOrEqual(rules.botOutput.min);
        expect(out).toBeLessThanOrEqual(rules.botOutput.max);
        seen.add(out);
      }
      expect(s.lastTurn!.outputs.gunnery).toBe(0);
      expect(s.lastTurn!.outputs.navigation).toBe(0);
    }
    expect(seen.size).toBeGreaterThan(3);
    // Faster than an unstaffed ship, slower than one at par.
    const crewed = turns(underway("work"), 3).lastTurn!.speed;
    const idle = turns(underway("work", {}, bare), 3).lastTurn!.speed;
    expect(crewed).toBeGreaterThan(idle);
    expect(crewed).toBeLessThan(1000);
    expect(turns(underway("work"), 3).heat).toBeLessThan(turns(underway("work", {}, bare), 3).heat);
  });

  it("a pirate takes a bot's station; the bot rests, then works another open one", () => {
    let s = underway("relieve");
    s = turns(s, 2);
    const hand = bots(s.crew).find((m) => m.station === "engines")!;
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "engines" });
    expect(crewMember(s, "p1")!.station).toBe("engines");
    expect(crewMember(s, hand.pirateId)).toMatchObject({ station: null, idleFromTurn: s.turn + rules.botRestTurns });
    expect(s.events).toEqual([{ type: "station", pirateId: "p1", station: "engines" }]);
    // Gunnery is open, but the bot waits out its rest first.
    s = turns(s, rules.botRestTurns - 1);
    expect(crewMember(s, hand.pirateId)!.station).toBeNull();
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, hand.pirateId)).toMatchObject({ station: "gunnery", idleFromTurn: null });
    expect(s.events).toContainEqual({ type: "station", pirateId: hand.pirateId, station: "gunnery" });
    expect(s.lastTurn!.outputs.gunnery).toBeGreaterThan(0);
    // Taking the same station again right away is a no-op for the bot's rest.
    const other = bots(s.crew).find((m) => m.station === "cooling")!;
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "cooling" });
    expect(crewMember(s, other.pirateId)!.station).toBeNull();
    expect(crewAtStation(s, "engines")).toBeNull();
    // With engines open, the relieved hand goes there once rested.
    s = turns(s, rules.botRestTurns);
    expect(crewMember(s, other.pirateId)!.station).toBe("engines");
  });

  it("bots are powered down in port, and go when the last pirate does", () => {
    let s = underway("port");
    const bootedUp = botIds(s);
    expect(bootedUp).toHaveLength(3);
    while (s.voyage) s = reduceShip(s, { type: "turn" });
    expect(s.outpostId).toBe("b");
    expect(bots(s.crew)).toEqual([]);
    expect(s.crew.map((c) => c.pirateId)).toEqual(["p1"]);
    const paid = s.events.find((e) => e.type === "powered_down");
    expect(paid).toEqual({ type: "powered_down", pirateIds: bootedUp });
    expect(s.events.indexOf(paid!)).toBeLessThan(s.events.findIndex((e) => e.type === "arrived"));
    // Engines again boots up fresh hands with new ids.
    s = reduceShip(s, { type: "launch", leg: legFrom("b") });
    expect(botIds(s)).toHaveLength(3);
    expect(botIds(s).some((id) => bootedUp.includes(id))).toBe(false);

    let gone = underway("gone");
    gone = reduceShip(gone, { type: "board", pirateId: "p2" });
    expect(bots(gone.crew)).toHaveLength(2);
    gone = reduceShip(gone, { type: "leave", pirateId: "p1" });
    expect(gone.captainId).toBe("p2");
    expect(bots(gone.crew)).toHaveLength(2);
    gone = reduceShip(gone, { type: "leave", pirateId: "p2" });
    expect(gone.crew).toEqual([]);
    expect(gone.outpostId).toBe("a");
    expect(gone.events.map((e) => e.type)).toEqual(["left", "powered_down", "abandoned"]);
  });

  it("a pirate boarding a ship full of bots relieves one, the idle one first", () => {
    let s = underway("berth");
    expect(s.crew).toHaveLength(skiff.maxCrew);
    const [first, second] = botIds(s) as [string, string, string];
    s = reduceShip(s, { type: "board", pirateId: "p2" });
    expect(s.crew).toHaveLength(skiff.maxCrew);
    expect(botIds(s)).toEqual([first, second]);
    expect(s.events).toEqual([{ type: "powered_down", pirateIds: [botIds(underway("berth"))[2]!] }, { type: "boarded", pirateId: "p2" }]);
    s = reduceShip(s, { type: "station", pirateId: "p2", station: "engines" });
    expect(crewMember(s, first)!.station).toBeNull();
    s = reduceShip(s, { type: "board", pirateId: "p3" });
    expect(botIds(s)).toEqual([second]);
    s = reduceShip(s, { type: "board", pirateId: "p4" });
    expect(bots(s.crew)).toEqual([]);
    expect(() => reduceShip(s, { type: "board", pirateId: "p5" })).toThrow(InvalidMoveError);
  });

  it("a bot can be ordered to any station it works, or stood down; never the nav console or a pirate's station", () => {
    let s = underway("orders", { gunnery: "p1" });
    const [a, b] = botIds(s) as [string, string, string];
    expect(crewMember(s, a)!.station).toBe("engines");
    // The nav console is a pirate's job: an order there is refused.
    expect(() => reduceShip(s, { type: "assign", pirateId: a, station: "navigation" })).toThrow(InvalidMoveError);
    // The pirate stands down from the guns; the hand is sent there and works at once.
    s = reduceShip(s, { type: "station", pirateId: "p1", station: null });
    s = reduceShip(s, { type: "assign", pirateId: a, station: "gunnery" });
    expect(crewMember(s, a)).toMatchObject({ station: "gunnery", idleFromTurn: null });
    expect(s.events).toEqual([{ type: "station", pirateId: a, station: "gunnery" }]);
    s = reduceShip(s, { type: "turn" });
    expect(s.lastTurn!.outputs.gunnery).toBeGreaterThanOrEqual(rules.botOutput.min);
    expect(s.lastTurn!.outputs.engines).toBe(0);
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "engines" });
    // Onto another bot's station: that hand steps aside and finds the open one (the guns) next turn.
    s = reduceShip(s, { type: "assign", pirateId: a, station: "cooling" });
    expect(crewMember(s, a)!.station).toBe("cooling");
    expect(crewMember(s, b)).toMatchObject({ station: null, idleFromTurn: s.turn });
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, b)!.station).toBe("gunnery");
    // The same order twice changes nothing; a pirate's station is refused; so is nonsense.
    expect(reduceShip(s, { type: "assign", pirateId: a, station: "cooling" }).events).toEqual([]);
    expect(() => reduceShip(s, { type: "assign", pirateId: a, station: "engines" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "assign", pirateId: "p1", station: "engines" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "assign", pirateId: "p9", station: "engines" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "assign", pirateId: a, station: "core" as Station })).toThrow(InvalidMoveError);
    // Stood down, the hand rests like one relieved, then goes back to work.
    s = reduceShip(s, { type: "assign", pirateId: a, station: null });
    expect(crewMember(s, a)).toMatchObject({ station: null, idleFromTurn: s.turn + rules.botRestTurns });
    expect(s.events).toEqual([{ type: "station", pirateId: a, station: null }]);
    s = turns(s, rules.botRestTurns - 1);
    expect(crewMember(s, a)!.station).toBeNull();
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, a)!.station).toBe("cooling");
  });

  it("the bots' work replays exactly", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 40 }), (seed, n) => {
        const a = turns(underway(seed, { gunnery: "p1" }), n);
        const b = turns(underway(seed, { gunnery: "p1" }), n);
        expect(hashShipState(a)).toBe(hashShipState(b));
        expect(a.lastTurn).toEqual(b.lastTurn);
      }),
      { numRuns: 50 },
    );
  });
});

describe("ship config", () => {
  it("rejects nonsense", () => {
    expect(() => createShip("x", { ...cfg, par: { ...par, engines: 0 } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...skiff, stations: ["engines", "engines"] } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...skiff, minCrew: 5 } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...skiff, botStations: ["engines", "engines"] } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...skiff, stations: ["engines"], botStations: ["cooling"] } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, rules: { ...DEFAULT_SHIP_RULES, botOutput: { min: 80, max: 60 } } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, rules: { ...DEFAULT_SHIP_RULES, maxSpeed: 10 } }, "a")).toThrow();
    expect(() => createShip("x", cfg, "")).toThrow();
  });
});

describe("plunder weighs what the ship received (ADR 0030)", () => {
  it("a pirate at par counts the same at any station, and the cap bounds a turn", () => {
    let s = underway("plunder", { engines: "p1", gunnery: "p2", plating: "p3" });
    s = reduceShip(s, { type: "duty", station: "engines", points: par.engines });
    s = reduceShip(s, { type: "duty", station: "gunnery", points: par.gunnery });
    s = reduceShip(s, { type: "duty", station: "plating", points: par.plating * 50 });
    s = reduceShip(s, { type: "turn" });
    const out = new Map(turnPlunderOutputs(s).map((o) => [o.pirateId, o.output]));
    // Raw points differ many times over; what the ship received does not.
    expect(out.get("p1")).toBe(100);
    expect(out.get("p2")).toBe(100);
    expect(out.get("p3")).toBe(DEFAULT_SHIP_RULES.outputCapPercent.plating);
  });

  it("bots and an idle pirate earn nothing, and a melee counts as duty turns", () => {
    let s = underway("hands", { engines: "p1" });
    s = reduceShip(s, { type: "turn" });
    expect(turnPlunderOutputs(s)).toEqual([]);
    // Par for a minute and a half of melee (nine ten-second turns) is nine turns at 100%.
    expect(meleePlunderOutput(1000, 1000, 90_000, 10)).toBe(900);
    expect(meleePlunderOutput(1500, 1000, 30_000, 10)).toBe(450);
    expect(meleePlunderOutput(0, 1000, 5_000, 10)).toBe(0);
  });
});

