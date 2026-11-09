/**
 * The ship: a crew at stations, a heat, a hull, and a voyage along one lane leg. The server
 * runs this reducer on a fixed turn clock (DESIGN.md 3.4); the client only renders snapshots.
 *
 * Every quantity is an integer so a replay is bit-identical everywhere (ADR 0003):
 * - heat and damage are in permille of a full heat and a wrecked hull;
 * - speed is in permille of the class's full speed;
 * - voyage progress is in units where a leg of `durationSeconds` is `durationSeconds * 1000`
 *   long and a turn at full speed covers `turnSeconds * 1000`, so a leg at full speed takes
 *   exactly its nominal time;
 * - a station's output for a turn is a percentage of par, the points a steady player makes in
 *   one turn, clamped to that station's `outputCapPercent`.
 *
 * Time is data: the server applies a `turn` move every `turnSeconds`. Nothing here reads a clock.
 */

import type { PrngState } from "../prng.js";

export const STATIONS = ["cooling", "engines", "plating", "gunnery", "navigation"] as const;
export type Station = (typeof STATIONS)[number];

export function isStation(x: unknown): x is Station {
  return typeof x === "string" && (STATIONS as readonly string[]).includes(x);
}

/** Progress units per second of nominal flying. A leg of n seconds is n * UNITS_PER_SECOND long. */
export const UNITS_PER_SECOND = 1000;

/** What the engine needs to know about a ship class; the server fills it from content. */
export interface ShipClassSpec {
  readonly id: string;
  readonly stations: readonly Station[];
  readonly maxCrew: number;
  /**
   * The crew the ship flies with at the least. Launching with fewer aboard boots up bots
   * (AI crew, DESIGN.md 3.4) to make up the number; they disembark when the ship docks.
   */
  readonly minCrew: number;
  /** The stations a bot works, in order of preference, by itself or by order. Never the nav console. */
  readonly botStations: readonly Station[];
  readonly turrets: number;
  /** Movement tokens per space battle turn at full flying output (M4). */
  readonly baseTokens: number;
}

/** Tuning for the simulation. Lives in content (`world/star-system.json`) and is tuned in playtests. */
export interface ShipRules {
  /** Seconds per turn. Only used to size a turn's progress; the server owns the clock. */
  readonly turnSeconds: number;
  /** Heat taken on per turn in flight, permille of a full heat. */
  readonly heatIntakePerTurn: number;
  /** Extra heat per turn at full hull damage, permille; scales linearly with damage. */
  readonly heatIntakeAtFullDamage: number;
  /** Heat vented out per turn at 100% cooling output, permille. */
  readonly ventPerTurn: number;
  /** Hull wear per turn in flight, permille. Zero in the original; v1 gives Plating work before combat. */
  readonly wearPerTurn: number;
  /** Hull repaired per turn at 100% plating output, permille. */
  readonly repairPerTurn: number;
  /** Speed with nobody flying, permille of full. */
  readonly idleSpeed: number;
  /** Speed added at 100% flying output, permille. */
  readonly driveSpeed: number;
  /** Speed added at 100% navigation output, permille. */
  readonly navSpeed: number;
  /** Speed is capped here, permille, before heat and damage slow it. */
  readonly maxSpeed: number;
  /** Speed lost with a full heat, permille; scales linearly with heat. */
  readonly heatSlow: number;
  /** Speed lost with a wrecked hull, permille; scales linearly with damage. */
  readonly damageSlow: number;
  /** Turrets loaded per turn at 100% gunnery output, in permille of one turret. */
  readonly loadPerTurn: number;
  /** Extra movement tokens per turn at 100% navigation output (M4). */
  readonly navTokens: number;
  /**
   * Each station's output for a turn is clamped to its own percentage of par, set so ordinary
   * bursts reach the ship whole and only a rare turn is cut short (ADR 0030). Puzzles that score in
   * lumps (a patched hole, a charted constellation) need more room than ones that score steadily.
   */
  readonly outputCapPercent: Readonly<Record<Station, number>>;
  /** Turns a dropped pirate's seat is held before they are put on the outpost. */
  readonly graceTurns: number;
  /** Turns the captain has to answer a raider's hail before the ship evades on its own. */
  readonly hailTurns: number;
  /** Where along a leg an encounter may happen, permille of its length. */
  readonly encounterWindow: { readonly from: number; readonly to: number };
  /**
   * A bot's output each turn, as a percentage of par: a passable job, rolled between these
   * from the ship's PRNG. No board is played; the number is the whole of a bot's work.
   */
  readonly botOutput: { readonly min: number; readonly max: number };
  /** Turns a bot relieved by a pirate waits before working another station, so the pirate settles in first. */
  readonly botRestTurns: number;
}

export const DEFAULT_SHIP_RULES: ShipRules = {
  turnSeconds: 10,
  heatIntakePerTurn: 25,
  heatIntakeAtFullDamage: 60,
  ventPerTurn: 70,
  wearPerTurn: 8,
  repairPerTurn: 40,
  idleSpeed: 350,
  driveSpeed: 650,
  navSpeed: 150,
  maxSpeed: 1150,
  heatSlow: 600,
  damageSlow: 500,
  loadPerTurn: 500,
  navTokens: 2,
  outputCapPercent: { cooling: 1000, engines: 350, plating: 1000, gunnery: 650, navigation: 1000 },
  graceTurns: 12,
  hailTurns: 3,
  encounterWindow: { from: 250, to: 800 },
  botOutput: { min: 55, max: 85 },
  botRestTurns: 3,
};

