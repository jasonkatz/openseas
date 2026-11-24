import { REFINING_DEF, type RefiningConfig, type RefiningMove, type RefiningState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { REFINING_PRESETS } from "../scenario/prototypes/refining.js";

/** What the studio needs to know about Refining: its content config and its starting points. The outlet is drawn on the engine's clock (ADR 0015). */
export const REFINING: StudioPuzzle<RefiningState, RefiningMove, RefiningConfig> = {
  id: "refining",
  def: REFINING_DEF,
  config: content.puzzles.refining.config,
  roundSeconds: content.puzzles.refining.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.refining,
  presets: REFINING_PRESETS,
  locked: ["tickMs"],
  ticked: { tickMs: content.puzzles.refining.config.tickMs },
};
