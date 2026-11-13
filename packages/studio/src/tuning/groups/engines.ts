import type { TuningGroups } from "../groups.js";

/** Where each of Engines's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["width", "height", "pieceKinds"],
  deal: ["injectorsAtOnce", "injectorSpanMin", "injectorSpanMax"],
  scoring: ["injectorPoints", "runPoints", "chainMultipliers", "flameoutPenalty"],
  limits: ["maxMoves"],
};
