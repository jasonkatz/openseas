import { describe, expect, it } from 'vitest';
import { rngFromSeed, rngInt } from '../../rng';
import { replay } from '../types';
import {
  COLS,
  GAP,
  JUNK,
  LOCK_MS,
  ROWS,
  aiChoose,
  applyGravity,
  attackPowerFor,
  def,
  drainOutgoing,
  findClears,
  garbagePatternFor,
  landingCells,
  resolveGrid,
  type Action,
  type Block,
  type Cell,
  type Pair,
  type State,
} from './index';

// ---------------------------------------------------------------------------
// helpers

const COLOR_CH: Record<string, number> = { r: 0, g: 1, b: 2, y: 3 };

function ch(c: string): Cell {
  if (c === '.') return null;
  if (c === '#') return { color: JUNK, breaker: false };
  const lower = c.toLowerCase();
  const color = COLOR_CH[lower];
  if (color === undefined) throw new Error(`bad cell char ${c}`);
  return { color, breaker: c !== lower };
}

/** Builds a grid from rows written bottom-most first ('.' empty, '#' junk, rgby normal, RGBY breakers). */
function gridFrom(rowsBottomFirst: string[]): Cell[][] {
  const g: Cell[][] = [];
  for (let y = 0; y < ROWS; y++) g.push(new Array<Cell>(COLS).fill(null));
  rowsBottomFirst.forEach((row, i) => {
    const y = ROWS - 1 - i;
    for (let x = 0; x < COLS; x++) g[y]![x] = ch(row[x] ?? '.');
  });
  return g;
}

function show(grid: Cell[][]): string[] {
  const out: string[] = [];
  for (let y = 0; y < ROWS; y++) {
    let s = '';
    for (let x = 0; x < COLS; x++) {
      const c = grid[y]![x];
      if (!c) s += '.';
      else if (c.color === JUNK) s += '#';
      else {
        const l = 'rgby'[c.color]!;
        s += c.breaker ? l.toUpperCase() : l;
      }
    }
    out.push(s);
  }
  // trim empty top rows
  while (out.length > 1 && out[0] === '......') out.shift();
  return out;
}

function blk(c: string): Block {
  return ch(c) as Block;
}

function pair(a: string, b: string, x = 2, dir: Pair['dir'] = 0): Pair {
  return { a: blk(a), b: blk(b), x, y: 1, dir };
}

function withGrid(s: State, grid: Cell[][], cur?: Pair): State {
  return { ...s, grid, cur: cur ?? s.cur };
}

function count(grid: Cell[][]): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c) n++;
  return n;
}

const MOVES: Action[] = [
  { type: 'left' },
  { type: 'right' },
  { type: 'rotateCW' },
  { type: 'rotateCCW' },
  { type: 'softDrop' },
  { type: 'hardDrop' },
];

function randomLog(seed: number, n: number): { at: number; a: Action }[] {
  let rng = rngFromSeed(seed);
  const log: { at: number; a: Action }[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    let dt: number;
    let k: number;
    [rng, dt] = rngInt(rng, 400);
    [rng, k] = rngInt(rng, MOVES.length);
    t += dt;
    log.push({ at: t, a: MOVES[k]! });
  }
  return log;
}

// ---------------------------------------------------------------------------

