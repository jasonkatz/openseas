import { describe, expect, it } from 'vitest';
import { ratingLabel, replay, type LogEntry } from '../types';
import {
  COLS,
  EMPTY,
  GUST,
  LOCK_MS,
  ROWS,
  SPAWN_COL,
  SPAWN_ROW,
  applyGravity,
  canOccupy,
  cellIndex,
  def,
  fallMsFor,
  findLines,
  landingRow,
  type Action,
  type State,
  type Trio,
} from './engine';

const A = {
  left: { type: 'left' } as Action,
  right: { type: 'right' } as Action,
  cycle: { type: 'cycle' } as Action,
  soft: { type: 'softDrop' } as Action,
  hard: { type: 'hardDrop' } as Action,
};

function emptyGrid(): number[] {
  return new Array<number>(ROWS * COLS).fill(EMPTY);
}

/** Builds a grid from ASCII rows (bottom rows last). '.' = empty, digits = colour. */
function gridFrom(rows: string[]): number[] {
  const g = emptyGrid();
  const offset = ROWS - rows.length;
  rows.forEach((line, i) => {
    for (let c = 0; c < COLS; c++) {
      const ch = line[c] ?? '.';
      if (ch !== '.') g[cellIndex(offset + i, c)] = Number(ch);
    }
  });
  return g;
}

function withGrid(state: State, grid: number[], piece?: { col?: number; row?: number; colors: Trio }): State {
  return {
    ...state,
    grid,
    piece: piece ? { col: piece.col ?? SPAWN_COL, row: piece.row ?? SPAWN_ROW, colors: piece.colors } : state.piece,
  };
}

function colorAt(s: State, row: number, col: number): number {
  return s.grid[cellIndex(row, col)] as number;
}

/** Tiny local LCG for scripting tests (never used by the engine). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Plays a busy, pseudo-random session and returns its action log. */
function scriptedLog(seed: number, totalMs: number): LogEntry<Action>[] {
  const r = lcg(seed);
  const log: LogEntry<Action>[] = [];
  let t = 0;
  while (t < totalMs) {
    t += 40 + Math.floor(r() * 400);
    const v = r();
    const a: Action = v < 0.3 ? A.left : v < 0.6 ? A.right : v < 0.75 ? A.cycle : v < 0.9 ? A.soft : A.hard;
    log.push({ at: t, a });
  }
  return log;
}

describe('sailing: init', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    const a = def.init(123);
    const b = def.init(123);
    const c = def.init(456);
    expect(a).toEqual(b);
    expect(a.next.join() + a.piece?.colors.join()).not.toEqual(c.next.join() + c.piece?.colors.join());
  });

  it('starts with an empty well, a spawned trio and a preview', () => {
    const s = def.init(1);
    expect(s.grid).toHaveLength(ROWS * COLS);
    expect(s.grid.every((v) => v === EMPTY)).toBe(true);
    expect(s.piece).toEqual({ col: SPAWN_COL, row: SPAWN_ROW, colors: expect.any(Array) });
    expect(s.next).toHaveLength(3);
    expect(s.over).toBe(false);
    expect(s.elapsedMs).toBe(0);
    expect(def.score(s)).toEqual({ points: 0, performance: 0, label: 'Booched' });
  });

  it('uses 5 colours at low difficulty and 6 at high', () => {
    expect(def.init(1, { difficulty: 0.2 }).nColors).toBe(5);
    expect(def.init(1, { difficulty: 0.8 }).nColors).toBe(6);
    expect(fallMsFor(0.4, 0)).toBe(700);
    expect(fallMsFor(1, 0)).toBe(400);
    expect(fallMsFor(0.4, 100000)).toBe(500);
    expect(fallMsFor(1, 500000)).toBe(250);
  });

  it('is plain JSON', () => {
    const s = def.init(9);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const log = scriptedLog(3, 20000);
    const end = replay(def, 9, undefined, log, 20000);
    expect(JSON.parse(JSON.stringify(end))).toEqual(end);
  });
});

