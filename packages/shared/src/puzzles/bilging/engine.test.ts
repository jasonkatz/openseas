import { describe, expect, it } from 'vitest';
import { replay, type LogEntry } from '../types';
import {
  CELLS,
  COLS,
  CRAB,
  JELLY,
  KINDS,
  PUFFER,
  ROWS,
  SPECIALS_AFTER_MS,
  STEP_MS,
  WATER_PER_POINT,
  applyGravity,
  burstPoints,
  def,
  findRuns,
  idx,
  init,
  reduce,
  runPoints,
  score,
  stepPoints,
  tick,
  waterRatePerMs,
  type Action,
  type Piece,
  type State,
} from './engine';

/** A board with no runs at all: colour = (x + 2y) mod 7. */
function cleanBoard(): Piece[] {
  const b: Piece[] = new Array(CELLS).fill(0);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) b[idx(x, y)] = (x + 2 * y) % KINDS;
  return b;
}

function withBoard(state: State, board: Piece[]): State {
  return { ...state, board };
}

function set(board: Piece[], cells: [number, number, Piece][]): Piece[] {
  const b = board.slice();
  for (const [x, y, p] of cells) b[idx(x, y)] = p;
  return b;
}

/** Column 2 has colour 2 at rows 4,5,7,8 with a 1 at row 6 and a 2 at (3,6): swap(2,6) makes a vertical 5-run. */
function fiveRunBoard(): Piece[] {
  const b = set(cleanBoard(), [[2, 4, 2], [2, 5, 2], [2, 6, 1], [2, 7, 2], [2, 8, 2], [3, 6, 2]]);
  return b;
}
const FIVE_SWAP: Action = { type: 'swap', x: 2, y: 6 };

function swap(x: number, y: number): Action {
  return { type: 'swap', x, y };
}

function randomLog(seed: number, n: number): LogEntry<Action>[] {
  // Simple LCG so tests are deterministic but independent of the engine rng.
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const log: LogEntry<Action>[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += Math.floor(next() * 400);
    log.push({ at: t, a: swap(Math.floor(next() * (COLS - 1)), Math.floor(next() * ROWS)) });
  }
  return log;
}

describe('bilging: init', () => {
  it('is deterministic from seed', () => {
    expect(init(42)).toEqual(init(42));
    expect(init(42).board).not.toEqual(init(43).board);
  });

  it('has COLS*ROWS colour pieces with no pre-existing matches', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = init(seed);
      expect(s.board).toHaveLength(CELLS);
      for (const p of s.board) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(KINDS);
      }
      expect(findRuns(s.board)).toEqual([]);
    }
  });

  it('respects config', () => {
    const s = init(1, { difficulty: 0.9, durationMs: 60_000 });
    expect(s.difficulty).toBe(0.9);
    expect(s.durationMs).toBe(60_000);
    expect(s.water).toBe(0);
    expect(s.points).toBe(0);
    expect(s.over).toBe(false);
    expect(def.id).toBe('bilging');
    expect(def.name).toBe('Bilging');
  });

  it('is JSON serialisable', () => {
    let s = init(7);
    s = reduce(s, swap(0, 0));
    s = tick(s, 1234);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('bilging: illegal actions', () => {
  it('out-of-range swaps are no-ops returning the same reference', () => {
    const s = init(5);
    expect(reduce(s, swap(-1, 0))).toBe(s);
    expect(reduce(s, swap(COLS - 1, 0))).toBe(s); // no right neighbour
    expect(reduce(s, swap(COLS, 0))).toBe(s);
    expect(reduce(s, swap(0, -1))).toBe(s);
    expect(reduce(s, swap(0, ROWS))).toBe(s);
    expect(reduce(s, swap(1.5, 2))).toBe(s);
    expect(reduce(s, { type: 'nope' } as unknown as Action)).toBe(s);
    expect(reduce(s, null as unknown as Action)).toBe(s);
  });

  it('ignores actions once over', () => {
    let s = init(5);
    s = tick(s, s.durationMs);
    expect(s.over).toBe(true);
    expect(reduce(s, swap(0, 0))).toBe(s);
    expect(tick(s, 100)).toBe(s);
  });

  it('free swaps that match nothing are still applied', () => {
    const s0 = withBoard(init(1), cleanBoard());
    const s1 = reduce(s0, swap(2, 3));
    expect(s1).not.toBe(s0);
    expect(s1.board[idx(2, 3)]).toBe(s0.board[idx(3, 3)]);
    expect(s1.board[idx(3, 3)]).toBe(s0.board[idx(2, 3)]);
    expect(s1.points).toBe(0);
    expect(s1.swapSeq).toBe(1);
    expect(s1.clearSeq).toBe(0);
    expect(s1.lastSteps).toEqual([]);
    expect(s1.lastClears).toEqual([]);
    expect(s1.lastSwap).toEqual({ x: 2, y: 3 });
  });
});

describe('bilging: run detection', () => {
  it('finds horizontal and vertical runs', () => {
    const b = set(cleanBoard(), [
      [0, 5, 3], [1, 5, 3], [2, 5, 3],
      [4, 0, 6], [4, 1, 6], [4, 2, 6], [4, 3, 6],
    ]);
    const runs = findRuns(b);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ colour: 3, size: 3, kind: 'run' });
    expect(runs[0]!.cells).toEqual([idx(0, 5), idx(1, 5), idx(2, 5)]);
    expect(runs[1]).toMatchObject({ colour: 6, size: 4, kind: 'run' });
  });

  it('treats crabs as wild', () => {
    const b = set(cleanBoard(), [[0, 5, 3], [1, 5, CRAB], [2, 5, 3]]);
    const runs = findRuns(b);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ colour: 3, size: 3 });
  });

  it('lets a crab bridge two different colours into two runs', () => {
    // R R crab B B  -> two runs of 3 sharing the crab.
    const b = set(cleanBoard(), [[0, 7, 0], [1, 7, 0], [2, 7, CRAB], [3, 7, 3], [4, 7, 3]]);
    const runs = findRuns(b);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.cells).toEqual([idx(0, 7), idx(1, 7), idx(2, 7)]);
    expect(runs[1]!.cells).toEqual([idx(2, 7), idx(3, 7), idx(4, 7)]);
  });

  it('does not match puffers or jellies', () => {
    const b = set(cleanBoard(), [[0, 5, 3], [1, 5, PUFFER], [2, 5, 3], [0, 6, 1], [1, 6, JELLY], [2, 6, 1]]);
    expect(findRuns(b)).toEqual([]);
  });
});

