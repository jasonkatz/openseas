/**
 * Tractor for the bots: a choice is one swap, scoring or not. Every legal swap is a choice, so a
 * careless player swaps blind; the one-move bot weighs each by what it scores now.
 */
import {
  TRACTOR_CACHE,
  TRACTOR_DEF,
  tractorRowOf,
  tractorSwapIllegalReason,
  tractorSwapValue,
  type TractorConfig,
  type TractorMove,
  type TractorState,
} from "@openseas/engine";
import { applyMoves, oneMoveBot, rolloutBot, type Bot, type BotGame, type Choice } from "../core.js";

/** A person's pace, from the tuning notes: a swap every 1.5 seconds, 60 in a 90 second round. */
const SECONDS_PER_SWAP = 1.5;

function swaps(state: TractorState): TractorMove[] {
  const out: TractorMove[] = [];
  for (let c = 0; c < state.cells.length; c++) if (tractorSwapIllegalReason(state, c) === null) out.push({ type: "swap", cell: c });
  return out;
}

const scoring = (state: TractorState): TractorMove[] => swaps(state).filter((m) => m.type === "swap" && tractorSwapValue(state, m.cell).scores);

/** How high the caches sit, summed: 0 when every cache is on the hatch's row. */
function cacheDepth(state: TractorState): number {
  let d = 0;
  state.cells.forEach((p, c) => {
    if (p.kind === TRACTOR_CACHE) d += tractorRowOf(state.config, c);
  });
  return d;
}

/** A beginner: any swap that makes a run, picked at random. */
function anyRunBot(): Bot<TractorState, TractorMove> {
  return {
    name: "any run",
    about: "Takes any swap that makes a run, at random.",
    choose(state, ctx) {
      const options = scoring(state);
      return options.length ? { moves: [ctx.rng.pick(options)] } : null;
    },
  };
}

/** Points now, and a little for every row it lifts the caches: a player who has seen what a cache is worth. */
function cacheLifterBot(): Bot<TractorState, TractorMove> {
  return {
    name: "cache lifter",
    about: "Weighs each scoring swap by its points and 15 a row for every row it lifts the caches.",
    choose(state, ctx) {
      let best: TractorMove[] = [];
      let bestValue = -Infinity;
      const depth = cacheDepth(state);
      for (const m of scoring(state)) {
        const after = applyMoves(TRACTOR_DEF, state, [m]);
        const value = after.score - state.score + 15 * (depth - cacheDepth(after) + (after.cachesHauled - state.cachesHauled) * state.config.height);
        if (value > bestValue) {
          bestValue = value;
          best = [m];
        } else if (value === bestValue) best.push(m);
      }
      return best.length ? { moves: [ctx.rng.pick(best)] } : null;
    },
  };
}

/** The bait: the rollout bot, made to fire a beacon the moment a swap can. */
function beaconAtOnceBot(): Bot<TractorState, TractorMove> {
  const rollout = rolloutBot<TractorState, TractorMove>(undefined, "beacon at once");
  return {
    name: "beacon at once",
    about: "The rollout bot, but a beacon is fired by the first swap that can fire it (the bait).",
    choose(state, ctx) {
      const firing = scoring(state).filter((m) => m.type === "swap" && tractorSwapValue(state, m.cell).fired > 0);
      if (firing.length) {
        const one = oneMoveBot<TractorState, TractorMove>();
        const narrowed = { ...ctx, game: { ...ctx.game, choices: () => firing.map((m) => ({ moves: [m] })) } };
        return one.choose(state, narrowed);
      }
      return rollout.choose(state, ctx);
    },
  };
}

export const TRACTOR_BOTS: BotGame<TractorState, TractorMove, TractorConfig> = {
  id: "tractor",
  def: TRACTOR_DEF,
  pace: "a swap every 1.5 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_SWAP,
  choices: (s): Choice<TractorMove>[] => swaps(s).map((m) => ({ moves: [m] })),
  end: () => ({ type: "end" }),
  open: true,
  bots: [anyRunBot(), cacheLifterBot(), beaconAtOnceBot()],
  slow: ["beacon at once"],
  baits: [{ bait: "beacon at once", beats: "rollout" }],
};
