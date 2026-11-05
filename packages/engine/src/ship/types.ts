/**
 * The ship: a crew at stations, a bilge, a hull, and a voyage along one route leg. The server
 * runs this reducer on a fixed turn clock (DESIGN.md 3.4); the client only renders snapshots.
 *
 * Every quantity is an integer so a replay is bit-identical everywhere (ADR 0003):
 * - water and damage are in permille of a full bilge and a wrecked hull;
 * - speed is in permille of the class's full speed;
 * - voyage progress is in units where a leg of `durationSeconds` is `durationSeconds * 1000`
 *   long and a turn at full speed covers `turnSeconds * 1000`, so a leg at full speed takes
 *   exactly its nominal time;
 * - a station's output for a turn is a percentage of par, the points a steady player makes in
 *   one turn, clamped to `maxOutputPercent`.
 *
 * Time is data: the server applies a `turn` move every `turnSeconds`. Nothing here reads a clock.
 */

import type { PrngState } from "../prng.js";

export const STATIONS = ["bilging", "sailing", "carpentry", "gunnery", "navigation"] as const;
export type Station = (typeof STATIONS)[number];

export function isStation(x: unknown): x is Station {
  return typeof x === "string" && (STATIONS as readonly string[]).includes(x);
}

/** Progress units per second of nominal sailing. A leg of n seconds is n * UNITS_PER_SECOND long. */
export const UNITS_PER_SECOND = 1000;

/** What the engine needs to know about a ship class; the server fills it from content. */
export interface ShipClassSpec {
  readonly id: string;
  readonly stations: readonly Station[];
  readonly maxCrew: number;
  readonly cannons: number;
  /** Movement tokens per sea battle turn at full sailing output (M4). */
  readonly baseTokens: number;
}

/** Tuning for the simulation. Lives in content (`world/ocean.json`) and is tuned in playtests. */
export interface ShipRules {
  /** Seconds per turn. Only used to size a turn's progress; the server owns the clock. */
  readonly turnSeconds: number;
  /** Water taken on per turn at sea, permille of a full bilge. */
  readonly waterIntakePerTurn: number;
  /** Extra water per turn at full hull damage, permille; scales linearly with damage. */
  readonly waterIntakeAtFullDamage: number;
  /** Water pumped out per turn at 100% bilging output, permille. */
  readonly pumpPerTurn: number;
  /** Hull wear per turn at sea, permille. Zero in the original; v1 gives Carpentry work before combat. */
  readonly wearPerTurn: number;
  /** Hull repaired per turn at 100% carpentry output, permille. */
  readonly repairPerTurn: number;
  /** Speed with nobody sailing, permille of full. */
  readonly idleSpeed: number;
  /** Speed added at 100% sailing output, permille. */
  readonly sailSpeed: number;
  /** Speed added at 100% navigation output, permille. */
  readonly navSpeed: number;
  /** Speed is capped here, permille, before water and damage slow it. */
  readonly maxSpeed: number;
  /** Speed lost with a full bilge, permille; scales linearly with water. */
  readonly waterSlow: number;
  /** Speed lost with a wrecked hull, permille; scales linearly with damage. */
  readonly damageSlow: number;
  /** Cannons loaded per turn at 100% gunnery output, in permille of one cannon. */
  readonly loadPerTurn: number;
  /** Extra movement tokens per turn at 100% navigation output (M4). */
  readonly navTokens: number;
  /** A station's output is clamped to this percentage of par. */
  readonly maxOutputPercent: number;
  /** Turns a dropped pirate's seat is held before they are put ashore. */
  readonly graceTurns: number;
  /** Turns the captain has to answer a brigand's hail before the ship evades on its own. */
  readonly hailTurns: number;
  /** Where along a leg an encounter may happen, permille of its length. */
  readonly encounterWindow: { readonly from: number; readonly to: number };
}

export const DEFAULT_SHIP_RULES: ShipRules = {
  turnSeconds: 10,
  waterIntakePerTurn: 25,
  waterIntakeAtFullDamage: 60,
  pumpPerTurn: 70,
  wearPerTurn: 8,
  repairPerTurn: 40,
  idleSpeed: 350,
  sailSpeed: 650,
  navSpeed: 150,
  maxSpeed: 1150,
  waterSlow: 600,
  damageSlow: 500,
  loadPerTurn: 500,
  navTokens: 2,
  maxOutputPercent: 200,
  graceTurns: 12,
  hailTurns: 3,
  encounterWindow: { from: 250, to: 800 },
};

export interface ShipConfig {
  readonly shipClass: ShipClassSpec;
  readonly rules: ShipRules;
  /** Points per turn that count as 100% output, per station. Derived from puzzle content. */
  readonly par: Readonly<Record<Station, number>>;
}

export interface CrewMember {
  readonly pirateId: string;
  readonly station: Station | null;
  /** Boarding order, for "longest aboard". Never reused within a ship's life. */
  readonly boardedSeq: number;
  /** The turn the pirate dropped, or null while connected. Their seat is held for `graceTurns`. */
  readonly awaySinceTurn: number | null;
}