describe('bilging: scoring', () => {
  it('rewards longer runs much more', () => {
    expect(runPoints(3)).toBe(3);
    expect(runPoints(4)).toBe(12);
    expect(runPoints(5)).toBe(27);
    expect(runPoints(6)).toBeGreaterThan(27);
    expect(runPoints(7)).toBeGreaterThan(runPoints(6));
    expect(burstPoints(9)).toBe(9);
    expect(burstPoints(4)).toBe(6);
  });

  it('applies combo and cascade multipliers', () => {
    const run3 = { cells: [0, 1, 2], colour: 0, size: 3, kind: 'run' as const };
    expect(stepPoints([run3], 0)).toBe(3);
    expect(stepPoints([run3, run3], 0)).toBe(9); // 6 * 1.5
    expect(stepPoints([run3], 1)).toBe(6);
    expect(stepPoints([run3, run3, run3], 2)).toBe(54); // 9 * 2 * 3
  });

  it('a swap that makes a 3-run scores 3 and clears the cells', () => {
    // row 4: A A x A -> swap x and the last A.
    const b = set(cleanBoard(), [[0, 4, 5], [1, 4, 5], [2, 4, 1], [3, 4, 5]]);
    const s0 = withBoard(init(3), b);
    const s1 = reduce(s0, swap(2, 4));
    expect(s1.points).toBe(3);
    expect(s1.lastPoints).toBe(3);
    expect(s1.clearSeq).toBe(1);
    expect(s1.lastCombo).toBe(1);
    expect(s1.lastCascades).toBe(1);
    expect(s1.lastClears).toHaveLength(1);
    expect(s1.lastClears[0]!.cells).toEqual([idx(0, 4), idx(1, 4), idx(2, 4)]);
    expect(s1.lastSteps).toHaveLength(1);
    // The step's board snapshot is post-swap, pre-clear.
    expect(s1.lastSteps[0]!.board[idx(2, 4)]).toBe(5);
    expect(s1.lastSteps[0]!.board[idx(3, 4)]).toBe(1);
    // Cells above the cleared cells fell down by one.
    for (let x = 0; x < 3; x++) {
      for (let y = 1; y <= 4; y++) expect(s1.board[idx(x, y)]).toBe(b[idx(x, y - 1)]);
    }
    expect(s1.lastSteps[0]!.falls).toContainEqual({ x: 0, fromY: 3, toY: 4 });
    expect(s1.lastSteps[0]!.falls).toContainEqual({ x: 0, fromY: -1, toY: 0 });
    expect(findRuns(s1.board)).toEqual([]);
  });

  it('a 5-run scores 27', () => {
    const b = fiveRunBoard();
    expect(findRuns(b)).toEqual([]);
    const s1 = reduce(withBoard(init(3), b), FIVE_SWAP);
    expect(s1.lastClears[0]).toMatchObject({ size: 5, colour: 2 });
    expect(s1.lastClears[0]!.cells).toEqual([idx(2, 4), idx(2, 5), idx(2, 6), idx(2, 7), idx(2, 8)]);
    expect(s1.points).toBe(27);
  });

  it('two runs from one swap are a combo', () => {
    // Swap (2,6)<->(3,6): piece at (3,6) moves to (2,6) completing a horizontal run,
    // piece at (2,6) moves to (3,6) completing a vertical run.
    const b = set(cleanBoard(), [
      [0, 6, 0], [1, 6, 0], [2, 6, 4], [3, 6, 0],
      [3, 4, 4], [3, 5, 4],
    ]);
    const s1 = reduce(withBoard(init(3), b), swap(2, 6));
    expect(s1.lastCombo).toBe(2);
    expect(s1.lastCascades).toBe(1);
    expect(s1.points).toBe(9);
  });

  it('cascades multiply by cascade index + 1', () => {
    // Column 2 rows 9,10 are 5 and (3,11) is 5: swap(2,11) makes a vertical 3-run at rows 9..11.
    // (2,8) = 6 then falls three rows to (2,11), where (0,11) and (1,11) are already 6 -> second run.
    let b = cleanBoard();
    b = set(b, [[2, 9, 5], [2, 10, 5], [2, 11, 1], [3, 11, 5], [0, 11, 6], [1, 11, 6], [2, 8, 6]]);
    expect(findRuns(b)).toEqual([]);
    const s1 = reduce(withBoard(init(9), b), swap(2, 11));
    expect(s1.lastSteps[0]!.clears).toHaveLength(1);
    expect(s1.lastSteps[0]!.clears[0]).toMatchObject({ colour: 5, size: 3 });
    expect(s1.lastCascades).toBeGreaterThanOrEqual(2);
    expect(s1.lastSteps[1]!.clears[0]).toMatchObject({ colour: 6, size: 3 });
    expect(s1.lastSteps[1]!.clears[0]!.cells).toEqual([idx(0, 11), idx(1, 11), idx(2, 11)]);
    // 3 (first) + 3*2 (second cascade) = 9, plus anything further cascades from rng refills add.
    expect(s1.points).toBeGreaterThanOrEqual(9);
    expect(s1.lastCombo).toBeGreaterThanOrEqual(2);
    expect(s1.lastClears.length).toBe(s1.lastCombo);
    expect(findRuns(s1.board)).toEqual([]);
  });

  it('a crab completes a run as a wild piece', () => {
    const b = set(cleanBoard(), [[0, 4, 5], [1, 4, 5], [2, 4, 1], [3, 4, CRAB]]);
    const s1 = reduce(withBoard(init(3), b), swap(2, 4));
    expect(s1.points).toBe(3);
    expect(s1.lastClears[0]!.cells).toContain(idx(2, 4));
  });

  it('swapping a puffer clears the 3x3 around its destination', () => {
    const b = set(cleanBoard(), [[2, 5, PUFFER]]);
    const s1 = reduce(withBoard(init(3), b), swap(2, 5)); // puffer moves to (3,5)
    expect(s1.lastClears[0]).toMatchObject({ kind: 'puffer', size: 9 });
    const cells = s1.lastClears[0]!.cells;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(cells).toContain(idx(3 + dx, 5 + dy));
    expect(s1.points).toBeGreaterThanOrEqual(9);
    expect(s1.board).not.toContain(PUFFER);
  });

  it('a puffer at the board edge clears a clipped area', () => {
    const b = set(cleanBoard(), [[1, 0, PUFFER]]);
    const s1 = reduce(withBoard(init(3), b), swap(0, 0)); // puffer moves to (0,0)
    expect(s1.lastClears[0]).toMatchObject({ kind: 'puffer', size: 4 });
  });

  it('swapping a jelly clears every piece of the other colour', () => {
    const b = set(cleanBoard(), [[2, 5, JELLY]]);
    const target = b[idx(3, 5)]!;
    const count = b.filter((p) => p === target).length;
    const s1 = reduce(withBoard(init(3), b), swap(2, 5));
    expect(s1.lastClears[0]).toMatchObject({ kind: 'jelly', colour: target, size: count + 1 });
    expect(s1.lastSteps[0]!.clears[0]!.cells).toContain(idx(3, 5)); // the jelly itself
    expect(s1.points).toBeGreaterThanOrEqual(burstPoints(count + 1));
    expect(s1.board).not.toContain(JELLY);
  });

  it('swapping jelly with jelly only clears the pair', () => {
    const b = set(cleanBoard(), [[2, 5, JELLY], [3, 5, JELLY]]);
    const s1 = reduce(withBoard(init(3), b), swap(2, 5));
    expect(s1.lastClears[0]).toMatchObject({ kind: 'jelly', size: 2 });
    expect(s1.board).not.toContain(JELLY);
  });

  it('scoring lowers the water', () => {
    let s0 = withBoard(init(3), fiveRunBoard());
    s0 = { ...s0, water: 0.5 };
    const s1 = reduce(s0, FIVE_SWAP);
    expect(s1.lastPoints).toBe(27);
    expect(s1.water).toBeCloseTo(0.5 - 27 * WATER_PER_POINT, 9);
    const s2 = reduce({ ...s0, water: 0.01 }, FIVE_SWAP);
    expect(s2.water).toBe(0);
  });
});

