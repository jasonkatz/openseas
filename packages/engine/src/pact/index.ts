import type { PuzzleDef } from "../def.js";
import { createPactGame, hashPactState, reducePact, summarizePact, validateConfig } from "./reduce.js";
import { DEFAULT_PACT_CONFIG, type PactConfig, type PactMove, type PactState } from "./types.js";

export * from "./types.js";
export {
  createPactGame,
  reducePact,
  replayPact,
  hashPactState,
  summarizePact,
  validateConfig as validatePactConfig,
  minBid as pactMinBid,
  playable as pactPlayable,
  moveIllegalReason as pactMoveIllegalReason,
  hint as pactHint,
  sideStanding as pactSideStanding,
  cardName as pactCardName,
  cardOf as pactCardOf,
  viewString as pactViewString,
  paceScore as pactPaceScore,
  type PactSummary,
} from "./reduce.js";
export { legalCards as pactLegalCards, rankOf as pactRankOf, suitOf as pactSuitOf, winning as pactWinning } from "./cards.js";
export { estimate as pactEstimate, seatChoice as pactSeatChoice, FULL_SKILL as PACT_FULL_SKILL, type SeatSkill as PactSeatSkill, type SeatChoice as PactSeatChoice } from "./seat.js";

export const PACT_DEF: PuzzleDef<PactState, PactMove, PactConfig> = {
  id: "pact",
  defaultConfig: DEFAULT_PACT_CONFIG,
  validateConfig,
  create: createPactGame,
  reduce: reducePact,
  hash: hashPactState,
  summarize: summarizePact,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves + 1,
};
