import type { TuningGroups } from "../groups.js";

/** Where each of Forging's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "blows"],
  deal: ["jumps", "far", "sparks", "weights", "preview"],
  scoring: ["strikePoints", "platePoints", "chainPoints", "chainCap", "setPoints", "weaveCap"],
  limits: ["maxMoves"],
};