export interface ShipConfig {
  readonly shipClass: ShipClassSpec;
  readonly rules: ShipRules;
  /** Points per turn that count as 100% output, per station. Derived from puzzle content. */
  readonly par: Readonly<Record<Station, number>>;
}

export interface CrewMember {
  /** A pirate's id, or `bot:<seq>` for a bot: ids the engine mints, never a pirate's. */
  readonly pirateId: string;
  readonly station: Station | null;
  /** Boarding order, for "longest aboard". Never reused within a ship's life. */
  readonly boardedSeq: number;
  /** The turn the pirate dropped, or null while connected. Their seat is held for `graceTurns`. */
  readonly awaySinceTurn: number | null;
  /**
   * A bot: AI crew booted up when the ship flew short-handed (DESIGN.md 3.4). Never the
   * captain, never away, never on a board; a pirate may take its station at any time.
   */
  readonly bot: boolean;
  /** A bot off its station: the turn from which it looks for another. Null otherwise. */
  readonly idleFromTurn: number | null;
}

/** A lane leg as the server reads it from content, plus the roll inputs the engine needs. */
export interface LegPlan {
  readonly laneId: string;
  readonly from: string;
  readonly to: string;
  readonly lengthUnits: number;
  readonly encounterChancePercent: number;
  readonly raiders: ReadonlyArray<{ readonly tierId: string; readonly weight: number }>;
}

export interface Encounter {
  readonly tierId: string;
  /** Progress at which the raider hails the ship. */
  readonly atUnits: number;
  readonly resolved: boolean;
}

export interface Voyage {
  readonly leg: LegPlan;
  readonly progress: number;
  readonly startedTurn: number;
  /** Rolled when the voyage starts; null when the leg is clear. */
  readonly encounter: Encounter | null;
  /** A raider waiting for the captain's answer. */
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
  /** Hand the helm to someone aboard. The server checks the caller is the captain. */
  | { readonly type: "helm"; readonly pirateId: string }
  /**
   * Order a bot to one of the stations it works (`botStations`, never the nav console), or
   * stand it down with null. The server checks the caller is the captain. A pirate at the station
   * is never displaced; another bot steps aside.
   */
  | { readonly type: "assign"; readonly pirateId: string; readonly station: Station | null }
  | { readonly type: "lock"; readonly inviteOnly: boolean }
  | { readonly type: "launch"; readonly leg: LegPlan }
  /** Points a station's board earned since its last report. Consumed by the next turn. */
  | { readonly type: "duty"; readonly station: Station; readonly points: number }
  | { readonly type: "turn" }
  | { readonly type: "evade" }
  /** Fight the raider that hailed. The captain's battle board is dealt by the server. */
  | { readonly type: "engage" }
  /** The battle board reports hull damage taken this turn, permille. */
  | { readonly type: "hit"; readonly damage: number }
  /** The battle board reports turrets fired this turn. */
  | { readonly type: "fired"; readonly shots: number }
  /** The fight is over. `plunder` is the purse on a win, in credits; the voyage resumes. */
  | { readonly type: "battle_end"; readonly outcome: ShipBattleOutcome; readonly plunder: number; readonly turns: number }
  /** A crew member's connection dropped; their seat is held for a grace period. */
  | { readonly type: "away"; readonly pirateId: string }
  | { readonly type: "back"; readonly pirateId: string };

export type ShipEvent =
  | { readonly type: "boarded"; readonly pirateId: string }
  | { readonly type: "left"; readonly pirateId: string; readonly reason: "left" | "timed_out" }
  /** A bot booted up as the ship flew, at a station or waiting for one. */
  | { readonly type: "booted_up"; readonly pirateId: string; readonly station: Station | null }
  /** Bots disembarked: the ship docked, emptied of pirates, or needed the berth. */
  | { readonly type: "powered_down"; readonly pirateIds: readonly string[] }
  | { readonly type: "station"; readonly pirateId: string; readonly station: Station | null }
  | { readonly type: "helm"; readonly pirateId: string }
  | { readonly type: "launched"; readonly laneId: string }
  | { readonly type: "hailed"; readonly tierId: string }
  | { readonly type: "evaded"; readonly tierId: string; readonly auto: boolean }
  | { readonly type: "engaged"; readonly tierId: string }
  | { readonly type: "battle_ended"; readonly tierId: string; readonly outcome: ShipBattleOutcome; readonly plunder: number; readonly turns: number }
  /** A boarding opened the melee at the airlock (M5). The server says so; the reducer never does. */
  | { readonly type: "boarding"; readonly tierId: string }
  | { readonly type: "arrived"; readonly outpostId: string; readonly turns: number }
  /** Nobody left aboard in flight: the ship is back at the outpost it left. */
  | { readonly type: "abandoned"; readonly outpostId: string };

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
  /** Docked here, or null in flight. Exactly one of `outpostId` and `voyage` is set. */
  readonly outpostId: string | null;
  readonly voyage: Voyage | null;
  /** Permille of a full heat. */
  readonly heat: number;
  /** Permille of a wrecked hull. */
  readonly damage: number;
  /** Turrets loaded, and progress toward the next in permille. */
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
