import type { TuningGroups } from "../groups.js";

/** Where each of Deflectors's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["size", "emitters", "targets", "mirrors", "lenses", "spend"],
  deal: ["pieces", "recipeWeights", "lensChance", "splitterChance", "queueSize"],
  pace: ["tickMs", "fireTicks"],
  scoring: ["bouncePoints", "bounceCap", "lensPercent", "litPercent"],
  limits: ["maxTick", "maxMoves"],
};
