/**
 * How a ship and the boards played aboard it are wired together: the derivations the server makes
 * when it builds a ship's config from content, deals the captain a space battle, feeds that battle
 * the ship's word each turn, opens the melee at a boarding and settles the fight. They live here,
 * pure, so the server and the harness's voyage bench compute them the same way (ADR 0027): a voyage
 * simulated in the harness is wired exactly as one flew on the server.
 *
 * Inputs are structural (the fields content carries), so the engine needs no content types.
 */

import { isWin } from "../battle/reduce.js";
import type { BattleConfig, RaiderSpec } from "../battle/types.js";
import type { SwordfightConfig } from "../swordfight/types.js";
import { heatAfterTurn, pirates } from "./reduce.js";
import { STATIONS, UNITS_PER_SECOND, type LegPlan, type ShipBattleOutcome, type ShipConfig, type ShipMove, type ShipRules, type ShipState, type Station } from "./types.js";

/** What a ship class in content carries that the engine reads. */
export interface ShipClassFields {
  readonly id: string;
  readonly stations: readonly Station[];
  readonly maxCrew: number;
  readonly minCrew: number;
  readonly botStations: readonly Station[];
  readonly turrets: number;
  readonly baseTokens: number;
}

/** What a duty puzzle's content carries that sets its par aboard. */
export interface DutyParFields {
  readonly parScore: number;
  readonly roundSeconds: number;
}

/** What a lane leg in content carries. */
export interface LaneLegFields {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly durationSeconds: number;
  /** Chance per leg of a raider encounter, 0..1. */
  readonly encounterChance: number;
  readonly raiders: ReadonlyArray<{ readonly tierId: string; readonly weight: number }>;
}

/** What a raider tier in content carries that the space battle reads. */
export interface RaiderTierFields {
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
      botStations: shipClass.botStations,
      turrets: shipClass.turrets,
      baseTokens: shipClass.baseTokens,
    },
    rules,
    par,
  };
}

/** A content lane leg as the ship reducer's `launch` move takes it. */
export function legPlan(lane: LaneLegFields): LegPlan {
  return {
    laneId: lane.id,
    from: lane.from,
    to: lane.to,
    lengthUnits: lane.durationSeconds * UNITS_PER_SECOND,
    encounterChancePercent: Math.round(lane.encounterChance * 100),
    raiders: lane.raiders,
  };
}

/** The ship's movement tokens as the battle board's kinds: half forward, the rest split between the turns. */
export function splitTokens(n: number): { left: number; forward: number; right: number } {
  const forward = Math.ceil(n / 2);
  const rest = n - forward;
  const left = Math.ceil(rest / 2);
  return { left, forward, right: rest - left };
}

/** A raider tier as the battle's raider: the tier's knobs in percent, the guns of its class. */
export function raiderSpecFor(tier: RaiderTierFields, turrets: number): RaiderSpec {
  return {
    turrets,
    tokensPerTurn: tier.movesPerTurn,
    reloadPerTurn: tier.reloadPerTurn,
    accuracy: Math.round(tier.accuracy * 100),
    aggression: Math.round(tier.aggression * 100),
    startDamage: 0,
  };
}

/**
 * The battle board's config aboard: content's rules with the ship's guns and hull, the tier's
 * raider, the tier's score factor and the ship's turn. No practice supply: the ship's word arrives
 * as `supply` moves.
 */
export function battleConfigAboard(base: BattleConfig, ship: ShipState, raider: RaiderSpec, scorePercent = 100): BattleConfig {
  const turrets = ship.config.shipClass.turrets;
  return {
    ...base,
    turnSeconds: ship.config.rules.turnSeconds,
    turrets,
    startLoaded: Math.min(turrets, ship.loaded),
    startDamage: Math.min(999, ship.damage),
    supply: null,
    raider,
    scorePercent,
  };
}

/** What the ship brings the captain's board right now: its tokens split by kind, its loaded guns, its hull. */
export interface ShipSupply {
  readonly left: number;
  readonly forward: number;
  readonly right: number;
  readonly turrets: number;
  readonly hull: number;
}

