import type { TuningGroups } from "../groups.js";

/** Where each of Swordfight's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "colors", "blades"],
  deal: ["breakerPermille", "scrapMatchPermille", "dealSeed", "blade", "allies", "foes"],
  pace: ["tickMs", "dropTicks", "fallTicks", "ripenMoves", "landAfterTicks", "incomingCapRows", "minRateSeconds"],
  scoring: ["cellPoints", "slabBonus", "attackPoints", "winPoints", "scorePercent"],
  limits: ["player", "offset", "maxTick", "maxMoves"],
};
