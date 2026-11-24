/**
 * Pact for the bots: a choice is one decision of the player's (a bid, a card, or the next deal),
 * with the other seats' bids and cards played out after it until the player is to decide again. The
 * table holds cards the player cannot see, so the board is not open: the one-move and rollout bots
 * would be reading the other hands. Every bot here sees only what the player sees, through the
 * engine's own rule for a seat (`pactSeatChoice`) with parts of it turned off, or a bid of its own.
 */
import {
  PACT_DEF,
  PACT_FULL_SKILL,
  pactEstimate,
  pactMoveIllegalReason,
  pactSeatChoice,
  type PactConfig,
  type PactMove,
  type PactSeatSkill,
  type PactState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: 3 s a card, 5 s a bid, the board's 0.9 s a seat's turn, 1.2 s to see a trick, 4 s a hand's count. */
const SECONDS_PER_CARD = 3;
const SECONDS_PER_BID = 5;
const SECONDS_PER_SEAT = 0.9;
const SECONDS_PER_TRICK = 1.2;
const SECONDS_PER_HAND = 4;

/** The moves that play the table on from `state` until the player is to decide, or the sitting is over. */
function playOn(state: PactState): PactMove[] {
  const out: PactMove[] = [];
  let s = state;
  while (!s.finished && s.phase === "table") {
    out.push({ type: "next" });
    s = PACT_DEF.reduce(s, { type: "next" });
  }
  return out;
}

function decision(state: PactState, move: PactMove): Choice<PactMove> {
  return { moves: [move, ...playOn(PACT_DEF.reduce(state, move))] };
}

function decisions(state: PactState): Choice<PactMove>[] {
  if (state.finished) return [];
  if (state.phase === "table") return [{ moves: playOn(state) }];
  if (state.phase === "over") return [decision(state, { type: "deal" })];
  if (state.phase === "bid") {
    const out: Choice<PactMove>[] = [];
    for (let b = 0; b <= 13; b++) if (pactMoveIllegalReason(state, { type: "bid", bid: b }) === null) out.push(decision(state, { type: "bid", bid: b }));
    return out;
  }
  return state.seats[0]!.cards.filter((c) => pactMoveIllegalReason(state, { type: "play", card: c }) === null).map((c) => decision(state, { type: "play", card: c }));
}

/** Plays the player's seat by the engine's rule with `skill`, bidding by `bid` when it is given. */
function ruleBot(name: string, about: string, skill: PactSeatSkill, bid?: (state: PactState) => number): Bot<PactState, PactMove> {
  return {
    name,
    about,
    choose(state) {
      if (state.phase === "bid" && bid) return decision(state, { type: "bid", bid: bid(state) });
      if (state.phase !== "bid" && state.phase !== "play") return decisions(state)[0] ?? null;
      const c = pactSeatChoice(state, 0, skill);
      return decision(state, c.kind === "bid" ? { type: "bid", bid: c.bid } : { type: "play", card: c.card });
    },
  };
}

const NONE: PactSeatSkill = { memory: false, duck: false, nil: false, set: false };

export const PACT_BOTS: BotGame<PactState, PactMove, PactConfig> = {
  id: "pact",
  def: PACT_DEF,
  pace: "3 s a card, 5 s a bid, 0.9 s a seat's turn, 1.2 s a trick, 4 s a count",
  elapsed: (s) => {
    const bids = s.seats[0]!.bid === null ? s.hand - 1 : s.hand;
    const cards = s.moveCount - bids;
    const tricks = Math.floor((s.played.length + 52 * Math.max(0, s.hand - 1)) / 4);
    return cards * SECONDS_PER_CARD + bids * SECONDS_PER_BID + s.tableActs * SECONDS_PER_SEAT + tricks * SECONDS_PER_TRICK + s.handsDone * SECONDS_PER_HAND;
  },
  choices: decisions,
  end: () => ({ type: "end" }),
  open: false,
  bots: [
    ruleBot("follower", "Bids its count; takes a trick when it can, with only aces as sure winners; no nil, no ducking.", NONE),
    ruleBot("counter", "As the follower, and remembers the cards played, so knows when its card is the best left.", { ...NONE, memory: true }),
    ruleBot("ducker", "As the counter, and ducks tricks once its side's pact is made.", { ...NONE, memory: true, duck: true }),
    ruleBot("plain", "The engine's whole rule: counts, ducks, bids and covers nil, and plays to set the rivals.", PACT_FULL_SKILL),
    ruleBot("greedy", "The whole rule, but takes every trick it can: the bags it gathers cost about what the sets it makes pay.", { ...PACT_FULL_SKILL, duck: false, set: false }),
    ruleBot("lowball", "The whole rule, but always bids one: a pact it cannot miss (a bait).", PACT_FULL_SKILL, () => 1),
    ruleBot("overbid", "The whole rule, but bids two over its count (a bait).", PACT_FULL_SKILL, (s) => Math.min(13, Math.max(1, Math.round(pactEstimate(s.seats[0]!.cards) / 10)) + 2)),
  ],
  baits: [
    { bait: "lowball", beats: "plain" },
    { bait: "overbid", beats: "plain" },
  ],
};
