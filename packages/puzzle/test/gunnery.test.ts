// Rung 4's ticks are proved by a real puzzle: Gunnery, a ticking puzzle on a deck drawn by hand, played beside
// the engine the game ships. Both are dealt the same deck with the same luck to come, and are held to the same
// deck, pieces, turrets, feed, score and streak after every stretch of ticks and every move.
import { advanceGunnery, createGunneryGame, DEFAULT_GUNNERY_CONFIG, predictGunneryPath as predictPath, reduceGunnery, type GunneryConfig, type GunneryState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import gunnery, { deckOf, type ArrowMove, type RemoveMove } from "../examples/gunnery.puzzle.js";
import { advance, DIRECTIONS, expand, explain, groundAfter, nextInt, play, read, replay, seedFromString, seenAfter, seenEmpty, start, type Ground, type NewPiece, type Round, type Seen, type SeenGround, type Setting } from "../src/index.js";

type Move = ArrowMove | RemoveMove;
const PIECES = ["cell", "sabot", "slug", "coolant"];
const TICK = 200;

/** The shipped numbers under the names the new puzzle gives them. A bonus that grows by a step a load, up to a cap, is a table of percents. */
const settingsOf = (c: GunneryConfig): Record<string, Setting> => ({
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
});
/** The shipped round as the new engine holds one: its pieces, and the terrain under them. */
function shippedBoard(s: GunneryState): { pieces: (NewPiece | null)[][]; ground: (Ground | null)[][] } {
  const { width, height, cells } = s.deck;
  const pieces: (NewPiece | null)[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => null));
  for (const p of s.pieces) pieces[p.row]![p.col] = { piece: PIECES[p.kind]!, state: DIRECTIONS[p.dir]! };
  const ground: (Ground | null)[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const cell = cells[y * width + x]!;
      return cell === "deck" ? null : cell === "barrel" ? { terrain: "feeder" } : cell === "turret" ? { terrain: "turret", state: "empty" } : { terrain: cell };
    }),
  );
  for (const t of s.turrets) ground[t.row]![t.col] = { terrain: "turret", state: t.firesAt !== null || t.loaded >= 3 ? "full" : t.jammed ? "jammed" : ["empty", "one", "two"][t.loaded]! };
  for (const a of s.arrows) ground[a.row]![a.col] = { terrain: "arrow", state: DIRECTIONS[a.dir]! };
  return { pieces, ground };
}
const bare = (board: Seen): (NewPiece | null)[][] => board.map((row) => row.map((p) => (p ? { piece: p.piece, state: p.state! } : null)));

const CONFIGS: Record<string, GunneryConfig> = {
  "as shipped": DEFAULT_GUNNERY_CONFIG,
  // A crowded deck with a fast feed makes pieces queue, wait and meet head on, and quick turrets fire broadsides.
  "a fast feed and quick turrets": { ...DEFAULT_GUNNERY_CONFIG, maxOnDeck: 14, spawnEveryTicks: 4, spawnEveryTicksMin: 2, queueLength: 0, bag: [3, 3, 3, 2], fireAfterTicks: 1, stepPoints: 7, loadPoints: 60, comboStep: 15, comboCap: 4, broadsidePoints: 111 },
  // One gangway from the feeder to a hatch with a turret on each side: full loads, loads in a row and broadsides come often.
  "one gangway and two turrets": {
    ...DEFAULT_GUNNERY_CONFIG,
    decks: [["###C###", "B.....H", "####C##", "#######", "#######"]],
    maxTick: 500,
    spawnEveryTicks: 5,
    spawnEveryTicksMin: 5,
    fireAfterTicks: 2,
  },
  "a short round on one deck": { ...DEFAULT_GUNNERY_CONFIG, decks: [DEFAULT_GUNNERY_CONFIG.decks[3]!], maxTick: 300, spawnEveryTicks: 6, spawnEveryTicksMin: 6, queueLength: 5, bag: [1, 1, 1, 0], fireAfterTicks: 9 },
};

/**
 * A move for the shipped round, picked by a stream of the test's own. Most of the time it steers: it looks for
 * one arrow, laid or lifted, that sends a piece somewhere better (into a turret that wants it, or away from one
 * it would jam) and sends no other piece somewhere worse. The rest of the time it lays or lifts any arrow, so
 * that the rounds hold jams, splashes and pieces meeting head on as well.
 */
