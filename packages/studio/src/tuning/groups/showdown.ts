import type { TuningGroups } from "../groups.js";

/** Where each of Showdown's config keys is tuned (see ../groups.ts). */
export const groups: TuningGroups = {
  board: ["rivals", "hands", "stack"],
  deal: ["styles", "play", "samples"],
  scoring: ["knockout", "speed", "smallBlind", "bigBlind", "smallBet", "bigBet", "raiseCap"],
  limits: ["maxMoves"],
};
