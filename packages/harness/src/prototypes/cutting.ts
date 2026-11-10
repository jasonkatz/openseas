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

/** What the bench needs to know about Cutting: its content config, presets and seed probes. */
export const CUTTING: HarnessPuzzle<CuttingState, CuttingMove, CuttingConfig> = {
  id: "cutting",
  def: CUTTING_DEF,
  config: content.puzzles.cutting.config,
  roundSeconds: content.puzzles.cutting.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.cutting,
  presets: CUTTING_PRESETS,
  probes: [
    { id: "three_cuts", test: (s) => s.cutsAllowed === 3 },
    { id: "setup_first", test: (s) => firstBestCut(s)?.points === 0 },
    // A plan that banks 144 or more from one piece has freed twelve cells whole.
    { id: "big_block", test: (s) => s.slabBest >= 144 + 36 && (firstBestCut(s)?.halves.some((h) => h.ore !== null && h.w * h.h >= 12) ?? false) },
  ],
  locked: [],
  ticked: null,
  hints: true,
};
