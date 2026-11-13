import type { TuningGroups } from "../groups.js";

/** Where each of Gunnery's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["decks"],
  deal: ["bag", "queueLength", "maxOnDeck"],
  pace: ["tickMs", "spawnEveryTicks", "spawnEveryTicksMin", "fireAfterTicks"],
  scoring: ["stepPoints", "loadPoints", "comboStep", "comboCap", "broadsidePoints"],
  limits: ["maxTick", "maxMoves"],
};
