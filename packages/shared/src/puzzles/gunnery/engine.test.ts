import { describe, expect, it } from 'vitest';
import {
  def, init, reduce, tick, score, isPrimedRow, clearPoints, pieceCells, ghostY, gravityMs, stackHeight,
  COLS, ROWS, SHAPES, STEP_MS, LOCK_DELAY_MS, MAX_LOCK_RESETS, GARBAGE_INTERVAL_MS, MAX_CANNONS, KIND_COLOR,
  type State, type Action, type Piece, type Cell, type Shape,
} from './engine';
import { replay, type LogEntry } from '../types';

// ---------------------------------------------------------------------------
// helpers

const CH: Record<string, Cell> = { P: 'powder', W: 'wad', S: 'shot', D: 'damp', '.': null };

/** Replaces the bottom rows of the grid from strings (last string = bottom row). */
function withRows(s: State, rows: string[]): State {
  const grid = s.grid.map((r) => r.slice());
  for (let i = 0; i < rows.length; i++) {
    const str = rows[i]!;
    const r = ROWS - rows.length + i;
    for (let c = 0; c < COLS; c++) grid[r]![c] = CH[str[c] ?? '.'] ?? null;
  }
  return { ...s, grid };
}

function withActive(s: State, p: Partial<Piece>): State {
  const base: Piece = { shape: 'T', kind: 'powder', rot: 0, x: 2, y: 0, ...(s.active ?? {}), ...p };
  return { ...s, active: base };
}

function row(s: State, r: number): string {
  return s.grid[r]!.map((c) => (c === null ? '.' : c === 'damp' ? 'D' : c[0]!.toUpperCase())).join('');
}

function act(s: State, ...types: Action['type'][]): State {
  let st = s;
  for (const t of types) st = reduce(st, { type: t } as Action);
  return st;
}

function cellSet(p: Piece): string {
  return pieceCells(p).map((c) => `${c.x},${c.y}`).sort().join(' ');
}

const quiet = { difficulty: 0.2, durationMs: 150000 }; // no garbage

// ---------------------------------------------------------------------------

describe('gunnery: init & 7-bag', () => {
  it('registers the def', () => {
    expect(def.id).toBe('gunnery');
    expect(def.name).toBe('Gunnery');
    expect(def.blurb.length).toBeGreaterThan(10);
  });

  it('starts with an active piece, 3 next, empty hold, empty grid', () => {
    const s = init(1);
    expect(s.active).not.toBeNull();
    expect(s.next).toHaveLength(3);
    expect(s.hold).toBeNull();
    expect(s.grid).toHaveLength(ROWS);
    expect(s.grid.every((r) => r.length === COLS && r.every((c) => c === null))).toBe(true);
    expect(s.over).toBe(false);
    expect(s.points).toBe(0);
    expect(s.elapsedMs).toBe(0);
  });

  it('is deterministic for the same seed and differs across seeds', () => {
    expect(init(42)).toEqual(init(42));
    const a = init(42), b = init(43);
    const sa = [a.active!.shape, ...a.next.map((n) => n.shape)].join('');
    const sb = [b.active!.shape, ...b.next.map((n) => n.shape)].join('');
    const ka = [a.active!.kind, ...a.next.map((n) => n.kind)].join('');
    const kb = [b.active!.kind, ...b.next.map((n) => n.kind)].join('');
    expect(sa + ka).not.toBe(sb + kb);
  });

  it('draws from a 7-bag: active + next + remaining bag cover every shape once', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const s = init(seed);
      const all = [s.active!.shape, ...s.next.map((n) => n.shape), ...s.bag];
      expect(all).toHaveLength(7);
      expect(new Set(all).size).toBe(7);
      expect([...all].sort()).toEqual([...SHAPES].sort());
    }
  });

  it('refills the bag after 7 draws and never repeats a shape within a bag', () => {
    let s = init(7, quiet);
    const empty = s.grid;
    const seq: Shape[] = [s.active!.shape, ...s.next.map((n) => n.shape)];
    // Each hard drop spawns one more piece and appends one to `next`.
    for (let i = 0; i < 10; i++) {
      s = act({ ...s, grid: empty }, 'hardDrop');
      expect(s.over).toBe(false);
      seq.push(s.next[s.next.length - 1]!.shape);
    }
    expect(seq.length).toBe(14);
    expect(new Set(seq.slice(0, 7)).size).toBe(7);
    expect(new Set(seq.slice(7, 14)).size).toBe(7);
  });

  it('all cells of a piece share one kind and kinds map to colours', () => {
    const s = init(5);
    for (const spec of [s.active!, ...s.next]) expect(['powder', 'wad', 'shot']).toContain(spec.kind);
    expect(KIND_COLOR.powder).toBe(1);
    expect(KIND_COLOR.wad).toBe(7);
    expect(KIND_COLOR.shot).toBe(3);
  });

  it('uses the kind pool so all three kinds appear over many spawns', () => {
    let s = init(3, quiet);
    const empty = s.grid;
    const kinds = new Set<string>();
    for (let i = 0; i < 24; i++) {
      kinds.add(s.active!.kind);
      s = act({ ...s, grid: empty }, 'hardDrop');
    }
    expect(kinds.size).toBe(3);
  });
});

