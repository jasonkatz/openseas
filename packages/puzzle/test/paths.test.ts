// Rung 4 is proved by a real puzzle: Paths, written as six parts over a ladder of four stages, played beside
// Salvage, the engine the game ships for it. Both start from the same board with the same luck to come, and
// are held to the same board, streak, bounty, counts and luck after every move, at every stage.
import { createSalvageGame, DEFAULT_SALVAGE_CONFIG, reduceSalvage, SALVAGE_CRATE, SALVAGE_RUBBLE, salvageCanClose, salvageCanExtend, salvageLineValue, type SalvageConfig, type SalvageState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import paths, { pathsWith, type TraceMove } from "../examples/paths.puzzle.js";
import { expand, hint, nextInt, play, read, replay, seedFromString, seenAfter, seenEmpty, start, type Event, type NewPiece, type Piece, type Round, type Seen, type Setting } from "../src/index.js";

const beside = pathsWith({ luck: "one" });

const pieceOf = (p: { kind: number; fuse?: number }): NewPiece =>
  p.kind === SALVAGE_CRATE ? { piece: "prize" } : p.kind === SALVAGE_RUBBLE ? { piece: "ruined" } : p.fuse ? { piece: "timed", kind: p.kind + 1, state: p.fuse } : { piece: "kind", kind: p.kind + 1 };
/** The shipped board as the new engine holds one: row by row from the top. */
const boardOf = (s: SalvageState): NewPiece[][] => Array.from({ length: s.config.height }, (_, y) => Array.from({ length: s.config.width }, (_, x) => pieceOf(s.cells[y * s.config.width + x]!)));
const bare = (board: readonly (readonly (Piece | NewPiece | null)[])[]): (NewPiece | null)[][] => board.map((row) => row.map((p) => (p ? { piece: p.piece, ...(p.kind === undefined ? {} : { kind: p.kind }), ...(p.state === undefined ? {} : { state: p.state }) } : null)));
/** The shipped numbers under the names Paths gives them. */
const settingsOf = (c: SalvageConfig): Record<string, Setting> => ({
  width: c.width, height: c.height, kinds: c.kinds, maxMoves: c.maxMoves,
  pathMin: c.minLine, pathPoints: c.linePoints,
  streakMin: c.streakMin, streakPercent: c.streakPercent,
  startPrizes: c.startCrates, prizePermille: c.cratePermille, maxPrizes: c.maxCrates, prizeFloorPoints: c.crateFloorPoints,
  loopMin: c.loopMin, loopPercent: c.loopPercent, insidePoints: c.enclosedPoints, prizeLoopPoints: c.crateLoopPoints,
  bountyLength: c.orderLength, bountyBonus: c.orderBonus,
  timerEvery: c.volatileEvery, timerFuse: c.fuse, timerPoints: c.volatilePoints,
});
/** What Salvage switches off by its numbers to cut each stage, which Paths cuts by leaving layers off. */
const OFF = {
  paths: { streakPercent: [100], startCrates: 0, maxCrates: 0, cratePermille: 0, loopMin: 0, orderLength: 0, volatileEvery: 0 },
  streak: { loopMin: 0, orderLength: 0, volatileEvery: 0 },
  loops: { volatileEvery: 0 },
  full: {},
} as const;
const CONFIGS: Record<string, SalvageConfig> = {
  "as shipped": DEFAULT_SALVAGE_CONFIG,
  // Few kinds make long paths and wide loops, and fast timers with short fuses blow up often.
  "few kinds, many prizes, fast timers": { ...DEFAULT_SALVAGE_CONFIG, kinds: 3, cratePermille: 150, maxCrates: 5, startCrates: 4, loopPercent: 300, orderLength: 5, volatileEvery: 2, fuse: 3, streakMin: 6, streakPercent: [100, 125, 155, 190, 235] },
  "a small board": { ...DEFAULT_SALVAGE_CONFIG, width: 5, height: 6, kinds: 4, minLine: 2, loopMin: 3, startCrates: 1, maxCrates: 2, cratePermille: 300, volatileEvery: 3, fuse: 2, orderLength: 4, streakMin: 3, crateFloorPoints: 7 },
};

/** A legal move on the shipped board, picked by a stream of the test's own: a wide loop where one lies ready, else a wandering path, closed when it can be. */
function pickMove(s: SalvageState, pick: (n: number) => number): { cells: number[]; loop: boolean } {
  const { width, height, loopMin, minLine } = s.config;
  if (loopMin > 0 && pick(2) === 0) {
    for (let c = 0; c < s.cells.length; c++) {
      const [x, y] = [c % width, Math.floor(c / width)];
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
      const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(([dx, dy]) => (y + dy!) * width + x + dx!);
      if (ring.every((cell, i) => i === 0 || salvageCanExtend(s, ring.slice(0, i), cell)) && salvageCanClose(s, ring)) return { cells: ring, loop: true };
    }
  }
  for (;;) {
    const cells = [pick(s.cells.length)];
    const want = minLine + pick(8);
    while (cells.length < want) {
      const next = Array.from({ length: s.cells.length }, (_, c) => c).filter((c) => salvageCanExtend(s, cells, c));
      if (next.length === 0) break;
      cells.push(next[pick(next.length)]!);
    }
    if (cells.length >= minLine) return { cells, loop: salvageCanClose(s, cells) && pick(3) > 0 };
  }
}

describe("Paths on the new engine, beside the engine the game ships", () => {
  for (const [name, whole] of Object.entries(CONFIGS)) {
    for (const stage of ["paths", "streak", "loops", "full"] as const) {
      it(`holds the same board, streak, bounty, counts and luck after every move: ${name}, at the stage ${stage}`, () => {
        const config: SalvageConfig = { ...whole, ...OFF[stage] };
        const seen = { moves: 0, loops: 0, inside: 0, netted: 0, floor: 0, defused: 0, blowups: 0, bounties: 0, reshuffles: 0, roundedApart: 0 };
        for (let seed = 1; seed <= 8; seed++) {
          let shipped = createSalvageGame(`seed-${seed}`, config);
          let round: Round<TraceMove> = start(beside, { seed, stage, settings: settingsOf(whole), board: boardOf(shipped), tasks: shipped.order ? [{ task: "bounty", holds: { kind: shipped.order.kind + 1 } }] : [], streams: { debris: shipped.rng } });
          let screen: Seen = round.last.events.reduce(seenAfter, seenEmpty(config.width, config.height));
          let picks = seedFromString(`picks-${seed}`);
          const pick = (n: number): number => {
            const r = nextInt(picks, n);
            picks = r.state;
            return r.value;
          };
          let score = 0;
          for (let m = 0; m < 100; m++) {
            const { cells, loop } = pickMove(shipped, pick);
            const before = shipped;
            const value = salvageLineValue(before, cells, loop);
            shipped = reduceSalvage(shipped, { type: "tether", cells, loop });
            const report = shipped.lastMove!;
            round = play(round, { move: "trace", path: cells.map((c) => ({ x: c % config.width, y: Math.floor(c / config.width) })), closed: loop });
            const at = `${name}, ${stage}, seed ${seed}, move ${m}`;
            expect(round.last.refused, at).toBeNull();
            const now = read(round);
            expect(bare(now.board), at).toEqual(boardOf(shipped));
            expect(round.state.streams.debris, at).toEqual(shipped.rng);
            // A screen that has only ever seen the events holds the same board.
            screen = round.last.events.reduce(seenAfter, screen);
            expect(screen, at).toEqual(now.board);
            // Salvage rounds the path's points down, and then each prize taken at the floor. Paths rounds once a move.
            const floor = shipped.cratesFloor - before.cratesFloor;
            const banked = Math.floor(((value.base + floor * config.crateFloorPoints) * report.streakPercent) / 100);
            expect(round.last.banked, at).toBe(banked);
            if (banked !== report.points) seen.roundedApart++, expect(floor, at).toBeGreaterThan(0), expect(banked - report.points, at).toBeLessThanOrEqual(report.rounds.length);
            score += banked;
            expect(now.score, at).toBe(score);
            if (stage !== "paths") expect(now.streak, at).toBe(shipped.combo);
            expect(now.tasks, at).toEqual(shipped.order ? [{ task: "bounty", holds: { kind: shipped.order.kind + 1 } }] : []);
            expect(now.stats, at).toMatchObject({
              paths: shipped.moveCount,
              longest: shipped.longest,
              ...(stage === "paths" ? {} : { prizes_floor: shipped.cratesFloor }),
              ...(stage === "loops" || stage === "full" ? { loops: shipped.loops, prizes_netted: shipped.cratesNetted, bounties: shipped.ordersFilled } : {}),
              ...(stage === "full" ? { defused: shipped.defused, blowups: shipped.blasts } : {}),
            });
            seen.moves++;
            seen.loops += report.loop ? 1 : 0;
            seen.inside += report.enclosed.length;
            seen.netted += report.netted.length;
            seen.floor += floor;
            seen.defused += report.defused.length;
            seen.blowups += report.blasts.length;
            seen.bounties += report.orderFilled ? 1 : 0;
            seen.reshuffles += report.shuffled ? 1 : 0;
          }
        }
        // The comparison means something only if the rules of the stage were met.
        expect(seen.moves).toBe(800);
        if (stage !== "paths") expect(seen.floor).toBeGreaterThan(0);
        if (stage === "loops" || stage === "full") expect(Math.min(seen.loops, seen.netted, seen.bounties)).toBeGreaterThan(0);
        if (stage === "full") expect(Math.min(seen.defused, seen.blowups)).toBeGreaterThan(0);
        expect(seen).toMatchSnapshot();
      });
    }
    it(`deals the same opening board and bounty: ${name}`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const shipped = createSalvageGame(`seed-${seed}`, whole);
        const round = start(beside, { seed, settings: settingsOf(whole), streams: { debris: seedFromString(`salvage:seed-${seed}`) } });
        expect(bare(read(round).board)).toEqual(boardOf(shipped));
        expect(read(round).tasks).toEqual([{ task: "bounty", holds: { kind: shipped.order!.kind + 1 } }]);
        expect(round.state.streams.debris).toEqual(shipped.rng);
      }
    });
  }
});

