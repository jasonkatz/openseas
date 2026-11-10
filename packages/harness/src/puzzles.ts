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
import { content } from "@openseas/boards";
import { PRESETS, boardPresets, deckPresets, type Preset } from "./scenario/presets.js";
import { SALVAGE } from "./prototypes/salvage.js";
import { OVERLOAD } from "./prototypes/overload.js";
import { DEFLECTORS } from "./prototypes/deflectors.js";
import { REACTOR } from "./prototypes/reactor.js";
import { SCANNER } from "./prototypes/scanner.js";
import { TUG } from "./prototypes/tug.js";
import { RACKS } from "./prototypes/racks.js";
import { CUTTING } from "./prototypes/cutting.js";

/** A condition on an opening state the seed finder can search for. Named by `harness.probe.<puzzle>.<id>`. */
export interface SeedProbe<S> {
  readonly id: string;
  readonly vars?: Record<string, string | number>;
  test(state: S): boolean;
}

/** What the bench needs to know about a puzzle beyond its engine definition. */
export interface HarnessPuzzle<S, M, C> {
  readonly id: PuzzleId;
  readonly def: PuzzleDef<S, M, C>;
  /** The content config and round length: what the server issues for recorded rounds. */
  readonly config: C;
  readonly roundSeconds: number;
  readonly presets: readonly Preset[];
  readonly probes: readonly SeedProbe<S>[];
  /** Config fields the form keeps read-only because the boards' animation timing is built on them. */
  readonly locked: readonly string[];
  /** Set for engines whose moves carry ticks (ADR 0015). */
  readonly ticked: { readonly tickMs: number } | null;
  /** Whether the puzzle has idle hints in unrated practice. */
  readonly hints: boolean;
}

const c = content.puzzles;

export const COOLING: HarnessPuzzle<CoolingState, CoolingMove, CoolingConfig> = {
  id: "cooling",
  def: COOLING_DEF,
  config: c.cooling.config,
  roundSeconds: c.cooling.roundSeconds,
  presets: PRESETS.cooling,
  probes: [
    { id: "charge_on_board", test: (s) => s.cells.some((p) => p.kind === Special.Charge) },
    { id: "magnet_on_board", test: (s) => s.cells.some((p) => p.kind === Special.Magnet) },
  ],
  locked: [],
  ticked: null,
  hints: true,
};

export const ENGINES: HarnessPuzzle<EnginesState, EnginesMove, EnginesConfig> = {
  id: "engines",
  def: ENGINES_DEF,
  config: c.engines.config,
  roundSeconds: c.engines.roundSeconds,
  presets: PRESETS.engines,
  probes: [
    { id: "double_first", test: (s) => s.current.a === s.current.b },
    {
      id: "square_injector",
      test: (s) => s.injectors.some((p) => p.cells.length === 4 && new Set(p.cells.map((x) => x.col)).size === 2 && new Set(p.cells.map((x) => x.row)).size === 2),
    },
  ],
  locked: [],
  ticked: null,
  hints: false,
};

export const PLATING: HarnessPuzzle<PlatingState, PlatingMove, PlatingConfig> = {
  id: "plating",
  def: PLATING_DEF,
  config: c.plating.config,
  roundSeconds: c.plating.roundSeconds,
  presets: PRESETS.plating,
  probes: [
    { id: "big_breach", test: (s) => s.breaches.some((h) => h.cells.length >= 15) },
    { id: "small_breach", test: (s) => s.breaches.some((h) => h.cells.length === 5) },
  ],
  locked: [],
  ticked: null,
  hints: false,
};

export const GUNNERY: HarnessPuzzle<GunneryState, GunneryMove, GunneryConfig> = {
  id: "gunnery",
  def: GUNNERY_DEF,
  config: c.gunnery.config,
  roundSeconds: c.gunnery.roundSeconds,
  presets: [...deckPresets(c.gunnery.config.decks), ...PRESETS.gunnery],
  probes: c.gunnery.config.decks.map((_, i) => ({ id: "deck", vars: { n: i + 1 }, test: (s: GunneryState) => s.deckIndex === i })),
  locked: ["tickMs"],
  ticked: { tickMs: c.gunnery.config.tickMs },
  hints: false,
};

export const NAVIGATION: HarnessPuzzle<NavigationState, NavigationMove, NavigationConfig> = {
  id: "navigation",
  def: NAVIGATION_DEF,
  config: c.navigation.config,
  roundSeconds: c.navigation.roundSeconds,
  presets: PRESETS.navigation,
  probes: [
    { id: "comet_first", test: (s) => navigationShapeOf(s.config, s.falling.kind) === 2 },
    { id: "repeat_kind", test: (s) => new Set(s.markers.map((m) => m.kind)).size < s.markers.length },
  ],
  locked: ["tickMs"],
  ticked: { tickMs: c.navigation.config.tickMs },
  hints: true,
};

export const BATTLE: HarnessPuzzle<BattleState, BattleMove, BattleConfig> = {
  id: "battle",
  def: BATTLE_DEF,
  config: c.battle.config,
  roundSeconds: c.battle.roundSeconds,
  presets: [...PRESETS.battle, ...boardPresets(c.battle.config.boards)],
  probes: [
    ...c.battle.config.boards.map((_, i) => ({ id: "board", vars: { n: i + 1 }, test: (s: BattleState) => s.boardIndex === i })),
    { id: "skiff_ahead", test: (s) => s.ships[0].x === s.ships[1].x },
  ],
  locked: [],
  ticked: null,
  hints: false,
};

export const SWORDFIGHT: HarnessPuzzle<SwordfightState, SwordfightMove, SwordfightConfig> = {
  id: "swordfight",
  def: SWORDFIGHT_DEF,
  config: c.swordfight.config,
  roundSeconds: c.swordfight.roundSeconds,
  presets: PRESETS.swordfight,
  probes: [
    { id: "breaker_first", test: (s) => s.boards[0]!.current.a.breaker || s.boards[0]!.current.b.breaker },
    { id: "double_first", test: (s) => s.boards[0]!.current.a.color === s.boards[0]!.current.b.color && !s.boards[0]!.current.a.breaker && !s.boards[0]!.current.b.breaker },
  ],
  locked: ["tickMs", "player"],
  ticked: { tickMs: c.swordfight.config.tickMs },
  hints: false,
};

/** Every puzzle on the bench, erased for generic code (the home page, the review loader). */
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
