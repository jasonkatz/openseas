import type { TuningGroups } from "../groups.js";

/** Where each of Freefall's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "entry", "rows"],
  deal: ["gapPermille", "rival", "rivalSkill"],
  scoring: ["quotas", "bays", "squareClusters"],
  pace: ["turnSeconds"],
  limits: ["maxMoves"],
};
