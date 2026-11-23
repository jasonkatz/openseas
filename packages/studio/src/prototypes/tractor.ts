import { TRACTOR_DEF, type TractorConfig, type TractorMove, type TractorState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { TRACTOR_PRESETS } from "../scenario/prototypes/tractor.js";

/** What the studio needs to know about Tractor: its content config and its starting points. */
export const TRACTOR: StudioPuzzle<TractorState, TractorMove, TractorConfig> = {
  id: "tractor",
  def: TRACTOR_DEF,
  config: content.puzzles.tractor.config,
  roundSeconds: content.puzzles.tractor.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.tractor,
  presets: TRACTOR_PRESETS,
  locked: [],
  ticked: null,
};
