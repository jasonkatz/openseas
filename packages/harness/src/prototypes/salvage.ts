import { SALVAGE_CRATE, SALVAGE_DEF, salvageFindLoop, salvageHint, type SalvageConfig, type SalvageMove, type SalvageState } from "@openseas/engine";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { SALVAGE_PRESETS } from "../scenario/prototypes/salvage.js";

/** What the bench needs to know about Salvage: its content config, presets and seed probes. */
export const SALVAGE: HarnessPuzzle<SalvageState, SalvageMove, SalvageConfig> = {
  id: "salvage",
  def: SALVAGE_DEF,
  config: content.puzzles.salvage.config,
  roundSeconds: content.puzzles.salvage.roundSeconds,
  presets: SALVAGE_PRESETS,
  probes: [
    { id: "loop_open", test: (s) => salvageFindLoop(s) !== null },
    { id: "long_line", test: (s) => (salvageHint(s)?.length ?? 0) >= 8 },
    { id: "crates_high", test: (s) => s.cells.every((p, i) => p.kind !== SALVAGE_CRATE || i < s.config.width * 2) },
  ],
  locked: [],
  ticked: null,
  hints: true,
};
