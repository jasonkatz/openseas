/**
 * A voyage scenario: a ship class, a route leg, a crew at their stations and how well each of them
 * plays, what the captain does about a brigand, and the world's numbers with any overrides. The
 * voyage bench (ADR 0027) sails it through the engine's own ship, battle and swordfight reducers,
 * wired as the server wires them (engine `ship/aboard.ts`).
 *
 * A scenario is held to the server's own checks before it sails, as a lab round is (ADR 0019): the
 * edited world must pass content's schema and cross-checks, and every config the voyage would deal
 * must pass the engine's validators. So a voyage simulated here is one the server could sail.
 *
 * Pure: content comes in as an argument, so tests use `loadContent()` and the page the shared copy.
 */

import { WorldSchema, contentProblems, type BrigandTier, type Content, type RouteLeg, type ShipClass, type ShipRules } from "@openseas/content";
import {
  STATIONS,
  battleConfigAboard,
  brigandSpecFor,
  createShip,
  isStation,
  legPlan,
  shipConfigFor,
  validateBattleConfig,
  validateShipConfig,
  validateSwordfightConfig,
  type BattleConfig,
  type BrigandSpec,
  type CaptainSpec,
  type LegPlan,
  type ShipConfig,
  type Station,
  type SwordAiSpec,
  type SwordfightConfig,
} from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { applyOverrides, getPath, type Overrides } from "../scenario/overrides.js";

/** What the captain does when a brigand hails: fight, run, or let the hail lapse (the ship evades on its own after `hailTurns`). */
export type HailOrder = "engage" | "evade" | "ignore";
export const HAIL_ORDERS: readonly HailOrder[] = ["engage", "evade", "ignore"];

/** Who plots the captain's sea battle: the AI captain, or the tester on the real board. */
export type Wheel = "ai" | "you";

/** A pirate's hand in the boarding melee, as the swordfight engine's AI plays it. */
export type SwordHand = SwordAiSpec;

export interface CrewSpec {
  /** Display only; empty shows "Pirate n". */
  readonly name: string;
  readonly station: Station | null;
  /** Percent of par the pirate's board earns in an average turn at their station. */
  readonly duty: number;
  /** How far a turn strays from that average, either way, in percent of par. */
  readonly spread: number;
  readonly sword: SwordHand;
}

export type ScriptAction = "away" | "back" | "leave" | "station";
export const SCRIPT_ACTIONS: readonly ScriptAction[] = ["away", "back", "leave", "station"];

/** Something a pirate does before the ship's turn `turn`: drop, come back, go ashore, or change station. */
export interface ScriptStep {
  readonly turn: number;
  /** Index into the crew. */
  readonly who: number;
  readonly action: ScriptAction;
  /** For `station`: where to, or null to stand down. */
  readonly station: Station | null;
}

export interface VoyageScenario {
  readonly seed: string;
  readonly shipClassId: string;
  readonly routeId: string;
  readonly hail: HailOrder;
  readonly wheel: Wheel;
  /** The AI captain's knobs, as a brigand tier's, in percent. */
  readonly captain: CaptainSpec;
  /** The pirates aboard, in boarding order: the first is the captain. Deckhands sign on by themselves. */
  readonly crew: readonly CrewSpec[];
  readonly script: readonly ScriptStep[];
  /** Dotted-path overrides into the voyage's world (`rules.pumpPerTurn`, `route.encounterChance`, `tiers.reaver.accuracy`). */
  readonly world: Overrides;
  /** How many voyages a batch sails. */
  readonly runs: number;
}

/** The parts of the world a voyage reads, as one object the overrides address. */
export interface VoyageWorld {
  readonly rules: ShipRules;
  readonly ship: ShipClass;
  readonly route: RouteLeg;
  readonly tiers: Readonly<Record<string, BrigandTier>>;
}

export const SWORD_HANDS: Readonly<Record<"green" | "able" | "deadly", SwordHand>> = {
  green: { thinkTicks: 20, skill: 30, blade: 0 },
  able: { thinkTicks: 14, skill: 60, blade: 0 },
  deadly: { thinkTicks: 9, skill: 90, blade: 0 },
};

/** Duty presets, percent of par: what a pirate of that standing makes of a board, give or take. */
export const DUTY_PRESETS: ReadonlyArray<{ readonly id: string; readonly duty: number; readonly spread: number }> = [
  { id: "idle", duty: 0, spread: 0 },
  { id: "green", duty: 45, spread: 20 },
  { id: "steady", duty: 100, spread: 15 },
  { id: "sharp", duty: 135, spread: 15 },
  { id: "legend", duty: 180, spread: 10 },
];

export const MAX_RUNS = 500;