function pickMove(s: GunneryState, pick: (n: number) => number): { col: number; row: number; dir: 0 | 1 | 2 | 3 } | { col: number; row: number } | null {
  const planks = Array.from({ length: s.deck.cells.length }, (_, i) => ({ col: i % s.deck.width, row: Math.floor(i / s.deck.width) })).filter((c) => s.deck.cells[c.row * s.deck.width + c.col] === "deck");
  type Arrows = GunneryState["arrows"];
  const worth = (piece: GunneryState["pieces"][number], arrows: Arrows): number => {
    const end = predictPath(s, piece, 40, arrows).end;
    if (end?.type !== "turret") return 1;
    return end.outcome === "loaded" ? 4 : end.outcome === "load" || end.outcome === "clean" ? 3 : 0;
  };
  if (pick(8) > 0) {
    const now = s.pieces.map((piece) => worth(piece, s.arrows));
    const holds = (arrows: Arrows, but: number): boolean => s.pieces.every((piece, i) => i === but || worth(piece, arrows) >= now[i]!);
    for (const [i, piece] of s.pieces.entries()) {
      if (now[i]! >= 3) continue;
      for (const cell of [{ col: piece.col, row: piece.row }, ...predictPath(s, piece, 14).cells]) {
        const rest = s.arrows.filter((a) => a.col !== cell.col || a.row !== cell.row);
        if (rest.length < s.arrows.length && worth(piece, rest) > now[i]! && holds(rest, i)) return cell;
        for (const dir of [0, 1, 2, 3] as const) {
          const laid = [...rest, { ...cell, dir }];
          if (worth(piece, laid) > now[i]! && holds(laid, i)) return { ...cell, dir };
        }
      }
    }
    // Nothing to steer: an arrow no piece on deck needs is lifted, so it turns nothing that comes later.
    const spare = s.arrows.find((a) => holds(s.arrows.filter((b) => b !== a), -1));
    return spare ? { col: spare.col, row: spare.row } : null;
  }
  const at = planks[pick(planks.length)]!;
  const lift = s.arrows.length > 0 && pick(3) === 0 ? s.arrows[pick(s.arrows.length)]! : null;
  return lift ? { col: lift.col, row: lift.row } : { ...at, dir: pick(4) as 0 | 1 | 2 | 3 };
}