export function shipSupply(ship: ShipState): ShipSupply {
  return { ...splitTokens(ship.tokens), turrets: Math.min(ship.config.shipClass.turrets, ship.loaded), hull: ship.damage };
}

/**
 * What each pirate gave the ship in the turn just taken, for the plunder (ADR 0030): the output of
 * the station they held, in percent of par after the station's cap, which is what the ship
 * received. Bots earn no plunder, and a pirate at no station gave nothing this turn.
 */
export function turnPlunderOutputs(ship: ShipState): Array<{ pirateId: string; output: number }> {
  const turn = ship.lastTurn;
  if (!turn || turn.held) return [];
  const out: Array<{ pirateId: string; output: number }> = [];
  for (const c of ship.crew) {
    if (c.bot || c.station === null) continue;
    const output = turn.outputs[c.station];
    if (output > 0) out.push({ pirateId: c.pirateId, output });
  }
  return out;
}

/**
 * The most boards a side of the melee holds: a swordfight takes at most eight AI hands a side. The
 * raider crew fields one board for each pirate at the airlock, up to this many.
 */
export const MELEE_SIDE_MAX = 8;

/**
 * Whether a space battle's end opens the boarding melee (ADR 0022): a grapple that lands, either
 * way, takes the fight to the airlock, and the melee decides the plunder. Any other end settles the
 * fight at once. The melee opens only if a pirate is there to fight it.
 */
export function fightGoesToMelee(outcome: ShipBattleOutcome): outcome is "boarded" | "boarded_by" {
  return outcome === "boarded" || outcome === "boarded_by";
}

/**
 * A pirate's attack a minute in the melee, from their swordfight score: the score without the win
 * band a won fight carries (`swordfightScore`). Any other fight is scored under the band, so its
 * score is its rate. This is the rate the plunder weighs (ADR 0030) and the rate a board shows.
 */
export function meleeAttackRate(cfg: Pick<SwordfightConfig, "winPoints">, score: number): number {
  return score >= cfg.winPoints ? score - cfg.winPoints : score;
}

/**
 * A pirate's melee as duty turns for the plunder (ADR 0030): their attack a minute against
 * Swordfight's par rate, in percent, counted once for every ship's turn the melee lasted.
 */
export function meleePlunderOutput(attackPerMinute: number, parRatePerMinute: number, meleeMs: number, turnSeconds: number): number {
  const turns = Math.max(1, Math.round(meleeMs / (turnSeconds * 1000)));
  return Math.floor((Math.max(0, attackPerMinute) * 100) / Math.max(1, parRatePerMinute)) * turns;
}

/**
 * Plunder split among everyone aboard, weighted by what each gave the ship during the fight, with an
 * extra share for the captain (DESIGN.md 3.4): a base of two shares for the captain and one for
 * everyone else, each scaled between half and full by the pirate's weight against the best
 * aboard. The weight is output the ship received plus the melee as duty turns (ADR 0030), so every
 * station is measured against its own par. What the floors leave over goes to the captain.
 * Integer arithmetic throughout.
 */
export function splitPlunder(total: number, crew: ReadonlyArray<{ pirateId: string; captain: boolean; points: number }>): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || crew.length === 0) return out;
  const top = Math.max(0, ...crew.map((c) => c.points));
  const weights = crew.map((c) => (c.captain ? 2 : 1) * (top > 0 ? 50 + Math.floor((50 * c.points) / top) : 100));
  const sum = weights.reduce((a, b) => a + b, 0);
  let paid = 0;
  crew.forEach((c, i) => {
    const credits = Math.floor((total * weights[i]!) / sum);
    out.set(c.pirateId, credits);
    paid += credits;
  });
  const captain = crew.find((c) => c.captain) ?? crew[0]!;
  out.set(captain.pirateId, (out.get(captain.pirateId) ?? 0) + (total - paid));
  return out;
}

