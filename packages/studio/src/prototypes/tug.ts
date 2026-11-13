import { TUG_DEF, tugSolve, type TugConfig, type TugMove, type TugState } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { TUG_PRESETS } from "../scenario/prototypes/tug.js";

const onWall = (s: TugState, cell: number): boolean => {
  const col = cell % s.config.width;
  const row = Math.floor(cell / s.config.width);
  return col === 0 || row === 0 || col === s.config.width - 1 || row === s.config.height - 1;
};

/** What the studio needs to know about Tug: its content config and its starting points. */
export const TUG: HarnessPuzzle<TugState, TugMove, TugConfig> = {
  id: "tug",
  def: TUG_DEF,
  config: content.puzzles.tug.config,
  roundSeconds: content.puzzles.tug.roundSeconds,
  configSchema: PUZZLE_CONFIG_SCHEMAS.tug,
  presets: TUG_PRESETS,
  locked: [],
  ticked: null,
};
