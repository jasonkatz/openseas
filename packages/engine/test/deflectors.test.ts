import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_DEFLECTORS_CONFIG,
  DEFLECTORS_BACKSLASH,
  DEFLECTORS_EMPTY,
  DEFLECTORS_LENS,
  DEFLECTORS_SLASH,
  InvalidMoveError,
  advanceDeflectors,
  createDeflectorsGame,
  deflectorsBeamPoints,
  deflectorsEmitterPorts,
  deflectorsHint,
  deflectorsIsMirror,
  deflectorsLitPercentAt,
  deflectorsOutlook,
  deflectorsRecipeSize,
  deflectorsResolve,
  deflectorsTrace,
  deflectorsViewString,
  hashDeflectorsState,
  reduceDeflectors,
  replayDeflectors,
  summarizeDeflectors,
  type DeflectorsConfig,
  type DeflectorsEvent,
  type DeflectorsMove,
  type DeflectorsState,
  type DeflectorsTarget,
} from "../src/index.js";

const cfg = DEFAULT_DEFLECTORS_CONFIG;

/** A round played by picks: each step lets some ticks pass, then places the next piece, turns it, fires or only waits. */
function playRandom(seed: string, picks: readonly number[], config: DeflectorsConfig = cfg): { moves: DeflectorsMove[]; state: DeflectorsState } {
  let state = createDeflectorsGame(seed, config);
  const moves: DeflectorsMove[] = [];
  for (let i = 0; i + 3 <= picks.length && !state.finished; i += 3) {
    const tick = Math.min(config.maxTick, state.tick + (picks[i]! % 30));
    const at = advanceDeflectors(state, tick);
    const kind = picks[i + 1]! % 6;
    let move: DeflectorsMove;
    if (kind <= 2 && at.queue.length > 0) move = { type: "place", cell: picks[i + 2]! % at.mirrors.length, tick };
    else if (kind === 3 && at.queue.length > 0 && deflectorsIsMirror(at.queue[0]!)) move = { type: "turn", tick };
    else if (kind === 4 && tick >= at.fireTick) move = { type: "fire", tick };
    else move = { type: "wait", tick };
    moves.push(move);
    state = reduceDeflectors(state, move);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 240 });

/**
 * A grid from rows of characters: `.` empty, `/` and `\` mirrors, `a`, `b`, `c` lenses, with these
 * targets as [port, recipe]. Nothing is spent unless `over` says so, and no piece comes for a long
 * while. With one emitter on a three by three grid it is port 10, the left edge of the middle row.
 */
function grid(rows: readonly string[], targets: ReadonlyArray<readonly [port: number, recipe: number]>, over: Partial<DeflectorsConfig> = {}): DeflectorsState {
  const emitters = over.emitters ?? 1;
  const config: DeflectorsConfig = {
    ...cfg,
    size: rows.length,
    emitters,
    targets: Math.max(1, targets.length),
    mirrors: 0,
    lenses: 0,
    litPercent: cfg.litPercent.slice(0, emitters).concat(Array.from({ length: Math.max(0, emitters - cfg.litPercent.length) }, () => 800)),
    spend: false,
    ...over,
  };
  const base = createDeflectorsGame("t", config);
  const cell = (ch: string): number => (ch === "/" ? DEFLECTORS_SLASH : ch === "\\" ? DEFLECTORS_BACKSLASH : ch >= "a" && ch <= "c" ? DEFLECTORS_LENS + ch.charCodeAt(0) - 97 : DEFLECTORS_EMPTY);
  return {
    ...base,
    mirrors: rows.join("").split("").map(cell),
    targets: targets.map(([port, recipe], id) => ({ id, port, recipe })),
    left: 0,
  };
}

const fires = (s: DeflectorsState): Extract<DeflectorsEvent, { type: "fire" }>[] => (s.lastMove?.events ?? []).flatMap((e) => (e.type === "fire" ? [e] : []));

