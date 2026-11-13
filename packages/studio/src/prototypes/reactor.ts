import { REACTOR_DEF, type ReactorConfig, type ReactorMove, type ReactorState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { REACTOR_PRESETS } from "../scenario/prototypes/reactor.js";

/** What the studio needs to know about Reactor: its content config and its starting points. */
export const REACTOR: HarnessPuzzle<ReactorState, ReactorMove, ReactorConfig> = {
  id: "reactor",
  def: REACTOR_DEF,
  config: content.puzzles.reactor.config,
  roundSeconds: content.puzzles.reactor.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.reactor,
  presets: REACTOR_PRESETS,
  locked: [],
  ticked: null,
};
