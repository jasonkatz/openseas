/**
 * Reactor for the bots: a choice is one swipe, any of the engine's legal directions. The moves are
 * untimed, so the clock is the tuning notes' pace, 110 swipes in a 120 second round. The puzzle's
 * own bots are the notes' corner habit, planner and stacker, and a hoarder that piles hot rods up
 * for a big salvo: the bait, set against the one-move bot, since four hot rods at once scram the core.
 * Core pressure adds three: the stacker blind to it, the stacker that reads the gauge, and the
 * planning hoarder, who parks a rod at a port and waits for a triple (its bait).
 */
import {
  REACTOR_DEF,
  reactorHotCount,
  reactorIsHot,
  reactorLegalDirs,
  reactorPortLoad,
  reactorPortStatus,
  reactorSwipeOutcome,
  type ReactorConfig,
  type ReactorDir,
  type ReactorMove,
  type ReactorState,
} from "@openseas/engine";
import { reseed, type Bot, type BotContext, type BotGame, type Choice } from "../core.js";

/** A person's pace, from the tuning notes: 110 swipes in a 120 second round, about a swipe a second. */
const SECONDS_PER_SWIPE = 120 / 110;
/** Swipes the planner and its kin look ahead, as in the tuning notes. */
const PLAN_DEPTH = 3;
/** Swipes the hoarder looks ahead: one, as the one-move bot it is set against. */
const HOARD_DEPTH = 1;
/** Fresh random streams each plan is weighed on: where the next rods enter is not known. */
const PLAN_SAMPLES = 2;

const swipe = (dir: ReactorDir): Choice<ReactorMove> => ({ moves: [{ type: "swipe", dir }] });

/** How a bot reads a core beyond its score: what it holds, and what it is worth to have it. */
interface Weights {
  /** Each empty cell: room to work in. */
  readonly empty: number;
  /** Each rod by its grade squared: fuel on its way to hot. */
  readonly grade: number;
  /** A hot rod at an open port with nothing in front of it, by how many are stacked there (1, 2, 3+). */
  readonly ready: readonly number[];
  /** A hot rod in a port's lane behind another rod. */
  readonly blocked: number;
  /** A hot rod nowhere near a port. */
  readonly loose: number;
  /** One hot rod short of a scram. */
  readonly brink: number;
  /** Each scram so far, beyond the points it took. */
  readonly scram: number;
  /** Reads the pressure gauge: each mark past half its limit costs this much. Absent: the gauge is only seen through a scram the lookahead meets. */
  readonly press?: number;
}

/** The planner's reading: a ready rod is worth a little under what it pays, and the brink is feared. */
const PLANNER: Weights = { empty: 4, grade: 2, ready: [60, 160, 260], blocked: 25, loose: 10, brink: -90, scram: -250 };
/** The stacker's: a lone ready rod is worth keeping a while, and two stacked at a port worth a lot. */
const STACKER: Weights = { empty: 4, grade: 2, ready: [120, 320, 520], blocked: 60, loose: 40, brink: -60, scram: -250 };
/** The hoarder's: every hot rod is treasure, wherever it is, and the lamps mean nothing. */
const HOARDER: Weights = { empty: 3, grade: 2, ready: [120, 320, 520], blocked: 120, loose: 120, brink: 0, scram: 0 };

/** The core read by `w`, its score included. */
function evaluate(state: ReactorState, w: Weights): number {
  const cfg = state.config;
  let v = state.score + w.scram * state.scrams;
  for (const rod of state.cells) {
    if (!rod) v += w.empty;
    else if (!reactorIsHot(cfg, rod.grade)) v += w.grade * rod.grade * rod.grade;
  }
  const hot = reactorHotCount(cfg, state.cells);
  let placed = 0;
  for (const port of state.ports) {
    const status = reactorPortStatus(state, port);
    if (status === "ready") {
      const load = reactorPortLoad(state, port);
      v += w.ready[Math.min(load, w.ready.length) - 1]!;
      placed += load;
    } else if (status === "blocked") {
      v += w.blocked;
      placed += 1;
    }
  }
  v += w.loose * Math.max(0, hot - placed);
  if (hot >= cfg.criticalHot - 1) v += w.brink;
  if (w.press && cfg.pressureLimit > 0) v -= w.press * Math.max(0, state.pressure - cfg.pressureLimit / 2);
  return v;
}

/** The best reading `depth` swipes on from `state`, each swipe on a fresh stream from `seed`. */
function lookahead(state: ReactorState, depth: number, w: Weights, seed: string): number {
  if (depth === 0 || state.finished) return evaluate(state, w);
  const dirs = reactorLegalDirs(state);
  if (dirs.length === 0) return evaluate(state, w);
  let top = -Infinity;
  for (const d of dirs) {
    const after = REACTOR_DEF.reduce(reseed(state, `${seed}:${d}`), { type: "swipe", dir: d });
    top = Math.max(top, lookahead(after, depth - 1, w, `${seed}:${d}`));
  }
  return top;
}