describe('gunnery: movement, rotation, kicks', () => {
  it('moves left and right until the wall, then is a no-op (same reference)', () => {
    let s = init(1, quiet);
    s = withActive(s, { shape: 'O', rot: 0, x: 3, y: 0 });
    for (let i = 0; i < 3; i++) s = act(s, 'left');
    expect(s.active!.x).toBe(0);
    const blocked = reduce(s, { type: 'left' });
    expect(blocked).toBe(s);
    for (let i = 0; i < 6; i++) s = act(s, 'right');
    expect(s.active!.x).toBe(COLS - 2);
    expect(reduce(s, { type: 'right' })).toBe(s);
  });

  it('rotates CW and CCW through all four states', () => {
    let s = withActive(init(1, quiet), { shape: 'T', rot: 0, x: 2, y: 3 });
    const r0 = cellSet(s.active!);
    expect(r0).toBe('2,4 3,3 3,4 4,4');
    s = act(s, 'rotateCW');
    expect(s.active!.rot).toBe(1);
    expect(cellSet(s.active!)).toBe('3,3 3,4 3,5 4,4');
    s = act(s, 'rotateCW', 'rotateCW', 'rotateCW');
    expect(s.active!.rot).toBe(0);
    expect(cellSet(s.active!)).toBe(r0);
    s = act(s, 'rotateCCW');
    expect(s.active!.rot).toBe(3);
    expect(cellSet(s.active!)).toBe('2,4 3,3 3,4 3,5');
  });

  it('wall-kicks a vertical I at the right wall when rotating to horizontal', () => {
    // I rot 1 occupies column x+2; x=5 -> column 7 (right wall).
    let s = withActive(init(1, quiet), { shape: 'I', rot: 1, x: 5, y: 3 });
    expect(cellSet(s.active!)).toBe('7,3 7,4 7,5 7,6');
    s = act(s, 'rotateCW');
    expect(s.active!.rot).toBe(2);
    expect(s.active!.x).toBe(4); // kicked left by one
    for (const c of pieceCells(s.active!)) expect(c.x).toBeLessThan(COLS);
  });

  it('wall-kicks a vertical I at the left wall (needs +2)', () => {
    // I rot 3 occupies column x+1; x=-1 -> column 0.
    let s = withActive(init(1, quiet), { shape: 'I', rot: 3, x: -1, y: 3 });
    expect(cellSet(s.active!)).toBe('0,3 0,4 0,5 0,6');
    s = act(s, 'rotateCW');
    expect(s.active!.rot).toBe(0);
    expect(s.active!.x).toBe(0);
    for (const c of pieceCells(s.active!)) expect(c.x).toBeGreaterThanOrEqual(0);
  });

  it('rotation is a no-op (same reference) when no kick fits', () => {
    let s = init(1, quiet);
    // Walls of powder in columns 0..1 and 4..7 from row 2 downwards; T sits in cols 2-3.
    const rows: string[] = [];
    for (let i = 0; i < ROWS - 2; i++) rows.push('PP..PPPP');
    s = withRows(s, rows);
    s = withActive(s, { shape: 'O', rot: 0, x: 2, y: 5 });
    // O rotates to itself; use I vertical instead: rot1 at x=0 -> col 2; horizontal needs 4 wide.
    s = withActive(s, { shape: 'I', rot: 1, x: 0, y: 5 });
    expect(reduce(s, { type: 'rotateCW' })).toBe(s);
    expect(reduce(s, { type: 'rotateCCW' })).toBe(s);
  });

  it('soft drop moves down one row; is a no-op when grounded', () => {
    let s = withActive(init(1, quiet), { shape: 'O', rot: 0, x: 3, y: 0 });
    s = act(s, 'softDrop');
    expect(s.active!.y).toBe(1);
    const g = ghostY(s);
    s = withActive(s, { y: g });
    expect(reduce(s, { type: 'softDrop' })).toBe(s);
  });

  it('ghostY finds the resting row', () => {
    let s = withActive(init(1, quiet), { shape: 'O', rot: 0, x: 3, y: 0 });
    expect(ghostY(s)).toBe(ROWS - 2);
    s = withRows(s, ['...PP...']);
    expect(ghostY(s)).toBe(ROWS - 3);
  });
});

