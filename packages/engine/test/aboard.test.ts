import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_BATTLE_CONFIG,
  DEFAULT_SHIP_RULES,
  battleConfigAboard,
  battlePlanIllegalReason,
  heatAfterTurn,
  heatRowsFor,
  raiderSpecFor,
  chooseCaptainPlan,
  createBattleGame,
  createShip,
  hashBattleState,
  legPlan,
  reduceBattle,
  reduceShip,
  seedFromString,
  shipConfigFor,
  shipSupply,
  soloHeatStart,
  soloHeatTurn,
  soloHeatTurnsDue,
  splitTokens,
  validateBattleConfig,
  type BattleConfig,
  type BattleState,
  type CaptainSpec,
  type PrngState,
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
