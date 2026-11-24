import type { TuningGroups } from "../groups.js";

/** Where each of Refining's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height"],
  deal: ["vapourPermille", "oilPermille", "catalystPermille", "smokeEvery"],
  pace: ["tickMs", "pulseTicks"],
  scoring: ["clearPoints", "runCap", "smoothPoints", "catalystPoints", "foulPoints"],
  limits: ["maxTick", "maxMoves"],
};
