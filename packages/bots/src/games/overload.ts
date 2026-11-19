/**
 * Overload for the bots: a choice is one tap on any capacitor, made a person's think time after the
 * last one (one tap every 1.5 seconds, the pace the tuning notes model), or as soon as a tap comes
 * back when the hand is empty. The round runs on the engine's own ticks. A tap that sets nothing off
 * scores nothing now, so a tap is weighed by its points and then, by less than a point, by the best
 * chain it leaves: the one-move bot is the best single tap, and the rollout sees which charges set
 * something up. The draw's bots weigh a tap by what the engine would pay for it (`overloadChainPoints`),
 * the draw in or out.
 */
import {
  OVERLOAD_DEF,
  OVERLOAD_FULL,
  advanceOverload,
  overloadChainPoints,
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

/** The bank as a bot blind to the draw reads it: the same bank, with no draw asked for. */
function blind(state: OverloadState): OverloadState {
  return state.config.drawSizes.length === 0 ? state : { ...state, config: { ...state.config, drawSizes: [] } };
}

interface Tapped {
  readonly cell: number;
  readonly size: number;
  readonly points: number;
  readonly met: boolean;
}

/** The best tap now by the points the engine would pay for it: among the 3s, the only ones that set anything off. */
function bestTap(state: OverloadState): Tapped | null {
  let best: Tapped | null = null;
  for (let c = 0; c < state.cells.length; c++) {
    if (state.cells[c]!.charge + 1 < OVERLOAD_FULL) continue;
    const size = overloadChainSize(state, c);
    const p = overloadChainPoints(state, size);
    if (size > 0 && (!best || p.points > best.points)) best = { cell: c, size, points: p.points, met: p.met };
  }
  return best;
}

/**
 * The planners: weigh every tap by the points the engine would pay for it (the draw included when
 * `seesDraw`, else as if none were asked for). Charge first when no tap reaches the streak and one
 * charge makes a longer chain, or when one charge makes the best tap worth `ratio` times what it is
 * now; else set off the best tap. `chase`: once the best tap meets the draw, charge anyway when one
 * charge makes a longer chain (the bait: n × n looks bigger, and it overshoots the band).
 */
function plannerBot(name: string, about: string, seesDraw: boolean, ratio: number, chase = false): Bot<OverloadState, OverloadMove> {
  return {
    name,
    about,
    choose(real, ctx) {
      const tick = nextTapTick(real);
      if (tick === null) return null;
      const state = seesDraw ? real : blind(real);
      const cfg = state.config;
      const now = bestTap(state);
      let charge: (Tapped & { at: number }) | null = null;
      for (let p = 0; p < state.cells.length; p++) {
        if (state.cells[p]!.charge + 1 >= OVERLOAD_FULL) continue;
        const after = bestTap(charged(state, p));
        if (after && (!charge || after.points > charge.points)) charge = { ...after, at: p };
      }
      const nowLong = now !== null && now.size >= cfg.streakMin;
      if (charge && !nowLong && (!now || charge.size > now.size)) return tapAt(charge.at, tick);
      if (charge && now && charge.points >= now.points * ratio) return tapAt(charge.at, tick);
      if (chase && charge && now && now.met) {
        let bigger: number | null = null;
        let size = now.size;
        for (let p = 0; p < state.cells.length; p++) {
          if (state.cells[p]!.charge + 1 >= OVERLOAD_FULL) continue;
          const s = longest(charged(state, p)).size;
          if (s > size) [bigger, size] = [p, s];
        }
        if (bigger !== null) return tapAt(bigger, tick);
      }
      if (now) return tapAt(now.cell, tick);
      if (charge) return tapAt(charge.at, tick);
      return tapAt(ctx.rng.int(state.cells.length), tick);
    },
  };
}

/**
 * The draw seeker: the joiner, looking two charges ahead. It weighs the best tap now, the best after
 * one charge and the best after two (the first charges it tries are the `width` best by one charge),
 * divided by `ratio` and `ratio2` for the taps they spend, with the draw's points in; charges first
 * when no tap reaches the streak, as every planner does.
 */
function seekerBot(name: string, about: string, seesDraw: boolean, ratio: number, ratio2: number, width = 6): Bot<OverloadState, OverloadMove> {
  return {
    name,
    about,
    choose(real, ctx) {
      const tick = nextTapTick(real);
      if (tick === null) return null;
      const state = seesDraw ? real : blind(real);
      const cfg = state.config;
      const now = bestTap(state);
      const ones: Array<Tapped & { at: number }> = [];
      for (let p = 0; p < state.cells.length; p++) {
        if (state.cells[p]!.charge + 1 >= OVERLOAD_FULL) continue;
        const after = bestTap(charged(state, p));
        if (after) ones.push({ ...after, at: p });
      }
      ones.sort((a, b) => b.points - a.points);
      const one = ones[0] ?? null;
      const nowLong = now !== null && now.size >= cfg.streakMin;
      if (one && !nowLong && (!now || one.size > now.size)) return tapAt(one.at, tick);
      let two: { at: number; points: number } | null = null;
      if (advanceOverload(state, tick).taps >= 3) {
        for (const first of ones.slice(0, width)) {
          const s1 = charged(state, first.at);
          for (let q = 0; q < s1.cells.length; q++) {
            if (s1.cells[q]!.charge + 1 >= OVERLOAD_FULL) continue;
            const after = bestTap(charged(s1, q));
            if (after && (!two || after.points > two.points)) two = { at: first.at, points: after.points };
          }
        }
      }
      const v0 = now ? now.points : 0;
      const v1 = one ? one.points / ratio : 0;
      const v2 = two ? two.points / ratio2 : 0;
      if (two && v2 > v1 && v2 > v0) return tapAt(two.at, tick);
      if (one && v1 > v0) return tapAt(one.at, tick);
      if (now) return tapAt(now.cell, tick);
      if (one) return tapAt(one.at, tick);
      return tapAt(ctx.rng.int(state.cells.length), tick);
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
    plannerBot("joiner", "Blind to the draw: charges to reach four, and when one charge doubles the best tap.", false, 2),
    seekerBot("seeker", "Blind to the draw: looks two charges ahead, a charge worth half and two a third.", false, 2, 3),
    plannerBot("draw joiner", "Plays the draw: the joiner, weighing every tap with the draw's points.", true, 2),
    seekerBot("draw seeker", "Plays the draw: the seeker, weighing every tap with the draw's points.", true, 2, 3),
    plannerBot("biggest chain", "The draw joiner, but once a tap meets the draw it charges for any longer chain (the bait: it overshoots the band).", true, 2, true),
    chargeAheadBot("greedy charge", `One charge ahead, but charges for any gain of ${GREEDY_GAIN} points (the bait).`, GREEDY_GAIN),
  ],
  baits: [
    { bait: "greedy charge", beats: "one charge ahead" },
    { bait: "biggest chain", beats: "draw seeker" },
  ],
};