describe('bilging: gravity', () => {
  it('drops survivors and fills from the top with falls recorded', () => {
    const b = cleanBoard();
    const mask: boolean[] = new Array(CELLS).fill(false);
    mask[idx(0, 11)] = true;
    mask[idx(0, 9)] = true;
    const g = applyGravity(b, mask, init(1).rng, false);
    expect(g.board[idx(0, 11)]).toBe(b[idx(0, 10)]);
    expect(g.board[idx(0, 10)]).toBe(b[idx(0, 8)]);
    expect(g.falls).toContainEqual({ x: 0, fromY: 10, toY: 11 });
    expect(g.falls).toContainEqual({ x: 0, fromY: 8, toY: 10 });
    expect(g.falls).toContainEqual({ x: 0, fromY: -2, toY: 0 });
    expect(g.falls).toContainEqual({ x: 0, fromY: -1, toY: 1 });
    // Untouched columns are unchanged and produce no falls.
    for (let y = 0; y < ROWS; y++) expect(g.board[idx(1, y)]).toBe(b[idx(1, y)]);
    expect(g.falls.filter((f) => f.x !== 0)).toEqual([]);
  });

  it('keeps the board full and valid after many random swaps', () => {
    let s = init(77);
    const log = randomLog(77, 400);
    for (const e of log) {
      s = tick(s, 150);
      s = reduce(s, e.a);
      expect(s.board).toHaveLength(CELLS);
      for (const p of s.board) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(JELLY);
      }
      expect(findRuns(s.board)).toEqual([]);
      if (s.over) break;
    }
  });
});

