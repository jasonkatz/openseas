import { TUG_DEF, tugSolve, type TugConfig, type TugMove, type TugState } from "@openseas/engine";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import { TUG_PRESETS } from "../scenario/prototypes/tug.js";

const onWall = (s: TugState, cell: number): boolean => {
  const col = cell % s.config.width;
  const row = Math.floor(cell / s.config.width);
  return col === 0 || row === 0 || col === s.config.width - 1 || row === s.config.height - 1;
};

/** What the bench needs to know about Tug: its content config, presets and seed probes. */
export const TUG: HarnessPuzzle<TugState, TugMove, TugConfig> = {
  id: "tug",
  def: TUG_DEF,
  config: content.puzzles.tug.config,
  roundSeconds: content.puzzles.tug.roundSeconds,
  presets: TUG_PRESETS,
  probes: [
    { id: "two_pod_start", test: (s) => new Set(tugSolve(s)?.map((m) => m.pod)).size >= 2 },
    { id: "clamp_mid_bay", test: (s) => !onWall(s, s.clamp.cell) },
    { id: "clamp_for_first_pod", test: (s) => s.clamp.pod === 0 },
  ],
  locked: [],
  ticked: null,
  hints: true,
};
