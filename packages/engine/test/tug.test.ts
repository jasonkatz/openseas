import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_TUG_CONFIG,
  InvalidMoveError,
  createTugGame,
  hashTugState,
  reduceTug,
  replayTug,
  tugDeliveryPoints,
  tugFlickIllegalReason,
  tugGradeAt,
  tugHint,
  tugLitClamps,
  tugSlide,
  tugSolve,
  tugStateViewString,
  tugStreakPercentAt,
  tugWantPar,
  type TugClamp,
  type TugConfig,
  type TugDir,
  type TugMove,
  type TugState,
} from "../src/index.js";

/** One clamp at a time: the puzzle before pairs, which the rules below were written for. */
const cfg: TugConfig = { ...DEFAULT_TUG_CONFIG, clamps: 1 };
/** Pairs, as content deals them. */
const two: TugConfig = { ...DEFAULT_TUG_CONFIG, clamps: 2 };

function legalFlicks(state: TugState): TugMove[] {
  const out: TugMove[] = [];
  for (let pod = 0; pod < state.pods.length; pod++) {
    for (let dir = 0; dir < 4; dir++) if (tugFlickIllegalReason(state, pod, dir) === null) out.push({ type: "flick", pod, dir: dir as TugDir });
  }
  return out;
}

/** A game played by picks: mostly flicks, now and then a skip. */
function playRandom(seed: string, picks: readonly number[], config: TugConfig = cfg): { moves: TugMove[]; state: TugState } {
  let state = createTugGame(seed, config);
  const moves: TugMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const legal = legalFlicks(state);
    const m: TugMove = p % 11 === 0 || legal.length === 0 ? { type: "skip" } : legal[p % legal.length]!;
    moves.push(m);
    state = reduceTug(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 80 });

/** A bay from rows of characters: `.` empty, `#` a block, a digit a pod. The clamp is set by hand. */
function bay(rows: readonly string[], clamp: { pod: number; col: number; row: number; par: number }, over: Partial<TugConfig> = {}): TugState {
  const width = rows[0]!.length;
  const height = rows.length;
  const pods: number[] = [];
  const blocks: number[] = [];
  rows.join("").split("").forEach((ch, cell) => {
    if (ch === "#") blocks.push(cell);
    else if (ch !== ".") pods[Number(ch)] = cell;
  });
  const config: TugConfig = { ...cfg, width, height, pods: pods.length, blocks: blocks.length, ...over };
  const base = createTugGame("bay", config);
  const lit = (c: { pod: number; col: number; row: number; par: number }): TugClamp => ({ pod: c.pod, cell: c.row * width + c.col, par: c.par, worth: c.par });
  return { ...base, blocks, pods, clamp: lit(clamp), clamp2: null };
}

/** A bay with pairs on and two clamps set by hand, `a` the one lit longer. */
function pair(rows: readonly string[], a: { pod: number; col: number; row: number; par: number }, b: { pod: number; col: number; row: number; par: number }): TugState {
  const s = bay(rows, a, { clamps: 2 });
  const width = rows[0]!.length;
  return { ...s, clamp2: { pod: b.pod, cell: b.row * width + b.col, par: b.par, worth: b.par } };
}

/** The fewest flicks to rest `pod` on `cell`, found the slow and obvious way, up to `depth`: the engine's par must agree. */
function bruteMin(state: TugState, pod: number, cell: number, depth: number): number | null {
  let frontier: TugState[] = [state];
  for (let d = 1; d <= depth; d++) {
    const next: TugState[] = [];
    for (const s of frontier) {
      for (let p = 0; p < s.pods.length; p++) {
        for (let dir = 0; dir < 4; dir++) {
          const { to } = tugSlide(s, p, dir as TugDir);
          if (to === s.pods[p]) continue;
          if (p === pod && to === cell) return d;
          const pods = s.pods.slice();
          pods[p] = to;
          next.push({ ...s, pods });
        }
      }
    }
    frontier = next;
  }
  return null;
}