describe('gunnery: gravity and lock delay', () => {
  it('falls one row per gravity interval (800ms at difficulty 0.4)', () => {
    expect(gravityMs(0.4, 0, 150000)).toBe(800);
    let s = withActive(init(1, { difficulty: 0.4 }), { shape: 'O', rot: 0, x: 3, y: 0 });
    s = tick(s, 750);
    expect(s.active!.y).toBe(0);
    s = tick(s, 50);
    expect(s.active!.y).toBe(1);
    s = tick(s, 1600);
    expect(s.active!.y).toBe(3);
  });

  it('speeds up with difficulty and time, floored at 200ms', () => {
    expect(gravityMs(1, 0, 150000)).toBeLessThan(gravityMs(0.4, 0, 150000));
    expect(gravityMs(0.4, 150000, 150000)).toBeLessThan(gravityMs(0.4, 0, 150000));
    expect(gravityMs(1, 150000, 150000)).toBe(200);
  });

  it('locks after the lock delay once grounded', () => {
    let s = withActive(init(1, quiet), { shape: 'O', kind: 'powder', rot: 0, x: 3, y: ROWS - 2 });
    const seq = s.lockSeq;
    s = tick(s, LOCK_DELAY_MS - STEP_MS);
    expect(s.lockSeq).toBe(seq);
    expect(s.active!.shape).toBe('O');
    s = tick(s, STEP_MS);
    expect(s.lockSeq).toBe(seq + 1);
    expect(row(s, ROWS - 1)).toBe('...PP...');
    expect(row(s, ROWS - 2)).toBe('...PP...');
    expect(s.active).not.toBeNull();
    expect(s.active!.y).toBe(0);
  });

  it('resets the lock delay on a successful move, at most MAX_LOCK_RESETS times', () => {
    let s = withActive(init(1, quiet), { shape: 'O', rot: 0, x: 3, y: ROWS - 2 });
    s = tick(s, 200);
    expect(s.lockMs).toBe(200);
    s = act(s, 'left');
    expect(s.lockMs).toBe(0);
    expect(s.lockResets).toBe(1);
    // Wiggle to exhaust resets.
    for (let i = 1; i < MAX_LOCK_RESETS; i++) {
      s = tick(s, 100);
      s = act(s, i % 2 ? 'right' : 'left');
      expect(s.lockMs).toBe(0);
    }
    expect(s.lockResets).toBe(MAX_LOCK_RESETS);
    s = tick(s, 100);
    s = act(s, 'left');
    expect(s.lockMs).toBe(100); // no reset left
    s = tick(s, LOCK_DELAY_MS);
    expect(s.lockSeq).toBe(1);
  });

  it('a move in mid-air does not consume a lock reset', () => {
    let s = withActive(init(1, quiet), { shape: 'O', rot: 0, x: 3, y: 0 });
    s = act(s, 'left', 'right', 'rotateCW');
    expect(s.lockResets).toBe(0);
  });
});

