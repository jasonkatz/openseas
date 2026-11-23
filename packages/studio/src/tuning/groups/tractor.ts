import type { TuningGroups } from "../groups.js";

/** Where each of Tractor's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "kinds"],
  deal: ["startCaches", "cachePermille", "maxCaches", "beaconEvery"],
  scoring: ["runPoints", "cascadePercent", "cachePoints", "sweepPoints"],
  limits: ["maxMoves"],
};