describe("tug bay", () => {
  it("opens with the configured pods and blocks apart, and a clamp at the starting par", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createTugGame(seed, cfg);
        expect(s.pods.length).toBe(cfg.pods);
        expect(s.blocks.length).toBe(cfg.blocks);
        expect(new Set([...s.pods, ...s.blocks]).size).toBe(cfg.pods + cfg.blocks);
        for (const cell of [...s.pods, ...s.blocks]) {
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(cell).toBeLessThan(cfg.width * cfg.height);
        }
        // Blocks stand off the walls and never touch, not even at a corner.
        for (const a of s.blocks) {
          const col = a % cfg.width;
          const row = Math.floor(a / cfg.width);
          expect(col > 0 && col < cfg.width - 1 && row > 0 && row < cfg.height - 1).toBe(true);
          for (const b of s.blocks) if (a !== b) expect(Math.abs(col - (b % cfg.width)) > 1 || Math.abs(row - Math.floor(b / cfg.width)) > 1).toBe(true);
        }
        expect(s.clamp.par).toBe(cfg.startPar);
        expect(s.pods).not.toContain(s.clamp.cell);
        expect(s.blocks).not.toContain(s.clamp.cell);
        expect(s.score).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createTugGame("x", { ...cfg, pods: 1 })).toThrow();
    expect(() => createTugGame("x", { ...cfg, maxPar: 5 })).toThrow();
    expect(() => createTugGame("x", { ...cfg, startPar: 3, maxPar: 2 })).toThrow();
    expect(() => createTugGame("x", { ...cfg, parPoints: [10, 20] })).toThrow();
    expect(() => createTugGame("x", { ...cfg, streakPercent: [] })).toThrow();
    expect(() => createTugGame("x", { ...cfg, clamps: 0 })).toThrow();
    expect(() => createTugGame("x", { ...cfg, clamps: 3 })).toThrow();
    expect(() => createTugGame("x", { ...cfg, clamps: 1.5 })).toThrow();
  });

  it("places as many blocks as fit when asked for more", () => {
    const s = createTugGame("crowd", { ...cfg, blocks: 16 });
    expect(s.blocks.length).toBeGreaterThan(4);
    expect(s.blocks.length).toBeLessThanOrEqual(9);
  });
});

describe("tug determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayTug(seed, cfg, moves);
        expect(hashTugState(replayed)).toBe(hashTugState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different openings", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashTugState(createTugGame(`seed-${i}`, cfg)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 12));
        if (state.finished) return;
        const before = JSON.stringify(state);
        const legal = legalFlicks(state);
        if (legal.length) reduceTug(state, legal[(picks[0] ?? 0) % legal.length]!);
        reduceTug(state, { type: "skip" });
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceTug(createTugGame("x", cfg), { type: "end" });
    expect(s.finished).toBe(true);
    expect({ score: s.score, moves: s.moveCount, bestCombo: s.bestCombo }).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceTug(s, { type: "end" })).toThrow(InvalidMoveError);
  });
});

