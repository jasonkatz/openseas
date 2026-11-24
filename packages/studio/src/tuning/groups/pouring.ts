import type { TuningGroups } from "../groups.js";

/** Where each of Pouring's config keys is tuned (see ../groups.ts). The rivals are part of the board: who sits at the bar. */
export const groups: TuningGroups = {
  board: ["size", "glasses", "brews", "offer", "rivals", "rivalSkill"],
  deal: ["icePerBag", "ragsPerBag"],
  pace: ["lastCall", "tolerance", "soberAfter"],
  scoring: ["pourPoints", "agePoints", "ageMax", "ringPoints", "linePoints", "cleanPercent"],
  limits: ["maxMoves"],
};
