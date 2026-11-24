import type { TuningGroups } from "../groups.js";

/** Where each of Showdown's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["rivals", "hands", "bank"],
  deal: ["styles", "play", "samples"],
  scoring: ["smallBlind", "bigBlind", "smallBet", "bigBet", "raiseCap"],
  limits: ["maxMoves"],
};
