import type { TuningGroups } from "../groups.js";

/** Where each of Battle's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["boards", "turretRange"],
  deal: ["turrets", "startLoaded", "startDamage", "tokenCap", "supply", "raider"],
  pace: ["turnSeconds", "segments"],
  scoring: ["shotDamage", "asteroidDamage", "ramDamage", "grappleDamage", "hitPoints", "hitTakenPoints", "winPoints", "turnBonus", "scorePercent"],
  limits: ["maxTurns", "maxMoves"],
};
