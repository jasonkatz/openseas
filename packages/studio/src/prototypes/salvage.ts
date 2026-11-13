import { SALVAGE_CRATE, SALVAGE_DEF, salvageFindLoop, salvageHint, type SalvageConfig, type SalvageMove, type SalvageState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { SALVAGE_PRESETS } from "../scenario/prototypes/salvage.js";

/** What the studio needs to know about Salvage: its content config and its starting points. */
export const SALVAGE: HarnessPuzzle<SalvageState, SalvageMove, SalvageConfig> = {
  id: "salvage",
  def: SALVAGE_DEF,
  config: content.puzzles.salvage.config,
  roundSeconds: content.puzzles.salvage.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.salvage,
  presets: SALVAGE_PRESETS,
  locked: [],
  ticked: null,
};