describe('swordfight: init', () => {
  it('creates an empty well with a falling pair and a preview', () => {
    const s = def.init(1);
    expect(s.cols).toBe(COLS);
    expect(s.rows).toBe(ROWS);
    expect(count(s.grid)).toBe(0);
    expect(s.cur).not.toBeNull();
    expect(s.cur!.x).toBe(2);
    expect(s.cur!.y).toBe(1);
    expect(s.next).toBeDefined();
    expect(s.over).toBe(false);
    expect(s.ko).toBe(false);
    expect(s.outgoing).toEqual([]);
    expect(s.fallMs).toBe(650);
    expect(s.durationMs).toBe(180000);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('is seed-deterministic and blocks only use colours 0..3', () => {
    const a = def.init(42);
    const b = def.init(42);
    expect(a).toEqual(b);
    for (const bl of [a.cur!.a, a.cur!.b, a.next.a, a.next.b]) {
      expect(bl.color).toBeGreaterThanOrEqual(0);
      expect(bl.color).toBeLessThan(4);
    }
    expect(def.init(42).cur).not.toEqual(def.init(43).cur);
  });

  it('difficulty changes the fall speed and respects the floor', () => {
    expect(def.init(1, { difficulty: 0 }).fallMs).toBe(850);
    expect(def.init(1, { difficulty: 1 }).fallMs).toBe(350);
    let s = def.init(1, { difficulty: 1 });
    s = def.reduce({ ...s, elapsedMs: 60000 }, { type: 'hardDrop' });
    expect(s.fallMs).toBe(300);
    s = def.reduce({ ...def.init(1), elapsedMs: 30000 }, { type: 'hardDrop' });
    expect(s.fallMs).toBe(650 - 60);
  });
});

describe('swordfight: determinism & purity', () => {
  it('same seed + same log => identical state', () => {
    const log = randomLog(7, 300);
    const a = replay(def, 99, { difficulty: 0.5 }, log, 120000);
    const b = replay(def, 99, { difficulty: 0.5 }, log, 120000);
    expect(a).toEqual(b);
    expect(a.pieces).toBeGreaterThan(10);
  });

  it('never mutates its inputs', () => {
    const s = def.init(5);
    const snap = JSON.stringify(s);
    def.reduce(s, { type: 'hardDrop' });
    def.reduce(s, { type: 'rotateCW' });
    def.tick(s, 5000);
    def.reduce(s, { type: 'garbage', pattern: [[JUNK, JUNK, JUNK, JUNK, JUNK, JUNK]] });
    aiChoose(s, rngFromSeed(1), 0.5);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('no-op actions return the same reference', () => {
    let s = def.init(3);
    s = def.reduce(s, { type: 'left' });
    s = def.reduce(s, { type: 'left' });
    expect(s.cur!.x).toBe(0);
    expect(def.reduce(s, { type: 'left' })).toBe(s);
    expect(def.reduce(s, { type: 'warn', power: 0 })).toBe(s);
    expect(def.reduce(s, { type: 'garbage', pattern: [] })).toBe(s);
    expect(def.reduce(s, { type: 'garbage', pattern: 'nope' as unknown as number[][] })).toBe(s);
    expect(def.reduce(s, { type: 'bogus' } as unknown as Action)).toBe(s);
    expect(def.tick(s, 0)).toBe(s);
    const over = { ...s, over: true };
    for (const a of MOVES) expect(def.reduce(over, a)).toBe(over);
    expect(def.reduce(over, { type: 'garbage', pattern: [[JUNK]] })).toBe(over);
    expect(def.tick(over, 1000)).toBe(over);
  });

  it('rotation at a wall kicks instead of failing', () => {
    let s = def.init(3);
    s = def.reduce(s, { type: 'right' });
    s = def.reduce(s, { type: 'right' });
    s = def.reduce(s, { type: 'right' });
    expect(s.cur!.x).toBe(5);
    s = def.reduce(s, { type: 'rotateCW' }); // satellite would go to x=6
    expect(s.cur!.dir).toBe(1);
    expect(s.cur!.x).toBe(4);
  });

  it('split ticks equal merged ticks', () => {
    const base = def.init(11, { difficulty: 0.7 });
    const one = def.tick(base, 5000);
    let five = base;
    for (let i = 0; i < 5; i++) five = def.tick(five, 1000);
    expect(five).toEqual(one);
    let many = base;
    for (let t = 0; t < 5000; t += 16) many = def.tick(many, 16);
    many = def.tick(many, 5000 - 16 * Math.ceil(5000 / 16)); // negative/zero remainder is a no-op
    const total = 16 * Math.ceil(5000 / 16);
    const big = def.tick(base, total);
    expect(many).toEqual(big);
    // through the whole session incl. game over
    const whole = def.tick(base, 200000);
    let chunks = base;
    for (let t = 0; t < 200000; t += 777) chunks = def.tick(chunks, 777);
    expect(chunks).toEqual(whole);
    expect(whole.over).toBe(true);
    expect(whole.ko).toBe(true); // nobody steered, the spawn column filled up
    expect(whole.elapsedMs).toBe(chunks.elapsedMs);
  });
});

describe('swordfight: gravity & locking', () => {
  it('pairs fall one row per fallMs and lock after the lock delay', () => {
    let s = def.init(2);
    const y0 = s.cur!.y;
    s = def.tick(s, s.fallMs);
    expect(s.cur!.y).toBe(y0 + 1);
    // drop to the floor (10 more rows); the lock delay only starts once resting
    s = def.tick(s, s.fallMs * 10);
    expect(s.cur!.y).toBe(ROWS - 1);
    expect(s.pieces).toBe(0);
    s = def.tick(s, LOCK_MS);
    expect(s.pieces).toBe(1);
    expect(s.lockSeq).toBe(1);
    expect(count(s.grid)).toBe(2);
    // new pair spawned from the preview
    expect(s.cur!.y).toBe(1);
  });

  it('moving resets the lock delay', () => {
    let s = def.init(2);
    s = def.tick(s, s.fallMs * 11);
    expect(s.cur!.y).toBe(ROWS - 1);
    s = def.tick(s, LOCK_MS - 50);
    expect(s.lockAcc).toBe(LOCK_MS - 50);
    s = def.reduce(s, { type: 'left' });
    expect(s.lockAcc).toBe(0);
  });

  it('hard drop locks immediately and the blocks split-fall', () => {
    const s0 = def.init(2);
    const grid = gridFrom(['..g...']);
    const s = withGrid(s0, grid, pair('r', 'b', 2, 1)); // horizontal r at x=2, b at x=3
    const land = landingCells(s.grid, s.cur!);
    expect(land[0]).toMatchObject({ x: 2, y: ROWS - 2 });
    expect(land[1]).toMatchObject({ x: 3, y: ROWS - 1 });
    const t = def.reduce(s, { type: 'hardDrop' });
    expect(show(t.grid)).toEqual(['..r...', '..gb..']);
  });

  it('soft drop moves one row, or locks when resting', () => {
    let s = def.init(2);
    s = def.reduce(s, { type: 'softDrop' });
    expect(s.cur!.y).toBe(2);
    s = def.tick(s, s.fallMs * 10);
    expect(s.pieces).toBe(0);
    s = def.reduce(s, { type: 'softDrop' });
    expect(s.pieces).toBe(1);
  });

  it('tops out (KO) when a new pair cannot spawn', () => {
    const s0 = def.init(2);
    const col = Array.from({ length: ROWS - 1 }, () => '..r...');
    const s = withGrid(s0, gridFrom(col), pair('g', 'g', 0, 1));
    const t = def.reduce(s, { type: 'hardDrop' });
    expect(t.ko).toBe(true);
    expect(t.over).toBe(true);
    expect(t.cur).toBeNull();
    expect(def.isOver(t)).toBe(true);
  });
});

describe('swordfight: breaker clearing', () => {
  it('a breaker clears the same-colour group it touches (plus itself)', () => {
    const [mark, n] = findClears(gridFrom(['rrr...', 'R.....']));
    expect(n).toBe(4);
    expect(mark.filter(Boolean).length).toBe(4);
    const res = resolveGrid(gridFrom(['rrrg..', 'R..g..']));
    expect(show(res.grid)).toEqual(['...g..', '...g..']);
    expect(res.passes).toEqual([4]);
    expect(res.clears.filter((c) => c.breaker).length).toBe(1);
  });

  it('normal blocks never clear on their own, however large the group', () => {
    const grid = gridFrom(['rrrrrr', 'rrrrrr', 'rrrrrr']);
    expect(findClears(grid)[1]).toBe(0);
    const res = resolveGrid(grid);
    expect(res.grid).toBe(grid);
    expect(res.passes).toEqual([]);
  });

  it('a breaker touching nothing of its colour stays put', () => {
    const grid = gridFrom(['gggbbb', 'R.Y.G.']);
    expect(findClears(grid)[1]).toBe(0);
  });

  it('two same-colour breakers touching clear each other', () => {
    const res = resolveGrid(gridFrom(['RR....']));
    expect(res.passes).toEqual([2]);
    expect(count(res.grid)).toBe(0);
  });

  it('breakers inside a group clear with it; other colours are untouched', () => {
    const res = resolveGrid(gridFrom(['rRrg..', '.r.B..', 'Br....']));
    // Red group: (0,0) r, (1,0) R, (2,0) r, (1,1) r, (1,2) r -> 5 cleared. Blue breakers touch no blue -> stay.
    expect(res.passes).toEqual([5]);
    expect(show(res.grid)).toEqual(['...B..', 'B..g..']);
  });

  it('junk adjacent to a cleared block is cleared, but junk does not propagate', () => {
    const res = resolveGrid(gridFrom(['##rR##', '#.....']));
    // r,R cleared; junk at x=1 (next to r) and x=4 (next to R) cleared; x=0 and x=5 and (0,row1) stay.
    expect(res.passes).toEqual([4]);
    expect(show(res.grid)).toEqual(['#.....', '#....#']);
  });

  it('a locked pair triggers clears on the whole board, and records lastClears/chain/clearSeq', () => {
    const s0 = def.init(2);
    const s = withGrid(s0, gridFrom(['..rr..', '..r...']), pair('R', 'g', 2, 0));
    const t = def.reduce(s, { type: 'hardDrop' });
    expect(t.chain).toBe(1);
    expect(t.clearSeq).toBe(1);
    expect(t.blocksCleared).toBe(4);
    expect(t.lastClears.length).toBe(4);
    expect(t.lastClears.every((c) => c.pass === 1)).toBe(true);
    expect(show(t.grid)).toEqual(['..g...']);
    // a lock that clears nothing leaves lastClears alone but sets chain 0
    const u = def.reduce(t, { type: 'hardDrop' });
    expect(u.chain).toBe(0);
    expect(u.clearSeq).toBe(1);
    expect(u.lastClears).toBe(t.lastClears);
  });

  it('chains: blocks falling onto a breaker trigger a second pass', () => {
    // bottom row: g r ; row 1: r r ; row 2: R G.  G touches no green until the reds vanish.
    const grid = gridFrom(['gr....', 'rr....', 'RG....']);
    const res = resolveGrid(grid);
    // pass 1: R + 3 reds = 4; gravity drops G onto the floor beside g -> pass 2: G + g = 2.
    expect(res.passes).toEqual([4, 2]);
    expect(count(res.grid)).toBe(0);
    expect(res.clears.filter((c) => c.pass === 2).length).toBe(2);
    expect(res.clears.filter((c) => c.pass === 1).length).toBe(4);
    expect(attackPowerFor(res.passes)).toBe(1);
  });

  it('a lock that causes a chain reports chain 2 and multiplies attack power', () => {
    const s0 = def.init(2);
    // Final, verified layout: column 0 = r, g ; column 1 = r, r, G. G touches only r's and the r at (1,1)... (0,1)=g is left of (1,1)=r, G at (1,2) touches (0,2)='.' and (1,1)=r. OK no g contact.
    const board = gridFrom([
      'rr....',
      'gr....',
      '.G....',
    ]);
    // Drop R into column 2 (x=2) -> lands (2,0), touches r(1,0): red group = {(1,0),(0,0),(1,1)} -> pass 1 clears 3 r + R = 4.
    // gravity: col0: g(0); col1: G(0). pass 2: G touches g -> 2 cleared. Chain 2, power = max(0,4-3)*1 + max(0,2-3)*2 = 1.
    const s = withGrid(s0, board, pair('R', 'b', 2, 0));
    // pivot R at x=2 (lands bottom), satellite b above it.
    const t = def.reduce(s, { type: 'hardDrop' });
    expect(t.chain).toBe(2);
    expect(t.blocksCleared).toBe(6);
    expect(t.outgoing).toEqual([{ power: 1, seq: 1 }]);
    expect(t.damageDealt).toBe(1);
    expect(show(t.grid)).toEqual(['..b...']);
  });
});

describe('swordfight: attacks', () => {
  it('attack power is max(0, cleared-3) * chain, summed over passes', () => {
    expect(attackPowerFor([])).toBe(0);
    expect(attackPowerFor([3])).toBe(0);
    expect(attackPowerFor([5])).toBe(2);
    expect(attackPowerFor([5, 6])).toBe(2 + 6);
    expect(attackPowerFor([2, 7, 4])).toBe(0 + 8 + 3);
  });

  it('a clearing lock appends an outgoing attack and accumulates damageDealt', () => {
    const s0 = def.init(2);
    const s = withGrid(s0, gridFrom(['.rrrr.', '..r...']), pair('R', 'g', 2, 0));
    const t = def.reduce(s, { type: 'hardDrop' });
    expect(t.blocksCleared).toBe(6);
    expect(t.outgoing).toEqual([{ power: 3, seq: 1 }]);
    expect(t.damageDealt).toBe(3);
    expect(def.score(t).points).toBe(3 * 10 + 6);
    expect(def.score(t).performance).toBeGreaterThan(0);
    const [drained, attacks] = drainOutgoing(t);
    expect(attacks).toEqual([{ power: 3, seq: 1 }]);
    expect(drained.outgoing).toEqual([]);
    expect(drainOutgoing(drained)[0]).toBe(drained);
    // the engine never touches another board: only outgoing changes
    expect(t.damageTaken).toBe(0);
  });

  it('clearing 3 or fewer blocks sends nothing', () => {
    const s0 = def.init(2);
    const s = withGrid(s0, gridFrom(['..r...']), pair('R', 'g', 2, 0));
    const t = def.reduce(s, { type: 'hardDrop' });
    expect(t.blocksCleared).toBe(2);
    expect(t.outgoing).toEqual([]);
    expect(t.damageDealt).toBe(0);
  });

  it('warn only updates pendingGarbage', () => {
    const s = def.init(2);
    const t = def.reduce(s, { type: 'warn', power: 7 });
    expect(t.pendingGarbage).toBe(7);
    expect({ ...t, pendingGarbage: 0 }).toEqual(s);
    expect(def.reduce(t, { type: 'warn', power: -3 }).pendingGarbage).toBe(0);
  });
});

describe('swordfight: garbage', () => {
  it('inserts rows at the bottom, bottom-most first, pushing the stack up', () => {
    const s0 = def.init(2);
    const s = withGrid(s0, gridFrom(['rgb...']));
    const t = def.reduce(s, {
      type: 'garbage',
      pattern: [
        [JUNK, JUNK, JUNK, JUNK, JUNK, JUNK],
        [0, 1, 2, 3, JUNK, JUNK],
      ],
    });
    expect(show(t.grid)).toEqual(['rgb...', 'rgby##', '######']);
    expect(t.garbageSeq).toBe(1);
    expect(t.lastGarbageRows).toBe(2);
    expect(t.damageTaken).toBe(12);
    expect(t.ko).toBe(false);
    expect(t.pendingGarbage).toBe(0);
    // the falling pair is lifted by the same amount so it keeps its height above the stack
    expect(t.cur!.y).toBe(s.cur!.y); // it was at spawn: clamped so the satellite stays in row 0
  });

  it('partial rows (GAP) let the stack settle through the holes', () => {
    const s0 = def.init(2);
    const s = withGrid(s0, gridFrom(['rrrrrr']));
    const t = def.reduce(s, { type: 'garbage', pattern: [[JUNK, GAP, JUNK, GAP, GAP, GAP]] });
    expect(show(t.grid)).toEqual(['r.r...', '#r#rrr']);
    expect(t.damageTaken).toBe(2);
  });

  it('lifts a mid-air pair with the stack', () => {
    const s0 = def.init(2);
    const s = withGrid(s0, gridFrom(['rrrrrr']), { ...pair('g', 'g', 0, 1), y: 8 });
    const t = def.reduce(s, { type: 'garbage', pattern: [[JUNK, JUNK, JUNK, JUNK, JUNK, JUNK], [JUNK, JUNK, JUNK, JUNK, JUNK, JUNK]] });
    expect(t.cur!.y).toBe(6);
  });

  it('ignores unknown values and junk colours never become breakers', () => {
    const s = def.init(2);
    const t = def.reduce(s, { type: 'garbage', pattern: [[9, -7, 1.7, JUNK, 'x' as unknown as number]] });
    expect(show(t.grid)).toEqual(['..g#..']);
    for (const row of t.grid) for (const c of row) if (c) expect(c.breaker).toBe(false);
  });

  it('KO when the push-up puts a block into row 0', () => {
    const s0 = def.init(2);
    const rowsFull = Array.from({ length: ROWS - 1 }, () => 'r.....');
    const s = withGrid(s0, gridFrom(rowsFull));
    expect(s.ko).toBe(false);
    const full = [JUNK, JUNK, JUNK, JUNK, JUNK, JUNK];
    const t = def.reduce(s, { type: 'garbage', pattern: [full] });
    expect(t.ko).toBe(true);
    expect(t.over).toBe(true);
    // a gap under the tall column lets it settle instead of topping out
    const v = def.reduce(s, { type: 'garbage', pattern: [[GAP, JUNK, GAP, GAP, GAP, GAP]] });
    expect(v.ko).toBe(false);
    // one row short does not KO
    const u = def.reduce(withGrid(s0, gridFrom(rowsFull.slice(0, ROWS - 2))), { type: 'garbage', pattern: [full] });
    expect(u.ko).toBe(false);
    expect(u.grid[0]![0]).toBeNull();
    expect(u.grid[1]![0]).not.toBeNull();
  });

  it('KO when blocks would be pushed off the top', () => {
    const s0 = def.init(2);
    const s = withGrid(s0, gridFrom(Array.from({ length: ROWS }, () => '.....r')));
    const t = def.reduce(s, { type: 'garbage', pattern: [[JUNK, GAP, GAP, GAP, GAP, GAP]] });
    expect(t.ko).toBe(true);
  });

  it('coloured garbage can be cleared by a breaker like any block', () => {
    const s0 = def.init(2);
    let s = def.reduce(withGrid(s0, gridFrom([]), pair('B', 'B', 2, 1)), { type: 'garbage', pattern: [[JUNK, 2, 2, 2, JUNK, JUNK]] });
    s = def.reduce(s, { type: 'hardDrop' }); // B lands on 2s at x=2,3
    expect(s.blocksCleared).toBe(3 + 2 + 2); // 3 blue + 2 breakers + 2 adjacent junk
    expect(show(s.grid)).toEqual(['.....#']);
  });
});

describe('swordfight: garbagePatternFor', () => {
  const rng = rngFromSeed(123);
  const junkCount = (rows: number[][]) => rows.flat().filter((v) => v === JUNK).length;
  const filled = (rows: number[][]) => rows.flat().filter((v) => v === JUNK || v >= 0).length;

  it('returns nothing for power <= 0', () => {
    expect(garbagePatternFor(0, rng)[1]).toEqual([]);
    expect(garbagePatternFor(-2, rng)[1]).toEqual([]);
  });

  it('is deterministic and advances the rng', () => {
    const a = garbagePatternFor(4, rng);
    const b = garbagePatternFor(4, rng);
    expect(a).toEqual(b);
    expect(a[0]).not.toEqual(rng);
  });

  it('power 1-2: one row with 2-3 junk cells', () => {
    for (const p of [1, 2]) {
      const [, rows] = garbagePatternFor(p, rng);
      expect(rows.length).toBe(1);
      expect(rows[0]!.length).toBe(COLS);
      expect(junkCount(rows)).toBe(p + 1);
      expect(filled(rows)).toBe(p + 1);
    }
  });

  it('power 3-5: one full row of junk and colours', () => {
    for (const p of [3, 4, 5]) {
      const [, rows] = garbagePatternFor(p, rngFromSeed(p));
      expect(rows.length).toBe(1);
      expect(filled(rows)).toBe(COLS);
      expect(rows.flat().every((v) => v === JUNK || (v >= 0 && v < 4))).toBe(true);
    }
  });

  it('power 6-9: two full rows', () => {
    for (const p of [6, 9]) {
      const [, rows] = garbagePatternFor(p, rng);
      expect(rows.length).toBe(2);
      expect(filled(rows)).toBe(COLS * 2);
    }
  });

  it('power 10+: three rows with a 4-connected one-colour sword that a breaker can clear in one go', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const [, rows] = garbagePatternFor(10 + seed, rngFromSeed(seed));
      expect(rows.length).toBe(3);
      expect(filled(rows)).toBe(COLS * 3);
      const colours = new Set(rows.flat().filter((v) => v >= 0));
      expect(colours.size).toBe(1);
      const c = [...colours][0]!;
      expect(rows.flat().filter((v) => v === c).length).toBe(5);
      // inserting the pattern then dropping a matching breaker next to the blade clears all 5 (+ junk)
      const s0 = def.init(1);
      const s = def.reduce(withGrid(s0, gridFrom([])), { type: 'garbage', pattern: rows });
      const g = s.grid;
      // find the top-most sword cell and put a breaker on top of it
      let bx = -1;
      let by = -1;
      for (let y = 0; y < ROWS && bx < 0; y++) for (let x = 0; x < COLS; x++) if (g[y]![x]?.color === c) { bx = x; by = y; break; }
      const placed = g.map((r) => r.slice());
      placed[by - 1]![bx] = { color: c, breaker: true };
      const res = resolveGrid(placed);
      expect(res.passes.length).toBe(1);
      expect(res.clears.filter((cl) => cl.color === c).length).toBe(6);
    }
  });
});

describe('swordfight: AI', () => {
  it('returns a non-empty action list ending with hardDrop that the engine accepts', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      let s = def.init(seed);
      let rng = rngFromSeed(seed);
      for (let i = 0; i < 40 && !s.over; i++) {
        let acts: Action[];
        [rng, acts] = aiChoose(s, rng, 0.8);
        expect(acts.length).toBeGreaterThan(0);
        expect(acts[acts.length - 1]).toEqual({ type: 'hardDrop' });
        for (const a of acts) expect(['left', 'right', 'rotateCW', 'rotateCCW', 'hardDrop']).toContain(a.type);
        const before = s.pieces;
        for (const a of acts.slice(0, -1)) {
          const n = def.reduce(s, a);
          expect(n).not.toBe(s); // every move/rotate the AI emits is legal
          s = n;
        }
        s = def.reduce(s, { type: 'hardDrop' });
        expect(s.pieces).toBe(before + 1);
        s = def.tick(s, 700);
      }
      expect(s.pieces).toBeGreaterThan(30);
    }
  });

  it('is deterministic and returns [] when there is no falling pair', () => {
    const s = def.init(9);
    const a = aiChoose(s, rngFromSeed(2), 0.5);
    const b = aiChoose(s, rngFromSeed(2), 0.5);
    expect(a).toEqual(b);
    expect(aiChoose({ ...s, over: true }, rngFromSeed(2), 0.5)[1]).toEqual([]);
    expect(aiChoose({ ...s, cur: null }, rngFromSeed(2), 0.5)[1]).toEqual([]);
  });

  it('prefers dropping a breaker onto a large same-colour group', () => {
    const s0 = def.init(2);
    const board = gridFrom(['.rrrr.', '.rrrr.']);
    const s = withGrid(s0, board, pair('R', 'g', 2, 0));
    const [, acts] = aiChoose(s, rngFromSeed(1), 1);
    let t = s;
    for (const a of acts) t = def.reduce(t, a);
    expect(t.blocksCleared).toBeGreaterThanOrEqual(9);
    expect(t.outgoing.length).toBe(1);
  });

  it('a skilled AI outplays a clumsy one over a session', () => {
    const run = (skill: number) => {
      let s = def.init(77);
      let rng = rngFromSeed(5);
      for (let i = 0; i < 150 && !s.over; i++) {
        let acts: Action[];
        [rng, acts] = aiChoose(s, rng, skill);
        for (const a of acts) s = def.reduce(s, a);
        s = def.tick(s, 700);
      }
      return s;
    };
    const good = run(1);
    const bad = run(0);
    expect(good.damageDealt).toBeGreaterThan(0);
    expect(good.ko).toBe(false);
    expect(good.damageDealt).toBeGreaterThanOrEqual(bad.damageDealt);
  });
});