describe('sailing: determinism', () => {
  it('replay of the same log yields deep-equal state', () => {
    const log = scriptedLog(7, 60000);
    const a = replay(def, 42, { difficulty: 0.6 }, log, 60000);
    const b = replay(def, 42, { difficulty: 0.6 }, log, 60000);
    expect(a).toEqual(b);
    expect(a.lockSeq).toBeGreaterThan(10);
  });

  it('split ticks equal merged ticks (with actions interleaved)', () => {
    const log = scriptedLog(11, 45000);
    const merged = replay(def, 77, undefined, log, 45000);

    // Same log, but every gap is ticked in ragged chunks (1..13 ms).
    const r = lcg(99);
    let s = def.init(77);
    let t = 0;
    for (const e of log) {
      while (t < e.at) {
        const dt = Math.min(e.at - t, 1 + Math.floor(r() * 13));
        s = def.tick(s, dt);
        t += dt;
      }
      s = def.reduce(s, e.a);
    }
    while (t < 45000) {
      const dt = Math.min(45000 - t, 1 + Math.floor(r() * 13));
      s = def.tick(s, dt);
      t += dt;
    }
    expect(s).toEqual(merged);
    expect(s.points).toBeGreaterThan(0);
  });

  it('one huge tick equals many small ticks with no input', () => {
    const big = def.tick(def.init(5), 30000);
    let small = def.init(5);
    for (let i = 0; i < 30; i++) small = def.tick(small, 1000);
    expect(small).toEqual(big);
    expect(big.lockSeq).toBeGreaterThan(3);
    // an unattended well stacks one column and tops out before the 30s are up
    expect(big.toppedOut).toBe(true);
    expect(big.elapsedMs).toBeLessThanOrEqual(30000);
  });

  it('never mutates the input state', () => {
    const s0 = def.init(3);
    const snap = JSON.parse(JSON.stringify(s0));
    def.tick(s0, 5000);
    def.reduce(s0, A.hard);
    def.reduce(s0, A.left);
    def.reduce(s0, A.cycle);
    expect(s0).toEqual(snap);
  });
});

describe('sailing: movement and no-ops', () => {
  it('moves left/right within the well and returns the same reference when blocked', () => {
    let s = def.init(1);
    s = def.reduce(s, A.left);
    s = def.reduce(s, A.left);
    expect(s.piece?.col).toBe(0);
    const blocked = def.reduce(s, A.left);
    expect(blocked).toBe(s);
    for (let i = 0; i < 5; i++) s = def.reduce(s, A.right);
    expect(s.piece?.col).toBe(COLS - 1);
    expect(def.reduce(s, A.right)).toBe(s);
  });

  it('cannot move sideways into a block', () => {
    const base = def.init(1);
    const grid = emptyGrid();
    grid[cellIndex(0, SPAWN_COL + 1)] = 0;
    const s = withGrid(base, grid, { colors: [1, 1, 1] });
    expect(def.reduce(s, A.right)).toBe(s);
    expect(def.reduce(s, A.left).piece?.col).toBe(SPAWN_COL - 1);
  });

  it('unknown actions and actions after game over are no-ops', () => {
    const s = def.init(1);
    expect(def.reduce(s, { type: 'nope' } as unknown as Action)).toBe(s);
    const over = { ...s, over: true };
    expect(def.reduce(over, A.hard)).toBe(over);
    expect(def.tick(over, 1000)).toBe(over);
    expect(def.tick(s, 0)).toBe(s);
  });

  it('cycle rotates colours downward and wraps', () => {
    const s = withGrid(def.init(1), emptyGrid(), { colors: [0, 1, 2] });
    const c1 = def.reduce(s, A.cycle);
    expect(c1.piece?.colors).toEqual([2, 0, 1]);
    const c3 = def.reduce(def.reduce(c1, A.cycle), A.cycle);
    expect(c3.piece?.colors).toEqual([0, 1, 2]);
  });

  it('soft drop moves one row and locks when resting', () => {
    const s = withGrid(def.init(1), emptyGrid(), { colors: [0, 1, 2] });
    const d = def.reduce(s, A.soft);
    expect(d.piece?.row).toBe(SPAWN_ROW + 1);
    expect(d.fallAcc).toBe(0);
    const floor = { ...s, piece: { ...s.piece!, row: ROWS - 3 } };
    const locked = def.reduce(floor, A.soft);
    expect(locked.lockSeq).toBe(1);
    expect(colorAt(locked, ROWS - 1, SPAWN_COL)).toBe(2);
    expect(colorAt(locked, ROWS - 2, SPAWN_COL)).toBe(1);
    expect(colorAt(locked, ROWS - 3, SPAWN_COL)).toBe(0);
  });

  it('hard drop lands on the floor or on a stack, and spawns the preview trio', () => {
    const s = withGrid(def.init(1), emptyGrid(), { colors: [0, 1, 2] });
    expect(landingRow(s.grid, s.piece!)).toBe(ROWS - 3);
    const a = def.reduce(s, A.hard);
    expect(colorAt(a, ROWS - 1, SPAWN_COL)).toBe(2);
    expect(a.piece).toEqual({ col: SPAWN_COL, row: SPAWN_ROW, colors: s.next });
    expect(a.next).not.toBe(s.next);
    expect(a.points).toBe(0);
    expect(a.chain).toBe(0);
    expect(a.lastClears).toEqual([]);

    const b = def.reduce({ ...a, piece: { col: SPAWN_COL, row: SPAWN_ROW, colors: [3, 4, 3] } }, A.hard);
    expect(colorAt(b, ROWS - 4, SPAWN_COL)).toBe(3);
    expect(colorAt(b, ROWS - 6, SPAWN_COL)).toBe(3);
  });
});

