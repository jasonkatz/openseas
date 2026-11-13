import type { TuningGroups } from "../groups.js";

/** Where each of Scanner's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height"],
  deal: ["startContacts", "maxContacts", "parBase", "parPerContact", "openingMin", "dealTries"],
  pace: ["growEvery"],
  scoring: ["contactPoints", "savePoints", "streakPercent", "overPenalty", "wrongPenalty", "spookPenalty"],
  limits: ["maxMoves"],
};
