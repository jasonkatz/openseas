import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_BATTLE_CONFIG,
  DEFAULT_SHIP_RULES,
  DEFAULT_SWORDFIGHT_CONFIG,
  MELEE_SIDE_MAX,
  battleConfigAboard,
  battlePlanIllegalReason,
  battlePurse,
  heatAfterTurn,
  heatRowsFor,
  raiderSpecFor,
  chooseCaptainPlan,
  createBattleGame,
  createShip,
  hashBattleState,
  fightGoesToMelee,
  legPlan,
  meleeAttackRate,
  reduceBattle,
  reduceShip,
  seedFromString,
  shipConfigFor,
  shipSupply,
  soloHeatStart,
  soloHeatTurn,
  soloHeatTurnsDue,
  splitPlunder,
  splitTokens,
  swordfightScore,
  validateBattleConfig,
  validateSwordfightConfig,
  type BattleConfig,
  type BattleState,
  type CaptainSpec,
  type PrngState,
  type ShipBattleOutcome,
  type ShipState,
  type Station,
} from "../src/index.js";

const SKIFF = {
  id: "skiff",
  stations: ["cooling", "engines", "plating", "gunnery", "navigation"] as Station[],
  maxCrew: 6,
  minCrew: 4,
  botStations: ["engines", "cooling", "plating", "gunnery"] as Station[],
  turrets: 4,
  baseTokens: 4,
};
const PAR = { parScore: 300, roundSeconds: 150 };
const PUZZLES = { cooling: PAR, engines: { parScore: 200, roundSeconds: 150 }, plating: PAR, gunnery: PAR, navigation: PAR };

function shipInFlight(): ShipState {
  let s = createShip("x", shipConfigFor(SKIFF, DEFAULT_SHIP_RULES, PUZZLES), "a");
  s = reduceShip(s, { type: "board", pirateId: "p1" });
  s = reduceShip(s, { type: "launch", leg: legPlan({ id: "a-b", from: "a", to: "b", durationSeconds: 200, encounterChance: 0, raiders: [] }) });
  for (let i = 0; i < 3; i++) s = reduceShip(s, { type: "turn" });
  return s;
}

describe("the ship and its boards, wired as the server wires them", () => {
  it("scales each puzzle's par to one turn", () => {
    const cfg = shipConfigFor(SKIFF, DEFAULT_SHIP_RULES, PUZZLES);
    expect(cfg.par.cooling).toBe(20);
    expect(cfg.par.engines).toBe(13);
  });

  it("deals the captain a battle board the engine accepts, carrying the ship's guns and hull", () => {
    const ship = { ...shipInFlight(), loaded: 3, damage: 240 };
    const raider = raiderSpecFor({ movesPerTurn: 3, reloadPerTurn: 1, accuracy: 0.65, aggression: 0.6 }, 4);
    expect(raider).toEqual({ turrets: 4, tokensPerTurn: 3, reloadPerTurn: 1, accuracy: 65, aggression: 60, startDamage: 0 });
    const cfg = battleConfigAboard(DEFAULT_BATTLE_CONFIG, ship, raider);
    expect(() => validateBattleConfig(cfg)).not.toThrow();
    expect(cfg).toMatchObject({ supply: null, turrets: 4, startLoaded: 3, startDamage: 240, turnSeconds: DEFAULT_SHIP_RULES.turnSeconds });
  });

  it("supplies the board with the ship's tokens split by kind, its loads and its hull", () => {
    const ship = { ...shipInFlight(), tokens: 5, loaded: 9, damage: 100 };
    expect(shipSupply(ship)).toEqual({ ...splitTokens(5), turrets: 4, hull: 100 });
  });
});

/** p1 (the captain), p2 and p3 aboard with the bots the class needs to launch, fighting the raider that hailed. */
function shipInFight(): ShipState {
  let s = createShip("fight", shipConfigFor(SKIFF, DEFAULT_SHIP_RULES, PUZZLES), "a");
  for (const id of ["p1", "p2", "p3"]) s = reduceShip(s, { type: "board", pirateId: id });
  s = reduceShip(s, { type: "launch", leg: legPlan({ id: "a-b", from: "a", to: "b", durationSeconds: 600, encounterChance: 1, raiders: [{ tierId: "junker", weight: 1 }] }) });
  while (!s.voyage!.hail) s = reduceShip(s, { type: "turn" });
  return reduceShip(s, { type: "engage" });
}

