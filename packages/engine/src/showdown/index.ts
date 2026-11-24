import type { PuzzleDef } from "../def.js";
import { createShowdownGame, hashShowdownState, reduceShowdown, summarizeShowdown, validateConfig } from "./reduce.js";
import { DEFAULT_SHOWDOWN_CONFIG, type ShowdownConfig, type ShowdownMove, type ShowdownState } from "./types.js";

export * from "./types.js";
export {
  createShowdownGame,
  reduceShowdown,
  replayShowdown,
  hashShowdownState,
  summarizeShowdown,
  validateConfig as validateShowdownConfig,
  pot as showdownPot,
  boardShowing as showdownBoardShowing,
  owed as showdownOwed,
  betSize as showdownBetSize,
  canRaise as showdownCanRaise,
  raiseCost as showdownRaiseCost,
  moveIllegalReason as showdownMoveIllegalReason,
  styleChoice as showdownStyleChoice,
  hint as showdownHint,
  cardName as showdownCardName,
  viewString as showdownViewString,
  paceScore as showdownPaceScore,
  type ShowdownSummary,
} from "./reduce.js";
export {
  handValue as showdownHandValue,
  handName as showdownHandName,
  bestFive as showdownBestFive,
  equity as showdownEquity,
  rankOf as showdownRankOf,
  suitOf as showdownSuitOf,
} from "./cards.js";

export const SHOWDOWN_DEF: PuzzleDef<ShowdownState, ShowdownMove, ShowdownConfig> = {
  id: "showdown",
  defaultConfig: DEFAULT_SHOWDOWN_CONFIG,
  validateConfig,
  create: createShowdownGame,
  reduce: reduceShowdown,
  hash: hashShowdownState,
  summarize: summarizeShowdown,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