describe('sailing: gravity and lock delay', () => {
  it('falls one row every fallMs', () => {
    const s = def.init(1, { difficulty: 0.4 });
    expect(s.fallMs).toBe(700);
    const t1 = def.tick(s, 699);
    expect(t1.piece?.row).toBe(SPAWN_ROW);
    expect(t1.fallAcc).toBe(699);
    const t2 = def.tick(t1, 1);
    expect(t2.piece?.row).toBe(SPAWN_ROW + 1);
    expect(t2.fallAcc).toBe(0);
  });

  it('locks LOCK_MS after coming to rest, unless moved', () => {
    const s = withGrid(def.init(1), emptyGrid(), { row: ROWS - 3, colors: [0, 1, 2] });
    const resting = def.tick(s, LOCK_MS - 1);
    expect(resting.lockSeq).toBe(0);
    expect(resting.lockAcc).toBe(LOCK_MS - 1);
    expect(def.tick(resting, 1).lockSeq).toBe(1);
    const moved = def.reduce(resting, A.left);
    expect(moved.lockAcc).toBe(0);
    expect(def.tick(moved, LOCK_MS - 1).lockSeq).toBe(0);
  });

  it('speeds up with difficulty and over time, never below the minimum', () => {
    const slow = def.tick(def.init(1, { difficulty: 0.2 }), 1);
    const fast = def.tick(def.init(1, { difficulty: 0.9 }), 1);
    expect(fast.fallMs).toBeLessThan(slow.fallMs);
    expect(fallMsFor(0.4, 60000)).toBe(fallMsFor(0.4, 0) - 120);
  });
});

describe('sailing: line detection', () => {
  it('finds horizontal, vertical and both diagonal lines', () => {
    const grid = gridFrom([
      '......',
      '2....3',
      '.2..3.',
      '..23..',
      '.1....',
      '.1....',
      '.1.000',
    ]);
    const lines = findLines(grid);
    const byColor = new Map(lines.map((l) => [l.color, l]));
    expect(lines).toHaveLength(4);
    expect(byColor.get(0)?.cells).toEqual([cellIndex(12, 3), cellIndex(12, 4), cellIndex(12, 5)]);
    expect(byColor.get(1)?.cells).toEqual([cellIndex(10, 1), cellIndex(11, 1), cellIndex(12, 1)]);
    expect(byColor.get(2)?.cells).toEqual([cellIndex(7, 0), cellIndex(8, 1), cellIndex(9, 2)]);
    expect(byColor.get(3)?.cells).toEqual([cellIndex(7, 5), cellIndex(8, 4), cellIndex(9, 3)]);
  });

  it('ignores runs of two and reports long runs once', () => {
    expect(findLines(gridFrom(['00.11.', '.2.2..']))).toEqual([]);
    const five = findLines(gridFrom(['44444.']));
    expect(five).toHaveLength(1);
    expect(five[0]?.size).toBe(5);
  });

  it('applyGravity drops floating blocks', () => {
    const g = applyGravity(gridFrom(['1.....', '......', '2.....']));
    expect(g[cellIndex(ROWS - 1, 0)]).toBe(2);
    expect(g[cellIndex(ROWS - 2, 0)]).toBe(1);
    expect(g[cellIndex(ROWS - 3, 0)]).toBe(EMPTY);
  });
});

