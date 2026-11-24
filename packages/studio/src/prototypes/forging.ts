import { FORGING_DEF, type ForgingConfig, type ForgingMove, type ForgingState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { FORGING_PRESETS } from "../scenario/prototypes/forging.js";

/** What the studio needs to know about Forging: its content config and its starting points. */
export const FORGING: StudioPuzzle<ForgingState, ForgingMove, ForgingConfig> = {
  id: "forging",
  def: FORGING_DEF,
  config: content.puzzles.forging.config,
  roundSeconds: content.puzzles.forging.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.forging,
  presets: FORGING_PRESETS,
  locked: [],
  ticked: null,
};
