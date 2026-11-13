import type { TuningGroups } from "../groups.js";

/** Where each of Overload's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height"],
  deal: ["refill", "boosterPermille", "startTaps", "tapCap"],
  pace: ["tickMs", "tapRegenTicks"],
  scoring: ["burstPoints", "chainCap", "streakMin", "streakPercent", "refundEvery"],
  limits: ["maxTick", "maxMoves"],
};