const sum = (m: ReadonlyMap<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

describe("a fight settled as the server settles it", () => {
  const ship = shipInFight();
  const points = new Map([
    ["p1", 0],
    ["p2", 400],
    ["p3", 100],
  ]);

  it("on a win, splits the tier's plunder among the pirates aboard, the captain's extra share and the remainder included", () => {
    expect(ship.captainId).toBe("p1");
    const bots = ship.crew.filter((c) => c.bot).map((c) => c.pirateId);
    expect(bots.length).toBeGreaterThan(0);
    for (const outcome of ["boarded", "crippled"] as const) {
      const purse = battlePurse(ship, outcome, 1001, points, 7);
      expect(purse.won).toBe(true);
      expect(purse.plunder).toBe(1001);
      // Weights: the captain 2 * 50 = 100, p2 1 * 100 = 100, p3 1 * (50 + 12) = 62; the floors leave 1 for the captain.
      expect(Object.fromEntries(purse.shares)).toEqual({ p1: 383, p2: 382, p3: 236 });
      expect(sum(purse.shares)).toBe(1001);
      for (const id of bots) expect(purse.shares.has(id)).toBe(false);
      expect(purse.end).toEqual({ type: "battle_end", outcome, plunder: 1001, turns: 7 });
      // The ship takes the end as the fight's last word: the encounter is resolved and the leg resumes.
      const over = reduceShip(ship, purse.end!);
      expect(over.voyage!.battle).toBeNull();
      expect(over.events).toEqual([{ type: "battle_ended", tierId: "junker", outcome, plunder: 1001, turns: 7 }]);
    }
  });

  it("with no captain aboard, every pirate takes one base share and the first the remainder", () => {
    const leaderless = { ...ship, captainId: null };
    const purse = battlePurse(leaderless, "boarded", 1000, new Map(), 3);
    expect(Object.fromEntries(purse.shares)).toEqual({ p1: 334, p2: 333, p3: 333 });
    // A pirate who did nothing still takes a share: half of what the best aboard earns.
    const weighted = battlePurse(leaderless, "boarded", 1000, new Map([["p2", 100]]), 3);
    expect(Object.fromEntries(weighted.shares)).toEqual({ p1: 250, p2: 500, p3: 250 });
    expect(Object.fromEntries(weighted.shares)).toEqual(Object.fromEntries(splitPlunder(1000, ["p1", "p2", "p3"].map((id) => ({ pirateId: id, captain: false, points: id === "p2" ? 100 : 0 })))));
  });

  it("a fight not won pays nothing and still ends on the ship", () => {
    for (const outcome of ["boarded_by", "crippled_by", "broke_off", "disengaged"] as const) {
      const purse = battlePurse(ship, outcome, 1000, points, 4);
      expect(purse.won).toBe(false);
      expect(purse.plunder).toBe(0);
      expect(purse.shares.size).toBe(0);
      expect(purse.end).toEqual({ type: "battle_end", outcome, plunder: 0, turns: 4 });
    }
    // A tier with no plunder pays nothing even on a win.
    expect(battlePurse(ship, "boarded", 0, points, 4).shares.size).toBe(0);
  });

  it("a ship with no fight on has nothing to end", () => {
    const flying = { ...ship, voyage: { ...ship.voyage!, battle: null } };
    const purse = battlePurse(flying, "boarded", 1000, points, 4);
    expect(purse.end).toBeNull();
    expect(sum(purse.shares)).toBe(1000);
  });

  it("only a boarding, either way, goes to the melee", () => {
    const all: ShipBattleOutcome[] = ["boarded", "crippled", "boarded_by", "crippled_by", "broke_off", "disengaged"];
    expect(all.filter(fightGoesToMelee)).toEqual(["boarded", "boarded_by"]);
  });

  it("holds the melee to as many boards a side as a swordfight takes", () => {
    const hand = { thinkTicks: 14, skill: 60, blade: 1 };
    const side = (n: number) => Array.from({ length: n }, () => ({ ...hand }));
    const melee = { ...DEFAULT_SWORDFIGHT_CONFIG, player: false, blade: 0 };
    expect(() => validateSwordfightConfig({ ...melee, allies: side(MELEE_SIDE_MAX), foes: side(MELEE_SIDE_MAX) })).not.toThrow();
    expect(() => validateSwordfightConfig({ ...melee, allies: side(MELEE_SIDE_MAX + 1), foes: side(1) })).toThrow();
    expect(() => validateSwordfightConfig({ ...melee, allies: side(1), foes: side(MELEE_SIDE_MAX + 1) })).toThrow();
  });
});

describe("a pirate's attack a minute in the melee", () => {
  const cfg = DEFAULT_SWORDFIGHT_CONFIG;

  it("is the score without the win band", () => {
    expect(meleeAttackRate(cfg, 0)).toBe(0);
    expect(meleeAttackRate(cfg, cfg.winPoints - 1)).toBe(cfg.winPoints - 1);
    expect(meleeAttackRate(cfg, cfg.winPoints)).toBe(0);
    expect(meleeAttackRate(cfg, cfg.winPoints + 1200)).toBe(1200);
    // A won fight's rate is not held under the band: five times par and more counts in full.
    expect(meleeAttackRate(cfg, 2 * cfg.winPoints + 300)).toBe(cfg.winPoints + 300);
  });

  it("undoes the swordfight's score: a won fight's rate in full, any other's as the score kept it", () => {
    const minTicks = Math.ceil((cfg.minRateSeconds * 1000) / cfg.tickMs);
    fc.assert(
      fc.property(fc.nat({ max: 200_000 }), fc.integer({ min: 1, max: cfg.maxTick }), fc.constantFrom("won" as const, "lost" as const, null), (points, ticks, outcome) => {
        const rate = Math.floor((points * 60_000 * cfg.scorePercent) / (100 * cfg.tickMs * Math.max(ticks, minTicks)));
        const score = swordfightScore(cfg, points, ticks, outcome);
        expect(meleeAttackRate(cfg, score)).toBe(outcome === "won" ? rate : Math.min(rate, cfg.winPoints - 1));
      }),
    );
  });
});

const CAPTAINS: CaptainSpec[] = [
  { accuracy: 30, aggression: 20 },
  { accuracy: 70, aggression: 60 },
  { accuracy: 100, aggression: 100 },
];
const practice: BattleConfig = DEFAULT_BATTLE_CONFIG;

/** Flies a whole practice fight with the AI captain. Returns every state and the captain's PRNG. */
function fly(seed: string, spec: CaptainSpec): { states: BattleState[]; illegal: string[] } {
  let s = createBattleGame(seed, practice);
  let rng: PrngState = seedFromString(`captain:${seed}`);
  const states = [s];
  const illegal: string[] = [];
  while (!s.finished) {
    const c = chooseCaptainPlan(s, spec, rng);
    rng = c.rng;
    const why = battlePlanIllegalReason(s, c.plan);
    if (why) {
      illegal.push(why);
      break;
    }
    s = reduceBattle(s, { type: "commit", ...c.plan });
    states.push(s);
  }
  return { states, illegal };
}

describe("the AI captain", () => {
  it("only ever plots what the ship can fly, and every fight ends", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.constantFrom(...CAPTAINS), (seed, spec) => {
        const { states, illegal } = fly(seed, spec);
        expect(illegal).toEqual([]);
        expect(states[states.length - 1]!.finished).toBe(true);
        expect(states.length - 1).toBeLessThanOrEqual(practice.maxTurns);
      }),
      { numRuns: 40 },
    );
  });

  it("is deterministic: the same fight and the same rolls give the same plot", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.constantFrom(...CAPTAINS), (seed, spec) => {
        const a = fly(seed, spec).states.map(hashBattleState);
        const b = fly(seed, spec).states.map(hashBattleState);
        expect(a).toEqual(b);
      }),
      { numRuns: 20 },
    );
  });

  it("fights: a sharp, bold captain lands hits against the practice raider", () => {
    let hits = 0;
    for (let i = 0; i < 12; i++) hits += fly(`s${i}`, { accuracy: 100, aggression: 80 }).states.at(-1)!.hits;
    expect(hits).toBeGreaterThan(12);
  });
});

