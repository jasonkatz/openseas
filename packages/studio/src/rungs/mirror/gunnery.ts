// Gunnery on the new engine, shown as the state the shipped Gunnery board draws (ADR 0097). The round is played
// by `@openseas/puzzle`: the deck, the feed, every tick of rolling, the turrets, the points and the streak. This
// file only turns what that round reports into the old shape, so the board, its sounds and its page are the
// shipped ones, unchanged.
import { GUNNERY_DEF, InvalidMoveError, parseGunneryDeck, type Arrow, type Dir, type GunneryConfig, type GunneryEvent, type GunneryMove, type GunneryState, type PuzzleDef, type Turret } from "@openseas/engine";
import { advance, DIRECTIONS, nextInt, play, read, seedFromString, seenAfter, start, type AnyMove, type Cell, type Direction, type Event, type Round, type Seen, type Setting } from "@openseas/puzzle";
import gunnery, { deckOf } from "@openseas/puzzle/examples/gunnery";
import { held, roundOf } from "./held.js";

const PIECES = ["cell", "sabot", "slug", "coolant"];
const LOADED: Record<string, number> = { empty: 0, one: 1, two: 2, full: 3, jammed: 0 };
const dirOf = (heading: unknown): Dir => DIRECTIONS.indexOf(heading as Direction) as Dir;

/** The shipped numbers under the names the new puzzle gives them. A bonus that grows by a step a load, up to a cap, is a table of percents. */
export function gunnerySettings(c: GunneryConfig): Record<string, Setting> {
  return {
    width: c.decks[0]![0]!.length,
    height: c.decks[0]!.length,
    decks: c.decks.map(deckOf),
    roundSeconds: (c.maxTick * c.tickMs) / 1000,
    maxMoves: c.maxMoves,
    maxOnDeck: c.maxOnDeck,
    dropEvery: c.spawnEveryTicks,
    dropEveryLeast: c.spawnEveryTicksMin,
    queueLength: c.queueLength,
    bag: c.bag,
    fireAfter: c.fireAfterTicks,
    stepPoints: c.stepPoints,
    loadPoints: c.loadPoints,
    broadsidePoints: c.broadsidePoints,
    streakPercent: Array.from({ length: c.comboCap + 1 }, (_, n) => 100 + (100 * c.comboStep * n) / c.loadPoints),
  };
}

/** A stretch of the round's events as the board hears them: each with its tick, its turret, and the piece it was about. */
function heard(before: Seen, events: readonly Event[], turrets: readonly Turret[]): GunneryEvent[] {
  const out: GunneryEvent[] = [];
  let board = before;
  const turretAt = (p: Cell): number => turrets.findIndex((t) => t.col === p.x && t.row === p.y);
  for (const e of events) {
    const tick = e.tick ?? 0;
    const f = e.fields as { at?: Cell; from?: Cell };
    const piece = f.from && board[f.from.y]![f.from.x];
    const about = piece ? { pieceId: piece.id, kind: PIECES.indexOf(piece.piece) } : {};
    const points = e.points ? { points: e.points } : {};
    if (e.event === "drop") for (const ch of e.changes) if (ch.change === "arrive") out.push({ tick, type: "spawn", pieceId: ch.piece.id, kind: PIECES.indexOf(ch.piece.piece) });
    if (e.event === "load" || e.event === "loaded" || e.event === "jam" || e.event === "clean" || e.event === "splash") out.push({ tick, type: e.event, turret: turretAt(f.at!), ...about, ...points });
    if (e.event === "exit") out.push({ tick, type: "exit", ...about, col: f.at!.x, row: f.at!.y });
    if (e.event === "fire") out.push({ tick, type: "fire", turret: turretAt(f.at!) });
    if (e.event === "broadside") out.push({ tick, type: "broadside", ...points });
    board = seenAfter(board, e);
  }
  return out;
}

/** The arrows in the order they were laid, which is the order the board keeps them in. */
function arrowsAfter(arrows: readonly Arrow[], events: readonly Event[]): readonly Arrow[] {
  let out = arrows;
  for (const e of events) {
    if (e.event !== "arrow" && e.event !== "remove") continue;
    const at = e.fields.at as Cell;
    out = out.filter((a) => a.col !== at.x || a.row !== at.y);
    if (e.event === "arrow") out = [...out, { col: at.x, row: at.y, dir: dirOf(e.fields.heading) }];
  }
  return out;
}