describe('gunnery: line clears & scoring', () => {
  function dropIIntoGap(s: State, kind: 'powder' | 'wad' | 'shot' = 'powder'): State {
    // vertical I at column 7
    return act(withActive(s, { shape: 'I', kind, rot: 1, x: 5, y: 0 }), 'hardDrop');
  }

  it('scores 10 / 25 / 45 / 80 for 1..4 unprimed rows', () => {
    const base = init(1, quiet);
    const expectPts = [0, 10, 25, 45, 80];
    for (let n = 1; n <= 4; n++) {
      const rows: string[] = [];
      for (let i = 0; i < n; i++) rows.push('PPPPPPP.');
      let s = withRows(base, rows);
      s = dropIIntoGap(s);
      expect(s.points).toBe(expectPts[n]);
      expect(s.lastClears).toBe(n);
      expect(s.cannonsLoaded).toBe(n);
      expect(s.clearSeq).toBe(1);
      expect(s.lastPrimed).toBe(false);
      expect(s.lastClearRows).toEqual(Array.from({ length: n }, (_, i) => ROWS - n + i));
      // cleared rows are gone; only the I's leftover cells (4 - n) remain, in column 7
      const left = s.grid.flatMap((r, y) => r.map((c, x) => (c === null ? null : `${x},${y}`)).filter((v) => v !== null));
      expect(left).toHaveLength(4 - n);
      expect(left.every((v) => v!.startsWith('7,'))).toBe(true);
    }
    expect(clearPoints(0, true)).toBe(0);
  });

  it('applies x1.5 when every cleared row is primed', () => {
    const base = init(1, quiet);
    let s = withRows(base, ['PWSPWSP.', 'PWSPWSP.', 'PWSPWSP.', 'PWSPWSP.']);
    s = dropIIntoGap(s);
    expect(s.points).toBe(120);
    expect(s.lastPrimed).toBe(true);
    expect(s.primedRows).toBe(4);
    expect(s.totalRows).toBe(4);
    expect(clearPoints(1, true)).toBe(15);
    expect(clearPoints(2, true)).toBe(38);
    expect(clearPoints(3, true)).toBe(68);
    expect(clearPoints(4, true)).toBe(120);
  });

  it('does not apply the primed bonus if any cleared row is unprimed', () => {
    let s = withRows(init(1, quiet), ['PWSPWSP.', 'PPPPPPP.', 'PWSPWSP.']);
    s = dropIIntoGap(s);
    expect(s.points).toBe(45);
    expect(s.lastPrimed).toBe(false);
    expect(s.primedRows).toBe(2);
  });

  it('only clears full rows and leaves partial rows in place, collapsing above', () => {
    let s = withRows(init(1, quiet), ['..PP....', 'PPPPPPP.', 'PP..PPP.', 'PPPPPPP.']);
    s = dropIIntoGap(s, 'shot');
    expect(s.lastClears).toBe(2);
    expect(s.points).toBe(25);
    // Bottom row now the former partial row with the I's shot cell in column 7.
    expect(row(s, ROWS - 1)).toBe('PP..PPPS');
    expect(row(s, ROWS - 2)).toBe('..PP...S');
    expect(row(s, ROWS - 3)).toBe('........');
  });

  it('the falling piece itself counts toward primed', () => {
    // Row needs a wad; the I supplies it.
    let s = withRows(init(1, quiet), ['PPSPPPP.']);
    s = dropIIntoGap(s, 'wad');
    expect(s.lastPrimed).toBe(true);
    expect(s.points).toBe(15);
  });

  it('caps cannonsLoaded at MAX_CANNONS', () => {
    let s = { ...init(1, quiet), cannonsLoaded: MAX_CANNONS - 1 };
    s = withRows(s, ['PPPPPPP.', 'PPPPPPP.', 'PPPPPPP.', 'PPPPPPP.']);
    s = dropIIntoGap(s);
    expect(s.cannonsLoaded).toBe(MAX_CANNONS);
  });

  it('hard drop locks immediately, plays into lockSeq, and spawns the next piece', () => {
    const s0 = init(9, quiet);
    const nextSpec = s0.next[0]!;
    const s = act(s0, 'hardDrop');
    expect(s.lockSeq).toBe(1);
    expect(s.pieceSeq).toBe(s0.pieceSeq + 1);
    expect(s.active!.shape).toBe(nextSpec.shape);
    expect(s.active!.kind).toBe(nextSpec.kind);
    expect(s.next).toHaveLength(3);
    expect(s.grid.flat().filter((c) => c !== null)).toHaveLength(4);
  });
});

