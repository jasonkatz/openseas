import { PACT_DEF, type PactConfig, type PactMove, type PactState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { PACT_PRESETS } from "../scenario/prototypes/pact.js";

/** What the studio needs to know about Pact: its content config and its starting points. */
export const PACT: StudioPuzzle<PactState, PactMove, PactConfig> = {
  id: "pact",
  def: PACT_DEF,
  config: content.puzzles.pact.config,
  roundSeconds: content.puzzles.pact.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.pact,
  presets: PACT_PRESETS,
  locked: [],
  ticked: null,
};