describe("deflectors grid", () => {
  it("opens with the configured mirrors and lenses, emitters down the left edge, targets on the others, and a piece waiting", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createDeflectorsGame(seed);
        const n = cfg.size;
        expect(s.mirrors.length).toBe(n * n);
        expect(s.mirrors.filter((m) => deflectorsIsMirror(m)).length).toBe(cfg.mirrors);
        const lenses = s.mirrors.filter((m) => m >= DEFLECTORS_LENS).map((m) => m - DEFLECTORS_LENS);
        expect(lenses.sort()).toEqual([0, 1]);
        expect(s.emitters).toEqual(deflectorsEmitterPorts(cfg));
        expect(s.emitters).toEqual([3 * n + 1, 3 * n + 3, 3 * n + 5]);
        expect(s.targets.length).toBe(cfg.targets);
        expect(new Set(s.targets.map((t) => t.port)).size).toBe(cfg.targets);
        expect(s.targets.map((t) => t.id)).toEqual([0, 1, 2, 3, 4]);
        for (const t of s.targets) {
          expect(t.port).toBeLessThan(3 * n);
          expect(deflectorsRecipeSize(t.recipe)).toBeLessThanOrEqual(cfg.recipeWeights.length - 1);
          expect(t.recipe).toBeLessThan(8);
        }
        expect(s.queue.length).toBe(cfg.queueSize);
        expect(s.left).toBe(cfg.pieces - cfg.queueSize);
        expect(s.fireTick).toBe(0);
        expect(s.score).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("deals recipes by their weights, and none at all with one weight", () => {
    const sizes = [0, 0, 0];
    for (let i = 0; i < 400; i++) for (const t of createDeflectorsGame(`r-${i}`).targets) sizes[deflectorsRecipeSize(t.recipe)]!++;
    const total = sizes[0]! + sizes[1]! + sizes[2]!;
    cfg.recipeWeights.forEach((w, k) => expect(Math.abs(sizes[k]! / total - w / 100)).toBeLessThan(0.04));
    const plain = createDeflectorsGame("x", { ...cfg, recipeWeights: [1], lensChance: 0 });
    expect(plain.targets.every((t) => t.recipe === 0)).toBe(true);
  });

  it("rejects an invalid config", () => {
    expect(() => createDeflectorsGame("x", { ...cfg, size: 2 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, mirrors: 37 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, mirrors: 34, lenses: 3 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, emitters: 2 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, emitters: 2, litPercent: [100, 200] })).not.toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, targets: 0 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, recipeWeights: [] })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, recipeWeights: [0, 0, 0] })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, recipeWeights: [1, 1, 1, 1, 1] })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, lensChance: 0 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, recipeWeights: [1], lensChance: 0 })).not.toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, queueSize: 0 })).toThrow();
    expect(() => createDeflectorsGame("x", { ...cfg, pieces: 0 })).toThrow();
    expect(createDeflectorsGame("x", { ...cfg, pieces: 2 }).queue.length).toBe(2);
    expect(() => createDeflectorsGame("x", { ...cfg, spend: 1 as unknown as boolean })).toThrow();
  });
});

