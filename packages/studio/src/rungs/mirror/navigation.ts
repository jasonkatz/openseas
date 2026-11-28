// Navigation on the new engine, shown as the state the game's board draws (ADR 0097, ADR 0098). The round is played
// by `@openseas/puzzle`: the sky and every star that falls on its clock or is brought down, every turn of a ring, the
// stars packing toward the centre, each constellation dealt and charted, the runs that clear, a lost heading, the
// points and the chain. This file only turns what that round reports into the shipped shape, so the board, its sounds
// and its page are the game's, unchanged.
import {
  InvalidMoveError,
  NAVIGATION_DEF,
  type Marker,
  type NavigationConfig,
  type NavigationEvent,
  type NavigationMove,
  type NavigationState,
  type PuzzleDef,
  type Star,
} from "@openseas/engine";
import { advance, play, read, seedFromString, seenAfter, start, type AnyMove, type Cell, type Event, type Ground, type Round, type Seen, type Setting } from "@openseas/puzzle";
import navigation, { type Sky } from "@openseas/puzzle/examples/navigation";
import { held, roundOf } from "./held.js";

/** The new engine ticks every tenth of a second, as the game does. */
const TICK_MS = 100;

/**
 * The game's numbers under the names the new puzzle gives them; a lost heading's cost is negative points. The fall
 * quickens over the round's length, so the round is exactly as long as the game's: a move at its very last tick is
 * past the new clock, and the mirror lets time run out there instead (see `reduce`).
 */
export function navigationSettings(c: NavigationConfig): Record<string, Setting> {
  return {
    rings: c.rings, sectors: c.octants, shapes: c.shapes, colors: c.colors, startStars: c.startStars, mostStars: c.maxStars, reusePercent: c.reuseChancePercent, starPoints: c.starPoints,
    chainPercent: c.chainPercent, runPoints: c.runPoints, lostPoints: -c.lostHeadingPenalty, roundSeconds: (c.maxTick * c.tickMs) / 1000, maxMoves: c.maxMoves, fallTicks: c.fallTicks, fallTicksLeast: c.fallTicksMin,
  };
}

type Kept = Pick<NavigationState, "eventSeq" | "moveCount" | "logLength" | "bestCombo">;
const KEPT = new WeakMap<object, Kept>();

const slotOf = (c: NavigationConfig, p: Cell): number => p.y * c.octants + p.x;
const slotsOf = (c: NavigationConfig, board: Seen): (Star | null)[] => board.flatMap((row) => row.map((p) => (p ? { id: p.id, kind: p.kind! - 1 } : null)));
const markersOf = (ground: readonly (readonly (Ground | null)[])[]): Marker[] =>
  ground.flatMap((row, ring) => row.flatMap((g, octant) => (g?.terrain === "marker" ? [{ ring, octant, kind: Number(g.state!.slice(5)) - 1 }] : [])));

function shown(round: Round<AnyMove>, config: NavigationConfig, kept: Kept, lastMove: NavigationState["lastMove"], ended = false, finished?: boolean): NavigationState {
  const now = read(round);
  const sky = (now.state as { sky: Sky }).sky;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const state: NavigationState = {
    config,
    tick: now.tick,
    slots: slotsOf(config, now.board),
    markers: markersOf(now.ground),
    falling: { kind: sky.falling.kind, startTick: sky.falling.start, landTick: sky.falling.land },
    next: sky.next,
    rng: round.state.streams.sky!,
    nextId: round.state.nextId,
    eventSeq: kept.eventSeq,
    moveCount: kept.moveCount,
    logLength: kept.logLength,
    landings: stat("landings"),
    landingsSinceDeal: stat("since_deal"),
    completed: stat("charted"),
    lostHeadings: stat("lost"),
    runsCleared: stat("runs"),
    score: now.score,
    combo: now.streak,
    bestCombo: Math.max(kept.bestCombo, now.streak),
    lastMove,
    finished: finished ?? (ended || kept.logLength >= config.maxMoves || now.tick >= config.maxTick),
  };
  KEPT.set(state, { ...kept, bestCombo: state.bestCombo });
  return held(state, round);
}

/** A stretch of the round's events in the game's words, numbered on from `seq`, on the chart as it stood before them. */
function heard(c: NavigationConfig, before: Round<AnyMove>, events: readonly Event[], seqIn: number): NavigationEvent[] {
  const was = read(before);
  let board: Seen = was.board;
  let markers = markersOf(was.ground);
  let seq = seqIn;
  let chain = was.streak;
  let since = (was.stats as Record<string, number>).since_deal ?? 0;
  let runBoard: Seen | null = null;
  const out: NavigationEvent[] = [];
  for (const e of events) {
    const tick = e.tick ?? 0;
    if (e.event !== "run") runBoard = null;
    if (e.event === "land") {
      const at = e.fields.at as Cell;
      const arrived = e.changes.find((ch) => ch.change === "arrive")!;
      const kind = (arrived as { piece: { kind: number } }).piece.kind - 1;
      since++;
      out.push({ seq: ++seq, tick, type: "land", slot: slotOf(c, at), id: (arrived as { piece: { id: number } }).piece.id, kind, onMarker: markers.some((m) => m.ring === at.y && m.octant === at.x && m.kind === kind) });
    } else if (e.event === "lost") {
      since++;
      chain = 0;
      const ids = (e.fields.stars as Cell[]).map((p) => board[p.y]![p.x]!.id);
      out.push({ seq: ++seq, tick, type: "lost_heading", octant: 0, ids, penalty: c.lostHeadingPenalty });
    } else if (e.event === "pack") {
      const moves = e.changes.flatMap((ch) => (ch.change === "travel" ? [{ id: board[ch.from.y]![ch.from.x]!.id, from: slotOf(c, ch.from), to: slotOf(c, ch.to) }] : []));
      out.push({ seq: ++seq, tick, type: "fall", moves });
    } else if (e.event === "charted") {
      const n = markers.length;
      const ids = markers.map((m) => board[m.ring]![m.octant]!.id);
      chain++;
      const chainPercent = c.chainPercent[Math.min(chain, c.chainPercent.length) - 1]!;
      const saved = Math.max(0, 2 * n - since);
      // What the board shows a constellation was worth is worked out the game's way (ADR 0098).
      const points = Math.floor((n * n * c.starPoints * chainPercent) / 100) + saved * n * c.starPoints;
      out.push({ seq: ++seq, tick, type: "charted", completion: { markers, ids, chain, chainPercent, saved, efficient: saved > 0, points } });
      since = 0;
    } else if (e.event === "run") {
      runBoard ??= board;
      const slots = (e.fields.stars as Cell[]).map((p) => slotOf(c, p));
      const first = (e.fields.stars as Cell[])[0]!;
      const ids = (e.fields.stars as Cell[]).map((p) => runBoard![p.y]![p.x]!.id);
      out.push({ seq: ++seq, tick, type: "run", run: { kind: runBoard[first.y]![first.x]!.kind! - 1, slots, ids, points: c.runPoints * (slots.length - 2) } });
    }
    board = seenAfter(board, e);
    if (e.event === "constellation" || e.event === "charted") markers = markersAfter(markers, e);
  }
  return out;
}

