/**
 * Forging for the bots: a choice is one strike, on any spot the press can reach. A careless player
 * strikes at random; the one-move bot weighs each strike by what it scores now, stall included.
 */
import { FORGING_DEF, forgingTargets, reduceForging, type ForgingConfig, type ForgingMove, type ForgingState } from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: a strike every 2.5 seconds, so a plate of 108 takes 270. */
const SECONDS_PER_STRIKE = 2.5;

const strikes = (state: ForgingState): ForgingMove[] => forgingTargets(state).map((cell) => ({ type: "strike", cell }));

/**
 * How good a position is to play on from: what has been scored, and how many places the press can
 * land next (a press with few places is close to a stall). A stall reads as the stall it is.
 */
function standing(s: ForgingState, mobility: number): number {
  if (s.finished) return s.score;
  return s.score + mobility * Math.min(6, forgingTargets(s).length);
}

/**
 * Looks `depth` strikes ahead on the marks it can see. Every mark a strike turns up is one the
 * preview showed, so a search no deeper than the preview reads nothing hidden.
 */
function search(s: ForgingState, depth: number, mobility: number): number {
  if (depth === 0 || s.finished) return standing(s, mobility);
  let best = -Infinity;
  for (const m of strikes(s)) best = Math.max(best, search(reduceForging(s, m), depth - 1, mobility));
  return best === -Infinity ? standing(s, mobility) : best;
}

function plannerBot(name: string, depth: number, about: string): Bot<ForgingState, ForgingMove> {
  return {
    name,
    about,
    choose(state, ctx) {
      let best: ForgingMove[] = [];
      let bestValue = -Infinity;
      const d = Math.min(depth, Math.max(1, state.config.preview));
      for (const m of strikes(state)) {
        const v = search(reduceForging(state, m), d - 1, 4);
        if (v > bestValue) {
          bestValue = v;
          best = [m];
        } else if (v === bestValue) best.push(m);
      }
      return best.length ? { moves: [ctx.rng.pick(best)] } : null;
    },
  };
}

/** Never stalls when it can help it: the one-move bot, with a strike that leaves the press few places to land weighed down. */
function keeperBot(): Bot<ForgingState, ForgingMove> {
  return {
    name: "keeper",
    about: "Points now plus 4 for each place the press could land next (up to 6): it keeps its options open.",
    choose(state, ctx) {
      let best: ForgingMove[] = [];
      let bestValue = -Infinity;
      for (const m of strikes(state)) {
        const v = standing(reduceForging(state, m), 4);
        if (v > bestValue) {
          bestValue = v;
          best = [m];
        } else if (v === bestValue) best.push(m);
      }
      return best.length ? { moves: [ctx.rng.pick(best)] } : null;
    },
  };
}

/** The bait: a chain pays on every strike, so it keeps one going whenever it can, and is the keeper otherwise. */
function chainChaserBot(): Bot<ForgingState, ForgingMove> {
  const keeper = keeperBot();
  return {
    name: "chain chaser",
    about: "Strikes the same mark again whenever it can (the bait), and is the keeper otherwise.",
    choose(state, ctx) {
      const lead = state.chainMark;
      if (lead !== null && state.chain > 0) {
        const same = strikes(state).filter((m) => m.type === "strike" && (state.cells[m.cell]!.mark === lead || state.cells[m.cell]!.mark === "spark"));
        const safe = same.filter((m) => !reduceForging(state, m).lastMove!.stalled);
        if (safe.length) return { moves: [ctx.rng.pick(safe)] };
      }
      return keeper.choose(state, ctx);
    },
  };
}

export const FORGING_BOTS: BotGame<ForgingState, ForgingMove, ForgingConfig> = {
  id: "forging",
  def: FORGING_DEF,
  pace: "a strike every 2.5 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_STRIKE,
  choices: (s): Choice<ForgingMove>[] => strikes(s).map((m) => ({ moves: [m] })),
  end: () => ({ type: "end" }),
  open: true,
  bots: [keeperBot(), chainChaserBot(), plannerBot("planner", 3, "Searches every line three strikes deep on the marks the preview shows, and takes the best by points plus 4 a landing place at the end.")],
  slow: ["planner"],
  baits: [{ bait: "chain chaser", beats: "planner" }],
};
