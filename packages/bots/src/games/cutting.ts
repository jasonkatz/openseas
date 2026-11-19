/**
 * Cutting for the bots: a choice is one cut, any piece on the table along any grid line inside it,
 * or giving the slab up. The moves are untimed, so a person's pace is modelled per cut. The four
 * cutters of the tuning notes are here: random is the careless bot every puzzle gets, and greedy,
 * one cut ahead and the best plan are the puzzle's own, read from the engine's own sums. Then the
 * order's bots (M11): the best plan blind to the order, the order chaser (a bait), and the cutter
 * that moves on from a slab once its next cut is not worth a cut's share of the round.
 */
import {
  CUTTING_DEF,
  cuttingBestCut,
  cuttingBestRemaining,
  cuttingCutPreview,
  cuttingGrade,
  cuttingStreakPercentAt,
  type CuttingConfig,
  type CuttingMove,
  type CuttingState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: about 30 cuts in a 120 second round. */
const SECONDS_PER_CUT = 120 / 30;
/** Giving a slab up is one tap on the chip. */
const SECONDS_PER_DONE = 1;

type Cut = Extract<CuttingMove, { type: "cut" }>;

/** Every cut on the table: each piece, each grid line inside it, both ways. */
export function cuttingCuts(state: CuttingState): Cut[] {
  const out: Cut[] = [];
  if (state.finished || state.cutsLeft <= 0) return out;
  for (const p of state.pieces) {
    for (let at = p.x + 1; at < p.x + p.w; at++) out.push({ type: "cut", piece: p.id, vertical: true, at });
    for (let at = p.y + 1; at < p.y + p.h; at++) out.push({ type: "cut", piece: p.id, vertical: false, at });
  }
  return out;
}

/** What a cut banks at once, by the engine's own preview. */
function banks(state: CuttingState, c: Cut): number {
  return cuttingCutPreview(state, c.piece, c.vertical, c.at)?.points ?? 0;
}

/** The cuts that bank most now. */
function greediest(state: CuttingState): Cut[] {
  const cuts = cuttingCuts(state);
  let top = -1;
  for (const c of cuts) top = Math.max(top, banks(state, c));
  return cuts.filter((c) => banks(state, c) === top);
}

/** Greedy: the cut that banks most now, ties at random. It never gives a slab up. */
function greedyBot(): Bot<CuttingState, CuttingMove> {
  return {
    name: "greedy",
    about: "Takes the cut that banks most now, ties at random.",
    choose(state, ctx) {
      const top = greediest(state);
      return top.length ? { moves: [ctx.rng.pick(top)] } : null;
    },
  };
}

/** One cut ahead: greedy, with its ties broken by the most the next cut could bank on the same slab. */
function oneAheadBot(): Bot<CuttingState, CuttingMove> {
  return {
    name: "one cut ahead",
    about: "Greedy, with its ties broken by the most the next cut could bank on the same slab.",
    choose(state, ctx) {
      const top = greediest(state);
      if (top.length === 0) return null;
      let bestNext = -1;
      let picks: Cut[] = [];
      for (const c of top) {
        const after = CUTTING_DEF.reduce(state, c);
        let next = 0;
        // A cut that ended the slab sees nothing of the next one: that would be reading the deal.
        if (after.slab === state.slab) for (const n of cuttingCuts(after)) next = Math.max(next, banks(after, n));
        if (next > bestNext) {
          bestNext = next;
          picks = [c];
        } else if (next === bestNext) picks.push(c);
      }
      return { moves: [ctx.rng.pick(picks)] };
    },
  };
}

/** The best plan: the engine's own first cut of a best plan, every time. */
function bestPlanBot(): Bot<CuttingState, CuttingMove> {
  return {
    name: "best plan",
    about: "Makes the first cut of a best plan for what is on the table, every time (the engine's hint).",
    choose(state) {
      const c = cuttingBestCut(state);
      return c ? { moves: [{ type: "cut", ...c }] } : null;
    },
  };
}

/**
 * The best plan made with the order's bonus scaled by `scale` in its own sums: at 0 it is blind to
 * the order and cuts for area alone; above 1 it frees the order's plate even where that costs a
 * block worth more. The cut it makes is real, so the engine pays it what it truly banks.
 */
function scaledPlanBot(name: string, about: string, scale: number): Bot<CuttingState, CuttingMove> {
  return {
    name,
    about,
    choose(state) {
      const seen: CuttingState = { ...state, config: { ...state.config, orderBonus: Math.round(state.config.orderBonus * scale) } };
      const c = cuttingBestCut(seen);
      if (c) return { moves: [{ type: "cut", ...c }] };
      // Its own sums see nothing more on this slab: give it up for the next.
      return cuttingBestCut(state) ? { moves: [{ type: "done" }] } : null;
    },
  };
}

/**
 * Moves on: before each cut it weighs every number of cuts k it could still spend on the slab by
 * what the best plan banks with k, the grade's bonus at the streak it would reach, less `cutWorth`
 * points for each cut (a cut's share of a good round: about 90 points in 4 s). It makes the first
 * cut of the best plan with the best k, and gives the slab up when that k is 0.
 */
function moveOnBot(name: string, cutWorth: number): Bot<CuttingState, CuttingMove> {
  return {
    name,
    about: `The best plan, but each cut must earn ${cutWorth} points (its share of a good round): it gives a slab up once the rest of it would not.`,
    choose(state) {
      if (state.finished) return null;
      const cfg = state.config;
      let bestK = 0;
      let bestValue = -Infinity;
      for (let k = 0; k <= state.cutsLeft; k++) {
        const got = state.slabGot + cuttingBestRemaining(state, k);
        const g = cuttingGrade(cfg, got, state.slabBest);
        const base = g === "flawless" ? cfg.flawlessBonus : g === "clean" ? cfg.cleanBonus : 0;
        const bonus = g === "rough" ? 0 : (base * cuttingStreakPercentAt(cfg, state.combo + 1)) / 100;
        const value = got + bonus - cutWorth * k;
        if (value > bestValue + 1e-9) {
          bestValue = value;
          bestK = k;
        }
      }
      const c = bestK > 0 ? cuttingBestCut(state, bestK) : null;
      return c ? { moves: [{ type: "cut", ...c }] } : { moves: [{ type: "done" }] };
    },
  };
}

/** A cut's worth to the bot that moves on: a good round's points over its cuts, about 2,900 over 30. */
const CUT_WORTH = 90;

export const CUTTING_BOTS: BotGame<CuttingState, CuttingMove, CuttingConfig> = {
  id: "cutting",
  def: CUTTING_DEF,
  pace: "30 cuts in 120 s, a slab given up in 1 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_CUT + (s.logLength - s.moveCount) * SECONDS_PER_DONE,
  choices: (s): Choice<CuttingMove>[] => [...cuttingCuts(s).map((c) => ({ moves: [c] })), { moves: [{ type: "done" }] }],
  end: () => ({ type: "end" }),
  open: true,
  bots: [
    greedyBot(),
    oneAheadBot(),
    bestPlanBot(),
    scaledPlanBot("order blind", "The best plan by area alone: it never sees the order.", 0),
    scaledPlanBot("order chaser", "The best plan with the order counted three times over: it frees the plate whatever it costs (the bait).", 3),
    moveOnBot("move on", CUT_WORTH),
  ],
  baits: [
    { bait: "order chaser", beats: "best plan" },
    { bait: "best plan", beats: "move on" },
  ],
};
