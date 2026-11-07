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
import { bilgeAfterTurn } from "./reduce.js";
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

/** A duty puzzle's par for one ship's turn: its par for a round, scaled to the turn's length. */
export function parPerTurn(rules: Pick<ShipRules, "turnSeconds">, puzzle: DutyParFields): number {
  return Math.max(1, Math.round((puzzle.parScore * rules.turnSeconds) / puzzle.roundSeconds));
}

/** The engine's config for a class: par per station is the puzzle's par scaled to one turn. */
export function shipConfigFor(shipClass: ShipClassFields, rules: ShipRules, puzzles: Readonly<Record<Station, DutyParFields>>): ShipConfig {
  const par = {} as Record<Station, number>;
  for (const st of STATIONS) par[st] = parPerTurn(rules, puzzles[st]);
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
 * brigand, the tier's score factor and the ship's turn. No practice supply: the ship's word arrives
 * as `supply` moves.
 */
export function battleConfigAboard(base: BattleConfig, ship: ShipState, brigand: BrigandSpec, scorePercent = 100): BattleConfig {
  const cannons = ship.config.shipClass.cannons;
  return {
    ...base,
    turnSeconds: ship.config.rules.turnSeconds,
    cannons,
    startLoaded: Math.min(cannons, ship.loaded),
    startDamage: Math.min(999, ship.damage),
    supply: null,
    brigand,
    scorePercent,
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
 * What each pirate gave the ship in the turn just taken, for the booty (ADR 0030): the output of
 * the station they held, in percent of par after the station's cap, which is what the ship
 * received. Deckhands earn no booty, and a pirate at no station gave nothing this turn.
 */
export function turnBootyOutputs(ship: ShipState): Array<{ pirateId: string; output: number }> {
  const turn = ship.lastTurn;
  if (!turn || turn.held) return [];
  const out: Array<{ pirateId: string; output: number }> = [];
  for (const c of ship.crew) {
    if (c.mate || c.station === null) continue;
    const output = turn.outputs[c.station];
    if (output > 0) out.push({ pirateId: c.pirateId, output });
  }
  return out;
}

/**
 * A pirate's melee as duty turns for the booty (ADR 0030): their attack a minute against
 * Swordfight's par rate, in percent, counted once for every ship's turn the melee lasted.
 */
export function meleeBootyOutput(attackPerMinute: number, parRatePerMinute: number, meleeMs: number, turnSeconds: number): number {
  const turns = Math.max(1, Math.round(meleeMs / (turnSeconds * 1000)));
  return Math.floor((Math.max(0, attackPerMinute) * 100) / Math.max(1, parRatePerMinute)) * turns;
}

/**
 * Booty split among everyone aboard, weighted by what each gave the ship during the fight, with an
 * extra share for the captain (DESIGN.md 3.4): a base of two shares for the captain and one for
 * everyone else, each scaled between half and full by the pirate's weight against the best
 * aboard. The weight is output the ship received plus the melee as duty turns (ADR 0030), so every
 * station is measured against its own par. What the floors leave over goes to the captain.
 * Integer arithmetic throughout.
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

/** What a Bilging board's config carries that the ship's bilge is read against. */
export interface BilgeBoardFields {
  readonly height: number;
  readonly minWaterRow: number;
}

/**
 * The ship's bilge as rows of a Bilging board (DESIGN.md 3.3): permille of a full bilge read as
 * rows of the board, never below the board's `minWaterRow`. A bilge never runs dry, so even a sound,
 * pumped ship keeps the board's bottom rows underwater, and any barnacles under the line stay put
 * until they are lifted.
 */
export function bilgeRowsFor(water: number, board: BilgeBoardFields): number {
  return Math.max(board.minWaterRow, Math.min(board.height, Math.round((water * board.height) / 1000)));
}

/**
 * A ship for a Bilging board played on its own, in the harness (ADR 0029). The hull is sound and
 * nobody else is aboard. Each turn the bilge takes the class's intake and drains by this board's own
 * output, exactly as the ship reducer's turn would. The server runs it for a recorded round and
 * pushes the depth as a ship pushes its bilge to a duty board; the harness runs it on the round's
 * own clock for unrated and lab rounds.
 */
export interface SoloBilge {
  /** Permille of a full bilge, as the ship carries it. */
  readonly water: number;
  /** The board's score at the last turn, so the next turn takes only what was earned since. */
  readonly lastScore: number;
  /** The depth the board shows, in rows. */
  readonly row: number;
}

/** A dry, sound ship at the deal. */
export function soloBilgeStart(board: BilgeBoardFields): SoloBilge {
  return { water: 0, lastScore: 0, row: bilgeRowsFor(0, board) };
}

/** One ship's turn for a lone Bilging board whose score is now `score`. A turn that earned nothing (or less) pumps nothing. */
export function soloBilgeTurn(rules: ShipRules, par: number, bilge: SoloBilge, score: number, board: BilgeBoardFields): SoloBilge {
  const points = Math.max(0, score - bilge.lastScore);
  const output = Math.min(rules.outputCapPercent.bilging, Math.floor((points * 100) / Math.max(1, par)));
  const water = bilgeAfterTurn(rules, bilge.water, 0, output);
  return { water, lastScore: score, row: bilgeRowsFor(water, board) };
}

/** How many of the lone ship's turns are due `elapsedMs` into the round. */
export function soloBilgeTurnsDue(rules: Pick<ShipRules, "turnSeconds">, elapsedMs: number): number {
  return Math.max(0, Math.floor(elapsedMs / (rules.turnSeconds * 1000)));
}
