import { TUG_DEF, type TugConfig, type TugMove, type TugState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { TUG_PRESETS } from "../scenario/prototypes/tug.js";

/** What the bench needs to know about Tug: its content config, presets and seed probes. */
export const TUG: HarnessPuzzle<TugState, TugMove, TugConfig> = {
  id: "tug",
  def: TUG_DEF,
  config: content.puzzles.tug.config,
  roundSeconds: content.puzzles.tug.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.tug,
  presets: TUG_PRESETS,
  probes: [],
  locked: [],
  ticked: null,
  hints: false,
};
