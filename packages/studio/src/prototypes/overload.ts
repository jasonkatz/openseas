import { OVERLOAD_DEF, overloadChainSize, overloadHint, type OverloadConfig, type OverloadMove, type OverloadState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { OVERLOAD_PRESETS } from "../scenario/prototypes/overload.js";

const longest = (s: OverloadState): number => s.cells.reduce((best, _, c) => Math.max(best, overloadChainSize(s, c)), 0);

/** What the studio needs to know about Overload: its content config and its starting points. Its taps come back on the engine's clock (ADR 0015). */
export const OVERLOAD: HarnessPuzzle<OverloadState, OverloadMove, OverloadConfig> = {
  id: "overload",
  def: OVERLOAD_DEF,
  config: content.puzzles.overload.config,
  roundSeconds: content.puzzles.overload.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.overload,
  presets: OVERLOAD_PRESETS,
  locked: ["tickMs"],
  ticked: { tickMs: content.puzzles.overload.config.tickMs },
};