/** The markers once an event has laid or lifted some: lifted when charted, laid when dealt, in the order of the chart. */
function markersAfter(markers: readonly Marker[], e: Event): Marker[] {
  if (e.event === "charted") return [];
  return e.changes
    .flatMap((ch) => (ch.change === "change" && "terrain" in ch && ch.terrain === "marker" ? [{ ring: ch.at.y, octant: ch.at.x, kind: Number(ch.state!.slice(5)) - 1 }] : []))
    .concat(markers)
    .sort((a, b) => a.ring - b.ring || a.octant - b.octant);
}

/** Time let pass on a shown state: the stars that came down by then, heard and reported as a wait. */
function passed(state: NavigationState, tick: number): { round: Round<AnyMove>; events: NavigationEvent[] } {
  const round = roundOf(state);
  if (tick <= state.tick) return { round, events: [] };
  const later = advance(round, { at: tick * TICK_MS });
  return { round: later, events: heard(state.config, round, later.last.events, state.eventSeq) };
}

/** The state at a later tick, without a move: what the board shows while stars fall. */
export function advanceNavigationMirror(state: NavigationState, tick: number): NavigationState {
  if (tick <= state.tick || state.finished) return state;
  const at = Math.min(tick, state.config.maxTick);
  const p = passed(state, at);
  const kept: Kept = { ...KEPT.get(state)!, eventSeq: p.events.at(-1)?.seq ?? state.eventSeq };
  return shown(p.round, state.config, kept, { move: { type: "wait", tick: at }, events: p.events, points: read(p.round).score - state.score }, false, false);
}

export const NAVIGATION_MIRROR: PuzzleDef<NavigationState, NavigationMove, NavigationConfig> = {
  ...NAVIGATION_DEF,
  validateConfig: (config) => {
    NAVIGATION_DEF.validateConfig(config);
    if (config.tickMs !== TICK_MS) throw new Error(`the new engine plays Navigation at a tick of ${TICK_MS} ms`);
    if ((config.maxTick * config.tickMs) % 1000 !== 0) throw new Error("the new engine plays Navigation for a whole number of seconds");
  },
  create: (seed, config) => {
    NAVIGATION_MIRROR.validateConfig(config);
    const round = start(navigation, { seed, settings: navigationSettings(config), streams: { sky: seedFromString(`navigation:${seed}`) } }) as unknown as Round<AnyMove>;
    return shown(round, config, { eventSeq: 0, moveCount: 0, logLength: 0, bestCombo: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const c = state.config;
    if (!Number.isInteger(move.tick) || move.tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
    if (move.tick > c.maxTick) throw new InvalidMoveError("tick beyond the round", move);
    if (move.type === "rotate" && (!Number.isInteger(move.ring) || move.ring < 0 || move.ring >= c.rings || (move.dir !== 1 && move.dir !== -1))) throw new InvalidMoveError("no such ring", move);
    const kept = KEPT.get(state)!;
    const logLength = kept.logLength + 1;
    const moveCount = move.type === "rotate" || move.type === "drop" ? kept.moveCount + 1 : kept.moveCount;
    // A wait, an end, or any move at the round's very last tick, where the new clock has run out: time passes.
    if (move.type === "wait" || move.type === "end" || move.tick >= c.maxTick) {
      const p = passed(state, move.tick);
      return shown(p.round, c, { ...kept, logLength, moveCount, eventSeq: p.events.at(-1)?.seq ?? state.eventSeq }, { move, events: p.events, points: read(p.round).score - state.score }, move.type === "end");
    }
    // The stars that came down up to the move's tick come first, then the move's own.
    const p = passed(state, move.tick);
    const next = play(p.round, move.type === "rotate" ? { move: "turn", ring: move.ring, dir: move.dir } : { move: "drop" }, { at: move.tick * TICK_MS });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const events = [...p.events, ...heard(c, p.round, next.last.events, p.events.at(-1)?.seq ?? state.eventSeq)];
    return shown(next, c, { ...kept, logLength, moveCount, eventSeq: events.at(-1)?.seq ?? state.eventSeq }, { move, events, points: read(next).score - state.score });
  },
};
