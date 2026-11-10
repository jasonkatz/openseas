import { OVERLOAD_DEF, type OverloadConfig, type OverloadMove, type OverloadState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { OVERLOAD_PRESETS } from "../scenario/prototypes/overload.js";

/** What the bench needs to know about Overload: its content config, presets and seed probes. */
export const OVERLOAD: HarnessPuzzle<OverloadState, OverloadMove, OverloadConfig> = {
  id: "overload",
  def: OVERLOAD_DEF,
  config: content.puzzles.overload.config,
  roundSeconds: content.puzzles.overload.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.overload,
  presets: OVERLOAD_PRESETS,
  probes: [],
  locked: [],
  ticked: null,
  hints: false,
};
