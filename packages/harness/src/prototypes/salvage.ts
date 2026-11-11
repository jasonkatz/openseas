import { SALVAGE_CRATE, SALVAGE_DEF, salvageFindLoop, salvageHint } from "@openseas/engine";
import { harnessPuzzle } from "../puzzles.js";

/** What the bench needs to know about Salvage: its seed probes. */
export const SALVAGE = harnessPuzzle(SALVAGE_DEF, {
  probes: [
    { id: "loop_open", test: (s) => salvageFindLoop(s) !== null },
    { id: "long_line", test: (s) => (salvageHint(s)?.length ?? 0) >= 8 },
    { id: "crates_high", test: (s) => s.cells.every((p, i) => p.kind !== SALVAGE_CRATE || i < s.config.width * 2) },
  ],
  hints: true,
});
