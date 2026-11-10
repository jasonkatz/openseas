import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_REACTOR_CONFIG,
  InvalidMoveError,
  REACTOR_DIRS,
  createReactorGame,
  hashReactorState,
  reactorCanSwipe,
  reactorHint,
  reactorHotCount,
  reactorIsHot,
  reactorLaneCells,
  reactorLegalDirs,
  reactorPipelineLeft,
  reactorPortCell,
  reactorPortLoad,
  reactorPortStatus,
  reactorSwipeOutcome,
  reactorViewString,
  reduceReactor,
  replayReactor,
  type ReactorConfig,
  type ReactorDir,
  type ReactorMove,
  type ReactorPort,
  type ReactorRod,
  type ReactorState,
} from "../src/index.js";

const cfg = DEFAULT_REACTOR_CONFIG;
const UP: ReactorDir = 0;
const RIGHT: ReactorDir = 1;
const DOWN: ReactorDir = 2;
const LEFT: ReactorDir = 3;
const swipeTo = (dir: ReactorDir): ReactorMove => ({ type: "swipe", dir });

function playRandom(seed: string, picks: readonly number[], config: ReactorConfig = cfg): { moves: ReactorMove[]; state: ReactorState } {
  let state = createReactorGame(seed, config);
  const moves: ReactorMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const legal = reactorLegalDirs(state);
    if (legal.length === 0) break;
    const m = swipeTo(legal[p % legal.length]!);
    moves.push(m);
    state = reduceReactor(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 160 });

/** A core from rows of characters: `.` is empty, a digit is a rod of that grade. Ports and the next rod are given. */
function core(rows: readonly string[], ports: readonly ReactorPort[], over: Partial<ReactorState> = {}, config: Partial<ReactorConfig> = {}): ReactorState {
  const c: ReactorConfig = { ...cfg, size: rows.length, ...config };
  const base = createReactorGame("t", c);
  let id = 1000;
  const cells: Array<ReactorRod | null> = rows
    .join("")
    .split("")
    .map((ch) => (ch === "." ? null : { id: id++, grade: Number(ch) }));
  return { ...base, cells, ports, next: 1, nextId: id, ...over };
}

const grid = (s: ReactorState): string => reactorViewString(s.cells, []).split("|")[0]!;
const at = (s: ReactorState, col: number, row: number): number => row * s.config.size + col;

describe("reactor core", () => {
  it("opens with the configured rods and ports, a rod waiting, and a swipe to make", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createReactorGame(seed);
        expect(s.cells.length).toBe(cfg.size * cfg.size);
        expect(s.cells.filter((r) => r !== null).length).toBe(cfg.startRods);
        expect(s.cells.every((r) => r === null || r.grade === 1)).toBe(true);
        expect(s.ports.length).toBe(cfg.ports);
        expect(new Set(s.ports.map((p) => `${p.side}${p.lane}`)).size).toBe(cfg.ports);
        for (const p of s.ports) {
          expect([0, 1, 2, 3]).toContain(p.side);
          expect(p.lane).toBeGreaterThanOrEqual(0);
          expect(p.lane).toBeLessThan(cfg.size);
        }
        expect([1, 2]).toContain(s.next);
        expect(reactorLegalDirs(s).length).toBeGreaterThan(0);
        expect(s.score).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createReactorGame("x", { ...cfg, size: 2 })).toThrow();
    expect(() => createReactorGame("x", { ...cfg, fusePoints: [2, 5] })).toThrow();
    expect(() => createReactorGame("x", { ...cfg, size: 3, ports: 12 })).toThrow();
    expect(() => createReactorGame("x", { ...cfg, salvoPercent: [] })).toThrow();
    expect(() => createReactorGame("x", { ...cfg, criticalHot: 1 })).toThrow();
  });
});

describe("reactor determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayReactor(seed, cfg, moves);
        expect(hashReactorState(replayed)).toBe(hashReactorState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different openings", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashReactorState(createReactorGame(`seed-${i}`)));
    expect(hashes.size).toBeGreaterThan(45);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 40));
        const before = JSON.stringify(state);
        for (const d of reactorLegalDirs(state)) reduceReactor(state, swipeTo(d));
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 40 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceReactor(createReactorGame("x"), { type: "end" });
    expect(s.finished).toBe(true);
    expect({ score: s.score, moves: s.moveCount, bestCombo: s.bestCombo }).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceReactor(s, { type: "end" })).toThrow(InvalidMoveError);
    expect(reactorLegalDirs(s)).toEqual([]);
  });
});

