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
  mates,
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
} from "../src/index.js";

const MATE_STATIONS: Station[] = ["sailing", "bilging", "carpentry", "gunnery"];
const sloop = { id: "sloop", stations: [...STATIONS], maxCrew: 4, minCrew: 4, mateStations: MATE_STATIONS, cannons: 4, baseTokens: 4 };
const par = { bilging: 20, sailing: 15, carpentry: 12, gunnery: 10, navigation: 8 };
const cfg: ShipConfig = { shipClass: sloop, rules: DEFAULT_SHIP_RULES, par };
/** The same sloop with no deckhands, for tests about an unstaffed ship. */
const bare: ShipConfig = { ...cfg, shipClass: { ...sloop, minCrew: 0 } };

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
      if (pick % 3 === 2) return { type: "assign", pirateId: aboard, station: pick % 2 === 0 ? null : STATIONS[Math.floor(pick / 300) % STATIONS.length]! };
      return pick % 2 === 0 ? { type: "away", pirateId: aboard } : { type: "back", pirateId: aboard };
    default: {
      const k = pick % 7;
      if (k === 0) return { type: "evade" };
      if (k === 1) return { type: "lock", inviteOnly: pick % 2 === 0 };
      if (k === 2) return { type: "engage" };
      if (k === 3) return { type: "hit", damage: Math.floor(pick / 7) % 300 };
      if (k === 4) return { type: "fired", shots: Math.floor(pick / 7) % 5 };
      if (k === 5) return { type: "battle_end", outcome: pick % 2 === 0 ? "boarded" : "broke_off", booty: Math.floor(pick / 7) % 1000, turns: Math.floor(pick / 7) % 20 };
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

/** Boards p1 as captain at p-station duty, sets sail on the first leg from "a". */
function underway(seed = "s", stations: Partial<Record<Station, string>> = {}, config = cfg): ShipState {
  let s = createShip(seed, config, "a");
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
          expect(pirates(s.crew).length).toBeGreaterThan(0);
        } else {
          expect(ISLANDS).toContain(s.islandId);
          // Deckhands are paid off in port.
          expect(mates(s.crew)).toEqual([]);
        }
        for (const m of mates(s.crew)) {
          expect(m.pirateId).not.toBe(s.captainId);
          expect(m.awaySinceTurn).toBeNull();
          expect(m.station === null).toBe(m.idleFromTurn !== null);
          if (m.station) expect(STATIONS).toContain(m.station);
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
      { pirateId: "mate:0", station: null, boardedSeq: 0, awaySinceTurn: null, mate: true, idleFromTurn: 0 },
      { pirateId: "late", station: null, boardedSeq: 3, awaySinceTurn: null, mate: false, idleFromTurn: null },
      { pirateId: "early-away", station: null, boardedSeq: 1, awaySinceTurn: 2, mate: false, idleFromTurn: null },
      { pirateId: "mid", station: null, boardedSeq: 2, awaySinceTurn: null, mate: false, idleFromTurn: null },
    ];
    expect(longestAboard(crew)?.pirateId).toBe("mid");
    expect(longestAboard([crew[0]!])).toBeNull();
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
    let s = underway("idle", {}, bare);
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
    let s = underway("guns", { gunnery: "p1" }, bare);
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
    let s = underway("dock", {}, bare);
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
    let s = createShip(seed, bare, "a");
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

  it("the captain can engage; the ship then holds position until the fight ends", () => {
    let s = certain("engage");
    expect(() => reduceShip(s, { type: "engage" })).toThrow(InvalidMoveError);
    while (!s.voyage!.hail) s = reduceShip(s, { type: "turn" });
    const tier = s.voyage!.hail!.tierId;
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "sailing" });
    const fighting = reduceShip(s, { type: "engage" });
    expect(fighting.voyage!.hail).toBeNull();
    expect(fighting.voyage!.battle).toEqual({ tierId: tier, sinceTurn: s.turn });
    expect(fighting.events).toEqual([{ type: "engaged", tierId: tier }]);
    expect(() => reduceShip(fighting, { type: "engage" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(fighting, { type: "evade" })).toThrow(InvalidMoveError);
    // Turns pass without the ship advancing, but the stations still produce.
    const held = turns(fighting, 3, (st) => reduceShip(st, { type: "duty", station: "sailing", points: par.sailing }));
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
    const over = reduceShip(firedShip, { type: "battle_end", outcome: "boarded", booty: 600, turns: 7 });
    expect(over.voyage!.battle).toBeNull();
    expect(over.voyage!.encounter!.resolved).toBe(true);
    expect(over.events).toEqual([{ type: "battle_ended", tierId: tier, outcome: "boarded", booty: 600, turns: 7 }]);
    expect(() => reduceShip(over, { type: "hit", damage: 1 })).toThrow(InvalidMoveError);
    expect(() => reduceShip(over, { type: "battle_end", outcome: "boarded", booty: 0, turns: 0 })).toThrow(InvalidMoveError);
    const on = turns(over, 1);
    expect(on.voyage!.progress).toBeGreaterThan(over.voyage!.progress);
    expect(on.voyage!.hail).toBeNull();
    expect(hashShipState(fighting)).not.toBe(hashShipState(s));
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
    let s = underway("empty", {}, bare);
    s = turns(s, 3);
    s = reduceShip(s, { type: "leave", pirateId: "p1" });
    expect(s.voyage).toBeNull();
    expect(s.islandId).toBe("a");
    expect(s.captainId).toBeNull();
    expect(s.water).toBe(0);
    expect(s.events).toEqual([{ type: "left", pirateId: "p1", reason: "left" }, { type: "abandoned", islandId: "a" }]);
  });
});

