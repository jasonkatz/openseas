// Refining on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: the tower, every tick and the draws the clock makes, every swap and early draw, each
// column's grade, the feed, the smoke that comes back, the points and the clear run. This file only turns what that
// round reports into the old shape, so the board, its sounds and its page are the prototype's, unchanged.
import { InvalidMoveError, REFINING_CATALYST, REFINING_DEF, REFINING_OIL, REFINING_SMOKE, REFINING_TAR, REFINING_VAPOUR, type PuzzleDef, type RefiningConfig, type RefiningDrawValue, type RefiningEvent, type RefiningGrade, type RefiningKind, type RefiningMove, type RefiningPiece, type RefiningSmoke, type RefiningState } from "@openseas/engine";
import { advance, play, read, seedFromString, seenAfter, start, type AnyMove, type Cell, type Event, type Round, type Seen, type Setting } from "@openseas/puzzle";
import refining, { type Tower } from "@openseas/puzzle/examples/refining";
import { held, roundOf, steady } from "./held.js";

/** The new engine ticks every tenth of a second, as the prototype does as shipped. */
const TICK_MS = 100;
const KIND: Record<string, RefiningKind> = { vapour: REFINING_VAPOUR, oil: REFINING_OIL, tar: REFINING_TAR, smoke: REFINING_SMOKE, catalyst: REFINING_CATALYST };
const GRADES: readonly string[] = ["clear", "smooth", "plain", "foul", "dump", "spill"];

/**
 * The prototype's numbers under the names the new puzzle gives them; a foul's cost is negative points. The prototype
 * takes a move at its last tick and ends there; the new engine's clock refuses a move once it has run out, so it runs
 * a second longer, and the mirror ends the round at the prototype's last tick.
 */
export function refiningSettings(c: RefiningConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, vapourPermille: c.vapourPermille, oilPermille: c.oilPermille, catalystPermille: c.catalystPermille, pulseTicks: c.pulseTicks,
    smokeEvery: c.smokeEvery, runCap: c.runCap, clearPoints: c.clearPoints, smoothPoints: c.smoothPoints, catalystPoints: c.catalystPoints, foulPoints: -c.foulPoints,
    roundSeconds: Math.floor((c.maxTick * c.tickMs) / 1000) + 1, maxMoves: c.maxMoves,
  };
}

/**
 * Smoke takes a vapour's place under a name of its own in the prototype; on the new engine the piece only changes. So
 * each smoke is named here as it comes back, the k-th from a number no piece reaches.
 */
interface Names { readonly alias: ReadonlyMap<number, number>; readonly smoked: number }
const NAMES = new WeakMap<object, Names>();
const SMOKE_IDS = 1_000_000;
type Kept = Pick<RefiningState, "eventSeq" | "events" | "moveCount" | "logLength" | "bestRun">;

const cellsOf = (board: Seen, names: Names): RefiningPiece[] => board.flatMap((row) => row.map((p) => ({ id: names.alias.get(p!.id) ?? p!.id, kind: KIND[p!.piece]! })));

function shown(round: Round<AnyMove>, config: RefiningConfig, names: Names, kept: Kept, lastMove: RefiningState["lastMove"], ended = false, finished?: boolean): RefiningState {
  const now = read(round);
  const tower = (now.state as { tower: Tower }).tower;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  // Only the names of pieces still in the tower are kept.
  const standing = new Set(now.board.flatMap((row) => row.map((p) => p!.id)));
  const alias = new Map([...names.alias].filter(([id]) => standing.has(id)));
  const kept2: Names = { alias, smoked: names.smoked };
  const state: RefiningState = {
    config,
    tick: now.tick,
    cells: cellsOf(now.board, kept2),
    rng: round.state.streams.feed!,
    catalystRng: round.state.streams.catalyst!,
    nextId: round.state.nextId,
    nextDraw: tower.nextDraw,
    run: now.streak,
    spilled: tower.spilled,
    score: now.score,
    draws: stat("draws"),
    clears: stat("clears"),
    smooths: stat("smooths"),
    fouls: stat("fouls"),
    dumps: stat("dumps"),
    spills: stat("spills"),
    ...kept,
    lastMove,
    finished: finished ?? (ended || kept.logLength >= config.maxMoves || now.tick >= config.maxTick),
  };
  NAMES.set(state, kept2);
  return held(state, round);
}

