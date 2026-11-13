import type { TuningGroups } from "../groups.js";

/** Where each of Deflectors's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["size", "mirrors"],
  deal: ["maxBeams", "minBest"],
  pace: ["tickMs", "openingTicks", "chargeTicks", "chargeTicksMin", "beamTicks", "respawnTicks", "rampTicks"],
  scoring: ["bouncePoints", "bounceCap", "perfectPercent", "streakPercent", "hullPenalty"],
  limits: ["maxTick", "maxMoves"],
};