describe("ship deckhands (DESIGN.md 3.4)", () => {
  const rules = DEFAULT_SHIP_RULES;
  const mateIds = (s: ShipState): string[] => mates(s.crew).map((m) => m.pirateId);

  it("setting sail short-handed signs on deckhands up to minCrew, at the mate stations in order", () => {
    const s = underway("hands", { gunnery: "p1" });
    expect(s.crew).toHaveLength(4);
    expect(pirates(s.crew).map((c) => c.pirateId)).toEqual(["p1"]);
    expect(mates(s.crew).map((m) => m.station)).toEqual(["sailing", "bilging", "carpentry"]);
    expect(mates(s.crew).every((m) => m.pirateId.startsWith("mate:") && m.idleFromTurn === null && m.awaySinceTurn === null)).toBe(true);
    expect(s.events).toEqual([
      { type: "sailed", routeId: "a-b" },
      ...mates(s.crew).map((m) => ({ type: "hired", pirateId: m.pirateId, station: m.station })),
    ]);
    expect(s.captainId).toBe("p1");
    // A deckhand is not a pirate: it holds no board, drops no connection, takes no wheel and never leaves on its own.
    const mate = mateIds(s)[0]!;
    for (const move of [
      { type: "duty", station: "sailing", points: 5 },
      { type: "away", pirateId: mate },
      { type: "back", pirateId: mate },
      { type: "wheel", pirateId: mate },
      { type: "leave", pirateId: mate },
      { type: "station", pirateId: mate, station: "gunnery" },
      { type: "board", pirateId: "mate:9" },
    ] as ShipMove[]) {
      expect(() => reduceShip(s, move)).toThrow(InvalidMoveError);
    }
  });

  it("a full crew sails without deckhands; one short gets one, left waiting if its stations are taken", () => {
    let full = createShip("full", cfg, "a");
    for (const p of ["p1", "p2", "p3", "p4"]) full = reduceShip(full, { type: "board", pirateId: p });
    full = reduceShip(full, { type: "sail", leg: legFrom("a") });
    expect(mates(full.crew)).toEqual([]);
    expect(full.events).toEqual([{ type: "sailed", routeId: "a-b" }]);

    let s = createShip("one-short", cfg, "a");
    for (const [i, p] of ["p1", "p2", "p3"].entries()) {
      s = reduceShip(s, { type: "board", pirateId: p });
      s = reduceShip(s, { type: "station", pirateId: p, station: MATE_STATIONS[i]! });
    }
    s = reduceShip(s, { type: "sail", leg: legFrom("a") });
    expect(mates(s.crew).map((m) => m.station)).toEqual(["gunnery"]);

    // Every station a deckhand would work is taken: it waits on deck and takes the first that opens.
    let busy = createShip("busy", { ...cfg, shipClass: { ...sloop, maxCrew: 6, minCrew: 5 } }, "a");
    for (const [i, p] of ["p1", "p2", "p3", "p4"].entries()) {
      busy = reduceShip(busy, { type: "board", pirateId: p });
      busy = reduceShip(busy, { type: "station", pirateId: p, station: MATE_STATIONS[i]! });
    }
    busy = reduceShip(busy, { type: "sail", leg: legFrom("a") });
    expect(mates(busy.crew)).toMatchObject([{ station: null, idleFromTurn: 0 }]);
    expect(busy.events.at(-1)).toEqual({ type: "hired", pirateId: mateIds(busy)[0], station: null });
    busy = turns(busy, 2);
    expect(mates(busy.crew)[0]!.station).toBeNull();
    busy = reduceShip(busy, { type: "station", pirateId: "p3", station: null });
    busy = reduceShip(busy, { type: "turn" });
    expect(mates(busy.crew)[0]).toMatchObject({ station: "carpentry", idleFromTurn: null });
    expect(busy.events).toContainEqual({ type: "station", pirateId: mateIds(busy)[0], station: "carpentry" });
  });

  it("deckhands do a passable job: output between mateOutput.min and max every turn, from the ship's PRNG", () => {
    let s = underway("work");
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      s = reduceShip(s, { type: "turn" });
      if (!s.voyage) break;
      for (const st of ["sailing", "bilging", "carpentry"] as const) {
        const out = s.lastTurn!.outputs[st];
        expect(out).toBeGreaterThanOrEqual(rules.mateOutput.min);
        expect(out).toBeLessThanOrEqual(rules.mateOutput.max);
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
    expect(turns(underway("work"), 3).water).toBeLessThan(turns(underway("work", {}, bare), 3).water);
  });

  it("a pirate takes a deckhand's station; the deckhand rests, then works another open one", () => {
    let s = underway("relieve");
    s = turns(s, 2);
    const hand = mates(s.crew).find((m) => m.station === "sailing")!;
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "sailing" });
    expect(crewMember(s, "p1")!.station).toBe("sailing");
    expect(crewMember(s, hand.pirateId)).toMatchObject({ station: null, idleFromTurn: s.turn + rules.mateRestTurns });
    expect(s.events).toEqual([{ type: "station", pirateId: "p1", station: "sailing" }]);
    // Gunnery is open, but the deckhand waits out its rest first.
    s = turns(s, rules.mateRestTurns - 1);
    expect(crewMember(s, hand.pirateId)!.station).toBeNull();
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, hand.pirateId)).toMatchObject({ station: "gunnery", idleFromTurn: null });
    expect(s.events).toContainEqual({ type: "station", pirateId: hand.pirateId, station: "gunnery" });
    expect(s.lastTurn!.outputs.gunnery).toBeGreaterThan(0);
    // Taking the same station again right away is a no-op for the deckhand's rest.
    const other = mates(s.crew).find((m) => m.station === "bilging")!;
    s = reduceShip(s, { type: "station", pirateId: "p1", station: "bilging" });
    expect(crewMember(s, other.pirateId)!.station).toBeNull();
    expect(crewAtStation(s, "sailing")).toBeNull();
    // With sailing open, the relieved hand goes there once rested.
    s = turns(s, rules.mateRestTurns);
    expect(crewMember(s, other.pirateId)!.station).toBe("sailing");
  });

  it("deckhands are paid off in port, and go when the last pirate does", () => {
    let s = underway("port");
    const hired = mateIds(s);
    expect(hired).toHaveLength(3);
    while (s.voyage) s = reduceShip(s, { type: "turn" });
    expect(s.islandId).toBe("b");
    expect(mates(s.crew)).toEqual([]);
    expect(s.crew.map((c) => c.pirateId)).toEqual(["p1"]);
    const paid = s.events.find((e) => e.type === "paid_off");
    expect(paid).toEqual({ type: "paid_off", pirateIds: hired });
    expect(s.events.indexOf(paid!)).toBeLessThan(s.events.findIndex((e) => e.type === "arrived"));
    // Sailing again signs on fresh hands with new ids.
    s = reduceShip(s, { type: "sail", leg: legFrom("b") });
    expect(mateIds(s)).toHaveLength(3);
    expect(mateIds(s).some((id) => hired.includes(id))).toBe(false);

    let gone = underway("gone");
    gone = reduceShip(gone, { type: "board", pirateId: "p2" });
    expect(mates(gone.crew)).toHaveLength(2);
    gone = reduceShip(gone, { type: "leave", pirateId: "p1" });
    expect(gone.captainId).toBe("p2");
    expect(mates(gone.crew)).toHaveLength(2);
    gone = reduceShip(gone, { type: "leave", pirateId: "p2" });
    expect(gone.crew).toEqual([]);
    expect(gone.islandId).toBe("a");
    expect(gone.events.map((e) => e.type)).toEqual(["left", "paid_off", "abandoned"]);
  });

  it("a pirate boarding a ship full of deckhands relieves one, the idle one first", () => {
    let s = underway("berth");
    expect(s.crew).toHaveLength(sloop.maxCrew);
    const [first, second] = mateIds(s) as [string, string, string];
    s = reduceShip(s, { type: "board", pirateId: "p2" });
    expect(s.crew).toHaveLength(sloop.maxCrew);
    expect(mateIds(s)).toEqual([first, second]);
    expect(s.events).toEqual([{ type: "paid_off", pirateIds: [mateIds(underway("berth"))[2]!] }, { type: "boarded", pirateId: "p2" }]);
    s = reduceShip(s, { type: "station", pirateId: "p2", station: "sailing" });
    expect(crewMember(s, first)!.station).toBeNull();
    s = reduceShip(s, { type: "board", pirateId: "p3" });
    expect(mateIds(s)).toEqual([second]);
    s = reduceShip(s, { type: "board", pirateId: "p4" });
    expect(mates(s.crew)).toEqual([]);
    expect(() => reduceShip(s, { type: "board", pirateId: "p5" })).toThrow(InvalidMoveError);
  });

  it("a deckhand can be ordered to any station the ship has, or stood down; a pirate's station is never taken", () => {
    let s = underway("orders", { gunnery: "p1" });
    const [a, b] = mateIds(s) as [string, string, string];
    expect(crewMember(s, a)!.station).toBe("sailing");
    // To the chart table, which deckhands never pick for themselves; it works there like anywhere.
    s = reduceShip(s, { type: "assign", pirateId: a, station: "navigation" });
    expect(crewMember(s, a)).toMatchObject({ station: "navigation", idleFromTurn: null });
    expect(s.events).toEqual([{ type: "station", pirateId: a, station: "navigation" }]);
    s = reduceShip(s, { type: "turn" });
    expect(s.lastTurn!.outputs.navigation).toBeGreaterThanOrEqual(rules.mateOutput.min);
    expect(s.lastTurn!.outputs.sailing).toBe(0);
    // Onto another deckhand's station: that hand steps aside and finds the open one next turn.
    s = reduceShip(s, { type: "assign", pirateId: a, station: "bilging" });
    expect(crewMember(s, a)!.station).toBe("bilging");
    expect(crewMember(s, b)).toMatchObject({ station: null, idleFromTurn: s.turn });
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, b)!.station).toBe("sailing");
    // The same order twice changes nothing; a pirate's station is refused; so is nonsense.
    expect(reduceShip(s, { type: "assign", pirateId: a, station: "bilging" }).events).toEqual([]);
    expect(() => reduceShip(s, { type: "assign", pirateId: a, station: "gunnery" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "assign", pirateId: "p1", station: "sailing" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "assign", pirateId: "p9", station: "sailing" })).toThrow(InvalidMoveError);
    expect(() => reduceShip(s, { type: "assign", pirateId: a, station: "rigging" as Station })).toThrow(InvalidMoveError);
    // Stood down, the hand rests like one relieved, then goes back to work.
    s = reduceShip(s, { type: "assign", pirateId: a, station: null });
    expect(crewMember(s, a)).toMatchObject({ station: null, idleFromTurn: s.turn + rules.mateRestTurns });
    expect(s.events).toEqual([{ type: "station", pirateId: a, station: null }]);
    s = turns(s, rules.mateRestTurns - 1);
    expect(crewMember(s, a)!.station).toBeNull();
    s = reduceShip(s, { type: "turn" });
    expect(crewMember(s, a)!.station).toBe("bilging");
  });

  it("the deckhands' work replays exactly", () => {
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
    expect(() => createShip("x", { ...cfg, par: { ...par, sailing: 0 } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...sloop, stations: ["sailing", "sailing"] } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...sloop, minCrew: 5 } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...sloop, mateStations: ["sailing", "sailing"] } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, shipClass: { ...sloop, stations: ["sailing"], mateStations: ["bilging"] } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, rules: { ...DEFAULT_SHIP_RULES, mateOutput: { min: 80, max: 60 } } }, "a")).toThrow();
    expect(() => createShip("x", { ...cfg, rules: { ...DEFAULT_SHIP_RULES, maxSpeed: 10 } }, "a")).toThrow();
    expect(() => createShip("x", cfg, "")).toThrow();
  });
});