describe("tug rules", () => {
  it("a flicked pod slides until a wall, a block or another pod stops it", () => {
    const s = bay(["0....", ".....", "..#..", "1...2", "....."], { pod: 0, col: 4, row: 4, par: 2 });
    expect(tugSlide(s, 0, 1)).toEqual({ to: 4, stop: "wall" });
    expect(tugSlide(s, 0, 2)).toEqual({ to: 10, stop: "pod" });
    expect(tugSlide(s, 2, 3)).toEqual({ to: 16, stop: "pod" });
    // Pod 1 slides up until pod 0 stops it, and pod 2 down a column runs to the wall.
    expect(tugSlide(s, 1, 0)).toEqual({ to: 5, stop: "pod" });
    expect(tugSlide(s, 2, 2)).toEqual({ to: 24, stop: "wall" });
    // A block stops a pod the cell before it.
    const t = bay([".....", "..0..", ".....", "..#..", "....1"], { pod: 0, col: 0, row: 0, par: 2 });
    expect(tugSlide(t, 0, 2)).toEqual({ to: 12, stop: "block" });
    const next = reduceTug(t, { type: "flick", pod: 0, dir: 2 });
    expect(next.pods[0]).toBe(12);
    expect(next.lastMove!.slide).toEqual({ pod: 0, from: 7, to: 12, stop: "block" });
    expect(next.moveCount).toBe(1);
    expect(next.flicks).toBe(1);
  });

  it("refuses a flick that moves nothing, a pod that is not there and a direction that is not one", () => {
    const s = bay(["0....", "1....", ".....", ".....", "....."], { pod: 0, col: 4, row: 4, par: 2 });
    const bad = (m: unknown): void => {
      expect(() => reduceTug(s, m as TugMove)).toThrow(InvalidMoveError);
    };
    bad({ type: "flick", pod: 0, dir: 0 });
    bad({ type: "flick", pod: 0, dir: 3 });
    bad({ type: "flick", pod: 0, dir: 2 });
    bad({ type: "flick", pod: 2, dir: 1 });
    bad({ type: "flick", pod: -1, dir: 1 });
    bad({ type: "flick", pod: 0, dir: 4 });
    bad({ type: "bogus" });
    expect(tugFlickIllegalReason(s, 0, 1)).toBeNull();
  });

  it("sliding over the clamp delivers nothing; coming to rest on it does", () => {
    // Pod 0 flicked right runs over the clamp at (2,0) to the wall.
    const s = bay(["0....", ".....", ".....", ".....", "....1"], { pod: 0, col: 2, row: 0, par: 2 });
    const over = reduceTug(s, { type: "flick", pod: 0, dir: 1 });
    expect(over.pods[0]).toBe(4);
    expect(over.delivered).toBe(0);
    expect(over.lastMove!.delivered).toBeNull();
    expect(over.clamp).toEqual(s.clamp);
    // With pod 1 parked at (3,0), the same flick stops on the clamp.
    const t = bay(["0..1.", ".....", ".....", ".....", "....."], { pod: 0, col: 2, row: 0, par: 1 });
    const done = reduceTug(t, { type: "flick", pod: 0, dir: 1 });
    expect(done.pods[0]).toBe(2);
    expect(done.delivered).toBe(1);
    expect(done.lastMove!.delivered).toMatchObject({ pod: 0, cell: 2, flicks: 1, par: 1, grade: "clean" });
    // Another pod on the clamp is not a delivery.
    const u = bay(["...1.", ".....", "0....", ".....", "....."], { pod: 0, col: 0, row: 0, par: 1 });
    expect(reduceTug(u, { type: "flick", pod: 1, dir: 3 }).delivered).toBe(0);
  });

  it("grades a delivery against par and scores it by par, grade and streak", () => {
    expect(tugGradeAt(cfg, 3, 3)).toBe("clean");
    expect(tugGradeAt(cfg, 3, 3 + cfg.slack)).toBe("full");
    expect(tugGradeAt(cfg, 3, 4 + cfg.slack)).toBe("slow");
    expect(tugDeliveryPoints(cfg, 2, "full", 0)).toBe(cfg.parPoints[1]);
    expect(tugDeliveryPoints(cfg, 2, "slow", 0)).toBe(Math.floor((cfg.parPoints[1]! * cfg.slowPercent) / 100));
    expect(tugDeliveryPoints(cfg, 4, "clean", 1)).toBe((cfg.parPoints[3]! * cfg.cleanPercent) / 100);
    expect(tugDeliveryPoints(cfg, 4, "clean", 3)).toBe(Math.floor((((cfg.parPoints[3]! * cfg.cleanPercent) / 100) * cfg.streakPercent[2]!) / 100));
    expect(tugStreakPercentAt(cfg, 0)).toBe(100);
    expect(tugStreakPercentAt(cfg, 99)).toBe(cfg.streakPercent[cfg.streakPercent.length - 1]);

    // A clean delivery at par one, then the same bay delivered two flicks late, then four late.
    const rows = ["0..1.", ".....", ".....", ".....", "....2"];
    const clamp = { pod: 0, col: 2, row: 0, par: 1 };
    const clean = reduceTug(bay(rows, clamp), { type: "flick", pod: 0, dir: 1 });
    expect(clean.score).toBe(tugDeliveryPoints(cfg, 1, "clean", 1));
    expect(clean.combo).toBe(1);
    expect(clean.level).toBe(1);
    expect(clean.flicks).toBe(0);
    let late = bay(rows, clamp);
    for (const dir of [3, 1] as const) late = reduceTug(late, { type: "flick", pod: 2, dir });
    late = reduceTug(late, { type: "flick", pod: 0, dir: 1 });
    expect(late.lastMove!.delivered).toMatchObject({ flicks: 3, grade: "full", points: cfg.parPoints[0] });
    expect(late.combo).toBe(0);
    expect(late.level).toBe(0);
    let slow = { ...bay(rows, clamp), level: 3 };
    for (const dir of [3, 1, 3, 1] as const) slow = reduceTug(slow, { type: "flick", pod: 2, dir });
    slow = reduceTug(slow, { type: "flick", pod: 0, dir: 1 });
    expect(slow.lastMove!.delivered).toMatchObject({ flicks: 5, grade: "slow", points: Math.floor((cfg.parPoints[0]! * cfg.slowPercent) / 100) });
    expect(slow.level).toBe(2);
  });

  it("a clean streak multiplies clean deliveries, and anything else ends it", () => {
    let s = createTugGame("streak", cfg);
    for (let n = 1; n <= 4; n++) {
      for (const m of tugSolve(s)!) s = reduceTug(s, m);
      const d = s.lastMove!.delivered!;
      expect(d.grade).toBe("clean");
      expect(d.streak).toBe(n);
      expect(d.streakPercent).toBe(tugStreakPercentAt(cfg, n));
      expect(d.points).toBe(tugDeliveryPoints(cfg, d.par, "clean", n));
    }
    expect(s.combo).toBe(4);
    expect(s.clean).toBe(4);
    const skipped = reduceTug(s, { type: "skip" });
    expect(skipped.combo).toBe(0);
    expect(skipped.bestCombo).toBe(4);
  });

  it("clean deliveries raise the par of the clamps to come, up to the cap; slow ones and skips lower it", () => {
    expect(tugWantPar(cfg, 0)).toBe(cfg.startPar);
    expect(tugWantPar(cfg, cfg.cleanPerStep)).toBe(cfg.startPar + 1);
    expect(tugWantPar(cfg, 999)).toBe(cfg.maxPar);
    let s = createTugGame("climb", cfg);
    const pars: number[] = [];
    for (let n = 0; n < 8; n++) {
      pars.push(s.clamp.par);
      for (const m of tugSolve(s)!) s = reduceTug(s, m);
    }
    // Two clamps at each par on the way up, then the cap.
    expect(pars).toEqual([2, 2, 3, 3, 4, 4, 4, 4]);
    expect(s.level).toBe((cfg.maxPar - cfg.startPar) * cfg.cleanPerStep);
    expect(s.bestPar).toBe(4);
    const eased = reduceTug(s, { type: "skip" });
    expect(eased.level).toBe(s.level - 1);
    expect(eased.clamp.par).toBeLessThanOrEqual(cfg.maxPar - 1);
  });

  it("a skip costs the penalty, never more than the score holds, and lights a different clamp", () => {
    const fresh = createTugGame("skip", cfg);
    const free = reduceTug(fresh, { type: "skip" });
    expect(free.score).toBe(0);
    expect(free.lastMove!.skipped).toEqual({ clamp: fresh.clamp, clamp2: null, penalty: 0 });
    expect(free.lastMove!.points).toBe(0);
    expect(free.skipped).toBe(1);
    expect(free.moveCount).toBe(0);
    expect(free.clamp.pod !== fresh.clamp.pod || free.clamp.cell !== fresh.clamp.cell).toBe(true);
    let s = fresh;
    for (const m of tugSolve(s)!) s = reduceTug(s, m);
    const paid = reduceTug(s, { type: "skip" });
    expect(paid.score).toBe(s.score - cfg.skipPenalty);
    expect(paid.lastMove!.points).toBe(-cfg.skipPenalty);
    expect(paid.flicks).toBe(0);
  });

  it("every clamp is dealt at its true par: no shorter way exists, and the solver's way is that long", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createTugGame(seed, cfg);
        for (const p of picks.slice(0, 30)) {
          const lit = state.lastMove === null || state.lastMove.clamp !== null;
          if (lit) {
            // Freshly lit: par is exact from the bay as it stands.
            expect(state.flicks).toBe(0);
            expect(state.clamp.par).toBeGreaterThanOrEqual(1);
            expect(state.clamp.par).toBeLessThanOrEqual(tugWantPar(cfg, state.level));
            expect(state.pods).not.toContain(state.clamp.cell);
            expect(state.blocks).not.toContain(state.clamp.cell);
            if (state.clamp.par <= 3) expect(bruteMin(state, state.clamp.pod, state.clamp.cell, state.clamp.par)).toBe(state.clamp.par);
            const route = tugSolve(state);
            expect(route).not.toBeNull();
            expect(route!.length).toBe(state.clamp.par);
          }
          const legal = legalFlicks(state);
          if (legal.length === 0) break;
          // Lean on the solver so clamps are delivered and deeper pars are dealt.
          const route = p % 3 === 0 ? null : tugSolve(state);
          state = reduceTug(state, route ? route[0]! : legal[p % legal.length]!);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("par four is exact too", () => {
    let checked = 0;
    for (let i = 0; i < 3; i++) {
      let s = createTugGame(`deep-${i}`, cfg);
      for (let n = 0; n < 6; n++) {
        if (s.clamp.par === 4) {
          expect(bruteMin(s, s.clamp.pod, s.clamp.cell, 4)).toBe(4);
          checked++;
        }
        for (const m of tugSolve(s)!) s = reduceTug(s, m);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it("the solver's flicks deliver cleanly, and it says so when the clamp is out of reach", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        let s = createTugGame(seed, cfg);
        const route = tugSolve(s)!;
        for (const m of route) {
          expect(tugFlickIllegalReason(s, m.pod, m.dir)).toBeNull();
          s = reduceTug(s, m);
        }
        expect(s.lastMove!.delivered?.grade).toBe("clean");
        expect(s.lastMove!.clamp).toEqual(s.clamp);
      }),
      { numRuns: 40 },
    );
    // Walled in by pods on a tiny bay, pod 0 cannot reach the far corner in one flick.
    const stuck = bay(["0...", "....", "....", "...1"], { pod: 0, col: 2, row: 2, par: 4 }, { maxPar: 1, startPar: 1 });
    expect(tugSolve(stuck, 1)).toBeNull();
  });

  it("keeps its counts straight through any play, and the score never goes below zero", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createTugGame(seed, cfg);
        for (const p of picks) {
          if (state.finished) break;
          const legal = legalFlicks(state);
          const m: TugMove = p % 9 === 0 || legal.length === 0 ? { type: "skip" } : p % 2 === 0 ? (tugSolve(state)?.[0] ?? legal[p % legal.length]!) : legal[p % legal.length]!;
          const next = reduceTug(state, m);
          const r = next.lastMove!;
          expect(next.score).toBe(state.score + r.points);
          expect(next.score).toBeGreaterThanOrEqual(0);
          expect(next.logLength).toBe(state.logLength + 1);
          expect(next.moveCount).toBe(state.moveCount + (m.type === "flick" ? 1 : 0));
          expect(new Set([...next.pods, ...next.blocks]).size).toBe(next.pods.length + next.blocks.length);
          expect(next.blocks).toEqual(state.blocks);
          expect(next.level).toBeGreaterThanOrEqual(0);
          expect(next.level).toBeLessThanOrEqual((cfg.maxPar - cfg.startPar) * cfg.cleanPerStep);
          if (r.delivered) {
            expect(r.clamp).toEqual(next.clamp);
            expect(next.delivered).toBe(state.delivered + 1);
            expect(next.pods[r.delivered.pod]).toBe(r.delivered.cell);
          } else if (!r.skipped) expect(next.clamp).toEqual(state.clamp);
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  it("stops at the move cap, skips included", () => {
    const config: TugConfig = { ...cfg, maxMoves: 3 };
    let s = createTugGame("cap", config);
    s = reduceTug(s, legalFlicks(s)[0]!);
    s = reduceTug(s, { type: "skip" });
    expect(s.finished).toBe(false);
    s = reduceTug(s, legalFlicks(s)[0]!);
    expect(s.finished).toBe(true);
    expect(() => reduceTug(s, { type: "skip" })).toThrow(InvalidMoveError);
  });

  it("the view string names every cell and the lit clamp", () => {
    const s = bay(["0.#.", "..1.", "....", "...."], { pod: 1, col: 0, row: 2, par: 2 }, { startPar: 1, maxPar: 2 });
    expect(tugStateViewString(s)).toBe("0.#...1.........|8:1");
  });
});

describe("tug pairs determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash with pairs on", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks, two);
        const replayed = replayTug(seed, two, moves);
        expect(hashTugState(replayed)).toBe(hashTugState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("with one clamp a seed deals and plays as it did before there were pairs, hash and all", () => {
    // Hashes taken from the engine before pairs: the opening, forty flicks of par routes, and sixty
    // flicks of a mix of par routes, any flick and skips.
    const golden = [
      { seed: "golden-1", opening: "8af5b240", after40: "fcf5efa8", score: 2794, mixed: "1da59508", mixedScore: 0 },
      { seed: "golden-2", opening: "b2cc1fc2", after40: "5000b0c4", score: 2794, mixed: "1fc6d104", mixedScore: 0 },
      { seed: "golden-3", opening: "5adece10", after40: "581cae01", score: 2794, mixed: "0f6be6d4", mixedScore: 22 },
    ];
    for (const g of golden) {
      let s = createTugGame(g.seed, cfg);
      expect(s.clamp2).toBeNull();
      expect(s.clamp.worth).toBe(s.clamp.par);
      expect(hashTugState(s)).toBe(g.opening);
      for (let i = 0; i < 40; i++) {
        const r = tugSolve(s);
        s = reduceTug(s, r?.[0] ?? { type: "skip" });
      }
      expect(hashTugState(s)).toBe(g.after40);
      expect(s.score).toBe(g.score);
      let m = createTugGame(g.seed, cfg);
      for (let i = 1; i <= 60; i++) {
        const legal = legalFlicks(m);
        const r = i % 3 === 0 ? tugSolve(m) : null;
        m = reduceTug(m, i % 9 === 0 ? { type: "skip" } : (r?.[0] ?? legal[(i * 7) % legal.length]!));
        expect(m.clamp2).toBeNull();
        expect(m.lastMove!.kept).toBeNull();
      }
      expect(hashTugState(m)).toBe(g.mixed);
      expect(m.score).toBe(g.mixedScore);
    }
  });

  it("the second clamp is dealt after the first, so turning pairs on changes only what comes after", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const off = createTugGame(seed, cfg);
        const on = createTugGame(seed, two);
        expect(on.blocks).toEqual(off.blocks);
        expect(on.pods).toEqual(off.pods);
        expect(on.clamp).toEqual(off.clamp);
        expect(on.clamp2).not.toBeNull();
        expect(on.rng).not.toEqual(off.rng);
      }),
      { numRuns: 40 },
    );
  });

  it("both clamps, their pars and their worths are part of the hash", () => {
    const s = createTugGame("pairs-hash", two);
    const h = hashTugState(s);
    const c2 = s.clamp2!;
    expect(hashTugState({ ...s, clamp2: { ...c2, par: c2.par + 1 } })).not.toBe(h);
    expect(hashTugState({ ...s, clamp2: { ...c2, worth: c2.worth + 1 } })).not.toBe(h);
    expect(hashTugState({ ...s, clamp2: { ...c2, pod: (c2.pod + 1) % s.pods.length } })).not.toBe(h);
    expect(hashTugState({ ...s, clamp: { ...s.clamp, worth: s.clamp.worth + 1 } })).not.toBe(h);
    expect(hashTugState({ ...s, clamp2: null })).not.toBe(h);
  });
});

