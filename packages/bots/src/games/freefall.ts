/**
 * Freefall for the bots: a choice is one drop, down any lane. The rival's answer is part of the
 * move, so a bot sees what it scored and, if it looks, what it left the rival.
 */
import { FREEFALL_DEF, freefallEntryLanes, freefallFall, type FreefallConfig, type FreefallMove, type FreefallState } from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: a drop every 3 seconds, the rival's answer played out included. */
const SECONDS_PER_DROP = 3;

function drops(state: FreefallState): FreefallMove[] {
  const out: FreefallMove[] = [];
  const [lo, hi] = freefallEntryLanes(state.config);
  for (let l = lo; l <= hi; l++) out.push({ type: "drop", lane: l });
  return out;
}

/** What the best drop on `state`'s shaft would score, for whoever drops next. */
function bestReply(state: FreefallState, rockers: FreefallState["rockers"], leg: number): number {
  let best = 0;
  const [lo, hi] = freefallEntryLanes(state.config);
  for (let l = lo; l <= hi; l++) best = Math.max(best, freefallFall(state.config, rockers, leg, l, 1_000_000).points);
  return best;
}

/** Points now less the best the rival could take from what the drop leaves: a player who reads the reply. */
function denierBot(weight = 1): Bot<FreefallState, FreefallMove> {
  return {
    name: weight === 1 ? "denier" : `denier x${weight}`,
    about: `Weighs each drop by its points less ${weight === 1 ? "" : `${weight} times `}the best drop it leaves the rival.`,
    choose(state, ctx) {
      let best: FreefallMove[] = [];
      let bestValue = -Infinity;
      for (const m of drops(state)) {
        if (m.type !== "drop") continue;
        const f = freefallFall(state.config, state.rockers, state.leg, m.lane, state.nextId);
        const reply = state.config.rival ? bestReply(state, f.rockers, state.leg) : 0;
        const value = f.points - weight * reply;
        if (value > bestValue) {
          bestValue = value;
          best = [m];
        } else if (value === bestValue) best.push(m);
      }
      return best.length ? { moves: [ctx.rng.pick(best)] } : null;
    },
  };
}

/** The bait: always down the entry lane over the richest berth it could fall straight into, as if the berth were the whole puzzle. */
function edgeBot(): Bot<FreefallState, FreefallMove> {
  return {
    name: "edge chaser",
    about: "Drops down the entry lane over the richest berth, whatever the rockers below it hold (a bait).",
    choose(state, ctx) {
      const cfg = state.config;
      const [lo] = freefallEntryLanes(cfg);
      const values = Array.from({ length: cfg.entry }, (_, i) => freefallFall(cfg, [], state.leg, lo + i, 1).points);
      const top = Math.max(...values);
      const lanes = values.flatMap((v, i) => (v === top ? [lo + i] : []));
      return { moves: [{ type: "drop", lane: ctx.rng.pick(lanes) }] };
    },
  };
}

export const FREEFALL_BOTS: BotGame<FreefallState, FreefallMove, FreefallConfig> = {
  id: "freefall",
  def: FREEFALL_DEF,
  pace: "a drop every 3 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_DROP,
  choices: (s): Choice<FreefallMove>[] => drops(s).map((m) => ({ moves: [m] })),
  end: () => ({ type: "end" }),
  open: true,
  bots: [denierBot(), edgeBot()],
  baits: [
    { bait: "edge chaser", beats: "one move" },
    { bait: "one move", beats: "denier" },
  ],
};