describe("the heat as a Cooling board reads it", () => {
  const board = { height: 12, minHeatRow: 3 };

  it("never reads a heat shallower than the board's floor, nor deeper than the board", () => {
    expect(heatRowsFor(0, board)).toBe(3);
    expect(heatRowsFor(200, board)).toBe(3);
    expect(heatRowsFor(500, board)).toBe(6);
    expect(heatRowsFor(1000, board)).toBe(12);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const rlo = heatRowsFor(lo, board);
        const rhi = heatRowsFor(hi, board);
        return rlo >= 3 && rhi <= 12 && rlo <= rhi;
      }),
    );
  });

  it("a lone Cooling ship takes heat as the ship's turn does", () => {
    const rules = DEFAULT_SHIP_RULES;
    const par = 20;
    let solo = soloHeatStart(board);
    expect(solo).toEqual({ heat: 0, lastScore: 0, row: 3 });
    // Nothing earned: the heat takes the class's intake every turn, as an unstaffed vent would.
    for (let t = 1; t <= 4; t++) {
      solo = soloHeatTurn(rules, par, solo, 0, board);
      expect(solo.heat).toBe(heatAfterTurn(rules, (t - 1) * rules.heatIntakePerTurn, 0, 0));
    }
    // A turn at par vents more than the intake, and the heat drains back to the floor.
    const wet = solo.heat;
    solo = soloHeatTurn(rules, par, solo, par, board);
    expect(solo.heat).toBe(heatAfterTurn(rules, wet, 0, 100));
    expect(solo.lastScore).toBe(par);
    for (let i = 0; i < 6; i++) solo = soloHeatTurn(rules, par, solo, solo.lastScore + par, board);
    expect(solo.heat).toBe(0);
    expect(solo.row).toBe(3);
  });

  it("counts a lone ship's turns from the round's start", () => {
    expect(soloHeatTurnsDue({ turnSeconds: 10 }, 0)).toBe(0);
    expect(soloHeatTurnsDue({ turnSeconds: 10 }, 9_999)).toBe(0);
    expect(soloHeatTurnsDue({ turnSeconds: 10 }, 10_000)).toBe(1);
    expect(soloHeatTurnsDue({ turnSeconds: 10 }, 150_000)).toBe(15);
  });
});