/** A decided fight, settled: what it won, each pirate's share, and the move that ends it on the ship. */
export interface BattlePurse {
  /** The ship boarded or crippled the raider. */
  readonly won: boolean;
  /** The tier's plunder on a win, in credits; nothing otherwise. */
  readonly plunder: number;
  /** Credits per pirate aboard; empty when there is no plunder. Bots work for their keep. */
  readonly shares: ReadonlyMap<string, number>;
  /** The ship's `battle_end` move, or null when the ship has no fight on to end. */
  readonly end: Extract<ShipMove, { type: "battle_end" }> | null;
}

/**
 * Settle a decided fight (ADR 0021, ADR 0030): on a win the tier's plunder goes to the pirates
 * aboard by `splitPlunder`, each weighted by `points` (the output their station gave the ship
 * during the fight, plus any melee as duty turns), with the captain's extra share; and the ship
 * hears the fight is over, with the plunder and the battle's `turns`. A boarding settles here once
 * the melee is decided. The server and the voyage bench pay every fight out through this.
 */
export function battlePurse(ship: ShipState, outcome: ShipBattleOutcome, tierPlunder: number, points: ReadonlyMap<string, number>, turns: number): BattlePurse {
  const won = isWin(outcome);
  const plunder = won ? tierPlunder : 0;
  const crew = pirates(ship.crew).map((c) => ({ pirateId: c.pirateId, captain: c.pirateId === ship.captainId, points: points.get(c.pirateId) ?? 0 }));
  const shares = plunder > 0 ? splitPlunder(plunder, crew) : new Map<string, number>();
  return { won, plunder, shares, end: ship.voyage?.battle ? { type: "battle_end", outcome, plunder, turns } : null };
}

/** What a Cooling board's config carries that the ship's heat is read against. */
export interface HeatBoardFields {
  readonly height: number;
  readonly minHeatRow: number;
}

/**
 * The ship's heat as rows of a Cooling board (DESIGN.md 3.3): permille of a full heat read as
 * rows of the board, never below the board's `minHeatRow`. A heat never runs dry, so even a sound,
 * vented ship keeps the board's bottom rows overheated, and any slag pieces under the line stay put
 * until they are lifted.
 */
export function heatRowsFor(heat: number, board: HeatBoardFields): number {
  return Math.max(board.minHeatRow, Math.min(board.height, Math.round((heat * board.height) / 1000)));
}

/**
 * A ship for a Cooling board played on its own, in the harness (ADR 0029). The hull is sound and
 * nobody else is aboard. Each turn the heat takes the class's intake and drains by this board's own
 * output, exactly as the ship reducer's turn would. The server runs it for a recorded round and
 * pushes the depth as a ship pushes its heat to a duty board; the harness runs it on the round's
 * own clock for unrated and lab rounds.
 */
export interface SoloHeat {
  /** Permille of a full heat, as the ship carries it. */
  readonly heat: number;
  /** The board's score at the last turn, so the next turn takes only what was earned since. */
  readonly lastScore: number;
  /** The depth the board shows, in rows. */
  readonly row: number;
}

/** A dry, sound ship at the deal. */
export function soloHeatStart(board: HeatBoardFields): SoloHeat {
  return { heat: 0, lastScore: 0, row: heatRowsFor(0, board) };
}

/** One ship's turn for a lone Cooling board whose score is now `score`. A turn that earned nothing (or less) vents nothing. */
export function soloHeatTurn(rules: ShipRules, par: number, solo: SoloHeat, score: number, board: HeatBoardFields): SoloHeat {
  const points = Math.max(0, score - solo.lastScore);
  const output = Math.min(rules.outputCapPercent.cooling, Math.floor((points * 100) / Math.max(1, par)));
  const heat = heatAfterTurn(rules, solo.heat, 0, output);
  return { heat, lastScore: score, row: heatRowsFor(heat, board) };
}

/** How many of the lone ship's turns are due `elapsedMs` into the round. */
export function soloHeatTurnsDue(rules: Pick<ShipRules, "turnSeconds">, elapsedMs: number): number {
  return Math.max(0, Math.floor(elapsedMs / (rules.turnSeconds * 1000)));
}