export function defaultCrew(): CrewSpec[] {
  return [
    { name: "", station: "navigation", duty: 100, spread: 15, sword: SWORD_HANDS.able },
    { name: "", station: "sailing", duty: 100, spread: 15, sword: SWORD_HANDS.able },
    { name: "", station: "gunnery", duty: 100, spread: 15, sword: SWORD_HANDS.able },
  ];
}

export function defaultScenario(content: Content): VoyageScenario {
  const route = content.world.routes.find((r) => r.from === content.world.startIslandId) ?? content.world.routes[0]!;
  return {
    seed: "voyage-1",
    shipClassId: content.world.shipClasses[0]!.id,
    routeId: route.id,
    hail: "engage",
    wheel: "ai",
    captain: { accuracy: 70, aggression: 60 },
    crew: defaultCrew(),
    script: [],
    world: {},
    runs: 50,
  };
}

/** The world as content has it for this ship and route, before overrides. */
export function baseWorld(content: Content, shipClassId: string, routeId: string): VoyageWorld | null {
  const ship = content.world.shipClasses.find((c) => c.id === shipClassId);
  const route = content.world.routes.find((r) => r.id === routeId);
  if (!ship || !route) return null;
  return { rules: content.world.ship, ship, route, tiers: Object.fromEntries(content.world.brigandTiers.map((t) => [t.id, t])) };
}

/** A tier as the voyage deals it: the battle's brigand, the purse, and the hand at the rail. */
export interface TierSetup {
  readonly id: string;
  readonly nameKey: string;
  readonly brigand: BrigandSpec;
  readonly booty: number;
  readonly swordsmen: SwordHand;
}

export interface CrewSetup extends CrewSpec {
  readonly pirateId: string;
}

/** A scenario resolved into what the engines take. */
export interface VoyageSetup {
  readonly seed: string;
  readonly islandId: string;
  readonly leg: LegPlan;
  readonly ship: ShipConfig;
  /** Content's battle rules; each fight's config is this aboard the ship as it is at the hail. */
  readonly battleBase: BattleConfig;
  /** Content's swordfight rules; the melee is these with the crew and the tier's hands. */
  readonly swordBase: SwordfightConfig;
  readonly tiers: Readonly<Record<string, TierSetup>>;
  readonly crew: readonly CrewSetup[];
  readonly script: readonly ScriptStep[];
  readonly hail: HailOrder;
  readonly wheel: Wheel;
  readonly captain: CaptainSpec;
  /** A voyage that has not reached port after this many turns is called adrift. */
  readonly maxTurns: number;
}

export type Resolved = { readonly ok: true; readonly setup: VoyageSetup; readonly world: VoyageWorld } | { readonly ok: false; readonly errors: readonly string[] };

const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

/** The crew's melee config: every pirate's hand against as many of the tier's swordsmen, at most eight a side. */
export function meleeConfig(base: SwordfightConfig, hands: readonly SwordHand[], tier: SwordHand): SwordfightConfig {
  const n = Math.min(8, hands.length);
  return { ...base, player: false, blade: 0, allies: hands.slice(0, n).map((h) => ({ ...h })), foes: Array.from({ length: n }, () => ({ ...tier })) };
}

/**
 * Resolve and check a scenario. The checks are the server's: content's schema and cross-checks on
 * the edited world, the engine's validators on the ship, every battle the leg could deal and the
 * melee, plus the bench's own on the crew and the script.
 */
