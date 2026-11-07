import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_BATTLE_CONFIG,
  DEFAULT_SHIP_RULES,
  battleConfigAboard,
  battlePlanIllegalReason,
  bilgeAfterTurn,
  bilgeRowsFor,
  brigandSpecFor,
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
  soloBilgeStart,
  soloBilgeTurn,
  soloBilgeTurnsDue,
  splitTokens,
  validateBattleConfig,
  type BattleConfig,
  type BattleState,
  type CaptainSpec,
  type PrngState,
  type ShipState,
  type Station,
} from "../src/index.js";

const SLOOP = {
  id: "sloop",
  stations: ["bilging", "sailing", "carpentry", "gunnery", "navigation"] as Station[],
  maxCrew: 6,
  minCrew: 4,
  mateStations: ["sailing", "bilging", "carpentry", "gunnery"] as Station[],
  cannons: 4,
  baseTokens: 4,
};
const PAR = { parScore: 300, roundSeconds: 150 };
const PUZZLES = { bilging: PAR, sailing: { parScore: 200, roundSeconds: 150 }, carpentry: PAR, gunnery: PAR, navigation: PAR };

function shipAtSea(): ShipState {
  let s = createShip("x", shipConfigFor(SLOOP, DEFAULT_SHIP_RULES, PUZZLES), "a");
  s = reduceShip(s, { type: "board", pirateId: "p1" });
  s = reduceShip(s, { type: "sail", leg: legPlan({ id: "a-b", from: "a", to: "b", durationSeconds: 200, encounterChance: 0, brigands: [] }) });
  for (let i = 0; i < 3; i++) s = reduceShip(s, { type: "turn" });
  return s;
}

describe("the ship and its boards, wired as the server wires them", () => {
  it("scales each puzzle's par to one turn", () => {
    const cfg = shipConfigFor(SLOOP, DEFAULT_SHIP_RULES, PUZZLES);
    expect(cfg.par.bilging).toBe(20);
    expect(cfg.par.sailing).toBe(13);
  });

  it("deals the captain a battle board the engine accepts, carrying the ship's guns and hull", () => {
    const ship = { ...shipAtSea(), loaded: 3, damage: 240 };
    const brigand = brigandSpecFor({ movesPerTurn: 3, reloadPerTurn: 1, accuracy: 0.65, aggression: 0.6 }, 4);
    expect(brigand).toEqual({ cannons: 4, tokensPerTurn: 3, reloadPerTurn: 1, accuracy: 65, aggression: 60, startDamage: 0 });
    const cfg = battleConfigAboard(DEFAULT_BATTLE_CONFIG, ship, brigand);
    expect(() => validateBattleConfig(cfg)).not.toThrow();
    expect(cfg).toMatchObject({ supply: null, cannons: 4, startLoaded: 3, startDamage: 240, turnSeconds: DEFAULT_SHIP_RULES.turnSeconds });
  });

  it("supplies the board with the ship's tokens split by kind, its loads and its hull", () => {
    const ship = { ...shipAtSea(), tokens: 5, loaded: 9, damage: 100 };
    expect(shipSupply(ship)).toEqual({ ...splitTokens(5), cannons: 4, hull: 100 });
  });
});

const CAPTAINS: CaptainSpec[] = [
  { accuracy: 30, aggression: 20 },
  { accuracy: 70, aggression: 60 },
  { accuracy: 100, aggression: 100 },
];
const practice: BattleConfig = DEFAULT_BATTLE_CONFIG;

/** Sails a whole practice fight with the AI captain. Returns every state and the captain's PRNG. */
function sail(seed: string, spec: CaptainSpec): { states: BattleState[]; illegal: string[] } {
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
  it("only ever plots what the ship can sail, and every fight ends", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.constantFrom(...CAPTAINS), (seed, spec) => {
        const { states, illegal } = sail(seed, spec);
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
        const a = sail(seed, spec).states.map(hashBattleState);
        const b = sail(seed, spec).states.map(hashBattleState);
        expect(a).toEqual(b);
      }),
      { numRuns: 20 },
    );
  });

  it("fights: a sharp, bold captain lands hits against the practice brigand", () => {
    let hits = 0;
    for (let i = 0; i < 12; i++) hits += sail(`s${i}`, { accuracy: 100, aggression: 80 }).states.at(-1)!.hits;
    expect(hits).toBeGreaterThan(12);
  });
});

describe("the bilge as a Bilging board reads it", () => {
  const board = { height: 12, minWaterRow: 3 };

  it("never reads a bilge shallower than the board's floor, nor deeper than the board", () => {
    expect(bilgeRowsFor(0, board)).toBe(3);
    expect(bilgeRowsFor(200, board)).toBe(3);
    expect(bilgeRowsFor(500, board)).toBe(6);
    expect(bilgeRowsFor(1000, board)).toBe(12);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const rlo = bilgeRowsFor(lo, board);
        const rhi = bilgeRowsFor(hi, board);
        return rlo >= 3 && rhi <= 12 && rlo <= rhi;
      }),
    );
  });

  it("a lone Bilging ship takes water as the ship's turn does", () => {
    const rules = DEFAULT_SHIP_RULES;
    const par = 20;
    let bilge = soloBilgeStart(board);
    expect(bilge).toEqual({ water: 0, lastScore: 0, row: 3 });
    // Nothing earned: the bilge takes the class's intake every turn, as an unstaffed pump would.
    for (let t = 1; t <= 4; t++) {
      bilge = soloBilgeTurn(rules, par, bilge, 0, board);
      expect(bilge.water).toBe(bilgeAfterTurn(rules, (t - 1) * rules.waterIntakePerTurn, 0, 0));
    }
    // A turn at par pumps more than the intake, and the bilge drains back to the floor.
    const wet = bilge.water;
    bilge = soloBilgeTurn(rules, par, bilge, par, board);
    expect(bilge.water).toBe(bilgeAfterTurn(rules, wet, 0, 100));
    expect(bilge.lastScore).toBe(par);
    for (let i = 0; i < 6; i++) bilge = soloBilgeTurn(rules, par, bilge, bilge.lastScore + par, board);
    expect(bilge.water).toBe(0);
    expect(bilge.row).toBe(3);
  });

  it("counts a lone ship's turns from the round's start", () => {
    expect(soloBilgeTurnsDue({ turnSeconds: 10 }, 0)).toBe(0);
    expect(soloBilgeTurnsDue({ turnSeconds: 10 }, 9_999)).toBe(0);
    expect(soloBilgeTurnsDue({ turnSeconds: 10 }, 10_000)).toBe(1);
    expect(soloBilgeTurnsDue({ turnSeconds: 10 }, 150_000)).toBe(15);
  });
});