function shown(round: Round<AnyMove>, prev: Pick<GunneryState, "config" | "deckIndex" | "deck" | "arrows" | "turrets" | "moveCount">, lastMove: GunneryState["lastMove"], counted: boolean, ended = false): GunneryState {
  const now = read(round);
  const { config, deck } = prev;
  const rules = now.state as { feed: { queue: number[]; last: number }; turrets?: { fired: readonly string[] } };
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const pieces = now.board.flatMap((row, y) => row.flatMap((p, x) => (p ? [{ id: p.id, kind: PIECES.indexOf(p.piece), col: x, row: y, dir: dirOf(p.state) }] : []))).sort((a, b) => a.id - b.id);
  // A turret is what its cell says. When it will fire is not on the deck: it was heard when the turret filled.
  const filled = new Map((lastMove?.events ?? []).filter((e) => e.type === "loaded").map((e) => [e.turret!, e.tick + config.fireAfterTicks]));
  const turrets = prev.turrets.map((t, i): Turret => {
    const state = now.ground[t.row]![t.col]!.state!;
    return { col: t.col, row: t.row, loaded: LOADED[state]!, jammed: state === "jammed", firesAt: state === "full" ? (filled.get(i) ?? t.firesAt) : null };
  });
  const fired = new Set(rules.turrets?.fired ?? []);
  const moveCount = prev.moveCount + (counted ? 1 : 0);
  const state: GunneryState = {
    config,
    deckIndex: prev.deckIndex,
    deck,
    tick: now.tick,
    pieces,
    arrows: arrowsAfter(prev.arrows, round.last.events),
    turrets,
    queue: rules.feed.queue,
    bag: round.state.bags.feed ?? [],
    lastDrop: rules.feed.last,
    nextId: round.state.nextId,
    rng: round.state.streams.feed!,
    moveCount,
    score: now.score,
    combo: now.streak,
    bestCombo: stat("best_streak"),
    loads: stat("loads"),
    jams: stat("jams"),
    firedSince: turrets.map((t) => fired.has(`${t.col},${t.row}`)),
    broadsides: stat("broadsides"),
    arrowsPlaced: stat("arrows"),
    lastMove,
    // The bound on moves is on the log, waits and all, so it is the host's to keep.
    finished: ended || moveCount >= config.maxMoves || now.tick >= config.maxTick,
  };
  return held(state, round);
}

/** Time let pass, or a move made after it: the round that came of it, shown with what was heard on the way. */
function after(state: GunneryState, next: Round<AnyMove>, move: GunneryMove, counted: boolean, ended = false): GunneryState {
  const events = heard(read(roundOf(state)).board, next.last.events, state.turrets);
  return shown(next, state, { move, events, points: read(next).score - state.score }, counted, ended);
}

/** The state at a later tick, without a move: what the board shows while time passes. */
export function advanceGunneryMirror(state: GunneryState, tick: number): GunneryState {
  if (tick <= state.tick) return state;
  const to = Math.min(tick, state.config.maxTick);
  return after(state, advance(roundOf(state), { at: to * state.config.tickMs }), { type: "wait", tick: to }, false);
}

export const GUNNERY_MIRROR: PuzzleDef<GunneryState, GunneryMove, GunneryConfig> = {
  ...GUNNERY_DEF,
  create: (seed, config) => {
    GUNNERY_DEF.validateConfig(config);
    // The shipped engine picks its deck and deals its bag from one stream. Each draw is given the place in it that it would have had, so a seed deals the same round.
    const first = seedFromString(`gunnery:${seed}`);
    const round = start(gunnery, { seed, settings: gunnerySettings(config), streams: { deck: first, feed: nextInt(first, config.decks.length).state } }) as unknown as Round<AnyMove>;
    const deckIndex = round.last.events.find((e) => e.event === "deck")!.fields.map as number;
    const deck = parseGunneryDeck(config.decks[deckIndex]!);
    const turrets = deck.turrets.map((t): Turret => ({ col: t.col, row: t.row, loaded: 0, jammed: false, firesAt: null }));
    return shown(round, { config, deckIndex, deck, arrows: [], turrets, moveCount: 0 }, null, false);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    if (!Number.isInteger(move.tick) || move.tick < state.tick) throw new InvalidMoveError("tick must not go backwards", move);
    if (move.tick > state.config.maxTick) throw new InvalidMoveError("tick beyond the round", move);
    const round = roundOf(state);
    const at = move.tick * state.config.tickMs;
    // A wait is time let pass, and ending early is the host's: neither is a move of the puzzle's.
    if (move.type === "wait" || move.type === "end") return after(state, advance(round, { at }), move, move.type === "wait", move.type === "end");
    const next = play(round, move.type === "arrow" ? { move: "arrow", at: { x: move.col, y: move.row }, heading: DIRECTIONS[move.dir] } : { move: "remove", at: { x: move.col, y: move.row } }, { at });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    return after(state, next, move, true);
  },
};
