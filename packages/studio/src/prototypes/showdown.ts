import { SHOWDOWN_DEF, type ShowdownConfig, type ShowdownMove, type ShowdownState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { StudioPuzzle } from "../puzzles.js";
import { SHOWDOWN_PRESETS } from "../scenario/prototypes/showdown.js";

/** What the studio needs to know about Showdown: its content config and its starting points. */
export const SHOWDOWN: StudioPuzzle<ShowdownState, ShowdownMove, ShowdownConfig> = {
  id: "showdown",
  def: SHOWDOWN_DEF,
  config: content.puzzles.showdown.config,
  roundSeconds: content.puzzles.showdown.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.showdown,
  presets: SHOWDOWN_PRESETS,
  locked: [],
  ticked: null,
};
