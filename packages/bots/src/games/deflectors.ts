/**
 * Deflectors for the bots: a choice is one piece put down (turned first when that is the way it
 * goes), the next piece binned, or a shot fired. Each lands at the tick a person would get to it.
 * Beside the three every puzzle gets are two ways to play: the eager bot puts each piece where the
 * shot is worth most now and fires at the first light; the builder looks one piece further ahead,
 * bins a piece that helps nothing, and holds its fire for a shot worth a set amount. The builder
 * is played at two paces, so the ladder shows what thinking longer costs against what it earns.
 */
import {
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_DEF,
  DEFLECTORS_EMPTY,
  DEFLECTORS_SLASH,
  deflectorsIsMirror,
  deflectorsOutlook,
  deflectorsResolve,
  type DeflectorsConfig,
  type DeflectorsMove,
  type DeflectorsState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's time to put a piece down: see where it goes, turn it, tap. */
const SECONDS_PER_PLACE = 1;
/** A careful person's time for the same, and a slow one's. */
const CAREFUL_SECONDS = 2.5;
const SLOW_SECONDS = 5;
/** A person's time to see a shot is ready and fire it. */
const SECONDS_TO_FIRE = 0.5;
/** What the builder gives the best a next mirror could make of a grid, against a shot it has now, in percent. */
const AHEAD_PERCENT = 80;

const ticks = (cfg: DeflectorsConfig, seconds: number): number => Math.max(1, Math.round((seconds * 1000) / cfg.tickMs));

/** The two ways a piece can go down: as it is, and turned, for a mirror. */
function ways(piece: number): Array<{ piece: number; turn: boolean }> {
  if (!deflectorsIsMirror(piece)) return [{ piece, turn: false }];
  return [
    { piece, turn: false },
    { piece: piece === DEFLECTORS_SLASH ? DEFLECTORS_BACKSLASH : DEFLECTORS_SLASH, turn: true },
  ];
}

/** Put the next piece on `cell`, turned first or not, a placing's time from now. Null past the round. */
function place(state: DeflectorsState, cell: number, turn: boolean, seconds = SECONDS_PER_PLACE): Choice<DeflectorsMove> | null {
  const tick = state.tick + ticks(state.config, seconds);
  // The round is over at its last tick, so a turn there would leave the piece unplaced.
  if (tick >= state.config.maxTick) return null;
  const moves: DeflectorsMove[] = turn ? [{ type: "turn", tick }, { type: "place", cell, tick }] : [{ type: "place", cell, tick }];
  return { moves };
}

/** Fire, as soon as a person would and the emitters are ready. Null past the round. */
function fire(state: DeflectorsState): Choice<DeflectorsMove> | null {
  const tick = Math.max(state.fireTick, state.tick + ticks(state.config, SECONDS_TO_FIRE));
  return tick <= state.config.maxTick ? { moves: [{ type: "fire", tick }] } : null;
}

/** Bin the next piece, a placing's time from now. Null past the round. */
function bin(state: DeflectorsState, seconds = SECONDS_PER_PLACE): Choice<DeflectorsMove> | null {
  const tick = state.tick + ticks(state.config, seconds);
  return tick < state.config.maxTick ? { moves: [{ type: "bin", tick }] } : null;
}

/** Wait for the emitters to recharge. Null past the round. */
function waitToFire(state: DeflectorsState): Choice<DeflectorsMove> | null {
  const tick = Math.max(state.fireTick, state.tick + 1);
  return tick <= state.config.maxTick ? { moves: [{ type: "wait", tick }] } : null;
}

/** Every decision: the next piece on any cell either way, binned, or a shot. */
function choices(state: DeflectorsState): Choice<DeflectorsMove>[] {
  if (state.finished) return [];
  const out: Choice<DeflectorsMove>[] = [];
  const push = (c: Choice<DeflectorsMove> | null): void => {
    if (c) out.push(c);
  };
  const next = state.queue[0];
  if (next !== undefined) {
    for (let cell = 0; cell < state.mirrors.length; cell++) for (const w of ways(next)) if (state.mirrors[cell] !== w.piece) push(place(state, cell, w.turn));
    push(bin(state));
  }
  if (deflectorsOutlook(state).lit > 0) push(fire(state));
  if (out.length === 0) push(waitToFire(state));
  return out;
}

/** A shot's worth on `cells`. */
const shotOn = (state: DeflectorsState, cells: readonly number[]): number => deflectorsResolve(state.config, cells, state.emitters, state.targets).points;

/** The best a mirror on any cell, either way, could make the shot on `cells`. */
function bestNext(state: DeflectorsState, cells: number[]): number {
  let best = 0;
  for (let c = 0; c < cells.length; c++) {
    const was = cells[c]!;
    for (const way of [DEFLECTORS_SLASH, DEFLECTORS_BACKSLASH]) {
      if (way === was) continue;
      cells[c] = way;
      best = Math.max(best, shotOn(state, cells));
    }
    cells[c] = was;
  }
  return best;
}

/**
 * Where to put the next piece: the cell and way that make the grid worth most. With `ahead`, a grid is
 * worth the better of its shot now and most of what one more mirror could make it. Ties go to an
 * empty cell, then the first.
 */
function bestPlace(state: DeflectorsState, ahead: boolean): { cell: number; turn: boolean; value: number } | null {
  const next = state.queue[0];
  if (next === undefined) return null;
  const cells = [...state.mirrors];
  let best: { cell: number; turn: boolean; value: number } | null = null;
  for (let cell = 0; cell < cells.length; cell++) {
    const was = cells[cell]!;
    for (const w of ways(next)) {
      if (w.piece === was) continue;
      cells[cell] = w.piece;
      const now = shotOn(state, cells);
      const value = (ahead ? Math.max(now, Math.floor((bestNext(state, cells) * AHEAD_PERCENT) / 100)) : now) * 2 + (was === DEFLECTORS_EMPTY ? 1 : 0);
      if (!best || value > best.value) best = { cell, turn: w.turn, value };
    }
    cells[cell] = was;
  }
  return best;
}

/** What the builder makes of the grid as it stands, on the scale bestPlace uses, without the empty-cell tie-break. */
function standing(state: DeflectorsState): number {
  const cells = [...state.mirrors];
  return Math.max(shotOn(state, cells), Math.floor((bestNext(state, cells) * AHEAD_PERCENT) / 100)) * 2;
}

/** The last tick a shot can still be fired by a person who decides now, or no pieces are left to build with. */
const lastCall = (state: DeflectorsState, seconds: number): boolean => state.queue.length === 0 || state.tick + ticks(state.config, seconds + SECONDS_TO_FIRE) > state.config.maxTick;

/** Puts each piece where the shot is worth most now, and fires at the first light (the bait). */
function eagerBot(): Bot<DeflectorsState, DeflectorsMove> {
  return {
    name: "eager",
    about: `Puts each piece where the shot is worth most now, ${SECONDS_PER_PLACE} s a piece, and fires as soon as anything lights (the bait).`,
    choose(state) {
      if (deflectorsOutlook(state).lit > 0 && state.tick >= state.fireTick - ticks(state.config, SECONDS_TO_FIRE)) {
        const f = fire(state);
        if (f) return f;
      }
      const p = bestPlace(state, false);
      return (p ? place(state, p.cell, p.turn) : null) ?? waitToFire(state);
    },
  };
}

/** Looks one piece ahead, bins a piece that helps nothing, and holds its fire for a shot worth `hold`, or the round's end. */
function builderBot(hold: number, seconds = SECONDS_PER_PLACE): Bot<DeflectorsState, DeflectorsMove> {
  return {
    name: seconds === SECONDS_PER_PLACE ? `builder ${hold}` : `builder ${hold}, ${seconds} s`,
    about: `Puts each piece where the grid is worth most counting one mirror more, ${seconds} s a piece, bins one that adds nothing, and fires at a shot worth ${hold} or at the end.`,
    choose(state) {
      const o = deflectorsOutlook(state);
      if (o.lit > 0 && (o.points >= hold || lastCall(state, seconds))) {
        const f = fire(state);
        if (f) return f;
      }
      const p = bestPlace(state, true);
      if (!p) return waitToFire(state);
      // A piece that makes the grid worth no more than it is goes in the bin, kept off the grid.
      if (Math.floor(p.value / 2) * 2 < standing(state)) return bin(state, seconds) ?? waitToFire(state);
      return place(state, p.cell, p.turn, seconds) ?? waitToFire(state);
    },
  };
}

export const DEFLECTORS_BOTS: BotGame<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  id: "deflectors",
  def: DEFLECTORS_DEF,
  pace: `${SECONDS_PER_PLACE} s a piece, ${SECONDS_TO_FIRE} s to fire`,
  elapsed: (s) => (s.tick * s.config.tickMs) / 1000,
  choices,
  end: (s, roundSeconds) => ({ type: "end", tick: Math.min(s.config.maxTick, Math.max(s.tick, Math.round((roundSeconds * 1000) / s.config.tickMs))) }),
  // What a careful player sees: points scored, and half of what the shot would score now.
  worth: (before, after) => after.score - before.score + (deflectorsOutlook(after).points - deflectorsOutlook(before).points) / 2,
  open: true,
  bots: [eagerBot(), builderBot(1), builderBot(150), builderBot(800), builderBot(1500), builderBot(3000), builderBot(6000), builderBot(800, CAREFUL_SECONDS), builderBot(800, SLOW_SECONDS)],
  baits: [{ bait: "eager", beats: "builder 150" }],
  slow: ["builder 1", "builder 150", "builder 800", "builder 1500", "builder 3000", "builder 6000", `builder 800, ${CAREFUL_SECONDS} s`, `builder 800, ${SLOW_SECONDS} s`],
};