describe('sailing: clearing and scoring', () => {
  it('scores 5 for a line of three and clears the cells', () => {
    const s = withGrid(def.init(1), gridFrom(['00....']), { colors: [1, 2, 0] });
    const r = def.reduce(s, A.hard);
    expect(r.points).toBe(5);
    expect(r.chain).toBe(1);
    expect(r.clearSeq).toBe(1);
    expect(r.lastClears).toHaveLength(1);
    expect(r.lastClears[0]).toMatchObject({ color: 0, size: 3, step: 1, gust: false });
    expect(colorAt(r, ROWS - 1, 0)).toBe(EMPTY);
    // the rest of the trio fell onto the floor
    expect(colorAt(r, ROWS - 1, SPAWN_COL)).toBe(2);
    expect(colorAt(r, ROWS - 2, SPAWN_COL)).toBe(1);
  });

  it('scores 12 for four and 25 for five', () => {
    const four = def.reduce(withGrid(def.init(1), gridFrom(['00.0..']), { colors: [1, 2, 0] }), A.hard);
    expect(four.points).toBe(12);
    const five = def.reduce(withGrid(def.init(1), gridFrom(['00.00.']), { colors: [1, 2, 0] }), A.hard);
    expect(five.points).toBe(25);
  });

  it('two simultaneous lines score ×1.5', () => {
    // Trio [4,1,0] in column 2 lands with its bottom 0 at (12,2), completing a horizontal
    // five (25), while its middle 1 at (11,2) completes the diagonal (9,0),(10,1),(11,2) (5).
    const grid = gridFrom([
      '1.....', // row 9
      '.1....', // row 10
      '......', // row 11
      '00.00.', // row 12
    ]);
    const s = withGrid(def.init(1), grid, { colors: [4, 1, 0] });
    const r = def.reduce(s, A.hard);
    const first = r.lastClears.filter((c) => c.step === 1);
    expect(first.map((l) => l.size).sort()).toEqual([3, 5]);
    expect(r.chain).toBe(1);
    expect(r.points).toBe(Math.round((25 + 5) * 1.5)); // 45
    expect(colorAt(r, ROWS - 1, 2)).toBe(4);
  });

  it('cascades: a clear that drops blocks into a new line counts as chain 2', () => {
    // Trio [4,5,0] in column 5: bottom 0 completes 000 on the floor (cols 3..5, chain 1 = 5 pts).
    // The 2s above cols 3,4 then fall beside the 2 at (12,2) -> 222 (chain 2 = 5 × 2 = 10).
    const grid = gridFrom([
      '...22.', // row 11
      '..200.', // row 12
    ]);
    const s = withGrid(def.init(1), grid, { col: 5, colors: [4, 5, 0] });
    const r = def.reduce(s, A.hard);
    expect(r.chain).toBe(2);
    expect(r.points).toBe(5 + 10);
    expect(r.lastClears.map((c) => c.step)).toEqual([1, 2]);
    expect(r.lastClears[1]).toMatchObject({ color: 2, size: 3, step: 2, gust: false });
    expect(r.grid.filter((v) => v !== EMPTY)).toEqual([4, 5]);
    expect(colorAt(r, ROWS - 1, 5)).toBe(5);
    expect(colorAt(r, ROWS - 2, 5)).toBe(4);
  });

  it('chain resets per lock and clearSeq only bumps on clears', () => {
    const s = withGrid(def.init(1), gridFrom(['00....']), { colors: [1, 2, 0] });
    const cleared = def.reduce(s, A.hard);
    expect(cleared.clearSeq).toBe(1);
    const plain = def.reduce({ ...cleared, piece: { col: 5, row: SPAWN_ROW, colors: [3, 4, 3] } }, A.hard);
    expect(plain.clearSeq).toBe(1);
    expect(plain.lockSeq).toBe(2);
    expect(plain.chain).toBe(0);
    expect(plain.lastClears).toEqual([]);
  });
});

