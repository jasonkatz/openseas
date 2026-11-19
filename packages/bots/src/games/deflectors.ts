/**
 * Deflectors for the bots: a choice is a whole volley plan, the mirrors to flip and then a fire,
 * each move landing at the tick a person would get to it. Plans come from the engine's own search
 * (the best setting, `volleyRoute`) and from the rule the board teaches (join a beam's line to the
 * dots running back from its exit). Beside them are the single flips a person might try on a drawn
 * line, firing now, and waiting out the count. With no volley up, the one thing to do is wait.
 *
 * Every bot respects locks: a locked mirror is never flipped, and the search is asked for the best
 * with the locks as they stand. Only the rollout bot looks past the volley in hand, so only it plays
 * for which mirrors the next volley will find locked.
 */
import {
  DEFLECTORS_DEF,
  deflectorsOutlook,
  deflectorsResolve,
  deflectorsTrace,
  deflectorsVolleyRoute,
  type DeflectorsConfig,
  type DeflectorsMove,
  type DeflectorsState,
  type DeflectorsVolley,
} from "@openseas/engine";
import type { Bot, BotGame, Choice, Rng } from "../core.js";

/** A person's pace at the rule the board teaches, from the tuning notes: the 0.8 s joiner. */
const SECONDS_PER_FLIP = 0.8;
/** The time to see the long way round, from the tuning notes: the longest bot at 6 s a beam. */
const SECONDS_PER_BEAM = 6;
/** The joiner gives up on a volley after this many flips. */
const MAX_JOIN_FLIPS = 40;
/** The bait's tries at a longer route once every beam is home. */
const LENGTHEN_TRIES = 3;

const ticks = (cfg: DeflectorsConfig, seconds: number): number => Math.max(1, Math.round((seconds * 1000) / cfg.tickMs));

/** Each beam home as the mirrors stand. */
function homes(cfg: DeflectorsConfig, mirrors: readonly number[], volley: DeflectorsVolley): boolean[] {
  return volley.beams.map((b) => deflectorsTrace(cfg, mirrors, b.entry).out === b.exit);
}

/**
 * The moves of a plan from `state`: each flip at its own tick, then a fire. Flips that would land
 * after the count ends are dropped, and a fire that would is replaced by waiting for the volley to
 * fire by itself; then a wait for the next volley to be dealt. Nothing goes past the round's last
 * tick. Null when nothing fits.
 */
function planMoves(state: DeflectorsState, flips: readonly number[], at: readonly number[], fireAt: number): Choice<DeflectorsMove> | null {
  const cfg = state.config;
  const volley = state.volley;
  if (!volley) return null;
  const moves: DeflectorsMove[] = [];
  for (let i = 0; i < flips.length; i++) {
    const tick = state.tick + at[i]!;
    if (tick >= volley.fireTick || tick > cfg.maxTick) break;
    moves.push({ type: "flip", cell: flips[i]!, tick });
  }
  let fired = state.tick + fireAt;
  if (fired < volley.fireTick && fired <= cfg.maxTick) moves.push({ type: "fire", volley: volley.id, tick: fired });
  else fired = volley.fireTick;
  // Then on to the next volley, so every decision is made with one in sight.
  const next = fired + cfg.respawnTicks;
  if (next <= cfg.maxTick) moves.push({ type: "wait", tick: next });
  else if (fired <= cfg.maxTick && moves.at(-1)?.type !== "fire") moves.push({ type: "wait", tick: fired });
  return moves.length ? { moves } : null;
}

/** Flips one after another at a person's flip pace, then a fire one flip later. */
function pacedPlan(state: DeflectorsState, flips: readonly number[]): Choice<DeflectorsMove> | null {
  const step = ticks(state.config, SECONDS_PER_FLIP);
  return planMoves(state, flips, flips.map((_, i) => (i + 1) * step), (flips.length + 1) * step);
}

/** The best setting, as the engine's search finds it, seen in a person's time for each beam and fired. */
function longestPlan(state: DeflectorsState, secondsPerBeam = SECONDS_PER_BEAM): Choice<DeflectorsMove> | null {
  const volley = state.volley;
  if (!volley) return null;
  const route = deflectorsVolleyRoute(state.config, state.mirrors, volley.beams, state.locked);
  if (!route) return null;
  const total = ticks(state.config, secondsPerBeam * volley.beams.length);
  const n = route.flips.length;
  return planMoves(state, route.flips, route.flips.map((_, i) => Math.round((total * (i + 1)) / (n + 1))), total);
}

