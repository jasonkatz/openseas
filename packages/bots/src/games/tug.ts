/**
 * Tug for the bots: a choice is one flick of one pod, or a skip. Every flick the engine allows is
 * offered (at most four pods times four directions), so nothing here re-derives where a pod stops:
 * the engine's own `tugSlide`, `tugFlickIllegalReason` and `tugSolve` say it. Tug has no clock of
 * its own, so a person is modelled by the seconds a flick takes, from the tuning notes' bots.
 */
import {
  TUG_DEF,
  tugFlickIllegalReason,
  tugSlide,
  tugSolve,
  type TugConfig,
  type TugDir,
  type TugMove,
  type TugState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: their bots were weighed over 60 flicks, a 120 second round. */
const SECONDS_PER_FLICK = 120 / 60;
const DIRS: readonly TugDir[] = [0, 1, 2, 3];
const SKIP: Choice<TugMove> = { moves: [{ type: "skip" }] };

/** Every flick the engine allows from here, pods and directions in order. */
function flicks(state: TugState): Choice<TugMove>[] {
  const out: Choice<TugMove>[] = [];
  for (let pod = 0; pod < state.pods.length; pod++) {
    for (const dir of DIRS) if (tugFlickIllegalReason(state, pod, dir) === null) out.push({ moves: [{ type: "flick", pod, dir }] });
  }
  return out;
}

/** The flicks that deliver the lit clamp now, the ones the ghosts show. */
function delivering(state: TugState): Choice<TugMove>[] {
  const { pod, cell } = state.clamp;
  const out: Choice<TugMove>[] = [];
  for (const dir of DIRS) {
    if (tugFlickIllegalReason(state, pod, dir) === null && tugSlide(state, pod, dir).to === cell) out.push({ moves: [{ type: "flick", pod, dir }] });
  }
  return out;
}

/** The next flick of a par route from here, or null when the clamp is more than `maxPar` flicks away. */
function parFlick(state: TugState): Choice<TugMove> | null {
  const route = tugSolve(state);
  const first = route?.[0];
  return first ? { moves: [first] } : null;
}

/**
 * The tuning notes' ghost reader: it sees one flick ahead, as the ghosts show. A flick that delivers
 * is taken; otherwise the wanted pod is flicked somewhere (most of the time) or any pod is.
 */
function ghostChoice(state: TugState, rng: { int(n: number): number; pick<T>(xs: readonly T[]): T }): Choice<TugMove> | null {
  const now = delivering(state);
  if (now.length) return rng.pick(now);
  const all = flicks(state);
  if (all.length === 0) return SKIP;
  const wanted = all.filter((c) => c.moves[0]?.type === "flick" && c.moves[0].pod === state.clamp.pod);
  return wanted.length && rng.int(4) < 3 ? rng.pick(wanted) : rng.pick(all);
}

function ghostBot(): Bot<TugState, TugMove> {
  return {
    name: "ghost reader",
    about: "Sees one flick ahead: takes a flick that delivers, else flicks the wanted pod (three times in four) or any pod.",
    choose: (state, ctx) => ghostChoice(state, ctx.rng),
  };
}

function solverBot(): Bot<TugState, TugMove> {
  return {
    name: "par route",
    about: "Plays the engine's par route for every clamp, so every delivery is clean (the notes' machine that never thinks).",
    choose: (state) => parFlick(state) ?? SKIP,
  };
}

/** A number in [0, 1) fixed by the clamp and a try count, so a player's read of a clamp holds across its flicks. */
function roll(state: TugState, attempt: number, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const v of [state.delivered, state.skipped, state.clamp.pod, state.clamp.cell, state.clamp.par, attempt, ...state.pods]) {
    h = Math.imul(h ^ v, 16777619);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * A modelled player from the tuning notes: odds of seeing the par route by the clamp's par. A clamp
 * it reads is played on the par route; one it does not is played as the ghost reader would, and
 * after par plus the slack in flicks it looks again. A clamp still out of reach after that many
 * looks is skipped.
 */
function modelBot(name: string, about: string, odds: readonly number[], salt: number): Bot<TugState, TugMove> {
  return {
    name,
    about,
    choose(state, ctx) {
      const par = state.clamp.par;
      const window = par + state.config.slack + 1;
      const attempt = Math.floor(state.flicks / window);
      if (attempt >= 3) return SKIP;
      const sees = roll(state, attempt, salt) < (odds[Math.min(par, odds.length) - 1] ?? 0);
      if (sees) {
        const next = parFlick(state);
        if (next) return next;
        // Wandered past where a route is in reach: give it up.
        return SKIP;
      }
      return ghostChoice(state, ctx.rng);
    },
  };
}

export const TUG_BOTS: BotGame<TugState, TugMove, TugConfig> = {
  id: "tug",
  def: TUG_DEF,
  pace: "60 flicks in 120 s",
  elapsed: (s) => s.logLength * SECONDS_PER_FLICK,
  choices: (s): Choice<TugMove>[] => [...flicks(s), SKIP],
  end: () => ({ type: "end" }),
  // A skip always costs its penalty to a one-move player, even with nothing to lose yet.
  worth: (before, after, choice) => (choice.moves[0]?.type === "skip" ? -before.config.skipPenalty : after.score - before.score),
  open: true,
  bots: [
    ghostBot(),
    modelBot("novice", "Sees the par route at par one and two nearly always, at par three under half the time, rarely at four; else plays as the ghost reader.", [0.95, 0.95, 0.45, 0.15], 1),
    modelBot("steady", "Sees the par route at par three three times in four and at four half the time; else plays as the ghost reader.", [1, 0.95, 0.75, 0.5], 2),
    solverBot(),
  ],
};
