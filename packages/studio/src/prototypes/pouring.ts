import { POURING_DEF, type PouringConfig, type PouringMove, type PouringState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { POURING_PRESETS } from "../scenario/prototypes/pouring.js";

/** What the studio needs to know about Pouring: its content config and its starting points. */
export const POURING: StudioPuzzle<PouringState, PouringMove, PouringConfig> = {
  id: "pouring",
  def: POURING_DEF,
  config: content.puzzles.pouring.config,
  roundSeconds: content.puzzles.pouring.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.pouring,
  presets: POURING_PRESETS,
  locked: [],
  ticked: null,
};
