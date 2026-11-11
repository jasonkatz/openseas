import { TUG_DEF, tugSolve, type TugState } from "@openseas/engine";
import { harnessPuzzle } from "../puzzles.js";

const onWall = (s: TugState, cell: number): boolean => {
  const col = cell % s.config.width;
  const row = Math.floor(cell / s.config.width);
  return col === 0 || row === 0 || col === s.config.width - 1 || row === s.config.height - 1;
};

/** What the bench needs to know about Tug: its seed probes. */
export const TUG = harnessPuzzle(TUG_DEF, {
  probes: [
    { id: "two_pod_start", test: (s) => new Set(tugSolve(s)?.map((m) => m.pod)).size >= 2 },
    { id: "clamp_mid_bay", test: (s) => !onWall(s, s.clamp.cell) },
    { id: "clamp_for_first_pod", test: (s) => s.clamp.pod === 0 },
  ],
  hints: true,
});