/** A mirror the player may flip: not locked. */
const free = (locked: readonly number[], cell: number): boolean => !((locked[cell] ?? 0) > 0);

/** The free mirrors on any waiting beam's drawn lines: its route as it stands and the dots back from its exit. */
function drawnMirrors(cfg: DeflectorsConfig, mirrors: readonly number[], volley: DeflectorsVolley, locked: readonly number[]): number[] {
  const out: number[] = [];
  for (const b of volley.beams) {
    for (const cell of deflectorsTrace(cfg, mirrors, b.entry).turns) if (!out.includes(cell) && free(locked, cell)) out.push(cell);
    for (const cell of deflectorsTrace(cfg, mirrors, b.exit).turns) if (!out.includes(cell) && free(locked, cell)) out.push(cell);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The joining rule, played on a copy of the mirrors: for the first beam astray, flip a mirror where
 * its line and the way back from its exit cross (one that leaves the other beams as they are, when
 * there is one), and otherwise any mirror on either line, then look again. `pick` chooses among
 * equals. A locked mirror is never flipped. Returns the flips and the mirrors they leave.
 */
function join(cfg: DeflectorsConfig, start: readonly number[], volley: DeflectorsVolley, pick: (n: number) => number, locked: readonly number[]): { flips: number[]; mirrors: number[] } {
  const mirrors = start.slice();
  const flips: number[] = [];
  let last = -1;
  const flip = (cell: number): void => {
    mirrors[cell] = 3 - mirrors[cell]!;
    flips.push(cell);
    last = cell;
  };
  while (flips.length < MAX_JOIN_FLIPS) {
    const home = homes(cfg, mirrors, volley);
    const astray = home.indexOf(false);
    if (astray < 0) break;
    const beam = volley.beams[astray]!;
    const line = deflectorsTrace(cfg, mirrors, beam.entry).turns;
    const back = deflectorsTrace(cfg, mirrors, beam.exit).turns;
    const crossings = [...new Set(line.filter((c) => back.includes(c) && free(locked, c)))].sort((a, b) => a - b);
    if (crossings.length) {
      // Of the crossings, those that keep every other beam home stay home.
      const keeps = crossings.filter((c) => {
        const tried = mirrors.slice();
        tried[c] = 3 - tried[c]!;
        const after = homes(cfg, tried, volley);
        return home.every((h, i) => i === astray || !h || after[i]);
      });
      const from = keeps.length ? keeps : crossings;
      flip(from[pick(from.length)]!);
      continue;
    }
    let either = [...new Set([...line, ...back])].filter((c) => free(locked, c)).sort((a, b) => a - b);
    if (either.length > 1) either = either.filter((c) => c !== last);
    if (either.length === 0) break;
    // Looking again: a flip that makes the two lines cross, when one does.
    const crosses = either.filter((c) => {
      const tried = mirrors.slice();
      tried[c] = 3 - tried[c]!;
      const l = deflectorsTrace(cfg, tried, beam.entry);
      if (l.out === beam.exit) return true;
      const b = deflectorsTrace(cfg, tried, beam.exit).turns;
      return l.turns.some((t) => b.includes(t));
    });
    const from = crosses.length ? crosses : either;
    flip(from[pick(from.length)]!);
  }
  return { flips, mirrors };
}

/** Wait for the next volley to be dealt, or null when none comes before the round ends. */
function waitForDeal(state: DeflectorsState): Choice<DeflectorsMove> | null {
  const tick = Math.max(state.nextDealTick, state.tick + 1);
  return tick <= state.config.maxTick ? { moves: [{ type: "wait", tick }] } : null;
}

/** Every decision worth weighing: the best plan, the joined plan, a flip on a drawn line, fire now, or wait. */
function choices(state: DeflectorsState): Choice<DeflectorsMove>[] {
  if (state.finished) return [];
  const cfg = state.config;
  const volley = state.volley;
  if (!volley) {
    const w = waitForDeal(state);
    return w ? [w] : [];
  }
  const out: Choice<DeflectorsMove>[] = [];
  const push = (c: Choice<DeflectorsMove> | null): void => {
    if (c) out.push(c);
  };
  push(longestPlan(state));
  const joined = join(cfg, state.mirrors, volley, () => 0, state.locked);
  if (joined.flips.length && homes(cfg, joined.mirrors, volley).every(Boolean)) push(pacedPlan(state, joined.flips));
  const step = ticks(cfg, SECONDS_PER_FLIP);
  for (const cell of drawnMirrors(cfg, state.mirrors, volley, state.locked)) {
    const tick = state.tick + step;
    // A flip after the count would land on the next volley's grid, where this mirror may be locked.
    if (tick < volley.fireTick && tick <= cfg.maxTick) out.push({ moves: [{ type: "flip", cell, tick }] });
  }
  push(pacedPlan(state, []));
  push(planMoves(state, [], [], Infinity));
  return out;
}

/** What a waiting volley is worth fired now, when every beam is home; nothing otherwise. */
function pending(state: DeflectorsState): number {
  const o = deflectorsOutlook(state);
  return o && o.clean ? o.points : 0;
}

/** The joining bot of the tuning notes, with its own coin flips among equal mirrors. */
function joinerBot(): Bot<DeflectorsState, DeflectorsMove> {
  return {
    name: "joiner",
    about: `Joins each beam's line to the way back from its exit, ${SECONDS_PER_FLIP} s a flip, and fires once every beam is home.`,
    choose(state, ctx) {
      const volley = state.volley;
      if (!volley) return waitForDeal(state);
      const { flips } = join(state.config, state.mirrors, volley, (n) => ctx.rng.int(n), state.locked);
      return pacedPlan(state, flips);
    },
  };
}

/** The longest bot of the tuning notes: handed the best setting, it pays only for the time to see it. */
function longestBot(): Bot<DeflectorsState, DeflectorsMove> {
  return {
    name: "longest",
    about: `Takes the best setting the search finds, ${SECONDS_PER_BEAM} s a beam to see it, and fires.`,
    choose(state) {
      return state.volley ? longestPlan(state) : waitForDeal(state);
    },
  };
}

/** One try at a longer route from a home one: flip a mirror on a route and keep it if every beam is still home and worth more. */
function lengthen(cfg: DeflectorsConfig, mirrors: number[], volley: DeflectorsVolley, rng: Rng, flips: number[], locked: readonly number[]): void {
  const route: number[] = [];
  for (const b of volley.beams) for (const c of deflectorsTrace(cfg, mirrors, b.entry).turns) if (!route.includes(c) && free(locked, c)) route.push(c);
  if (route.length === 0) return;
  const cell = rng.pick(route.sort((a, b) => a - b));
  const before = deflectorsResolve(cfg, mirrors, volley, 0, 0).base;
  mirrors[cell] = 3 - mirrors[cell]!;
  flips.push(cell);
  const after = deflectorsResolve(cfg, mirrors, volley, 0, 0);
  if (after.clean && after.base > before) return;
  mirrors[cell] = 3 - mirrors[cell]!;
  flips.push(cell);
}

/** The bait: the joiner, but once home it tries three times to lengthen the route before it fires. */
function lengthenerBot(): Bot<DeflectorsState, DeflectorsMove> {
  return {
    name: "lengthener",
    about: `The joiner, but once every beam is home it tries ${LENGTHEN_TRIES} flips for a longer route before it fires (the bait).`,
    choose(state, ctx) {
      const volley = state.volley;
      if (!volley) return waitForDeal(state);
      const cfg = state.config;
      const joined = join(cfg, state.mirrors, volley, (n) => ctx.rng.int(n), state.locked);
      const flips = joined.flips;
      if (homes(cfg, joined.mirrors, volley).every(Boolean)) for (let t = 0; t < LENGTHEN_TRIES; t++) lengthen(cfg, joined.mirrors, volley, ctx.rng, flips, state.locked);
      return pacedPlan(state, flips);
    },
  };
}

export const DEFLECTORS_BOTS: BotGame<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  id: "deflectors",
  def: DEFLECTORS_DEF,
  pace: `${SECONDS_PER_FLIP} s a flip, ${SECONDS_PER_BEAM} s a beam to see the long way round`,
  elapsed: (s) => (s.tick * s.config.tickMs) / 1000,
  choices,
  end: (s, roundSeconds) => ({ type: "end", tick: Math.min(s.config.maxTick, Math.max(s.tick, Math.round((roundSeconds * 1000) / s.config.tickMs))) }),
  worth: (before, after) => after.score + pending(after) - (before.score + pending(before)),
  open: true,
  bots: [joinerBot(), longestBot(), lengthenerBot()],
  baits: [
    { bait: "lengthener", beats: "joiner" },
    // Under locks, the best route every volley (the one-move bot) loses to the planner that keeps the next grid open.
    { bait: "one move", beats: "rollout" },
  ],
};