describe("deflectors determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayDeflectors(seed, cfg, moves);
        expect(hashDeflectorsState(replayed)).toBe(hashDeflectorsState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("time passing in one step or in many comes to the same grid", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.array(fc.integer({ min: 1, max: 90 }), { minLength: 1, maxLength: 20 }), (seed, picks, gaps) => {
        const { state } = playRandom(seed, picks.slice(0, 60));
        if (state.finished) return;
        let stepped = state;
        for (const g of gaps) {
          if (stepped.finished) break;
          stepped = reduceDeflectors(stepped, { type: "wait", tick: Math.min(cfg.maxTick, stepped.tick + g) });
        }
        const once = reduceDeflectors(state, { type: "wait", tick: stepped.tick });
        const strip = (s: DeflectorsState): unknown => ({ ...s, logLength: 0, lastMove: null, finished: false });
        expect(strip(once)).toEqual(strip(stepped));
        const shown = advanceDeflectors(state, stepped.tick);
        expect(strip(shown)).toEqual(strip(once));
        expect(shown.lastMove?.events ?? []).toEqual(once.lastMove!.events);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different grids", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashDeflectorsState(createDeflectorsGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce and advance never mutate their input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 30));
        if (state.finished) return;
        const before = JSON.stringify(state);
        const tick = Math.min(cfg.maxTick, state.tick + 40);
        const at = advanceDeflectors(state, tick);
        if (at.queue.length) reduceDeflectors(state, { type: "place", cell: 7, tick });
        if (at.queue.length && deflectorsIsMirror(at.queue[0]!)) reduceDeflectors(state, { type: "turn", tick });
        if (tick >= state.fireTick) reduceDeflectors(state, { type: "fire", tick });
        deflectorsOutlook(state);
        deflectorsHint(state);
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 40 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceDeflectors(createDeflectorsGame("x"), { type: "end", tick: 0 });
    expect(s.finished).toBe(true);
    expect(summarizeDeflectors(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceDeflectors(s, { type: "end", tick: 0 })).toThrow(InvalidMoveError);
  });
});

describe("deflectors beams and mirrors", () => {
  it("a beam runs straight through empty cells and turns at a mirror", () => {
    // Port 10 is the left edge, row 1, heading right; ports 1 and 7 are the top and bottom of column 1.
    const slash = grid(["...", "./.", "..."], []);
    const c = slash.config;
    const none = { lenses: 0, lensCells: [] };
    expect(deflectorsTrace(c, slash.mirrors, 10)).toEqual({ out: 1, bounces: 1, turns: [4], ...none });
    const back = grid(["...", ".\\.", "..."], []);
    expect(deflectorsTrace(c, back.mirrors, 10)).toEqual({ out: 7, bounces: 1, turns: [4], ...none });
    expect(deflectorsTrace(c, back.mirrors, 9)).toEqual({ out: 3, bounces: 0, turns: [], ...none });
    const two = grid(["./.", "./.", "..."], []);
    expect(deflectorsTrace(c, two.mirrors, 10)).toEqual({ out: 3, bounces: 2, turns: [4, 1], ...none });
    const lens = grid(["...", "a/c", ".b."], []);
    expect(deflectorsTrace(c, lens.mirrors, 10)).toEqual({ out: 1, bounces: 1, turns: [4], lenses: 0b001, lensCells: [3] });
    expect(deflectorsTrace(c, lens.mirrors, 7)).toEqual({ out: 4, bounces: 1, turns: [4], lenses: 0b110, lensCells: [7, 5] });
  });

  it("a route runs the same backwards", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 23 }), (seed, entry) => {
        const s = createDeflectorsGame(seed);
        const there = deflectorsTrace(cfg, s.mirrors, entry);
        const back = deflectorsTrace(cfg, s.mirrors, there.out);
        expect(there.out).not.toBe(entry);
        expect(back.out).toBe(entry);
        expect(back.bounces).toBe(there.bounces);
        expect(back.turns).toEqual(there.turns.slice().reverse());
        expect(back.lenses).toBe(there.lenses);
      }),
    );
  });

  it("emitters spread down the left edge", () => {
    expect(deflectorsEmitterPorts({ ...cfg, size: 3, emitters: 1 })).toEqual([10]);
    expect(deflectorsEmitterPorts({ ...cfg, size: 3, emitters: 3 })).toEqual([9, 10, 11]);
    expect(deflectorsEmitterPorts({ ...cfg, size: 8, emitters: 2 })).toEqual([26, 30]);
  });
});

