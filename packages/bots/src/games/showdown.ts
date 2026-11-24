/**
 * Showdown for the bots: a choice is one decision of the player's (fold, call, raise, or deal the
 * next hand), with the rivals' answers played out after it until the player is to decide again.
 * The table holds cards the player cannot see, so the board is not open: the one-move and rollout
 * bots would be reading the rivals' hands. Every bot here sees only what the player sees, through
 * the engine's own rule for a rival (`showdownStyleChoice`) given numbers of its own.
 */
import {
  SHOWDOWN_DEF,
  seedFromString,
  showdownMoveIllegalReason,
  showdownStyleChoice,
  type ShowdownConfig,
  type ShowdownMove,
  type ShowdownState,
  type ShowdownStyleNumbers,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: 3 s a decision, the board's 1.4 s a rival's turn or a card turned, 2.5 s to look at a hand's end. */
const SECONDS_PER_DECISION = 3;
const SECONDS_PER_RIVAL = 1.4;
const SECONDS_PER_HAND = 2.5;

/** The moves that play the table on from `state` until the player is to decide, or the round is over. */
function playOn(state: ShowdownState): ShowdownMove[] {
  const out: ShowdownMove[] = [];
  let s = state;
  while (!s.finished && s.phase === "table") {
    out.push({ type: "next" });
    s = SHOWDOWN_DEF.reduce(s, { type: "next" });
  }
  return out;
}

function decisions(state: ShowdownState): Choice<ShowdownMove>[] {
  if (state.finished) return [];
  if (state.phase === "table") return [{ moves: playOn(state) }];
  const kinds: ShowdownMove[] = state.phase === "over" ? [{ type: "deal" }] : [{ type: "fold" }, { type: "call" }, { type: "raise" }];
  return kinds
    .filter((m) => showdownMoveIllegalReason(state, m) === null)
    .map((m) => ({ moves: [m, ...playOn(SHOWDOWN_DEF.reduce(state, m))] }));
}

/** The choice that starts with `type`. */
function pick(state: ShowdownState, type: ShowdownMove["type"]): Choice<ShowdownMove> | null {
  const all = decisions(state);
  return all.find((c) => c.moves[0]?.type === type) ?? all[0] ?? null;
}

/** Plays the player's seat by a rival's rule with these numbers, numbers chosen afresh for each decision by `tune`. */
function styledBot(name: string, about: string, tune: (state: ShowdownState) => ShowdownStyleNumbers): Bot<ShowdownState, ShowdownMove> {
  return {
    name,
    about,
    choose(state, ctx) {
      if (state.phase !== "act") return decisions(state)[0] ?? null;
      const c = showdownStyleChoice(state, 0, tune(state), seedFromString(`${name}:${ctx.rng.int(0x7fffffff)}`));
      const kind = c.kind === "fold" && showdownMoveIllegalReason(state, { type: "fold" }) !== null ? "call" : c.kind;
      return pick(state, kind);
    },
  };
}

/** The live rivals' styles. */
const live = (s: ShowdownState) => s.seats.filter((x, i) => i > 0 && !x.folded && !x.out).map((x) => x.style);

/** Plain good play: the shark's own numbers, the same at every seat. */
const sharkBot = () => styledBot("shark", "Plays its cards against the price, by the shark's numbers.", (s) => s.config.play.shark);

/** Reads the table: the shark's numbers, moved for whoever is still in. */
const readerBot = () =>
  styledBot("reader", "The shark's numbers, moved for the rivals still in: never bluffs a sponge and bets it thinner, bluffs bricks, calls a hothead down lighter.", (s) => {
    const styles = live(s);
    const p = { ...s.config.play.shark };
    if (styles.every((x) => x === "brick")) p.bluff = 600;
    if (styles.includes("sponge")) {
      p.bluff = 0;
      p.raiseAt = 1150;
    }
    if (styles.includes("hothead")) p.slack += 300;
    if (styles.length === 1 && styles[0] === "brick") p.slack -= 300;
    return p;
  });

/** Folds all but the best: a brick of its own. */
const rockBot = () => styledBot("rock", "Plays only strong cards, by the brick's numbers.", (s) => s.config.play.brick);

/** A bait: never folds, never raises. Looks safe; pays off every better hand. */
function callerBot(): Bot<ShowdownState, ShowdownMove> {
  return {
    name: "caller",
    about: "Calls or checks every time, whatever it holds (a bait).",
    choose: (state) => (state.phase === "act" ? pick(state, "call") : (decisions(state)[0] ?? null)),
  };
}

/** A bait: raises whenever it can. Looks bold; wins small pots and loses big ones. */
function raiserBot(): Bot<ShowdownState, ShowdownMove> {
  return {
    name: "raiser",
    about: "Raises whenever the street takes one, and calls when capped (a bait).",
    choose: (state) => (state.phase === "act" ? pick(state, "raise") : (decisions(state)[0] ?? null)),
  };
}

export const SHOWDOWN_BOTS: BotGame<ShowdownState, ShowdownMove, ShowdownConfig> = {
  id: "showdown",
  def: SHOWDOWN_DEF,
  pace: "3 s a decision, 1.4 s a rival's turn, 2.5 s a hand's end",
  elapsed: (s) => s.moveCount * SECONDS_PER_DECISION + s.tableActs * SECONDS_PER_RIVAL + s.hand * SECONDS_PER_HAND,
  choices: decisions,
  end: () => ({ type: "end" }),
  open: false,
  bots: [sharkBot(), readerBot(), rockBot(), callerBot(), raiserBot()],
  baits: [
    { bait: "caller", beats: "shark" },
    { bait: "raiser", beats: "shark" },
    { bait: "rock", beats: "reader" },
  ],
};
