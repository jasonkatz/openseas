import type { TuningGroups } from "../groups.js";

/** Where each of Deflectors's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["size", "mirrors", "lenses", "spend"],
  deal: ["beams", "recipeLenses", "minBest"],
  pace: ["tickMs", "openingTicks", "respawnTicks"],
  scoring: ["bouncePoints", "bounceCap", "lensPercent", "perfectPercent", "streakPercent", "hullPenalty"],
  limits: ["maxTick", "maxMoves"],
};