describe("tug pairs", () => {
  // Pod 0 is a flick from its clamp at the right wall. Pod 1 wants the cell under it: a par-two
  // clamp (pod 0 across first, as a stop, then pod 1 up) that the first delivery makes a par one.
  const rows = ["2....", "0....", ".....", ".....", "....1"];
  const a = { pod: 0, col: 4, row: 1, par: 1 };
  const b = { pod: 1, col: 4, row: 2, par: 2 };

  it("opens with two clamps for different pods on different cells, each at its true par", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createTugGame(seed, two);
        const [c1, c2] = tugLitClamps(s) as [TugClamp, TugClamp];
        expect(c2.pod).not.toBe(c1.pod);
        expect(c2.cell).not.toBe(c1.cell);
        for (const c of [c1, c2]) {
          expect(c.par).toBe(two.startPar);
          expect(c.worth).toBe(c.par);
          expect(s.pods).not.toContain(c.cell);
          expect(s.blocks).not.toContain(c.cell);
          expect(bruteMin(s, c.pod, c.cell, c.par)).toBe(c.par);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("a delivery measures the other clamp again from the bay it leaves, and the other keeps its worth: the handoff", () => {
    const s = pair(rows, a, b);
    const first = reduceTug(s, { type: "flick", pod: 0, dir: 1 });
    expect(first.lastMove!.delivered).toMatchObject({ pod: 0, par: 1, worth: 1, grade: "clean", points: tugDeliveryPoints(cfg, 1, "clean", 1) });
    // Pod 0 now stops pod 1 one cell short of the wall: par one, still worth a par two.
    const kept = { pod: 1, cell: 2 * 5 + 4, par: 1, worth: 2 };
    expect(first.lastMove!.kept).toEqual(kept);
    expect(first.clamp).toEqual(kept);
    expect(first.clamp2).toEqual(first.lastMove!.clamp);
    expect(first.flicks).toBe(0);
    const second = reduceTug(first, { type: "flick", pod: 1, dir: 0 });
    // Clean at par one, paid as the par two it lit at, with the streak.
    expect(second.lastMove!.delivered).toMatchObject({ pod: 1, flicks: 1, par: 1, worth: 2, grade: "clean", streak: 2 });
    expect(second.lastMove!.points).toBe(tugDeliveryPoints(cfg, 2, "clean", 2));
    expect(second.score).toBe(tugDeliveryPoints(cfg, 1, "clean", 1) + tugDeliveryPoints(cfg, 2, "clean", 2));
    expect(second.delivered).toBe(2);
    expect(second.combo).toBe(2);
  });

  it("the worth is kept when the delivery pushes the other clamp further away too", () => {
    // Pod 1 is a flick from the top right corner; pod 0 delivered under it blocks the column, so
    // pod 0 has to be moved off again first: par two, still worth a par one.
    const s = pair(rows, a, { pod: 1, col: 4, row: 0, par: 1 });
    const next = reduceTug(s, { type: "flick", pod: 0, dir: 1 });
    expect(next.lastMove!.kept).toEqual({ pod: 1, cell: 4, par: 2, worth: 1 });
    expect(bruteMin(next, 1, 4, 3)).toBe(2);
  });

  it("either clamp delivers; the one left lit becomes the first, and a new one lights as the second", () => {
    // The clamp lit longer is pod 1's; pod 0's is delivered first.
    const s = pair(rows, b, a);
    const next = reduceTug(s, { type: "flick", pod: 0, dir: 1 });
    expect(next.lastMove!.delivered).toMatchObject({ pod: 0, worth: 1 });
    expect(next.clamp).toMatchObject({ pod: 1, par: 1, worth: 2 });
    expect(next.clamp2).toEqual(next.lastMove!.clamp);
    // Another pod coming to rest on a clamp's cell delivers nothing.
    const wrong = reduceTug(pair(["0...2", ".....", ".....", ".....", "....1"], { pod: 0, col: 3, row: 4, par: 2 }, { pod: 1, col: 4, row: 3, par: 2 }), {
      type: "flick",
      pod: 2,
      dir: 2,
    });
    expect(wrong.pods[2]).toBe(3 * 5 + 4);
    expect(wrong.delivered).toBe(0);
    expect(wrong.lastMove!.kept).toBeNull();
  });

  it("the new clamp lights for a pod not already wanted, on another cell, at its true par, and the kept one is measured exactly", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createTugGame(seed, two);
        for (const p of picks.slice(0, 30)) {
          const legal = legalFlicks(state);
          if (legal.length === 0) break;
          const h = p % 3 === 0 ? null : tugHint(state);
          const next = reduceTug(state, h ? h.route[0]! : legal[p % legal.length]!);
          const r = next.lastMove!;
          expect(next.clamp2).not.toBeNull();
          expect(next.clamp2!.pod).not.toBe(next.clamp.pod);
          expect(next.clamp2!.cell).not.toBe(next.clamp.cell);
          if (r.delivered) {
            const other = [state.clamp, state.clamp2!].find((c) => c.pod !== r.delivered!.pod)!;
            // The kept clamp: the same pod and cell and worth, its par measured from this bay.
            expect(r.kept).toEqual(next.clamp);
            expect({ pod: next.clamp.pod, cell: next.clamp.cell, worth: next.clamp.worth }).toEqual({ pod: other.pod, cell: other.cell, worth: other.worth });
            const route = tugSolve(next, two.maxPar + 2, next.clamp);
            expect(next.clamp.par).toBe(route ? route.length : two.maxPar + 2);
            if (next.clamp.par <= 3) expect(bruteMin(next, next.clamp.pod, next.clamp.cell, 3)).toBe(next.clamp.par);
            // The new one: dealt fresh from this bay, worth its par.
            const lit = next.clamp2!;
            expect(r.clamp).toEqual(lit);
            expect(lit.worth).toBe(lit.par);
            expect(lit.par).toBeLessThanOrEqual(tugWantPar(two, next.level));
            if (lit.par <= 3) expect(bruteMin(next, lit.pod, lit.cell, lit.par)).toBe(lit.par);
            expect(next.flicks).toBe(0);
          } else if (!r.skipped) {
            expect(next.clamp).toEqual(state.clamp);
            expect(next.clamp2).toEqual(state.clamp2);
          }
          state = next;
        }
      }),
      { numRuns: 30 },
    );
  });

  it("a skip gives up both clamps for one penalty, and two new ones light, neither the same as either", () => {
    let s = createTugGame("pairs-skip", two);
    const h = tugHint(s)!;
    for (const m of h.route) s = reduceTug(s, m);
    expect(s.score).toBeGreaterThan(two.skipPenalty);
    const skipped = reduceTug(s, { type: "skip" });
    expect(skipped.lastMove!.skipped).toEqual({ clamp: s.clamp, clamp2: s.clamp2, penalty: two.skipPenalty });
    expect(skipped.score).toBe(s.score - two.skipPenalty);
    expect(skipped.lastMove!.clamp).toEqual(skipped.clamp);
    expect(skipped.lastMove!.clamp2).toEqual(skipped.clamp2);
    expect(skipped.combo).toBe(0);
    const gone = [s.clamp, s.clamp2!];
    for (const c of tugLitClamps(skipped)) {
      expect(gone.some((g) => g.pod === c.pod && g.cell === c.cell)).toBe(false);
      expect(c.worth).toBe(c.par);
    }
    expect(skipped.clamp2!.pod).not.toBe(skipped.clamp.pod);
  });

  it("the hint plays the nearer clamp, and says which", () => {
    const s = pair(rows, b, a);
    expect(tugHint(s)).toEqual({ clamp: s.clamp2, route: [{ type: "flick", pod: 0, dir: 1 }] });
    expect(tugSolve(s)!.length).toBe(2);
    expect(tugHint(s, 0)).toBeNull();
  });

  it("the view string names the second clamp too", () => {
    const s = pair(["0.#.", "..1.", "....", "...."], { pod: 1, col: 0, row: 2, par: 2 }, { pod: 0, col: 3, row: 3, par: 2 });
    expect(tugStateViewString(s)).toBe("0.#...1.........|8:1|15:0");
  });
});
