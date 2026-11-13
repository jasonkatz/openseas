import { CUTTING_DEF, cuttingBestCut, cuttingCutPreview, type CuttingConfig, type CuttingMove, type CuttingState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { CUTTING_PRESETS } from "../scenario/prototypes/cutting.js";

/** The first cut of a best plan for the opening slab, as the engine would preview it. */
function firstBestCut(s: CuttingState) {
  const b = cuttingBestCut(s);
  return b ? cuttingCutPreview(s, b.piece, b.vertical, b.at) : null;
}

/** What the studio needs to know about Cutting: its content config and its starting points. */
export const CUTTING: HarnessPuzzle<CuttingState, CuttingMove, CuttingConfig> = {
  id: "cutting",
  def: CUTTING_DEF,
  config: content.puzzles.cutting.config,
  roundSeconds: content.puzzles.cutting.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.cutting,
  presets: CUTTING_PRESETS,
  locked: [],
  ticked: null,
};
