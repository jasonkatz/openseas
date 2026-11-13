import type { TuningGroups } from "../groups.js";

/** Where each of Navigation's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["rings", "octants", "shapes", "colors"],
  deal: ["startStars", "maxStars", "reuseChancePercent"],
  pace: ["tickMs", "fallTicks", "fallTicksMin"],
  scoring: ["starPoints", "chainPercent", "runPoints", "lostHeadingPenalty"],
  limits: ["maxTick", "maxMoves"],
};
