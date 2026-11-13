import {
  BATTLE_DEF,
  COOLING_DEF,
  PLATING_DEF,
  GUNNERY_DEF,
  NAVIGATION_DEF,
  ENGINES_DEF,
  SWORDFIGHT_DEF,
  Special,
  navigationShapeOf,
  type BattleConfig,
  type BattleMove,
  type BattleState,
  type CoolingConfig,
  type CoolingMove,
  type CoolingState,
  type PlatingConfig,
  type PlatingMove,
  type PlatingState,
  type GunneryConfig,
  type GunneryMove,
  type GunneryState,
  type NavigationConfig,
  type NavigationMove,
  type NavigationState,
  type PuzzleDef,
  type PuzzleId,
  type EnginesConfig,
  type EnginesMove,
  type EnginesState,
  type SwordfightConfig,
  type SwordfightMove,
  type SwordfightState,
} from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { z } from "zod";
import { PRESETS, boardPresets, deckPresets, type Preset } from "./scenario/presets.js";
import { SALVAGE } from "./prototypes/salvage.js";
import { OVERLOAD } from "./prototypes/overload.js";
import { DEFLECTORS } from "./prototypes/deflectors.js";
import { REACTOR } from "./prototypes/reactor.js";
import { SCANNER } from "./prototypes/scanner.js";
import { TUG } from "./prototypes/tug.js";
import { RACKS } from "./prototypes/racks.js";
import { CUTTING } from "./prototypes/cutting.js";

/** What the studio needs to know about a puzzle beyond its engine definition. */
export interface HarnessPuzzle<S, M, C> {
  readonly id: PuzzleId;
  readonly def: PuzzleDef<S, M, C>;
  /** The content config and round length: the shipped numbers, which the server deals. */
  readonly config: C;
  readonly roundSeconds: number;
  /** The wire schema the server would hold a config to; a draft is checked against it too, and the tuning panel is built from it. */
  readonly configSchema: z.ZodType;
  readonly presets: readonly Preset[];
  /** Config fields the form keeps read-only because the boards' animation timing is built on them. */
  readonly locked: readonly string[];
  /** Set for engines whose moves carry ticks (ADR 0015). */
  readonly ticked: { readonly tickMs: number } | null;
}

const c = content.puzzles;

export const COOLING: HarnessPuzzle<CoolingState, CoolingMove, CoolingConfig> = {
  id: "cooling",
  def: COOLING_DEF,
  config: c.cooling.config,
  roundSeconds: c.cooling.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.cooling,
  presets: PRESETS.cooling,
  locked: [],
  ticked: null,
};

export const ENGINES: HarnessPuzzle<EnginesState, EnginesMove, EnginesConfig> = {
  id: "engines",
  def: ENGINES_DEF,
  config: c.engines.config,
  roundSeconds: c.engines.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.engines,
  presets: PRESETS.engines,
  locked: [],
  ticked: null,
};

export const PLATING: HarnessPuzzle<PlatingState, PlatingMove, PlatingConfig> = {
  id: "plating",
  def: PLATING_DEF,
  config: c.plating.config,
  roundSeconds: c.plating.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.plating,
  presets: PRESETS.plating,
  locked: [],
  ticked: null,
};

export const GUNNERY: HarnessPuzzle<GunneryState, GunneryMove, GunneryConfig> = {
  id: "gunnery",
  def: GUNNERY_DEF,
  config: c.gunnery.config,
  roundSeconds: c.gunnery.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.gunnery,
  presets: [...deckPresets(c.gunnery.config.decks), ...PRESETS.gunnery],
  locked: ["tickMs"],
  ticked: { tickMs: c.gunnery.config.tickMs },
};

export const NAVIGATION: HarnessPuzzle<NavigationState, NavigationMove, NavigationConfig> = {
  id: "navigation",
  def: NAVIGATION_DEF,
  config: c.navigation.config,
  roundSeconds: c.navigation.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.navigation,
  presets: PRESETS.navigation,
  locked: ["tickMs"],
  ticked: { tickMs: c.navigation.config.tickMs },
};

export const BATTLE: HarnessPuzzle<BattleState, BattleMove, BattleConfig> = {
  id: "battle",
  def: BATTLE_DEF,
  config: c.battle.config,
  roundSeconds: c.battle.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.battle,
  presets: [...PRESETS.battle, ...boardPresets(c.battle.config.boards)],
  locked: [],
  ticked: null,
};

export const SWORDFIGHT: HarnessPuzzle<SwordfightState, SwordfightMove, SwordfightConfig> = {
  id: "swordfight",
  def: SWORDFIGHT_DEF,
  config: c.swordfight.config,
  roundSeconds: c.swordfight.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.swordfight,
  presets: PRESETS.swordfight,
  locked: ["tickMs", "player"],
  ticked: { tickMs: c.swordfight.config.tickMs },
};

/** Every puzzle in the studio, erased for generic code (the frame, the tuning panel). */
export const HARNESS_PUZZLES: Readonly<Record<PuzzleId, HarnessPuzzle<unknown, unknown, unknown>>> = {
  cooling: COOLING as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  engines: ENGINES as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  plating: PLATING as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  gunnery: GUNNERY as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  navigation: NAVIGATION as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  battle: BATTLE as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  swordfight: SWORDFIGHT as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  // Prototype puzzles (ADR 0036): each brings its own entry from prototypes/.
  salvage: SALVAGE as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  overload: OVERLOAD as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  deflectors: DEFLECTORS as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  reactor: REACTOR as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  scanner: SCANNER as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  tug: TUG as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  racks: RACKS as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  cutting: CUTTING as unknown as HarnessPuzzle<unknown, unknown, unknown>,
};
