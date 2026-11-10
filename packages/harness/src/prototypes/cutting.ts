import { CUTTING_DEF, type CuttingConfig, type CuttingMove, type CuttingState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { CUTTING_PRESETS } from "../scenario/prototypes/cutting.js";

/** What the bench needs to know about Cutting: its content config, presets and seed probes. */
export const CUTTING: HarnessPuzzle<CuttingState, CuttingMove, CuttingConfig> = {
  id: "cutting",
  def: CUTTING_DEF,
  config: content.puzzles.cutting.config,
  roundSeconds: content.puzzles.cutting.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.cutting,
  presets: CUTTING_PRESETS,
  probes: [],
  locked: [],
  ticked: null,
  hints: false,
};
