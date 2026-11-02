import {
  BILGING_DEF,
  CARPENTRY_DEF,
  GUNNERY_DEF,
  NAVIGATION_DEF,
  SAILING_DEF,
  Special,
  navigationShapeOf,
  type BilgingConfig,
  type BilgingMove,
  type BilgingState,
  type CarpentryConfig,
  type CarpentryMove,
  type CarpentryState,
  type GunneryConfig,
  type GunneryMove,
  type GunneryState,
  type NavigationConfig,
  type NavigationMove,
  type NavigationState,
  type PuzzleDef,
  type PuzzleId,
  type SailingConfig,
  type SailingMove,
  type SailingState,
} from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { z } from "zod";
import { PRESETS, deckPresets, type Preset } from "./scenario/presets.js";

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
  /** The content config and round length: what the server issues for rated rounds. */
  readonly config: C;
  readonly roundSeconds: number;
  /** The wire schema the server would hold a config to; lab configs are checked against it too. */
  readonly configSchema: z.ZodType;
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

export const BILGING: HarnessPuzzle<BilgingState, BilgingMove, BilgingConfig> = {
  id: "bilging",
  def: BILGING_DEF,
  config: c.bilging.config,
  roundSeconds: c.bilging.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.bilging,
  presets: PRESETS.bilging,
  probes: [
    { id: "keg_on_board", test: (s) => s.cells.some((p) => p.kind === Special.Keg) },
    { id: "ink_on_board", test: (s) => s.cells.some((p) => p.kind === Special.Ink) },
  ],
  locked: [],
  ticked: null,
  hints: true,
};

export const SAILING: HarnessPuzzle<SailingState, SailingMove, SailingConfig> = {
  id: "sailing",
  def: SAILING_DEF,
  config: c.sailing.config,
  roundSeconds: c.sailing.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.sailing,
  presets: PRESETS.sailing,
  probes: [
    { id: "double_first", test: (s) => s.current.a === s.current.b },
    {
      id: "square_platform",
      test: (s) => s.platforms.some((p) => p.cells.length === 4 && new Set(p.cells.map((x) => x.col)).size === 2 && new Set(p.cells.map((x) => x.row)).size === 2),
    },
  ],
  locked: [],
  ticked: null,
  hints: false,
};

export const CARPENTRY: HarnessPuzzle<CarpentryState, CarpentryMove, CarpentryConfig> = {
  id: "carpentry",
  def: CARPENTRY_DEF,
  config: c.carpentry.config,
  roundSeconds: c.carpentry.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.carpentry,
  presets: PRESETS.carpentry,
  probes: [
    { id: "big_hole", test: (s) => s.holes.some((h) => h.cells.length >= 15) },
    { id: "small_hole", test: (s) => s.holes.some((h) => h.cells.length === 5) },
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
  configSchema: PUZZLE_CONFIG_SCHEMAS.gunnery,
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
  configSchema: PUZZLE_CONFIG_SCHEMAS.navigation,
  presets: PRESETS.navigation,
  probes: [
    { id: "comet_first", test: (s) => navigationShapeOf(s.config, s.falling.kind) === 2 },
    { id: "repeat_kind", test: (s) => new Set(s.markers.map((m) => m.kind)).size < s.markers.length },
  ],
  locked: ["tickMs"],
  ticked: { tickMs: c.navigation.config.tickMs },
  hints: true,
};

/** Every puzzle on the bench, erased for generic code (the home page, the review loader). */
export const HARNESS_PUZZLES: Readonly<Record<PuzzleId, HarnessPuzzle<unknown, unknown, unknown>>> = {
  bilging: BILGING as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  sailing: SAILING as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  carpentry: CARPENTRY as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  gunnery: GUNNERY as unknown as HarnessPuzzle<unknown, unknown, unknown>,
  navigation: NAVIGATION as unknown as HarnessPuzzle<unknown, unknown, unknown>,
};