/** A route leg as the server reads it from content, plus the roll inputs the engine needs. */
export interface LegPlan {
  readonly routeId: string;
  readonly from: string;
  readonly to: string;
  readonly lengthUnits: number;
  readonly encounterChancePercent: number;
  readonly brigands: ReadonlyArray<{ readonly tierId: string; readonly weight: number }>;
}

export interface Encounter {
  readonly tierId: string;
  /** Progress at which the brigand hails the ship. */
  readonly atUnits: number;
  readonly resolved: boolean;
}

export interface Voyage {
  readonly leg: LegPlan;
  readonly progress: number;
  readonly startedTurn: number;
  /** Rolled when the voyage starts; null when the leg is clear. */
  readonly encounter: Encounter | null;
  /** A brigand waiting for the captain's answer. */
  readonly hail: { readonly tierId: string; readonly sinceTurn: number } | null;
  /** The fight under way: the ship holds position until it ends (M4). */
  readonly battle: { readonly tierId: string; readonly sinceTurn: number } | null;
}

/** How a fight ended, from the captain's side; the battle engine's outcome. */
export type ShipBattleOutcome = "boarded" | "crippled" | "boarded_by" | "crippled_by" | "broke_off" | "disengaged";

export type ShipMove =
  | { readonly type: "board"; readonly pirateId: string }
  | { readonly type: "leave"; readonly pirateId: string }
  /** Take a station, or null to stand down. */
  | { readonly type: "station"; readonly pirateId: string; readonly station: Station | null }
  /** Hand the wheel to someone aboard. The server checks the caller is the captain. */
  | { readonly type: "wheel"; readonly pirateId: string }
  | { readonly type: "lock"; readonly inviteOnly: boolean }
  | { readonly type: "sail"; readonly leg: LegPlan }
  /** Points a station's board earned since its last report. Consumed by the next turn. */
  | { readonly type: "duty"; readonly station: Station; readonly points: number }
  | { readonly type: "turn" }
  | { readonly type: "evade" }
  /** Fight the brigand that hailed. The captain's battle board is dealt by the server. */
  | { readonly type: "engage" }
  /** The battle board reports hull damage taken this turn, permille. */
  | { readonly type: "hit"; readonly damage: number }
  /** The battle board reports cannons fired this turn. */
  | { readonly type: "fired"; readonly shots: number }
  /** The fight is over. `booty` is the purse on a win, in coins; the voyage resumes. */
  | { readonly type: "battle_end"; readonly outcome: ShipBattleOutcome; readonly booty: number; readonly turns: number }
  /** A crew member's connection dropped; their seat is held for a grace period. */
  | { readonly type: "away"; readonly pirateId: string }
  | { readonly type: "back"; readonly pirateId: string };

export type ShipEvent =
  | { readonly type: "boarded"; readonly pirateId: string }
  | { readonly type: "left"; readonly pirateId: string; readonly reason: "left" | "timed_out" }
  | { readonly type: "station"; readonly pirateId: string; readonly station: Station | null }
  | { readonly type: "wheel"; readonly pirateId: string }
  | { readonly type: "sailed"; readonly routeId: string }
  | { readonly type: "hailed"; readonly tierId: string }
  | { readonly type: "evaded"; readonly tierId: string; readonly auto: boolean }
  | { readonly type: "engaged"; readonly tierId: string }
  | { readonly type: "battle_ended"; readonly tierId: string; readonly outcome: ShipBattleOutcome; readonly booty: number; readonly turns: number }
  /** A boarding opened the melee at the rail (M5). The server says so; the reducer never does. */
  | { readonly type: "boarding"; readonly tierId: string }
  | { readonly type: "arrived"; readonly islandId: string; readonly turns: number }
  /** Nobody left aboard at sea: the ship is back at the island it left. */
  | { readonly type: "abandoned"; readonly islandId: string };

/** What one turn did, for the HUD and the voyage log. */
export interface TurnReport {
  readonly turn: number;
  /** Each station's output this turn, percent of par; 0 when unstaffed or the ship was held. */
  readonly outputs: Readonly<Record<Station, number>>;
  /** True when the captain was away and the ship held position. */
  readonly held: boolean;
  readonly speed: number;
  readonly advanced: number;
  readonly tokens: number;
}

export interface ShipState {
  readonly config: ShipConfig;
  readonly rng: PrngState;
  readonly turn: number;
  readonly captainId: string | null;
  readonly crew: readonly CrewMember[];
  readonly nextBoardedSeq: number;
  readonly inviteOnly: boolean;
  /** Docked here, or null at sea. Exactly one of `islandId` and `voyage` is set. */
  readonly islandId: string | null;
  readonly voyage: Voyage | null;
  /** Permille of a full bilge. */
  readonly water: number;
  /** Permille of a wrecked hull. */
  readonly damage: number;
  /** Cannons loaded, and progress toward the next in permille. */
  readonly loaded: number;
  readonly loading: number;
  /** Movement tokens the last turn produced (M4). */
  readonly tokens: number;
  /** Points reported per station since the last turn. */
  readonly pending: Readonly<Record<Station, number>>;
  readonly lastTurn: TurnReport | null;
  readonly voyagesCompleted: number;
  /** What the last move did. Replaced on every move. */
  readonly events: readonly ShipEvent[];
}
