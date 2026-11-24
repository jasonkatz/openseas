import type { TuningGroups } from "../groups.js";

/** Where each of Assembly's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "traySize"],
  deal: ["kindWeights", "startCores", "corePermille", "maxCores"],
  scoring: ["fitPoints", "chainCap", "corePoints"],
  limits: ["maxMoves"],
};