export function resolveScenario(content: Content, sc: VoyageScenario): Resolved {
  const errors: string[] = [];
  const base = baseWorld(content, sc.shipClassId, sc.routeId);
  if (!base) return { ok: false, errors: [`unknown ship class or route: ${sc.shipClassId}, ${sc.routeId}`] };
  for (const path of Object.keys(sc.world)) if (getPath(base, path) === undefined) errors.push(`${path}: no such field`);
  const edited = applyOverrides(base, sc.world);

  // The world as the server would load it with these edits, held to content's own checks.
  const world = {
    ...content.world,
    ship: edited.rules,
    shipClasses: content.world.shipClasses.map((c) => (c.id === sc.shipClassId ? edited.ship : c)),
    routes: content.world.routes.map((r) => (r.id === sc.routeId ? edited.route : r)),
    brigandTiers: content.world.brigandTiers.map((t) => edited.tiers[t.id] ?? t),
  };
  const parsed = WorldSchema.safeParse(world);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".") || "world"}: ${issue.message}`);
    return { ok: false, errors };
  }
  errors.push(...contentProblems({ ...content, world: parsed.data }));
  const w: VoyageWorld = {
    rules: parsed.data.ship,
    ship: parsed.data.shipClasses.find((c) => c.id === sc.shipClassId)!,
    route: parsed.data.routes.find((r) => r.id === sc.routeId)!,
    tiers: Object.fromEntries(parsed.data.brigandTiers.map((t) => [t.id, t])),
  };

  let ship: ShipConfig | null = null;
  try {
    ship = shipConfigFor(w.ship, w.rules, content.puzzles);
    validateShipConfig(ship);
  } catch (e) {
    errors.push(`ship: ${e instanceof Error ? e.message : String(e)}`);
  }

  // The crew.
  const blades = content.puzzles.swordfight.config.blades.length;
  if (sc.crew.length < 1) errors.push("crew: at least one pirate must sail");
  if (sc.crew.length > w.ship.maxCrew) errors.push(`crew: a ${w.ship.id} takes at most ${w.ship.maxCrew}`);
  const taken = new Set<Station>();
  sc.crew.forEach((c, i) => {
    const where = `crew ${i + 1}`;
    if (c.station !== null) {
      if (!isStation(c.station) || !w.ship.stations.includes(c.station)) errors.push(`${where}: no ${String(c.station)} station aboard`);
      else if (taken.has(c.station)) errors.push(`${where}: ${c.station} is already taken`);
      else taken.add(c.station);
    }
    if (!isInt(c.duty, 0, 1000)) errors.push(`${where}: duty must be a whole percent from 0 to 1000`);
    if (!isInt(c.spread, 0, 200)) errors.push(`${where}: spread must be a whole percent from 0 to 200`);
    if (!isInt(c.sword.skill, 0, 100)) errors.push(`${where}: sword skill must be 0 to 100`);
    if (!isInt(c.sword.thinkTicks, 1, 10_000)) errors.push(`${where}: sword speed must be 1 to 10000 ticks`);
    if (!isInt(c.sword.blade, 0, blades - 1)) errors.push(`${where}: no such blade`);
  });
  sc.script.forEach((s, i) => {
    const where = `script ${i + 1}`;
    if (!isInt(s.turn, 1, 100_000)) errors.push(`${where}: turn must be 1 or later`);
    if (!isInt(s.who, 0, sc.crew.length - 1)) errors.push(`${where}: no such pirate`);
    if (!SCRIPT_ACTIONS.includes(s.action)) errors.push(`${where}: unknown action`);
    if (s.action === "station" && s.station !== null && !isStation(s.station)) errors.push(`${where}: no such station`);
  });
  if (!isInt(sc.captain.accuracy, 0, 100) || !isInt(sc.captain.aggression, 0, 100)) errors.push("captain: accuracy and aggression are percents");
  if (!HAIL_ORDERS.includes(sc.hail)) errors.push("hail: unknown order");
  if (sc.wheel !== "ai" && sc.wheel !== "you") errors.push("wheel: ai or you");
  if (!isInt(sc.runs, 1, MAX_RUNS)) errors.push(`runs: 1 to ${MAX_RUNS}`);
  if (typeof sc.seed !== "string" || sc.seed.length === 0) errors.push("seed: required");

  // Every tier the leg can deal, as the battle and the melee would deal it.
  const tiers: Record<string, TierSetup> = {};
  for (const t of Object.values(w.tiers)) {
    const cls = parsed.data.shipClasses.find((c) => c.id === t.shipClassId);
    tiers[t.id] = { id: t.id, nameKey: t.nameKey, brigand: brigandSpecFor(t, cls?.cannons ?? 0), booty: t.booty, swordsmen: { ...t.swordsmen } };
  }
  if (ship && errors.length === 0) {
    const fresh = createShip(sc.seed, ship, w.route.from);
    for (const b of w.route.brigands) {
      const tier = tiers[b.tierId]!;
      const cfg = battleConfigAboard(content.puzzles.battle.config, fresh, tier.brigand);
      const wire = PUZZLE_CONFIG_SCHEMAS.battle.safeParse(cfg);
      if (!wire.success) for (const issue of wire.error.issues) errors.push(`battle against ${tier.id}: ${issue.path.join(".")}: ${issue.message}`);
      try {
        validateBattleConfig(cfg);
      } catch (e) {
        errors.push(`battle against ${tier.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        validateSwordfightConfig(meleeConfig(content.puzzles.swordfight.config, sc.crew.map((c) => c.sword), tier.swordsmen));
      } catch (e) {
        errors.push(`melee against ${tier.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (errors.length || !ship) return { ok: false, errors };

  return {
    ok: true,
    world: w,
    setup: {
      seed: sc.seed,
      islandId: w.route.from,
      leg: legPlan(w.route),
      ship,
      battleBase: content.puzzles.battle.config,
      swordBase: content.puzzles.swordfight.config,
      tiers,
      crew: sc.crew.map((c, i) => ({ ...c, pirateId: `p${i + 1}` })),
      script: [...sc.script].sort((a, b) => a.turn - b.turn),
      hail: sc.hail,
      wheel: sc.wheel,
      captain: { ...sc.captain },
      maxTurns: 1000,
    },
  };
}

/** Stations a pirate may be put at on this class, in the engine's order. */
export function stationsOf(world: VoyageWorld): Station[] {
  return STATIONS.filter((s) => world.ship.stations.includes(s));
}
