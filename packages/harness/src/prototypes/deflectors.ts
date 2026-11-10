import { DEFLECTORS_DEF, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { DEFLECTORS_PRESETS } from "../scenario/prototypes/deflectors.js";

/** What the bench needs to know about Deflectors: its content config, presets and seed probes. */
export const DEFLECTORS: HarnessPuzzle<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  id: "deflectors",
  def: DEFLECTORS_DEF,
  config: content.puzzles.deflectors.config,
  roundSeconds: content.puzzles.deflectors.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.deflectors,
  presets: DEFLECTORS_PRESETS,
  probes: [],
  locked: [],
  ticked: null,
  hints: false,
};