describe('sailing: wind gust', () => {
  it('clears every block of the colour beneath it and itself', () => {
    const grid = gridFrom([
      '.3....', // row 10
      '.1..3.', // row 11
      '0030.1', // row 12
    ]);
    const s = withGrid(def.init(1), grid, { colors: [2, 4, GUST] });
    const r = def.reduce(s, A.hard);
    // gust lands at (11,2) over the 3 at (12,2): all 3s vanish, gust vanishes, 2 and 4 settle in column 2.
    expect(r.grid.filter((v) => v === 3)).toHaveLength(0);
    expect(r.grid.filter((v) => v === GUST)).toHaveLength(0);
    expect(r.lastClears[0]).toMatchObject({ color: 3, size: 3, step: 0, gust: true });
    expect(r.points).toBe(3);
    expect(colorAt(r, ROWS - 1, 2)).toBe(4);
    expect(colorAt(r, ROWS - 2, 2)).toBe(2);
    // the 1 at (11,1) was sitting on a 3? no — on a 0; still there
    expect(colorAt(r, ROWS - 2, 1)).toBe(1);
    expect(colorAt(r, ROWS - 1, 0)).toBe(0);
  });

  it('just clears itself when it lands on the floor', () => {
    const s = withGrid(def.init(1), gridFrom(['00....']), { colors: [1, 2, GUST] });
    const r = def.reduce(s, A.hard);
    expect(r.points).toBe(0);
    expect(r.lastClears).toEqual([{ cells: [cellIndex(ROWS - 1, SPAWN_COL)], color: GUST, size: 0, step: 0, gust: true }]);
    expect(colorAt(r, ROWS - 1, SPAWN_COL)).toBe(2);
    expect(colorAt(r, ROWS - 2, SPAWN_COL)).toBe(1);
    expect(colorAt(r, ROWS - 1, 0)).toBe(0);
  });

  it('a gust in the middle clears the colour of the trio block beneath it', () => {
    const s = withGrid(def.init(1), gridFrom(['2....2']), { colors: [1, GUST, 2] });
    const r = def.reduce(s, A.hard);
    expect(r.grid.filter((v) => v === 2)).toHaveLength(0);
    expect(colorAt(r, ROWS - 1, SPAWN_COL)).toBe(1);
    expect(r.points).toBe(3);
  });

  it('gust clears drop the blocks that were resting above the cleared colour', () => {
    const grid = gridFrom([
      '0.....', // row 10
      '3.....', // row 11
      '00.3..', // row 12
    ]);
    const s = withGrid(def.init(1), grid, { col: 3, colors: [4, 5, GUST] });
    const r = def.reduce(s, A.hard);
    // gust at (11,3) over the 3 at (12,3): both 3s vanish; column 0 compacts to 0 over 0; 4,5 settle in column 3.
    expect(r.grid.filter((v) => v === 3)).toHaveLength(0);
    expect(colorAt(r, ROWS - 1, 0)).toBe(0);
    expect(colorAt(r, ROWS - 2, 0)).toBe(0);
    expect(colorAt(r, ROWS - 1, 3)).toBe(5);
    expect(colorAt(r, ROWS - 2, 3)).toBe(4);
    expect(r.points).toBe(2);
    expect(r.chain).toBe(0);
    expect(r.clearSeq).toBe(1);
  });
});

