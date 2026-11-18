import type { TuningGroups } from "../groups.js";

/** Where each of Salvage's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "kinds"],
  deal: ["startCrates", "cratePermille", "maxCrates", "volatileEvery", "fuse"],
  scoring: ["minLine", "linePoints", "loopMin", "loopPercent", "enclosedPoints", "crateFloorPoints", "crateLoopPoints", "orderLength", "orderBonus", "volatilePoints", "streakMin", "streakPercent"],
  limits: ["maxMoves"],
};