describe('gunnery: primed detection', () => {
  const r = (s: string) => s.split('').map((ch) => CH[ch] ?? null);
  it('requires >=2 powder, >=1 wad, >=1 shot', () => {
    expect(isPrimedRow(r('PPWSPPPP'))).toBe(true);
    expect(isPrimedRow(r('PWSWSWSW'))).toBe(false); // only 1 powder
    expect(isPrimedRow(r('PPPPSSSS'))).toBe(false); // no wad
    expect(isPrimedRow(r('PPWWWWWW'))).toBe(false); // no shot
    expect(isPrimedRow(r('PPWSDDDD'))).toBe(true); // damp cells don't disqualify
    expect(isPrimedRow(r('DDDDDDDP'))).toBe(false);
  });
});

describe('gunnery: hold', () => {
  it('holds the active piece, spawns the next, and blocks a second hold until lock', () => {
    const s0 = init(11, quiet);
    const first = { shape: s0.active!.shape, kind: s0.active!.kind };
    const second = s0.next[0]!;
    const s1 = act(s0, 'hold');
    expect(s1.hold).toEqual(first);
    expect(s1.holdUsed).toBe(true);
    expect(s1.active!.shape).toBe(second.shape);
    expect(s1.active!.kind).toBe(second.kind);
    expect(s1.active!.rot).toBe(0);
    expect(s1.active!.y).toBe(0);
    expect(s1.next).toHaveLength(3);
    expect(reduce(s1, { type: 'hold' })).toBe(s1);
    // after locking, hold is available again and swaps.
    const s2 = act(s1, 'hardDrop');
    expect(s2.holdUsed).toBe(false);
    const third = { shape: s2.active!.shape, kind: s2.active!.kind };
    const s3 = act(s2, 'hold');
    expect(s3.hold).toEqual(third);
    expect(s3.active!.shape).toBe(first.shape);
    expect(s3.active!.kind).toBe(first.kind);
    expect(s3.next).toEqual(s2.next); // swap does not touch the queue
  });

  it('hold resets rotation and position', () => {
    let s = withActive(init(11, quiet), { rot: 2, x: 0, y: 6 });
    s = act(s, 'hold');
    expect(s.active!.rot).toBe(0);
    expect(s.active!.y).toBe(0);
  });
});

describe('gunnery: damp garbage', () => {
  it('rises a damp row with exactly one gap every 20s at difficulty >= 0.3', () => {
    let s: State = { ...init(21, { difficulty: 0.4 }), active: null };
    s = withRows(s, ['P.......']);
    s = tick(s, GARBAGE_INTERVAL_MS - STEP_MS);
    expect(s.garbageSeq).toBe(0);
    s = tick(s, STEP_MS);
    expect(s.garbageSeq).toBe(1);
    const bottom = s.grid[ROWS - 1]!;
    expect(bottom.filter((c) => c === 'damp')).toHaveLength(COLS - 1);
    expect(bottom.filter((c) => c === null)).toHaveLength(1);
    // The pre-existing stack shifted up by one.
    expect(s.grid[ROWS - 2]![0]).toBe('powder');
    s = tick(s, GARBAGE_INTERVAL_MS);
    expect(s.garbageSeq).toBe(2);
    expect(s.grid[ROWS - 3]![0]).toBe('powder');
    expect(s.grid[ROWS - 2]!.filter((c) => c === 'damp')).toHaveLength(COLS - 1);
  });

  it('gap position is deterministic per seed', () => {
    const a = tick(init(21, { difficulty: 0.5 }), GARBAGE_INTERVAL_MS);
    const b = tick(init(21, { difficulty: 0.5 }), GARBAGE_INTERVAL_MS);
    expect(a.grid[ROWS - 1]).toEqual(b.grid[ROWS - 1]);
  });

  it('does not rise below difficulty 0.3', () => {
    const s = tick(init(21, { difficulty: 0.2 }), GARBAGE_INTERVAL_MS * 2);
    expect(s.garbageSeq).toBe(0);
    expect(s.grid[ROWS - 1]!.every((c) => c !== 'damp')).toBe(true);
  });

  it('lifts the active piece with the stack', () => {
    let s = withActive(init(21, { difficulty: 0.4 }), { shape: 'O', rot: 0, x: 3, y: 5 });
    s = { ...s, garbageTimerMs: GARBAGE_INTERVAL_MS - STEP_MS };
    s = tick(s, STEP_MS);
    expect(s.garbageSeq).toBe(1);
    expect(s.active!.y).toBe(4);
  });

  it('a damp row can be cleared by filling its gap', () => {
    let s = init(21, { difficulty: 0.4 });
    s = { ...s, garbageTimerMs: GARBAGE_INTERVAL_MS - STEP_MS };
    s = tick(s, STEP_MS);
    const gap = s.grid[ROWS - 1]!.indexOf(null);
    // Drop a vertical I into the gap: rot 1 occupies column x+2.
    s = withActive(s, { shape: 'I', kind: 'shot', rot: 1, x: gap - 2, y: 0 });
    s = act(s, 'hardDrop');
    expect(s.lastClears).toBe(1);
    expect(s.points).toBe(10);
    expect(s.lastPrimed).toBe(false);
    expect(s.grid[ROWS - 1]!.every((c) => c !== 'damp')).toBe(true);
  });

  it('tops out when garbage would push cells off the top', () => {
    let s = init(21, { difficulty: 0.4 });
    const grid = s.grid.map((r) => r.slice());
    grid[0]![0] = 'powder';
    s = { ...s, grid, garbageTimerMs: GARBAGE_INTERVAL_MS - STEP_MS };
    s = tick(s, STEP_MS);
    expect(s.over).toBe(true);
    expect(s.topOut).toBe(true);
  });
});

