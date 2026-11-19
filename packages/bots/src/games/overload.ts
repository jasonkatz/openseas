/**
 * Overload for the bots: a choice is one tap on any capacitor, made a person's think time after the
 * last one (one tap every 1.5 seconds, the pace the tuning notes model), or as soon as a tap comes
 * back when the hand is empty. The round runs on the engine's own ticks. A tap that sets nothing off
 * scores nothing now, so a tap is weighed by its points and then, by less than a point, by the best
 * chain it leaves: the one-move bot is the best single tap, and the rollout sees which charges set
 * something up.
 */
import {
  OVERLOAD_DEF,
  OVERLOAD_FULL,
  advanceOverload,
  overloadChainSize,
  overloadChainValue,
  overloadHint,
  overloadNeighbours,
  overloadStreakPercentAt,
  type OverloadConfig,
  type OverloadMove,
  type OverloadState,
} from "@openseas/engine";
import type { Bot, BotContext, BotGame, Choice } from "../core.js";

/** A person's think time between taps, from the tuning notes: one tap every 1.5 seconds. */
const THINK_SECONDS = 1.5;
/** The one-charge-ahead bot charges first when one charge adds this many points or more (the tuning notes' 70). */
const JOIN_GAIN = 70;
/** The bait charges first for any gain this big (the tuning notes' 20). */
const GREEDY_GAIN = 20;

type Tap = Extract<OverloadMove, { type: "tap" }>;

/** Ticks of think time, on the round's clock. */
const thinkTicks = (cfg: OverloadConfig): number => Math.max(1, Math.round((THINK_SECONDS * 1000) / cfg.tickMs));

/** The tick the next tap lands at: think time on, or later when the hand is empty until a tap comes back. Null past the round. */
function nextTapTick(state: OverloadState): number | null {
  const cfg = state.config;
  const t = state.tick + thinkTicks(cfg);
  if (t > cfg.maxTick) return null;
  const at = advanceOverload(state, t);
  if (at.taps >= 1) return t;
  const back = at.regenFrom + cfg.tapRegenTicks;
  return back <= cfg.maxTick ? back : null;
}

const tapAt = (cell: number, tick: number): Choice<OverloadMove> => ({ moves: [{ type: "tap", cell, tick } satisfies Tap] });

/** What a chain of `size` set off from `state` scores, the streak it would build or break included. */
function chainPoints(state: OverloadState, size: number): number {
  if (size <= 0) return 0;
  const cfg = state.config;
  const percent = size >= cfg.streakMin ? overloadStreakPercentAt(cfg, state.combo + 1) : 100;
  return Math.floor((overloadChainValue(cfg, size) * percent) / 100);
}

/** Every capacitor's chain if tapped now, by cell: 0 where a tap only charges. Only a 3 can set one off, so only 3s are asked. */
const chainSizes = (state: OverloadState): number[] => state.cells.map((cell, c) => (cell.charge + 1 >= OVERLOAD_FULL ? overloadChainSize(state, c) : 0));

/** The longest chain one tap sets off now, and the cells that set it off. */
function longest(state: OverloadState): { size: number; cells: number[] } {
  const sizes = chainSizes(state);
  let size = 0;
  for (const s of sizes) size = Math.max(size, s);
  return { size, cells: size > 0 ? sizes.flatMap((s, c) => (s === size ? [c] : [])) : [] };
}

/** The bank with one more charge on `cell`, nothing set off: what a charging tap leaves, to read the next tap on. */
function charged(state: OverloadState, cell: number): OverloadState {
  const cells = state.cells.slice();
  cells[cell] = { ...cells[cell]!, charge: cells[cell]!.charge + 1 };
  return { ...state, cells };
}

/** The best charge: the capacitor that, charged, leaves the longest chain for the tap after. */
function bestCharge(state: OverloadState): { cell: number; size: number } | null {
  let best: { cell: number; size: number } | null = null;
  for (let p = 0; p < state.cells.length; p++) {
    if (state.cells[p]!.charge + 1 >= OVERLOAD_FULL) continue;
    const size = longest(charged(state, p)).size;
    if (!best || size > best.size) best = { cell: p, size };
  }
  return best;
}

/** What the best tap from `state` scores: the setup a charge leaves, as a careful player sees it. */
function bestNext(state: OverloadState): number {
  return chainPoints(state, longest(state).size);
}

/**
 * The tuning notes' one-charge-ahead player, and the bait beside it: set off the longest chain when
 * it reaches the streak and no charge adds `gain` points or more; otherwise charge the capacitor that
 * makes the next chain longest.
 */