describe('swordfight: scoring & time', () => {
  it('points = damageDealt*10 + blocksCleared, performance decays while idle', () => {
    let s = def.init(2);
    expect(def.score(s)).toEqual({ points: 0, performance: 0, label: 'Booched' });
    s = withGrid(s, gridFrom(['.rrrr.', '..r...']), pair('R', 'g', 2, 0));
    s = def.reduce(s, { type: 'hardDrop' });
    const p0 = def.score(s).performance;
    expect(p0).toBeGreaterThan(0.05);
    expect(def.score(s).points).toBe(3 * 10 + 6);
    s = def.tick(s, 10000); // the window that contained the attack is sampled: rating rises
    const p1 = def.score(s).performance;
    expect(p1).toBeGreaterThan(p0);
    s = def.tick(s, 10000);
    const p2 = def.score(s).performance;
    s = def.tick(s, 10000);
    const p3 = def.score(s).performance;
    expect(p2).toBeLessThan(p1);
    expect(p3).toBeLessThan(p1 * 0.5); // idle for 20s noticeably drops it
    expect(def.score(s).points).toBeGreaterThanOrEqual(36); // unattended pairs keep landing
    expect(def.score(s).label).toBe('Booched');
  });

  it('ends at durationMs', () => {
    let s = def.init(2, { durationMs: 20000 });
    s = def.tick(s, 19999);
    expect(s.over).toBe(false);
    s = def.tick(s, 1);
    expect(s.over).toBe(true);
    expect(s.ko).toBe(false);
    expect(s.elapsedMs).toBe(20000);
  });

  it('applyGravity returns the same reference when nothing moves', () => {
    const g = gridFrom(['rgb...', 'r.....']);
    expect(applyGravity(g)[0]).toBe(g);
    const floating = gridFrom(['......', 'r.....']);
    const [out, moved] = applyGravity(floating);
    expect(moved).toBe(true);
    expect(show(out)).toEqual(['r.....']);
  });
});
