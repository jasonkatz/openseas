import { RACKS_DEF, racksCrateFits, racksTopGroup, type RacksConfig, type RacksMove, type RacksState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { RACKS_PRESETS } from "../scenario/prototypes/racks.js";

/** What the studio needs to know about Racks: its content config and its starting points. */
export const RACKS: HarnessPuzzle<RacksState, RacksMove, RacksConfig> = {
  id: "racks",
  def: RACKS_DEF,
  config: content.puzzles.racks.config,
  roundSeconds: content.puzzles.racks.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.racks,
  presets: RACKS_PRESETS,
  locked: [],
  ticked: null,
};
