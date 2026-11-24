/**
 * Refining for the bots: a choice is one swap along a link, a person's think time after the last
 * (a swap a second, the pace the tuning notes model), an early draw of the outlet, or a wait for the
 * clock's next draw. The round runs on the engine's own ticks. A swap scores nothing now, so a
 * choice is weighed by its points and then by how much better sorted it leaves the tower: columns
 * all vapour or all the rest, nearest the outlet first.
 */
import {
  REFINING_DEF,
  advanceRefining,
  refiningAfterSwap,
  refiningDrawValue,
  refiningHint,
  refiningLinks,
  refiningSortedness,
  type RefiningConfig,
  type RefiningDir,
  type RefiningMove,
  type RefiningState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's think time between swaps, from the tuning notes: a swap a second. */
const THINK_SECONDS = 1;

const thinkTicks = (cfg: RefiningConfig): number => Math.max(1, Math.round((THINK_SECONDS * 1000) / cfg.tickMs));

/** The tick the next choice lands at, or null past the round. */
function nextTick(state: RefiningState): number | null {
  const t = state.tick + thinkTicks(state.config);
  return t <= state.config.maxTick ? t : null;
}

const swapsAt = (shown: RefiningState, tick: number): Choice<RefiningMove>[] => refiningLinks(shown).map((l) => ({ moves: [{ type: "swap", cell: l.cell, dir: l.dir, tick }] }));
const drawAt = (tick: number): Choice<RefiningMove> => ({ moves: [{ type: "draw", tick }] });
const waitAt = (tick: number): Choice<RefiningMove> => ({ moves: [{ type: "wait", tick }] });

/** Wait for the clock's draw, or to the end of the round. */
function waitForClock(state: RefiningState): Choice<RefiningMove> | null {
  const t = Math.min(state.config.maxTick, Math.max(state.tick + 1, state.nextDraw));
  return t > state.tick ? waitAt(t) : null;
}

/** What the player sees at the next choice: the tower once the clock has drawn what it will by then. */
function seen(state: RefiningState): { shown: RefiningState; tick: number } | null {
  const tick = nextTick(state);
  if (tick === null) return null;
  return { shown: advanceRefining(state, tick), tick };
}

/** True when drawing the outlet now is plainly good: a clear column, or a dump that leaves the run alone. */
const ready = (s: RefiningState): boolean => {
  const v = refiningDrawValue(s);
  return v.grade === "clear" || v.grade === "dump";
};

/**
 * A sorter: the swap that sorts the tower most, a second at a time, and the clock's draws. With
 * `early`, it draws the outlet itself whenever the outlet is `drawWhen`.
 */
function sorterBot(name: string, about: string, drawWhen: ((s: RefiningState) => boolean) | null): Bot<RefiningState, RefiningMove> {
  return {
    name,
    about,
    choose(state) {
      const at = seen(state);
      if (!at) return waitForClock(state);
      if (drawWhen && drawWhen(at.shown)) return drawAt(at.tick);
      const h = refiningHint(at.shown);
      if (h) return { moves: [{ type: "swap", cell: h.cell, dir: h.dir, tick: at.tick }] };
      return waitAt(at.tick);
    },
  };
}

/** The best first swap of the best two swaps by the tower's sorting: a player who sees one swap set up the next. */
function bestPair(s: RefiningState, near = false): { cell: number; dir: RefiningDir } | null {
  const base = refiningSortedness(s);
  const w = s.config.width;
  let best: { cell: number; dir: RefiningDir; value: number } | null = null;
  // `near` keeps to the outlet and the column beside it: the pieces about to be drawn.
  for (const a of refiningLinks(s).filter((l) => !near || l.cell % w >= w - 2)) {
    const one = refiningAfterSwap(s, a.cell, a.dir)!;
    let value = refiningSortedness(one) - base;
    for (const b of refiningLinks(one)) {
      const two = refiningAfterSwap(one, b.cell, b.dir)!;
      value = Math.max(value, (refiningSortedness(two) - base) * 0.9);
    }
    if (value > 0 && (!best || value > best.value)) best = { ...a, value };
  }
  return best;
}

/** Two ahead: the first of the best two swaps, and early draws when the outlet is `drawWhen`. */
function twoAheadBot(name: string, about: string, drawWhen: (s: RefiningState) => boolean, near = false): Bot<RefiningState, RefiningMove> {
  return {
    name,
    about,
    choose(state) {
      const at = seen(state);
      if (!at) return waitForClock(state);
      if (drawWhen(at.shown)) return drawAt(at.tick);
      const p = bestPair(at.shown, near);
      if (p) return { moves: [{ type: "swap", cell: p.cell, dir: p.dir, tick: at.tick }] };
      return waitAt(at.tick);
    },
  };
}

export const REFINING_BOTS: BotGame<RefiningState, RefiningMove, RefiningConfig> = {
  id: "refining",
  def: REFINING_DEF,
  pace: "a swap a second",
  elapsed: (s) => (s.tick * s.config.tickMs) / 1000,
  choices: (s): Choice<RefiningMove>[] => {
    const at = seen(s);
    if (!at) return [];
    return [...swapsAt(at.shown, at.tick), drawAt(at.tick), waitAt(at.tick)];
  },
  end: (s, roundSeconds) => ({ type: "end", tick: Math.max(s.tick, Math.min(s.config.maxTick, Math.round((roundSeconds * 1000) / s.config.tickMs))) }),
  // Points first; the sorting a choice leaves is less than a point beside them, so it orders the swaps.
  worth: (before, after) => {
    const sorted = refiningSortedness(after) - refiningSortedness(before);
    return after.score - before.score + sorted / 1000;
  },
  open: true,
  bots: [
    sorterBot("sorter", "Takes the swap that sorts the tower most, a second at a time, and leaves the draws to the clock.", null),
    sorterBot("early sorter", "The sorter, but draws the outlet itself when it is clear or a dump.", ready),
    twoAheadBot("two ahead", "Draws the outlet when it is clear or a dump; else takes the first of the two swaps that sort the tower most.", ready),
    twoAheadBot("cash in", "Two ahead, but draws the outlet whenever it would score at all, smooth columns too.", (s) => ready(s) || refiningDrawValue(s).points > 0),
    twoAheadBot("outlet only", "Two ahead, but works only the outlet and the column beside it: the pieces about to be drawn (the bait).", ready, true),
  ],
  baits: [{ bait: "outlet only", beats: "two ahead" }],
  slow: ["two ahead", "cash in", "outlet only"],
};