describe('gunnery: game over', () => {
  it('tops out when the spawn collides', () => {
    let s = init(1, quiet);
    const rows: string[] = [];
    for (let i = 0; i < ROWS; i++) rows.push('..PPPP..');
    s = withRows(s, rows);
    // Lock the current piece (anywhere) to force a spawn.
    s = withActive(s, { shape: 'O', rot: 0, x: 0, y: 0 });
    s = act(s, 'hardDrop');
    expect(s.over).toBe(true);
    expect(s.topOut).toBe(true);
    expect(def.isOver(s)).toBe(true);
    expect(reduce(s, { type: 'left' })).toBe(s);
    expect(tick(s, 1000)).toBe(s);
  });

  it('eventually tops out when hard-dropping without moving', () => {
    let s = init(4, quiet);
    let n = 0;
    while (!s.over && n < 200) { s = act(s, 'hardDrop'); n++; }
    expect(s.over).toBe(true);
    expect(s.topOut).toBe(true);
    expect(n).toBeLessThan(200);
  });

  it('ends at durationMs without a top-out', () => {
    let s = init(1, { difficulty: 0.2, durationMs: 5000 });
    s = tick(s, 4950);
    expect(s.over).toBe(false);
    s = tick(s, 50);
    expect(s.over).toBe(true);
    expect(s.topOut).toBe(false);
    expect(s.elapsedMs).toBe(5000);
  });
});