function chargeAheadBot(name: string, about: string, gain: number): Bot<OverloadState, OverloadMove> {
  return {
    name,
    about,
    choose(state, ctx) {
      const tick = nextTapTick(state);
      if (tick === null) return null;
      const now = longest(state);
      const charge = bestCharge(state);
      const cfg = state.config;
      // The gain is read before the streak, as the tuning notes' bot read it.
      const added = charge ? overloadChainValue(cfg, charge.size) - overloadChainValue(cfg, now.size) : 0;
      const fire = now.size > 0 && (!charge || charge.size <= now.size || (now.size >= cfg.streakMin && added < gain));
      if (fire) return tapAt(ctx.rng.pick(now.cells), tick);
      if (charge) return tapAt(charge.cell, tick);
      return tapAt(ctx.rng.int(state.cells.length), tick);
    },
  };
}

/** Any 3: sets off any capacitor at 3, and charges one at random when none is. */
function anyThreeBot(): Bot<OverloadState, OverloadMove> {
  return {
    name: "any 3",
    about: "Taps any capacitor at 3; with none, charges one at random.",
    choose(state, ctx) {
      const tick = nextTapTick(state);
      if (tick === null) return null;
      const threes = state.cells.flatMap((c, i) => (c.charge === 3 ? [i] : []));
      return tapAt(threes.length ? ctx.rng.pick(threes) : ctx.rng.int(state.cells.length), tick);
    },
  };
}

/** Biggest clump: a 3 in the biggest group of touching 3s, read by eye, not by the chain it sets off. */
function biggestClumpBot(): Bot<OverloadState, OverloadMove> {
  return {
    name: "biggest clump",
    about: "Taps a 3 in the biggest group of touching 3s; with none, charges one at random.",
    choose(state, ctx) {
      const tick = nextTapTick(state);
      if (tick === null) return null;
      const cfg = state.config;
      const seen = new Array<boolean>(state.cells.length).fill(false);
      let best: number[] = [];
      for (let s = 0; s < state.cells.length; s++) {
        if (seen[s] || state.cells[s]!.charge !== 3) continue;
        const clump: number[] = [];
        const stack = [s];
        seen[s] = true;
        while (stack.length) {
          const c = stack.pop()!;
          clump.push(c);
          for (const n of overloadNeighbours(cfg, c)) {
            if (!seen[n] && state.cells[n]!.charge === 3) {
              seen[n] = true;
              stack.push(n);
            }
          }
        }
        if (clump.length > best.length) best = clump;
      }
      return tapAt(best.length ? ctx.rng.pick(best) : ctx.rng.int(state.cells.length), tick);
    },
  };
}

/** Charge to four: the engine's idle hint, followed every tap. It charges only to reach the streak. */
function hintBot(): Bot<OverloadState, OverloadMove> {
  return {
    name: "charge to four",
    about: "Follows the idle hint: the longest chain, or a charge first when no tap reaches four.",
    choose(state, ctx: BotContext<OverloadState, OverloadMove>) {
      const tick = nextTapTick(state);
      if (tick === null) return null;
      const h = overloadHint(state);
      return tapAt(h ? h.cell : ctx.rng.int(state.cells.length), tick);
    },
  };
}

export const OVERLOAD_BOTS: BotGame<OverloadState, OverloadMove, OverloadConfig> = {
  id: "overload",
  def: OVERLOAD_DEF,
  pace: "a tap every 1.5 s, or when one comes back",
  elapsed: (s) => (s.tick * s.config.tickMs) / 1000,
  choices: (s): Choice<OverloadMove>[] => {
    const tick = nextTapTick(s);
    return tick === null ? [] : s.cells.map((_, c) => tapAt(c, tick));
  },
  end: (s, roundSeconds) => ({ type: "end", tick: Math.max(s.tick, Math.min(s.config.maxTick, Math.round((roundSeconds * 1000) / s.config.tickMs))) }),
  // Points first, so a one-move bot is the tuning notes' best single tap. The setup a tap leaves is a
  // fraction of a point beside them: it orders the charges, for the rollout and for a bank with no 3.
  worth: (before, after) => {
    const next = bestNext(after);
    return after.score - before.score + next / (next + 1000);
  },
  open: true,
  bots: [
    anyThreeBot(),
    biggestClumpBot(),
    hintBot(),
    chargeAheadBot("one charge ahead", `Sets off the longest chain once it reaches four, unless one charge adds ${JOIN_GAIN} points; else charges for the longest next chain.`, JOIN_GAIN),
    chargeAheadBot("greedy charge", `One charge ahead, but charges for any gain of ${GREEDY_GAIN} points (the bait).`, GREEDY_GAIN),
  ],
  baits: [{ bait: "greedy charge", beats: "one charge ahead" }],
};