describe('bilging: specials', () => {
  it('never spawn before the unlock time', () => {
    for (let seed = 1; seed < 30; seed++) {
      let s = init(seed);
      for (const e of randomLog(seed, 60)) {
        s = reduce(s, e.a);
        for (const p of s.board) expect(p).toBeLessThan(KINDS);
      }
      expect(s.elapsedMs).toBe(0);
    }
  });

  it('spawn after the unlock time', () => {
    let seen = 0;
    for (let seed = 1; seed < 40; seed++) {
      let s = tick(init(seed), SPECIALS_AFTER_MS);
      for (const e of randomLog(seed, 80)) {
        s = reduce(s, e.a);
        if (s.board.some((p) => p >= KINDS)) {
          seen++;
          break;
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe('bilging: water, time & game over', () => {
  it('water rises over time and fills in ~60s at difficulty 0.4 when idle', () => {
    let s = init(1, { difficulty: 0.4, durationMs: 300_000 });
    expect(waterRatePerMs(0.4) * 60_000).toBeCloseTo(1, 9);
    s = tick(s, 30_000);
    expect(s.water).toBeCloseTo(0.5, 6);
    expect(s.over).toBe(false);
    s = tick(s, 30_000);
    expect(s.water).toBe(1);
    expect(s.over).toBe(true);
    expect(s.endReason).toBe('flooded');
    expect(def.isOver(s)).toBe(true);
  });

  it('water rises faster at higher difficulty', () => {
    expect(waterRatePerMs(0.9)).toBeGreaterThan(waterRatePerMs(0.4));
    expect(waterRatePerMs(0.1)).toBeLessThan(waterRatePerMs(0.4));
  });

  it('ends on the time limit', () => {
    let s = init(1, { difficulty: 0, durationMs: 20_000 });
    s = tick(s, 19_999);
    expect(s.over).toBe(false);
    expect(s.elapsedMs).toBe(19_999);
    s = tick(s, 1);
    expect(s.over).toBe(true);
    expect(s.endReason).toBe('time');
    expect(s.elapsedMs).toBe(20_000);
  });

  it('tick is identical whether split or merged', () => {
    const base = reduce(init(11), swap(0, 0));
    const a = tick(base, 5000);
    let b = base;
    for (let i = 0; i < 5; i++) b = tick(b, 1000);
    expect(a).toEqual(b);
    let c = base;
    for (let i = 0; i < 100; i++) c = tick(c, 50);
    expect(a).toEqual(c);
    let d = base;
    for (let i = 0; i < 40; i++) d = tick(d, 125);
    expect(a).toEqual(d);
  });

  it('ignores non-positive ticks', () => {
    const s = init(1);
    expect(tick(s, 0)).toBe(s);
    expect(tick(s, -5)).toBe(s);
  });
});

describe('bilging: performance', () => {
  it('starts at zero', () => {
    const sc = score(init(1));
    expect(sc.points).toBe(0);
    expect(sc.performance).toBe(0);
    expect(typeof sc.label).toBe('string');
  });

  it('rises with sustained scoring and decays when idle', () => {
    const b = fiveRunBoard();
    let s = init(3);
    // Score 27 points once per second for 20 seconds (~27 pts/s >> 8 pts/s).
    for (let i = 0; i < 20; i++) {
      s = withBoard(s, b);
      s = reduce(s, FIVE_SWAP);
      s = tick(s, 1000);
    }
    const busy = score(s).performance;
    expect(busy).toBeGreaterThan(0.85);
    expect(s.points).toBeGreaterThanOrEqual(27 * 20);
    // Idle 20s: performance drops noticeably.
    s = tick(s, 20_000);
    const idle = score(s).performance;
    expect(idle).toBeLessThan(busy * 0.5);
  });

  it('is penalised by a flooding bilge', () => {
    let s = init(3);
    s = { ...s, perfRate: 8 };
    const dry = score(s).performance;
    const wet = score({ ...s, water: 0.9 }).performance;
    expect(dry).toBe(1);
    expect(wet).toBeLessThan(dry);
    expect(wet).toBeCloseTo(0.55, 9);
  });

  it('points scored right before a short tick are not lost', () => {
    let s = withBoard(init(3), fiveRunBoard());
    s = reduce(s, FIVE_SWAP);
    s = tick(s, STEP_MS / 2);
    expect(s.perfRate).toBe(0);
    expect(s.ptsSinceTick).toBe(27);
    s = tick(s, STEP_MS / 2);
    expect(s.perfRate).toBeGreaterThan(0);
    expect(s.ptsSinceTick).toBe(0);
  });
});

describe('bilging: determinism & replay', () => {
  it('same seed + same log => deep-equal state', () => {
    const log = randomLog(123, 300);
    const a = replay(def, 999, { difficulty: 0.5 }, log, 150_000);
    const b = replay(def, 999, { difficulty: 0.5 }, log, 150_000);
    expect(a).toEqual(b);
    expect(a.swapSeq).toBeGreaterThan(0);
    expect(a.over).toBe(true);
  });

  it('different seeds diverge', () => {
    const log = randomLog(5, 50);
    const a = replay(def, 1, undefined, log, 10_000);
    const b = replay(def, 2, undefined, log, 10_000);
    expect(a.board).not.toEqual(b.board);
  });

  it('reduce does not mutate its input', () => {
    const s0 = init(21);
    const snapshot = JSON.stringify(s0);
    reduce(s0, swap(0, 0));
    reduce(s0, swap(3, 11));
    tick(s0, 5000);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});