describe("reactor rules", () => {
  it("keeps the core's invariants after every swipe", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createReactorGame(seed);
        for (const p of picks) {
          const legal = reactorLegalDirs(state);
          expect(legal.length).toBeGreaterThan(0);
          const dir = legal[p % legal.length]!;
          const next = reduceReactor(state, swipeTo(dir));
          const r = next.lastMove!;
          // The core: its size, no rod twice, no grade past hot, never critical, never stuck.
          expect(next.cells.length).toBe(cfg.size * cfg.size);
          const ids = next.cells.flatMap((x) => (x ? [x.id] : []));
          expect(new Set(ids).size).toBe(ids.length);
          for (const rod of next.cells) if (rod) expect(rod.grade).toBeLessThanOrEqual(cfg.hotGrade);
          expect(reactorHotCount(cfg, next.cells)).toBeLessThan(cfg.criticalHot);
          expect(reactorLegalDirs(next).length).toBeGreaterThan(0);
          // The ports: always the configured number, all different; a used one never reopens where it was.
          expect(next.ports.length).toBe(cfg.ports);
          expect(new Set(next.ports.map((q) => `${q.side}${q.lane}`)).size).toBe(cfg.ports);
          for (const d of r.discharges) expect(next.ports.some((q) => q.side === d.port.side && q.lane === d.port.lane)).toBe(false);
          // The score is what the report says, and never negative.
          expect(next.score).toBe(state.score + r.points);
          expect(next.score).toBeGreaterThanOrEqual(0);
          // Every rod that was in the core has one slide, and nothing else has.
          const before = state.cells.flatMap((x) => (x ? [x.id] : []));
          expect(r.slides.map((x) => x.id).sort((a, b) => a - b)).toEqual(before.sort((a, b) => a - b));
          for (const sl of r.slides) expect(state.cells[sl.from]?.id).toBe(sl.id);
          // A rod enters on the trailing edge of a lane that changed, at the grade that was shown.
          expect(r.entered).not.toBeNull();
          expect(r.entered!.grade).toBe(state.next);
          const trailing = Array.from({ length: cfg.size }, (_, lane) => reactorLaneCells(cfg, dir, lane)[cfg.size - 1]!);
          expect(trailing).toContain(r.entered!.cell);
          if (!r.scram) expect(next.cells[r.entered!.cell]?.id).toBe(r.entered!.id);
          // A pipeline is running exactly while swipes are left in it.
          expect(reactorPipelineLeft(next) > 0).toBe(next.combo > 0);
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  it("slides every rod to the wall and fuses equal grades once a swipe", () => {
    const s = core(["11..", "1111", "211.", "...3"], []);
    const next = reduceReactor(s, swipeTo(LEFT));
    const rows = grid(next).match(/.{4}/g)!;
    // Each row before the entering rod: 2..., 22.., 22.., 3...; the rod entered at the right end of one of them.
    const packed = ["2...", "22..", "22..", "3..."];
    let entered = 0;
    rows.forEach((row, i) => {
      if (row === packed[i]) return;
      expect(row.slice(0, 3)).toBe(packed[i]!.slice(0, 3));
      expect(row[3]).toBe("1");
      entered++;
    });
    expect(entered).toBe(1);
    const r = next.lastMove!;
    expect(r.fusions.length).toBe(4);
    expect(r.fusions.every((f) => f.grade === 2 && !f.hot && f.points === cfg.fusePoints[0])).toBe(true);
    expect(r.points).toBe(4 * cfg.fusePoints[0]!);
    expect(next.fusions).toBe(4);
    // A rod keeps its id when another fuses into it; the other is gone.
    const kept = r.slides.filter((x) => x.into === null && !x.out).map((x) => x.id);
    for (const id of kept) expect(next.cells.some((x) => x?.id === id)).toBe(true);
    for (const sl of r.slides.filter((x) => x.into !== null)) {
      expect(next.cells.some((x) => x?.id === sl.id)).toBe(false);
      expect(kept).toContain(sl.into);
    }
  });

  it("slides the other three ways too", () => {
    const s = core(["1..2", "....", "1...", "...2"], []);
    // Up: both columns fuse against the top wall, and the new rod enters along the bottom.
    expect(grid(reduceReactor(s, swipeTo(UP))).slice(0, 4)).toBe("2..3");
    const up = reduceReactor(s, swipeTo(UP)).lastMove!;
    expect(up.fusions.map((f) => f.grade).sort()).toEqual([2, 3]);
    const down = reduceReactor(s, swipeTo(DOWN)).lastMove!;
    expect(down.fusions.map((f) => f.cell).sort((a, b) => a - b)).toEqual([at(s, 0, 3), at(s, 3, 3)]);
    const right = reduceReactor(s, swipeTo(RIGHT)).lastMove!;
    expect(right.fusions.length).toBe(0);
    expect(right.slides.filter((x) => x.from !== x.to).map((x) => x.to).sort((a, b) => a - b)).toEqual([at(s, 2, 0), at(s, 3, 2)]);
  });

  it("refuses a swipe that changes nothing, and anything that is not a move", () => {
    const s = core(["12..", "3...", "....", "...."], []);
    expect(reactorCanSwipe(s, LEFT)).toBe(false);
    expect(reactorCanSwipe(s, UP)).toBe(false);
    expect(() => reduceReactor(s, swipeTo(LEFT))).toThrow(InvalidMoveError);
    expect(reactorLegalDirs(s)).toEqual([RIGHT, DOWN]);
    expect(() => reduceReactor(s, { type: "swipe", dir: 7 } as unknown as ReactorMove)).toThrow(InvalidMoveError);
    expect(() => reduceReactor(s, { type: "bogus" } as unknown as ReactorMove)).toThrow(InvalidMoveError);
  });

  it("a hot rod fuses with nothing, and a fusion can make one", () => {
    const hot = core(["44..", "....", "....", "...."], []);
    expect(reactorCanSwipe(hot, LEFT)).toBe(false);
    const s = core(["33..", "....", "....", "...."], []);
    const next = reduceReactor(s, swipeTo(LEFT));
    expect(next.lastMove!.fusions).toMatchObject([{ grade: 4, hot: true, points: cfg.fusePoints[2] }]);
    expect(reactorIsHot(cfg, next.cells[0]!.grade)).toBe(true);
    expect(reactorHotCount(cfg, next.cells)).toBe(1);
  });

  it("discharges a hot rod pushed against a wall with an open port, closes the port and opens another", () => {
    const port: ReactorPort = { side: LEFT, lane: 1 };
    const s = core(["....", ".4.1", "....", "...."], [port, { side: UP, lane: 3 }]);
    expect(reactorPortCell(s.config, port)).toBe(at(s, 0, 1));
    expect(reactorPortStatus(s, port)).toBe("ready");
    expect(reactorPortLoad(s, port)).toBe(1);
    expect(reactorHint(s)).toBe(LEFT);
    expect(reactorSwipeOutcome(s, LEFT)).toMatchObject({ legal: true, discharges: 1 });
    const next = reduceReactor(s, swipeTo(LEFT));
    const r = next.lastMove!;
    expect(r.discharges).toMatchObject([{ port, cell: at(s, 0, 1), pipeline: 1, percent: 100, points: cfg.dischargePoints }]);
    expect(r.points).toBe(cfg.dischargePoints);
    expect(next.discharges).toBe(1);
    expect(next.combo).toBe(1);
    expect(next.bestCombo).toBe(1);
    // The rod behind it took its place at the wall.
    expect(next.cells[at(s, 0, 1)]?.grade).toBe(1);
    expect(reactorHotCount(cfg, next.cells)).toBe(0);
    // That port is gone, the other stays, a new one is open somewhere else.
    expect(next.ports.length).toBe(2);
    expect(next.ports[0]).toEqual({ side: UP, lane: 3 });
    expect(r.opened.length).toBe(1);
    expect(r.opened[0]).not.toEqual(port);
    expect(next.ports[1]).toEqual(r.opened[0]);
  });

  it("a hot rod with a rod between it and the port is blocked, and one with no port in its lane only slides", () => {
    const port: ReactorPort = { side: LEFT, lane: 0 };
    const blocked = core(["14..", "....", "....", "...."], [port]);
    expect(reactorPortStatus(blocked, port)).toBe("blocked");
    expect(reactorPortLoad(blocked, port)).toBe(0);
    expect(reactorHint(blocked)).toBeNull();
    const idle = core(["1...", "..4.", "....", "...."], [port]);
    expect(reactorPortStatus(idle, port)).toBe("idle");
    const next = reduceReactor(idle, swipeTo(LEFT));
    expect(next.lastMove!.discharges).toEqual([]);
    expect(next.cells[at(idle, 0, 1)]?.grade).toBe(4);
    // The same port only takes a rod pushed toward its own wall.
    const side = core(["4...", "....", "....", "1..."], [port]);
    expect(reduceReactor(side, swipeTo(UP)).lastMove!.discharges).toEqual([]);
  });

  it("hot rods stacked at a port leave together, for a salvo", () => {
    const port: ReactorPort = { side: LEFT, lane: 2 };
    const s = core(["....", "....", ".44.", "...."], [port, { side: DOWN, lane: 0 }]);
    expect(reactorPortLoad(s, port)).toBe(2);
    const next = reduceReactor(s, swipeTo(LEFT));
    const r = next.lastMove!;
    expect(r.discharges.map((d) => [d.pipeline, d.percent, d.points])).toEqual([
      [1, 100, 100],
      [2, 125, 125],
    ]);
    expect(r.salvoPercent).toBe(cfg.salvoPercent[1]);
    expect(r.points).toBe(Math.floor((225 * cfg.salvoPercent[1]!) / 100));
    expect(next.salvos).toBe(1);
    expect(next.combo).toBe(2);
    // One port was used, so one port opened.
    expect(r.opened.length).toBe(1);
    expect(next.ports.length).toBe(2);
    // A rod that is not hot stops the salvo: only the rods ahead of it leave.
    const mixed = core(["....", "....", "414.", "...."], [port]);
    const after = reduceReactor(mixed, swipeTo(LEFT));
    expect(after.lastMove!.discharges.length).toBe(1);
    expect(after.cells[at(mixed, 0, 2)]?.grade).toBe(1);
    expect(after.cells[at(mixed, 1, 2)]?.grade).toBe(4);
  });

  it("two ports on one wall both fire in one swipe", () => {
    const a: ReactorPort = { side: UP, lane: 0 };
    const b: ReactorPort = { side: UP, lane: 3 };
    const s = core(["....", "4..4", "....", "...."], [a, b]);
    const next = reduceReactor(s, swipeTo(UP));
    expect(next.lastMove!.discharges.length).toBe(2);
    expect(next.lastMove!.opened.length).toBe(2);
    expect(next.ports.length).toBe(2);
    expect(next.salvos).toBe(1);
  });

  it("the pipeline runs while discharges keep coming and lapses when the window is used up", () => {
    const port: ReactorPort = { side: LEFT, lane: 0 };
    const config = { pipelineSwipes: 2 };
    let s = core([".4..", "....", "....", "...1"], [port], {}, config);
    s = reduceReactor(s, swipeTo(LEFT));
    expect(s.combo).toBe(1);
    expect(reactorPipelineLeft(s)).toBe(2);
    // A second discharge inside the window is the second of the run, at the second percent.
    const second = reduceReactor({ ...s, cells: core([".4..", "....", "....", "...1"], []).cells, ports: [port] }, swipeTo(LEFT));
    expect(second.lastMove!.discharges).toMatchObject([{ pipeline: 2, percent: cfg.pipelinePercent[1] }]);
    expect(second.bestCombo).toBe(2);
    // Two swipes with no discharge use the window up.
    let t: ReactorState = { ...s, cells: core(["....", "....", "....", "1..2"], []).cells, ports: [] };
    t = reduceReactor(t, swipeTo(UP));
    expect(t.combo).toBe(1);
    expect(t.lastMove!.lapsed).toBe(false);
    expect(reactorPipelineLeft(t)).toBe(1);
    t = reduceReactor(t, swipeTo(DOWN));
    expect(t.combo).toBe(0);
    expect(t.lastMove!.lapsed).toBe(true);
    expect(reactorPipelineLeft(t)).toBe(0);
    // The next discharge starts a new run.
    const fresh = reduceReactor({ ...t, cells: core([".4..", "....", "....", "...1"], []).cells, ports: [port] }, swipeTo(LEFT));
    expect(fresh.lastMove!.discharges).toMatchObject([{ pipeline: 1, percent: 100 }]);
    expect(fresh.bestCombo).toBe(1);
  });

  it("a discharge on the last swipe of the window still continues the run", () => {
    const port: ReactorPort = { side: LEFT, lane: 0 };
    let s = core([".4..", "....", "....", "...1"], [port], {}, { pipelineSwipes: 2 });
    s = reduceReactor(s, swipeTo(LEFT));
    let t: ReactorState = { ...s, cells: core(["....", "....", "....", "1..2"], []).cells, ports: [] };
    t = reduceReactor(t, swipeTo(UP));
    const last = reduceReactor({ ...t, cells: core([".4..", "....", "....", "...1"], []).cells, ports: [port] }, swipeTo(LEFT));
    expect(last.lastMove!.discharges).toMatchObject([{ pipeline: 2 }]);
  });

  it("scrams when too many hot rods are in the core at once", () => {
    const s = core(["4..4", "....", "4...", "33.."], [], { score: 400, combo: 2, sinceDischarge: 1 });
    const next = reduceReactor(s, swipeTo(LEFT));
    const r = next.lastMove!;
    expect(r.scram).not.toBeNull();
    expect(r.scram!.cause).toBe("critical");
    expect(r.scram!.penalty).toBe(cfg.scramPenalty);
    expect(r.points).toBe(cfg.fusePoints[2]! - cfg.scramPenalty);
    expect(next.score).toBe(400 + cfg.fusePoints[2]! - cfg.scramPenalty);
    expect(next.scrams).toBe(1);
    expect(next.combo).toBe(0);
    // The core restarts with fresh rods, and the ports stay.
    expect(next.cells.filter((x) => x !== null).length).toBe(cfg.startRods);
    expect(r.scram!.fresh.length).toBe(cfg.startRods);
    for (const f of r.scram!.fresh) expect(next.cells[f.cell]).toEqual({ id: f.id, grade: 1 });
    expect(r.scram!.ids.length).toBeGreaterThanOrEqual(4);
  });

  it("scrams when no swipe can change anything, and the score never goes below zero", () => {
    // Swiping left moves only the bottom row; the rod that enters fills the core with nothing to fuse.
    const s = core(["121", "212", ".12"], [], { next: 3, score: 40 });
    const next = reduceReactor(s, swipeTo(LEFT));
    const r = next.lastMove!;
    expect(r.entered).toMatchObject({ cell: 8, grade: 3 });
    expect(r.scram).not.toBeNull();
    expect(r.scram!.cause).toBe("jammed");
    expect(r.scram!.penalty).toBe(40);
    expect(r.scram!.ids.length).toBe(9);
    expect(next.score).toBe(0);
    expect(reactorLegalDirs(next).length).toBeGreaterThan(0);
  });

  it("stops at the move cap", () => {
    const config: ReactorConfig = { ...cfg, maxMoves: 2 };
    let s = createReactorGame("cap", config);
    s = reduceReactor(s, swipeTo(reactorLegalDirs(s)[0]!));
    expect(s.finished).toBe(false);
    s = reduceReactor(s, swipeTo(reactorLegalDirs(s)[0]!));
    expect(s.finished).toBe(true);
    expect(() => reduceReactor(s, swipeTo(LEFT))).toThrow(InvalidMoveError);
  });

  it("the lanes of a swipe start at its wall", () => {
    expect(reactorLaneCells(cfg, UP, 1)).toEqual([1, 5, 9, 13]);
    expect(reactorLaneCells(cfg, RIGHT, 0)).toEqual([3, 2, 1, 0]);
    expect(reactorLaneCells(cfg, DOWN, 3)).toEqual([15, 11, 7, 3]);
    expect(reactorLaneCells(cfg, LEFT, 2)).toEqual([8, 9, 10, 11]);
    expect(REACTOR_DIRS).toEqual([0, 1, 2, 3]);
  });

  it("the view string names every cell and every port", () => {
    const s = core(["1..2", "....", ".4..", "...3"], [
      { side: LEFT, lane: 2 },
      { side: UP, lane: 0 },
    ]);
    expect(reactorViewString(s.cells, s.ports)).toBe("1..2.....4.....3|00,32");
  });
});
