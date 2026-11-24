import { DEFLECTORS_DEF, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { DEFLECTORS_PRESETS } from "../scenario/prototypes/deflectors.js";

/** What the studio needs to know about Deflectors: its content config and its starting points. */
export const DEFLECTORS: StudioPuzzle<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  id: "deflectors",
  def: DEFLECTORS_DEF,
  config: content.puzzles.deflectors.config,
  roundSeconds: content.puzzles.deflectors.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.deflectors,
  presets: DEFLECTORS_PRESETS,
  // The queue, the emitters' charge and the beams in flight are timed against the tick.
  locked: ["tickMs"],
  ticked: { tickMs: content.puzzles.deflectors.config.tickMs },
};