describe('sailing: game over', () => {
  it('tops out when the spawn column reaches row 0', () => {
    // Fill column 2 from row 3 to the floor; the trio rests at rows 0..2 and the next spawn is blocked.
    const grid = emptyGrid();
    for (let r = 3; r < ROWS; r++) grid[cellIndex(r, SPAWN_COL)] = (r % 2) as number; // alternating, no lines
    const s = withGrid(def.init(1), grid, { colors: [2, 3, 2] });
    expect(canOccupy(s.grid, SPAWN_COL, SPAWN_ROW)).toBe(true);
    const r = def.reduce(s, A.hard);
    expect(r.over).toBe(true);
    expect(r.toppedOut).toBe(true);
    expect(r.piece).toBeNull();
    expect(colorAt(r, 0, SPAWN_COL)).toBe(2);
    expect(def.isOver(r)).toBe(true);
    expect(def.reduce(r, A.left)).toBe(r);
  });

  it('tops out when a trio locks partly above the well', () => {
    const grid = emptyGrid();
    for (let r = 1; r < ROWS; r++) grid[cellIndex(r, SPAWN_COL)] = (r % 2) as number;
    const s = withGrid(def.init(1), grid, { colors: [2, 3, 2] });
    const r = def.reduce(s, A.hard);
    expect(r.over).toBe(true);
    expect(r.toppedOut).toBe(true);
    expect(colorAt(r, 0, SPAWN_COL)).toBe(2);
  });

  it('a stack in another column does not end the game', () => {
    const grid = emptyGrid();
    for (let r = 0; r < ROWS; r++) grid[cellIndex(r, 5)] = (r % 2) as number;
    const s = withGrid(def.init(1), grid, { colors: [2, 3, 2] });
    const r = def.reduce(s, A.hard);
    expect(r.over).toBe(false);
  });

  it('ends at the duration limit', () => {
    const s = def.init(1, { durationMs: 5000 });
    const mid = def.tick(s, 4999);
    expect(mid.over).toBe(false);
    const end = def.tick(mid, 1);
    expect(end.over).toBe(true);
    expect(end.elapsedMs).toBe(5000);
    expect(end.toppedOut).toBe(false);
    expect(def.tick(end, 1000)).toBe(end);
    const direct = def.tick(s, 9000);
    expect(direct.elapsedMs).toBe(5000);
    expect(direct.over).toBe(true);
  });

  it('eventually tops out when the player never acts (default duration)', () => {
    const s = def.tick(def.init(2, { difficulty: 1 }), 150000);
    expect(s.over).toBe(true);
    // with no input, 13 rows of stacking in one column tops out long before 150s
    expect(s.toppedOut).toBe(true);
    expect(s.elapsedMs).toBeLessThan(150000);
  });
});

describe('sailing: performance', () => {
  it('rises with clears and decays while idle', () => {
    const s = withGrid(def.init(1, { durationMs: 400000 }), gridFrom(['00.00.']), { colors: [1, 2, 0] });
    const cleared = def.reduce(s, A.hard);
    expect(cleared.points).toBe(25);
    const sampled = def.tick(cleared, 100);
    expect(sampled.performance).toBeGreaterThan(0);
    expect(sampled.sailPower).toBe(sampled.performance);
    expect(def.score(sampled).performance).toBe(sampled.performance);
    expect(def.score(sampled).label).toBe(ratingLabel(sampled.performance));
    // Idle for 20s: re-seat a harmless trio at the top each second so nothing ever locks or clears.
    let idle = sampled;
    for (let i = 0; i < 20; i++) {
      idle = def.tick({ ...idle, grid: emptyGrid(), piece: { col: SPAWN_COL, row: SPAWN_ROW, colors: [0, 1, 2] } }, 1000);
    }
    expect(idle.points).toBe(25);
    expect(idle.performance).toBeLessThan(sampled.performance * 0.4);
    expect(idle.performance).toBeGreaterThan(0);
  });

  it('saturates at 1 for sustained ~6 pts/s and never exceeds 1', () => {
    let s = def.init(1, { durationMs: 400000 });
    for (let i = 0; i < 300; i++) {
      s = { ...s, windowPts: s.windowPts + 6 };
      s = def.tick({ ...s, grid: emptyGrid(), piece: { col: SPAWN_COL, row: SPAWN_ROW, colors: [0, 1, 2] } }, 1000);
    }
    expect(s.performance).toBeGreaterThan(0.9);
    expect(s.performance).toBeLessThanOrEqual(1);
    expect(def.score(s).label).toMatch(/Incredible|Excellent/);
  });
});
