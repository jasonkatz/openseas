/**
 * How a ship and the boards played aboard it are wired together: the derivations the server makes
 * when it builds a ship's config from content, deals the captain a sea battle, feeds that battle
 * the ship's word each turn and splits the purse. They live here, pure, so the server and the
 * harness's voyage bench compute them the same way (ADR 0027): a voyage simulated in the harness
 * is wired exactly as one sailed on the server.
 *
 * Inputs are structural (the fields content carries), so the engine needs no content types.
 */

import type { BattleConfig, BrigandSpec } from "../battle/types.js";
import { STATIONS, UNITS_PER_SECOND, type LegPlan, type ShipConfig, type ShipRules, type ShipState, type Station } from "./types.js";

/** What a ship class in content carries that the engine reads. */
export interface ShipClassFields {
  readonly id: string;
  readonly stations: readonly Station[];
  readonly maxCrew: number;
  readonly minCrew: number;
  readonly mateStations: readonly Station[];
  readonly cannons: number;
  readonly baseTokens: number;
}

/** What a duty puzzle's content carries that sets its par aboard. */
export interface DutyParFields {
  readonly parScore: number;
  readonly roundSeconds: number;
}

/** What a route leg in content carries. */
export interface RouteLegFields {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly durationSeconds: number;
  /** Chance per leg of a brigand encounter, 0..1. */
  readonly encounterChance: number;
  readonly brigands: ReadonlyArray<{ readonly tierId: string; readonly weight: number }>;
}

/** What a brigand tier in content carries that the sea battle reads. */
export interface BrigandTierFields {
  readonly movesPerTurn: number;
  readonly reloadPerTurn: number;
  /** 0..1 */
  readonly accuracy: number;
  /** 0..1 */
  readonly aggression: number;
}

/** The engine's config for a class: par per station is the puzzle's par scaled to one turn. */
export function shipConfigFor(shipClass: ShipClassFields, rules: ShipRules, puzzles: Readonly<Record<Station, DutyParFields>>): ShipConfig {
  const par = {} as Record<Station, number>;
  for (const st of STATIONS) {
    const p = puzzles[st];
    par[st] = Math.max(1, Math.round((p.parScore * rules.turnSeconds) / p.roundSeconds));
  }
  return {
    shipClass: {
      id: shipClass.id,
      stations: shipClass.stations,
      maxCrew: shipClass.maxCrew,
      minCrew: shipClass.minCrew,
      mateStations: shipClass.mateStations,
      cannons: shipClass.cannons,
      baseTokens: shipClass.baseTokens,
    },
    rules,
    par,
  };
}

/** A content route leg as the ship reducer's `sail` move takes it. */
export function legPlan(route: RouteLegFields): LegPlan {
  return {
    routeId: route.id,
    from: route.from,
    to: route.to,
    lengthUnits: route.durationSeconds * UNITS_PER_SECOND,
    encounterChancePercent: Math.round(route.encounterChance * 100),
    brigands: route.brigands,
  };
}

/** The ship's movement tokens as the battle board's kinds: half forward, the rest split between the turns. */
export function splitTokens(n: number): { left: number; forward: number; right: number } {
  const forward = Math.ceil(n / 2);
  const rest = n - forward;
  const left = Math.ceil(rest / 2);
  return { left, forward, right: rest - left };
}

/** A brigand tier as the battle's brigand: the tier's knobs in percent, the guns of its class. */
export function brigandSpecFor(tier: BrigandTierFields, cannons: number): BrigandSpec {
  return {
    cannons,
    tokensPerTurn: tier.movesPerTurn,
    reloadPerTurn: tier.reloadPerTurn,
    accuracy: Math.round(tier.accuracy * 100),
    aggression: Math.round(tier.aggression * 100),
    startDamage: 0,
  };
}

/**
 * The battle board's config aboard: content's rules with the ship's guns and hull, the tier's
 * brigand and the ship's turn. No practice supply: the ship's word arrives as `supply` moves.
 */
export function battleConfigAboard(base: BattleConfig, ship: ShipState, brigand: BrigandSpec): BattleConfig {
  const cannons = ship.config.shipClass.cannons;
  return {
    ...base,
    turnSeconds: ship.config.rules.turnSeconds,
    cannons,
    startLoaded: Math.min(cannons, ship.loaded),
    startDamage: Math.min(999, ship.damage),
    supply: null,
    brigand,
  };
}

/** What the ship brings the captain's board right now: its tokens split by kind, its loaded guns, its hull. */
export interface ShipSupply {
  readonly left: number;
  readonly forward: number;
  readonly right: number;
  readonly cannons: number;
  readonly hull: number;
}

export function shipSupply(ship: ShipState): ShipSupply {
  return { ...splitTokens(ship.tokens), cannons: Math.min(ship.config.shipClass.cannons, ship.loaded), hull: ship.damage };
}

/**
 * Booty split among everyone aboard, weighted by duty performance during the fight, with an extra
 * share for the captain (DESIGN.md 3.4): a base of two shares for the captain and one for everyone
 * else, each scaled between half and full by the pirate's points against the best aboard. What the
 * floors leave over goes to the captain. Integer arithmetic throughout.
 */
export function splitBooty(total: number, crew: ReadonlyArray<{ pirateId: string; captain: boolean; points: number }>): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || crew.length === 0) return out;
  const top = Math.max(0, ...crew.map((c) => c.points));
  const weights = crew.map((c) => (c.captain ? 2 : 1) * (top > 0 ? 50 + Math.floor((50 * c.points) / top) : 100));
  const sum = weights.reduce((a, b) => a + b, 0);
  let paid = 0;
  crew.forEach((c, i) => {
    const coins = Math.floor((total * weights[i]!) / sum);
    out.set(c.pirateId, coins);
    paid += coins;
  });
  const captain = crew.find((c) => c.captain) ?? crew[0]!;
  out.set(captain.pirateId, (out.get(captain.pirateId) ?? 0) + (total - paid));
  return out;
}