describe("Paths, on its own", () => {
  const playOut = (seed: number, stage: string, moves: number): Round<TraceMove> => {
    let round = start(paths, { seed, stage });
    for (let m = 0; m < moves; m++) round = play(round, hint(round)!);
    return round;
  };

  it("is cut into stages by layers: each stage has only what its layers bring", () => {
    expect(paths.document.ladder.map((x) => [x.stage, x.adds])).toEqual([["paths", ["paths"]], ["streak", ["streak", "prizes"]], ["loops", ["loops", "bounty"]], ["full", ["timers"]]]);
    const first = playOut(1, "paths", 40);
    expect(read(first)).toMatchObject({ stage: "paths", streak: 0, gauges: {}, stats: { paths: 40 }, tasks: [] });
    expect(read(first).board.flat().every((p) => p?.piece === "kind")).toBe(true);
    expect(Object.keys(read(playOut(1, "streak", 5)).gauges)).toEqual(["streak"]);
    expect(read(start(paths, { seed: 1, stage: "loops" })).tasks).toHaveLength(1);
    expect(read(start(paths, { seed: 1 })).stage).toBe("full");
    expect(() => start(paths, { seed: 1, stage: "nets" })).toThrow("paths has no stage nets: its ladder is paths, streak, loops, full");
  });

  it("refuses a closed path at a stage that has not reached loops", () => {
    const round = start(paths, { seed: 3, stage: "streak" });
    const open = hint(round)!;
    expect(play(round, { ...open, closed: true }).last.refused).toBe("reason.cannot_close");
    expect(play(round, open).last.refused).toBeNull();
  });

  it("opens with a bounty posted, and posts another kind when one is filled", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let round = start(paths, { seed, settings: { kinds: 2, bountyLength: 3 } });
      const posted = round.last.events.find((e) => e.event === "posted")!;
      expect(posted.tasks).toEqual([{ task: "bounty", opened: { kind: posted.fields.kind } }]);
      for (let m = 0; m < 30; m++) {
        const was = read(round).tasks[0]!.holds.kind;
        round = play(round, hint(round)!);
        const events = round.last.events.map((e) => e.event);
        if (events.includes("bounty")) expect(events.at(-1)).toBe("posted"), expect(read(round).tasks[0]!.holds.kind).not.toBe(was);
        else expect(read(round).tasks[0]!.holds.kind).toBe(was);
      }
    }
  });

  it("plays the same round again from its seed, stage and log, and a screen follows it by events alone", () => {
    for (const stage of ["paths", "streak", "loops", "full"]) {
      for (let seed = 1; seed <= 5; seed++) {
        let round = start(paths, { seed, stage });
        const events: Event[] = [...round.last.events];
        for (let m = 0; m < 60; m++) events.push(...(round = play(round, hint(round)!)).last.events);
        const again = replay(paths, String(seed), {}, round.log, stage);
        expect(read(again)).toEqual(read(round));
        expect(events.reduce(seenAfter, seenEmpty(7, 8))).toEqual(read(round).board);
      }
    }
  });

  it("expands to a whole document", () => {
    expect(expand(paths)).toMatchSnapshot();
  });
});