describe("Gunnery on the new engine, beside the engine the game ships", () => {
  const met: Record<string, number> = {};
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same deck, pieces, turrets, feed, score and streak, tick for tick: ${name}`, () => {
      const seen = { ticks: 0, moves: 0, drops: 0, loads: 0, full: 0, jams: 0, cleans: 0, splashes: 0, exits: 0, fires: 0, broadsides: 0, bestStreak: 0, score: 0 };
      for (let seed = 1; seed <= 6; seed++) {
        let shipped = createGunneryGame(`seed-${seed}`, config);
        // The shipped engine picks its deck and deals its bag from one stream. Each draw here is given the place in it that it would have had.
        const first = seedFromString(`gunnery:seed-${seed}`);
        let round: Round<Move> = start(gunnery, { seed, settings: settingsOf(config), streams: { deck: first, feed: nextInt(first, config.decks.length).state } });
        let screen: Seen = round.last.events.reduce(seenAfter, seenEmpty(shipped.deck.width, shipped.deck.height));
        let ground: SeenGround = round.last.events.reduce(groundAfter, seenEmpty(shipped.deck.width, shipped.deck.height) as SeenGround);
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (at: string): void => {
          const now = read(round);
          const want = shippedBoard(shipped);
          expect(now.tick, at).toBe(shipped.tick);
          expect(bare(now.board), at).toEqual(want.pieces);
          expect(now.ground, at).toEqual(want.ground);
          // A screen that has only ever seen the events holds the same pieces on the same deck.
          screen = round.last.events.reduce(seenAfter, screen);
          ground = round.last.events.reduce(groundAfter, ground);
          expect(screen, at).toEqual(now.board);
          expect(ground, at).toEqual(now.ground);
          expect(now.score, at).toBe(shipped.score);
          expect(now.streak, at).toBe(shipped.combo);
          expect(now.stats, at).toMatchObject({ best_streak: shipped.bestCombo, loads: shipped.loads, jams: shipped.jams, broadsides: shipped.broadsides, arrows: shipped.arrowsPlaced });
          expect((now.state as { feed: { queue: number[] } }).feed.queue, at).toEqual(shipped.queue);
          expect(round.state.bags.feed ?? [], at).toEqual(shipped.bag);
          expect(round.state.streams.feed, at).toEqual(shipped.rng);
          for (const e of shipped.lastMove?.events ?? []) {
            seen.drops += e.type === "spawn" ? 1 : 0;
            seen.loads += e.type === "load" ? 1 : 0;
            seen.full += e.type === "loaded" ? 1 : 0;
            seen.jams += e.type === "jam" ? 1 : 0;
            seen.cleans += e.type === "clean" ? 1 : 0;
            seen.splashes += e.type === "splash" ? 1 : 0;
            seen.exits += e.type === "exit" ? 1 : 0;
            seen.fires += e.type === "fire" ? 1 : 0;
            seen.broadsides += e.type === "broadside" ? 1 : 0;
          }
        };
        level(`${name}, seed ${seed}, the start`);
        for (let tick = 0; tick < config.maxTick - 6; ) {
          tick += 1 + pick(4);
          const at = `${name}, seed ${seed}, tick ${tick}`;
          // Time passes with no move...
          shipped = advanceGunnery(shipped, tick);
          round = advance(round, { at: tick * TICK });
          level(at);
          // ...and then, on the same tick, a move is made.
          const move = pickMove(shipped, pick);
          if (!move) continue;
          shipped = reduceGunnery(shipped, "dir" in move ? { type: "arrow", ...move, tick } : { type: "remove", ...move, tick });
          round = play(round, "dir" in move ? { move: "arrow", at: { x: move.col, y: move.row }, heading: DIRECTIONS[move.dir]! } : { move: "remove", at: { x: move.col, y: move.row } }, { at: tick * TICK });
          expect(round.last.refused, at).toBeNull();
          level(at);
          seen.moves++;
        }
        // The round runs out with nobody moving, and the last tick is the one that falls on the clock's end.
        shipped = advanceGunnery(shipped, config.maxTick);
        round = advance(round, { at: config.maxTick * TICK + 5000 });
        level(`${name}, seed ${seed}, the end`);
        expect(read(round, { at: config.maxTick * TICK }).ended).toBe("clock");
        expect(play(round, { move: "remove", at: { x: 1, y: 1 } }, { at: config.maxTick * TICK + 5000 }).last.refused).toBe("reason.round_over");
        seen.ticks += shipped.tick;
        seen.bestStreak = Math.max(seen.bestStreak, shipped.bestCombo);
        seen.score += shipped.score;
      }
      for (const [what, n] of Object.entries(seen)) met[what] = what === "bestStreak" ? Math.max(met[what] ?? 0, n) : (met[what] ?? 0) + n;
      expect(seen).toMatchSnapshot();
    });
  }
  // The comparison means something only if the rules were met.
  it("met every rule on the way: drops, loads, full loads in a row, jams, cleans, splashes, exits, fires and broadsides", () => {
    for (const what of ["drops", "loads", "full", "jams", "cleans", "splashes", "exits", "fires", "broadsides"]) expect(met[what], what).toBeGreaterThan(0);
    expect(met.bestStreak).toBeGreaterThan(2);
  });
});

describe("Gunnery, on its own", () => {
  const steer = (round: Round<Move>, moves: readonly [number, Move][], until: number): Round<Move> => advance(moves.reduce((r, [tick, move]) => play(r, move, { at: tick * TICK }), round), { at: until * TICK });

  it("runs every tick due before a move, and the same ticks however time is cut up", () => {
    const moves: [number, Move][] = [[5, { move: "arrow", at: { x: 4, y: 3 }, heading: "left" }], [40, { move: "arrow", at: { x: 2, y: 3 }, heading: "down" }], [90, { move: "remove", at: { x: 4, y: 3 } }]];
    const whole = steer(start(gunnery, { seed: 7 }), moves, 200);
    // The same moves with time let pass a tick at a time in between.
    let sliced = start(gunnery, { seed: 7 });
    for (let tick = 1; tick <= 200; tick++) {
      sliced = advance(sliced, { at: tick * TICK });
      for (const [when, move] of moves) if (when === tick) sliced = play(sliced, move, { at: tick * TICK });
    }
    expect(read(sliced)).toEqual(read(whole));
    expect(read(whole).tick).toBe(200);
    expect(read(replay(gunnery, "7", {}, whole.log, undefined, 200 * TICK))).toEqual(read(whole));
  });

  it("marks every event with the tick it happened on, and lets no tick run twice", () => {
    const round = advance(start(gunnery, { seed: 3 }), { at: 30 * TICK + 150 });
    expect(read(round).tick).toBe(30);
    const ticks = round.last.events.map((e) => e.tick!);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(round.last.events.filter((e) => e.event === "drop").map((e) => e.tick)).toEqual([2, 10, 18, 26]);
    expect(advance(round, { at: 30 * TICK + 199 }).last.events).toEqual([]);
    expect(() => advance(round, { at: 100 })).toThrow("time cannot run back");
  });

  it("refuses an arrow off the planks, and a refused move leaves the round and its ticks as they were", () => {
    const round = start(gunnery, { seed: 3 });
    const refused = play(round, { move: "arrow", at: { x: 0, y: 0 }, heading: "up" }, { at: 20 * TICK });
    expect(refused.last.refused).toBe("reason.not_a_plank");
    expect(read(refused).tick).toBe(0);
    expect(play(round, { move: "arrow", at: { x: 1, y: 1 }, heading: "sideways" as never }, { at: 20 * TICK }).last.refused).toBe("reason.unknown_move");
  });

  it("refuses a map that does not fit its board or names terrain the puzzle does not have", () => {
    expect(() => start(gunnery, { seed: 1, settings: { decks: [deckOf(["#B#", "#.#", "#H#"])] } })).toThrow("setting decks: map 0 is not 9 by 15");
    const odd = read(start(gunnery, { seed: 1 })).ground.map((row) => row.map((g) => (g?.terrain === "crate" ? "reef" : (g?.terrain ?? "plain"))));
    expect(() => start(gunnery, { seed: 1, settings: { decks: [odd] } })).toThrow("names the terrain reef");
  });

  it("explains which part answers each tick", () => {
    expect(explain(gunnery)).toContain("onTick");
    expect(expand(gunnery)).toMatchSnapshot();
  });
});