/** The swipe whose best plan `PLAN_DEPTH` swipes on reads highest by `w`, over a few fresh streams, of `dirs`. */
function planSwipe(
  real: ReactorState,
  ctx: BotContext<ReactorState, ReactorMove>,
  w: Weights,
  dirs = reactorLegalDirs(real),
  depth = PLAN_DEPTH,
  blind?: Partial<ReactorConfig>,
): Choice<ReactorMove> | null {
  // A bot blind to a layer plans on a core where that layer is off.
  const state: ReactorState = blind ? { ...real, config: { ...real.config, ...blind } } : real;
  let best: Choice<ReactorMove>[] = [];
  let top = -Infinity;
  const seeds = Array.from({ length: PLAN_SAMPLES }, () => `plan:${ctx.rng.int(0x7fffffff)}`);
  for (const d of dirs) {
    const choice = swipe(d);
    if (ctx.apply(real, choice) === null) continue;
    let total = 0;
    for (const seed of seeds) {
      const after = REACTOR_DEF.reduce(reseed(state, `${seed}:${d}`), { type: "swipe", dir: d });
      total += lookahead(after, depth - 1, w, `${seed}:${d}`);
    }
    if (total > top) {
      top = total;
      best = [choice];
    } else if (total === top) best.push(choice);
  }
  return best.length ? ctx.rng.pick(best) : null;
}

function plannerBot(name: string, about: string, w: Weights, blind?: Partial<ReactorConfig>): Bot<ReactorState, ReactorMove> {
  return { name, about, choose: (state, ctx) => planSwipe(state, ctx, w, undefined, undefined, blind) };
}

/** How much the gauge stacker fears each mark of pressure past half the limit. */
const GAUGE_FEAR = 40;

/**
 * The bait: the hoard the tuning notes' critical core was set against. A one-swipe player like the
 * one-move bot, but it never sends a hot rod out alone while another swipe is open, only in a
 * salvo, and reads every hot rod as treasure, blind to the lamps.
 */
function hoarderBot(): Bot<ReactorState, ReactorMove> {
  return {
    name: "hoarder",
    about: "Looks one swipe ahead, never sends a hot rod out alone while it has another swipe, and piles hot rods up for a salvo, blind to the lamps (the bait).",
    choose(state, ctx) {
      const legal = reactorLegalDirs(state);
      const held = legal.filter((d) => reactorSwipeOutcome(state, d).discharges !== 1);
      return planSwipe(state, ctx, HOARDER, held.length ? held : legal, HOARD_DEPTH);
    },
  };
}

/**
 * The pressure bait: the hoard with the stacker's eyes. Three swipes ahead, it parks a hot rod at
 * a port and waits for more to join it, never sending one out alone while it has another swipe;
 * it reads the lamps and the gauge only through a scram its lookahead meets.
 */
function planningHoarderBot(): Bot<ReactorState, ReactorMove> {
  return {
    name: "planning hoarder",
    about: "Looks three swipes ahead, parks a hot rod at a port and waits for a salvo, never sending one out alone while it has another swipe; blind to the gauge but for a scram it can see coming (the bait).",
    choose(state, ctx) {
      const legal = reactorLegalDirs(state);
      const held = legal.filter((d) => reactorSwipeOutcome(state, d).discharges !== 1);
      return planSwipe(state, ctx, HOARDER, held.length ? held : legal);
    },
  };
}

/** The tuning notes' corner habit: down when it can, then left, then right, up last. */
function cornerBot(): Bot<ReactorState, ReactorMove> {
  const order: readonly ReactorDir[] = [2, 3, 1, 0];
  return {
    name: "corner habit",
    about: "Down when it can, then left, then right, and up last, blind to ports and lamps.",
    choose(state) {
      const legal = reactorLegalDirs(state);
      const d = order.find((o) => legal.includes(o));
      return d === undefined ? null : swipe(d);
    },
  };
}

export const REACTOR_BOTS: BotGame<ReactorState, ReactorMove, ReactorConfig> = {
  id: "reactor",
  def: REACTOR_DEF,
  pace: "110 swipes in 120 s",
  elapsed: (s) => s.moveCount * SECONDS_PER_SWIPE,
  choices: (s): Choice<ReactorMove>[] => reactorLegalDirs(s).map(swipe),
  end: () => ({ type: "end" }),
  // Points come late (a fusion now is a discharge seven swipes on), so a one-move player weighs the
  // core it leaves, the way the planner does, not the points alone.
  worth: (before, after) => evaluate(after, PLANNER) - evaluate(before, PLANNER),
  open: true,
  bots: [
    cornerBot(),
    plannerBot("planner", "Looks three swipes ahead on fresh streams, weighing points, room, hot rods at ports and the lamps.", PLANNER),
    plannerBot("stacker", "The planner, but a hot rod at a port is held for a second to join it in a salvo.", STACKER),
    hoarderBot(),
    plannerBot("blind stacker", "The stacker, planning as if the core had no pressure: it holds as long as the lamps allow.", STACKER, { pressureLimit: 0 }),
    plannerBot("gauge stacker", "The stacker, reading the gauge: each mark of pressure past half the limit is feared.", { ...STACKER, press: GAUGE_FEAR }),
    planningHoarderBot(),
  ],
  slow: ["planner", "stacker", "blind stacker", "gauge stacker", "planning hoarder"],
  baits: [
    { bait: "hoarder", beats: "one move" },
    { bait: "planning hoarder", beats: "gauge stacker" },
  ],
};