describe("deflectors pieces", () => {
  it("nothing comes on the clock: placing or binning the next piece draws one from the supply", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createDeflectorsGame(seed);
        const later = advanceDeflectors(s, 600);
        expect(later.queue).toEqual(s.queue);
        expect(later.mirrors).toEqual(s.mirrors);
        const placed = reduceDeflectors(later, { type: "place", cell: 0, tick: 600 });
        expect(placed.mirrors[0]).toBe(s.queue[0]);
        expect(placed.queue.slice(0, -1)).toEqual(s.queue.slice(1));
        expect(placed.queue.length).toBe(cfg.queueSize);
        expect(placed.left).toBe(s.left - 1);
        expect(placed.lastMove!.events).toEqual([{ seq: 1, tick: 600, type: "piece", piece: placed.queue[cfg.queueSize - 1] }]);
        const binned = reduceDeflectors(placed, { type: "bin", tick: 610 });
        expect(binned.mirrors).toEqual(placed.mirrors);
        expect(binned.queue.slice(0, -1)).toEqual(placed.queue.slice(1));
        expect(binned.left).toBe(s.left - 2);
        expect(binned.binned).toBe(1);
        expect(binned.lastMove!.events.at(-1)).toMatchObject({ type: "bin", piece: placed.queue[0] });
      }),
      { numRuns: 30 },
    );
  });

  it("the supply runs out, and the round ends once it has and the grid lights nothing", () => {
    let s = createDeflectorsGame("supply", { ...cfg, pieces: 4, queueSize: 3 });
    expect(s.left).toBe(1);
    s = reduceDeflectors(s, { type: "bin", tick: 1 });
    expect(s.queue.length).toBe(3);
    expect(s.left).toBe(0);
    s = reduceDeflectors(s, { type: "bin", tick: 2 });
    expect(s.queue.length).toBe(2);
    s = reduceDeflectors(s, { type: "bin", tick: 3 });
    // Binning the last piece leaves the grid as it is: the round ends only if it lights nothing.
    s = reduceDeflectors({ ...s, mirrors: s.mirrors.map(() => DEFLECTORS_EMPTY) }, { type: "bin", tick: 4 });
    expect(s.queue).toEqual([]);
    expect(s.finished).toBe(true);
    expect(() => reduceDeflectors({ ...s, finished: false }, { type: "bin", tick: 5 })).toThrow();
  });

  it("pieces are mirrors either way, or lenses about lensChance in a hundred", () => {
    let lenses = 0;
    let all = 0;
    for (let i = 0; i < 40; i++) {
      const s = createDeflectorsGame(`p-${i}`, { ...cfg, queueSize: 8 });
      for (const p of s.queue) {
        all++;
        if (p >= DEFLECTORS_LENS) lenses++;
        expect(p === DEFLECTORS_SLASH || p === DEFLECTORS_BACKSLASH || (p >= DEFLECTORS_LENS && p < DEFLECTORS_LENS + 3)).toBe(true);
      }
    }
    expect(Math.abs(lenses / all - cfg.lensChance / 100)).toBeLessThan(0.08);
  });

  it("the next piece goes on any cell and replaces what is there; a mirror can be turned first", () => {
    const s = { ...grid(["...", "./.", "..."], [[1, 0]]), queue: [DEFLECTORS_SLASH, DEFLECTORS_LENS + 1] };
    const turned = reduceDeflectors(s, { type: "turn", tick: 1 });
    expect(turned.queue).toEqual([DEFLECTORS_BACKSLASH, DEFLECTORS_LENS + 1]);
    expect(reduceDeflectors(turned, { type: "turn", tick: 1 }).queue).toEqual(s.queue);
    const placed = reduceDeflectors(turned, { type: "place", cell: 4, tick: 2 });
    expect(placed.mirrors[4]).toBe(DEFLECTORS_BACKSLASH);
    expect(placed.queue).toEqual([DEFLECTORS_LENS + 1]);
    expect(placed.placed).toBe(1);
    const lens = reduceDeflectors(placed, { type: "place", cell: 0, tick: 2 });
    expect(lens.mirrors[0]).toBe(DEFLECTORS_LENS + 1);
    expect(lens.queue).toEqual([]);
  });

  it("refuses moves that are not legal", () => {
    const s = { ...grid(["...", "./.", "..."], [[1, 0]]), queue: [DEFLECTORS_LENS] };
    expect(() => reduceDeflectors(s, { type: "place", cell: 9, tick: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceDeflectors(s, { type: "place", cell: -1, tick: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceDeflectors(s, { type: "turn", tick: 0 })).toThrow(InvalidMoveError);
    const empty = { ...s, queue: [] };
    expect(() => reduceDeflectors(empty, { type: "place", cell: 0, tick: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceDeflectors(empty, { type: "turn", tick: 0 })).toThrow(InvalidMoveError);
    const fired = reduceDeflectors(s, { type: "fire", tick: 5 });
    expect(() => reduceDeflectors(fired, { type: "fire", tick: 5 + cfg.fireTicks - 1 })).toThrow(InvalidMoveError);
    expect(() => reduceDeflectors(fired, { type: "fire", tick: 5 + cfg.fireTicks })).not.toThrow();
    expect(() => reduceDeflectors(fired, { type: "wait", tick: 4 })).toThrow(InvalidMoveError);
    expect(() => reduceDeflectors(s, { type: "wait", tick: cfg.maxTick + 1 })).toThrow(InvalidMoveError);
  });
});

describe("deflectors shots", () => {
  it("a beam out through a target lights it and scores by its turns", () => {
    const s = grid(["...", "./.", "..."], [[1, 0]]);
    expect(deflectorsOutlook(s)).toMatchObject({ lit: 1, base: 4, litPercent: 100, points: 4 });
    const hit = reduceDeflectors(s, { type: "fire", tick: 5 });
    const e = fires(hit)[0]!;
    expect(e.outcome.shots).toEqual([{ entry: 10, out: 1, bounces: 1, turns: [4], lenses: 0, lensCells: [], target: 0, points: 4 }]);
    expect(e.spent).toEqual([]);
    expect(hit).toMatchObject({ score: 4, shots: 1, lit: 1, bestShot: 4, bestLit: 1, longest: 1, fireTick: 5 + cfg.fireTicks });
    expect(summarizeDeflectors(hit)).toEqual({ score: 4, moves: 1, bestCombo: 1 });
    // A beam that lights nothing scores nothing, and costs nothing.
    const miss = reduceDeflectors(grid(["...", ".\\.", "..."], [[1, 0]]), { type: "fire", tick: 5 });
    expect(fires(miss)[0]!.outcome).toMatchObject({ lit: 0, base: 0, litPercent: 0, points: 0 });
    expect(miss).toMatchObject({ score: 0, shots: 1, lit: 0 });
  });

  it("a target lights only through exactly its recipe, and each lens in it is worth half as much again", () => {
    const rows = ["...", "a/.", "..."];
    expect(deflectorsOutlook(grid(rows, [[1, 0b001]])).points).toBe(6);
    expect(deflectorsBeamPoints(cfg, 1, 0b001)).toBe(6);
    expect(deflectorsBeamPoints(cfg, 3, 0b101)).toBe(32);
    // A lens short, or a lens too many, lights nothing.
    expect(deflectorsOutlook(grid(rows, [[1, 0b011]])).lit).toBe(0);
    expect(deflectorsOutlook(grid(rows, [[1, 0]])).lit).toBe(0);
    expect(deflectorsOutlook(grid(["...", "./.", "..."], [[1, 0b001]])).lit).toBe(0);
  });

  it("a shot is multiplied by how many targets it lights, and lights each once", () => {
    // Emitters at ports 9, 10, 11: the first turns up to port 0, the second down to port 7, the third runs straight to port 5.
    const rows = ["/..", ".\\.", "..."];
    const three = grid(rows, [[0, 0], [5, 0], [7, 0]], { emitters: 3 });
    expect(three.emitters).toEqual([9, 10, 11]);
    const o = deflectorsOutlook(three);
    expect(o.shots.map((s) => s.target)).toEqual([0, 2, 1]);
    expect(o).toMatchObject({ lit: 3, base: 9, litPercent: 400, points: 36 });
    expect(deflectorsLitPercentAt(three.config, 2)).toBe(200);
    expect(deflectorsLitPercentAt(three.config, 0)).toBe(0);
    const two = grid(rows, [[0, 0], [7, 0]], { emitters: 3 });
    expect(deflectorsOutlook(two)).toMatchObject({ lit: 2, base: 8, points: 16 });
    // Two beams out through one target: the first lights it, the second lights nothing.
    const same = grid(["\\..", "...", "..."], [[5, 0]], { emitters: 3 });
    const both = deflectorsResolve(same.config, same.mirrors, [9, 11], same.targets);
    expect(deflectorsTrace(same.config, same.mirrors, 9).out).toBe(6);
    expect(both.shots.map((s) => s.target)).toEqual([-1, 0]);
    const twice = deflectorsResolve(same.config, grid(["...", "...", "..."], []).mirrors, [11, 11], same.targets);
    expect(twice.shots.map((s) => s.target)).toEqual([0, -1]);
    expect(twice.lit).toBe(1);
  });

  it("a shot spends every mirror a beam turned at and every lens a lighting beam passed; lit targets ask again", () => {
    // The middle beam lights port 1 through lens a; the bottom beam turns at a mirror and passes lens b into nothing.
    const s = grid([".....", "a/...", ".....", "b.\\..", "....."], [[1, 0b001], [8, 0]], { emitters: 3, litPercent: [100, 200, 400], spend: true });
    expect(s.emitters).toEqual([15 + 0, 15 + 2, 15 + 4]);
    const hit = reduceDeflectors({ ...s, emitters: [16, 18] }, { type: "fire", tick: 3 });
    const e = fires(hit)[0]!;
    expect(e.outcome.shots.map((x) => x.target)).toEqual([0, -1]);
    expect(e.spent).toEqual([5, 6, 17]);
    expect(hit.mirrors[5]).toBe(DEFLECTORS_EMPTY);
    expect(hit.mirrors[6]).toBe(DEFLECTORS_EMPTY);
    expect(hit.mirrors[17]).toBe(DEFLECTORS_EMPTY);
    expect(hit.mirrors[15]).toBe(DEFLECTORS_LENS + 1);
    expect(hit.spent).toBe(3);
    expect(e.targets).toEqual(hit.targets);
    expect(hit.targets[1]).toEqual(s.targets[1]);
    expect(hit.targets[0]!.port).toBe(1);
    // Spending off, the grid stays as built.
    const kept = reduceDeflectors({ ...s, emitters: [16, 18], config: { ...s.config, spend: false } }, { type: "fire", tick: 3 });
    expect(fires(kept)[0]!.spent).toEqual([]);
    expect(kept.mirrors).toEqual(s.mirrors);
  });

  it("what the board is told a shot would do is what firing does", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        if (state.finished || state.tick < state.fireTick) return;
        const told = deflectorsOutlook(state);
        const fired = reduceDeflectors(state, { type: "fire", tick: state.tick });
        const e = fires(fired)[0]!;
        expect(e.outcome).toEqual(told);
        expect(fired.score).toBe(state.score + told.points);
        const recipes = new Set<number>();
        for (const t of fired.targets as DeflectorsTarget[]) if (told.shots.some((x) => x.target === t.id)) recipes.add(t.id);
        for (const t of fired.targets) if (!recipes.has(t.id)) expect(t).toEqual(state.targets.find((x) => x.id === t.id));
      }),
      { numRuns: 80 },
    );
  });

  it("the round is over at its last tick, and at the move cap", () => {
    const s = createDeflectorsGame("x");
    expect(reduceDeflectors(s, { type: "wait", tick: cfg.maxTick }).finished).toBe(true);
    const capped = createDeflectorsGame("x", { ...cfg, maxMoves: 2 });
    const one = reduceDeflectors(capped, { type: "wait", tick: 1 });
    expect(one.finished).toBe(false);
    expect(reduceDeflectors(one, { type: "wait", tick: 2 }).finished).toBe(true);
  });

  it("the hint puts the next piece where the shot is worth more than it is", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 90));
        if (state.finished) return;
        const h = deflectorsHint(state);
        if (!h) return;
        const before = deflectorsOutlook(state).points;
        let s = state;
        if (h.turn) s = reduceDeflectors(s, { type: "turn", tick: s.tick });
        s = reduceDeflectors(s, { type: "place", cell: h.cell, tick: s.tick });
        expect(deflectorsOutlook(s).points).toBeGreaterThan(before);
      }),
      { numRuns: 60 },
    );
    expect(deflectorsHint({ ...createDeflectorsGame("x"), queue: [] })).toBeNull();
  });

  it("the view string names every cell, every target and the queue", () => {
    const s = { ...grid(["a..", "./.", "..\\"], [[5, 2], [1, 0]]), queue: [DEFLECTORS_SLASH, DEFLECTORS_LENS + 2] };
    expect(deflectorsViewString(s.mirrors, s.targets, s.queue)).toBe("a.../...\\|1~0,5~2|/c");
  });
});