describe('gunnery: ticks are split-invariant', () => {
  function playSome(seed: number): State {
    let s = init(seed, { difficulty: 0.6 });
    const script: Action['type'][] = ['left', 'rotateCW', 'hardDrop', 'right', 'right', 'hardDrop', 'hold', 'softDrop', 'softDrop', 'rotateCCW', 'left', 'hardDrop'];
    for (const t of script) {
      s = tick(s, 137);
      s = reduce(s, { type: t } as Action);
    }
    return s;
  }

  it('tick(5000) equals 5 x tick(1000) and 50 x tick(100) and odd chunks', () => {
    for (const seed of [1, 2, 3]) {
      const s0 = playSome(seed);
      const a = tick(s0, 5000);
      let b = s0;
      for (let i = 0; i < 5; i++) b = tick(b, 1000);
      let c = s0;
      for (let i = 0; i < 50; i++) c = tick(c, 100);
      let d = s0;
      let left = 5000;
      const chunks = [7, 13, 333, 1, 999, 1234];
      let k = 0;
      while (left > 0) {
        const dt = Math.min(left, chunks[k++ % chunks.length]!);
        d = tick(d, dt);
        left -= dt;
      }
      expect(a).toEqual(b);
      expect(a).toEqual(c);
      expect(a).toEqual(d);
      expect(a.elapsedMs).toBe(s0.elapsedMs + 5000);
    }
  });

  it('long ticks across garbage rises are split-invariant (with a live piece and parked)', () => {
    for (const s0 of [init(8, { difficulty: 0.5 }), { ...init(8, { difficulty: 0.5 }), active: null }]) {
      const a = tick(s0, 41000);
      let b = s0;
      for (let i = 0; i < 41; i++) b = tick(b, 1000);
      expect(a).toEqual(b);
      if (!a.over) expect(a.garbageSeq).toBe(2);
    }
  });

  it('a game that ends mid-tick is split-invariant too', () => {
    const s0 = init(8, { difficulty: 0.5, durationMs: 3000 });
    const a = tick(s0, 7777);
    let b = s0;
    for (let i = 0; i < 8; i++) b = tick(b, 1000);
    expect(a).toEqual(b);
    expect(a.over).toBe(true);
    expect(a.elapsedMs).toBe(3000);
  });

  it('replay of an action log is deterministic', () => {
    const log: LogEntry<Action>[] = [
      { at: 100, a: { type: 'left' } },
      { at: 400, a: { type: 'rotateCW' } },
      { at: 900, a: { type: 'hardDrop' } },
      { at: 1500, a: { type: 'hold' } },
      { at: 2200, a: { type: 'right' } },
      { at: 2600, a: { type: 'hardDrop' } },
    ];
    const a = replay(def, 77, { difficulty: 0.5 }, log, 30000);
    const b = replay(def, 77, { difficulty: 0.5 }, log, 30000);
    expect(a).toEqual(b);
    expect(a.lockSeq).toBeGreaterThanOrEqual(2);
  });

  it('state stays JSON-serialisable', () => {
    const s = tick(act(init(5), 'rotateCW', 'hardDrop', 'hold'), 3000);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('gunnery: no-op reference equality', () => {
  it('returns the same reference for every no-op', () => {
    const s = init(1, quiet);
    expect(tick(s, 0)).toBe(s);
    expect(tick(s, -5)).toBe(s);
    expect(reduce(s, { type: 'bogus' } as unknown as Action)).toBe(s);
    const over = { ...s, over: true };
    for (const t of ['left', 'right', 'rotateCW', 'rotateCCW', 'softDrop', 'hardDrop', 'hold'] as const) {
      expect(reduce(over, { type: t })).toBe(over);
    }
    const noActive = { ...s, active: null };
    expect(reduce(noActive, { type: 'hardDrop' })).toBe(noActive);
  });

  it('does not mutate the input state', () => {
    const s = init(2, { difficulty: 0.5 });
    const snap = JSON.stringify(s);
    act(s, 'left', 'rotateCW', 'softDrop', 'hold', 'hardDrop');
    tick(s, 25000);
    expect(JSON.stringify(s)).toBe(snap);
  });
});

describe('gunnery: score & performance', () => {
  it('starts at zero with a label', () => {
    const sc = score(init(1));
    expect(sc.points).toBe(0);
    expect(sc.performance).toBe(0);
    expect(typeof sc.label).toBe('string');
  });

  it('rises with clears and decays while idle', () => {
    let s = withRows(init(1, quiet), ['PWSPWSP.', 'PWSPWSP.', 'PWSPWSP.', 'PWSPWSP.']);
    s = act(withActive(s, { shape: 'I', kind: 'powder', rot: 1, x: 5, y: 0 }), 'hardDrop');
    expect(s.points).toBe(120);
    s = tick(s, 1000);
    const p1 = score(s).performance;
    expect(p1).toBeGreaterThan(0.1);
    // Keep clearing for a while: performance should climb.
    for (let i = 0; i < 6; i++) {
      s = withRows(s, ['PPPPPPP.', 'PPPPPPP.']);
      s = act(withActive(s, { shape: 'I', kind: 'powder', rot: 1, x: 5, y: 0 }), 'hardDrop');
      s = tick(s, 1000);
    }
    const p2 = score(s).performance;
    expect(p2).toBeGreaterThan(p1);
    expect(p2).toBeLessThanOrEqual(1);
    // Idle for 20s -> noticeable drop.
    const idle = tick({ ...s, active: null }, 20000);
    const p3 = score(idle).performance;
    expect(p3).toBeLessThan(p2 * 0.5);
  });

  it('gives a small bonus for a low stack only once there is some play', () => {
    const s = init(1, quiet);
    expect(score(s).performance).toBe(0);
    const playing = { ...s, perf: 0.5 };
    const tall = withRows(playing, Array.from({ length: 10 }, () => 'PPPPPPP.'));
    expect(stackHeight(tall)).toBe(10);
    expect(score(playing).performance).toBeGreaterThan(score(tall).performance);
    expect(score(playing).performance - 0.5).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});
