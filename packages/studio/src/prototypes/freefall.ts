import { FREEFALL_DEF, type FreefallConfig, type FreefallMove, type FreefallState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { FREEFALL_PRESETS } from "../scenario/prototypes/freefall.js";

/** What the studio needs to know about Freefall: its content config and its starting points. */
export const FREEFALL: StudioPuzzle<FreefallState, FreefallMove, FreefallConfig> = {
  id: "freefall",
  def: FREEFALL_DEF,
  config: content.puzzles.freefall.config,
  roundSeconds: content.puzzles.freefall.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.freefall,
  presets: FREEFALL_PRESETS,
  locked: [],
  ticked: null,
};