/** A stretch of the round's events in the prototype's words, numbered on from `seq`, with the names it gave smoke. */
function heard(c: RefiningConfig, before: Seen, events: readonly Event[], seqIn: number, runIn: number, names: Names): { events: RefiningEvent[]; names: Names; run: number } {
  const at = (p: Cell): number => p.y * c.width + p.x;
  const alias = new Map(names.alias);
  let smoked = names.smoked;
  const name = (id: number): number => alias.get(id) ?? id;
  let board = before;
  let seq = seqIn;
  let run = runIn;
  const out: RefiningEvent[] = [];
  for (const e of events) {
    const tick = e.tick ?? 0;
    if (e.event === "swap") out.push({ seq: ++seq, tick, type: "swap", a: at(e.fields.at as Cell), b: at(e.fields.other as Cell) });
    else if (GRADES.includes(e.event)) {
      const f = e.fields as { early: boolean; run: number; catalysts: number; fouls: number; lost: number };
      const column = board.map((row) => ({ id: name(row[c.width - 1]!.id), kind: KIND[row[c.width - 1]!.piece]! }));
      const grade = e.event as RefiningGrade;
      const up = grade !== "dump" && grade !== "spill";
      run = grade === "clear" ? f.run : grade === "dump" ? run : 0;
      const points = grade === "clear" ? c.clearPoints * Math.min(run, c.runCap) + c.catalystPoints * f.catalysts : grade === "smooth" ? c.smoothPoints + c.catalystPoints * f.catalysts : grade === "foul" ? (f.fouls === 0 ? 0 : -c.foulPoints * f.fouls) : 0;
      const value: RefiningDrawValue = { up, grade, run, points, spilled: up ? 0 : column.filter((p) => p.kind === REFINING_VAPOUR).length, catalysts: f.catalysts };
      const fresh = e.changes.flatMap((ch) => (ch.change === "arrive" ? [{ id: ch.piece.id, kind: KIND[ch.piece.piece]! }] : []));
      out.push({ seq: ++seq, tick, type: "draw", early: f.early, column, value, points: grade === "foul" ? (f.lost === 0 ? 0 : -f.lost) : points, fresh, smoke: [] });
    } else if (e.event === "smoke") {
      // Smoke comes back with the draw before it, on the tower that draw left.
      const p = e.fields.at as Cell;
      const piece = board[p.y]![p.x]!;
      const id = SMOKE_IDS + smoked++;
      const smoke: RefiningSmoke = { cell: at(p), was: name(piece.id), id };
      alias.set(piece.id, id);
      const last = out.at(-1)!;
      if (last.type === "draw") out[out.length - 1] = { ...last, smoke: [...last.smoke, smoke] };
    }
    board = seenAfter(board, e);
  }
  return { events: out, names: { alias, smoked }, run };
}

const keptOf = (s: RefiningState): Kept => ({ eventSeq: s.eventSeq, events: s.events, moveCount: s.moveCount, logLength: s.logLength, bestRun: s.bestRun });

/** Time let pass on a shown state: the draws the clock made by then, heard and added to the state's events. */
function passed(state: RefiningState, tick: number): { state: RefiningState; heard: RefiningEvent[] } {
  if (tick <= state.tick) return { state, heard: [] };
  const round = roundOf(state);
  const later = advance(round, { at: tick * TICK_MS });
  const h = heard(state.config, read(round).board, later.last.events, state.eventSeq, state.run, NAMES.get(state)!);
  const kept: Kept = { ...keptOf(state), eventSeq: h.events.at(-1)?.seq ?? state.eventSeq, events: h.events.length > 0 ? [...state.events, ...h.events] : state.events, bestRun: Math.max(state.bestRun, h.run) };
  return { state: shown(later, state.config, h.names, kept, state.lastMove, false, false), heard: h.events };
}

/** The state at a later tick, without a move: what the board shows while the clock draws. */
export function advanceRefiningMirror(state: RefiningState, tick: number): RefiningState {
  if (tick <= state.tick || state.finished) return state;
  return steady(state, passed(state, Math.min(tick, state.config.maxTick)).state, "cells");
}

const streamsOf = (seed: string) => ({
  deal: seedFromString(`refining:${seed}:deal`),
  dealCatalyst: seedFromString(`refining:${seed}:deal-catalyst`),
  feed: seedFromString(`refining:${seed}:feed`),
  catalyst: seedFromString(`refining:${seed}:catalyst`),
});

export const REFINING_MIRROR: PuzzleDef<RefiningState, RefiningMove, RefiningConfig> = {
  ...REFINING_DEF,
  validateConfig: (config) => {
    REFINING_DEF.validateConfig(config);
    if (config.tickMs !== TICK_MS) throw new Error(`the new engine plays Refining at a tick of ${TICK_MS} ms`);
  },
  create: (seed, config) => {
    REFINING_MIRROR.validateConfig(config);
    const round = start(refining, { seed, settings: refiningSettings(config), streams: streamsOf(seed) }) as unknown as Round<AnyMove>;
    return shown(round, config, { alias: new Map(), smoked: 0 }, { eventSeq: 0, events: [], moveCount: 0, logLength: 0, bestRun: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const c = state.config;
    const tick = move.type === "end" && move.tick === undefined ? state.tick : move.tick;
    if (tick === undefined || !Number.isInteger(tick) || tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
    if (tick > c.maxTick) throw new InvalidMoveError("tick beyond the round", move);
    // The draws the clock makes up to the move's tick come first, then the move's own.
    const { state: before, heard: due } = passed(state, tick);
    const kept: Kept = { ...keptOf(before), logLength: state.logLength + 1 };
    if (move.type === "wait" || move.type === "end") {
      return steady(state, shown(roundOf(before), c, NAMES.get(before)!, { ...kept, events: due }, { move, events: due, points: before.score - state.score }, move.type === "end"), "cells");
    }
    if (move.type === "swap" && (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= c.width * c.height)) throw new InvalidMoveError("no such cell", move);
    const round = roundOf(before);
    const next = play(round, move.type === "swap" ? { move: "swap", at: { x: move.cell % c.width, y: Math.floor(move.cell / c.width) }, dir: move.dir === "upRight" ? 0 : 1 } : { move: "draw" }, { at: tick * TICK_MS });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const h = heard(c, read(round).board, next.last.events, before.eventSeq, before.run, NAMES.get(before)!);
    const events = [...due, ...h.events];
    return shown(next, c, h.names, { ...kept, eventSeq: events.at(-1)?.seq ?? before.eventSeq, events, moveCount: before.moveCount + 1, bestRun: Math.max(kept.bestRun, h.run) }, { move, events, points: read(next).score - state.score });
  },
};
