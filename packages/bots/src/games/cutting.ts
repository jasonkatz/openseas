/**
 * Cutting for the bots: a choice is one cut, any piece on the table along any grid line inside it,
 * or giving the slab up. The moves are untimed, so a person's pace is modelled per cut. The four
 * cutters of the tuning notes are here: random is the careless bot every puzzle gets, and greedy,
 * one cut ahead and the best plan are the puzzle's own, read from the engine's own sums.
 */
import {
  CUTTING_DEF,
  cuttingBestCut,
  cuttingCutPreview,
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

export const CUTTING_BOTS: BotGame<CuttingState, CuttingMove, CuttingConfig> = {
  id: "cutting",
  def: CUTTING_DEF,
  pace: "30 cuts in 120 s, a slab given up in 1 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_CUT + (s.logLength - s.moveCount) * SECONDS_PER_DONE,
  choices: (s): Choice<CuttingMove>[] => [...cuttingCuts(s).map((c) => ({ moves: [c] })), { moves: [{ type: "done" }] }],
  end: () => ({ type: "end" }),
  open: true,
  bots: [greedyBot(), oneAheadBot(), bestPlanBot()],
};
