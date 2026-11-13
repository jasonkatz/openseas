import type { TuningGroups } from "../groups.js";

/** Where each of Reactor's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["size", "hotGrade", "ports", "criticalHot"],
  deal: ["startRods", "twoPermille"],
  scoring: ["fusePoints", "dischargePoints", "salvoPercent", "pipelineSwipes", "pipelinePercent", "scramPenalty"],
  limits: ["maxMoves"],
};
