import { describe, expect, it } from 'vitest';
import { replay } from '../types';
import type { LogEntry } from '../types';
import { rngFromSeed, rngInt } from '../../rng';
import {
  BREACH_CELLS,
  COLS,
  DISCARD_COST,
  PIECE_LIBRARY,
  ROWS,
  SEA_INTERVAL_MS,
  anyPieceFits,
  canPlace,
  def,
  flipShape,
  holeScore,
  holeStuck,
  normaliseShape,
  openCells,
  rotateShape,
  sameShape,
  shapeBounds,
  shapeOrientations,
} from './engine';
import type { Action, CellKind, Hole, Piece, Pt, State } from './engine';

const idx = (x: number, y: number): number => y * COLS + x;
const key = (p: Pt): string => `${p.x},${p.y}`;

function isConnected(cells: readonly Pt[]): boolean {
  if (cells.length === 0) return false;
  const set = new Set(cells.map(key));
  const seen = new Set<string>([key(cells[0]!)]);
  const stack: Pt[] = [cells[0]!];
  while (stack.length) {
    const p = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const q = { x: p.x + dx, y: p.y + dy };
      const k = key(q);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push(q);
      }
    }
  }
  return seen.size === cells.length;
}

/** Asserts cells/owner/holes agree and no two holes share an edge. */
function assertHullValid(s: State): void {
  const byId = new Map<number, Hole>();
  for (const h of s.holes) {
    expect(byId.has(h.id)).toBe(false);
    byId.set(h.id, h);
    expect(isConnected(h.cells)).toBe(true);
    let filled = 0;
    for (const p of h.cells) {
      expect(s.owner[idx(p.x, p.y)]).toBe(h.id);
      const c = s.cells[idx(p.x, p.y)];
      expect(c === 'hole' || c === 'filled').toBe(true);
      if (c === 'filled') filled++;
    }
    expect(h.filled).toBe(filled);
  }
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const o = s.owner[idx(x, y)]!;
      const c = s.cells[idx(x, y)];
      if (c === 'solid') expect(o).toBe(-1);
      else {
        expect(byId.has(o)).toBe(true);
        expect(byId.get(o)!.cells.some((p) => p.x === x && p.y === y)).toBe(true);
        // non-adjacency between different holes
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const no = s.owner[idx(nx, ny)]!;
          if (no !== -1) expect(no).toBe(o);
        }
      }
    }
  }
}

/** Finds a legal placement for any tray slot (after rotations/flips) or null. */
function findPlacement(s: State): { slot: number; x: number; y: number; pre: Action[] } | null {
  for (let slot = 0; slot < s.tray.length; slot++) {
    for (let f = 0; f < 2; f++) {
      for (let r = 0; r < 4; r++) {
        const pre: Action[] = [];
        for (let i = 0; i < f; i++) pre.push({ type: 'flip', slot });
        for (let i = 0; i < r; i++) pre.push({ type: 'rotate', slot });
        let t = s;
        for (const a of pre) t = def.reduce(t, a);
        const b = shapeBounds(t.tray[slot]!.shape);
        for (let y = 0; y + b.h <= ROWS; y++) {
          for (let x = 0; x + b.w <= COLS; x++) {
            if (canPlace(t, slot, x, y)) return { slot, x, y, pre };
          }
        }
      }
    }
  }
  return null;
}

/** Builds a state with exactly the given holes (and a chosen tray) on an otherwise solid hull. */
function craft(base: State, holeCells: Pt[][], tray: Piece[], perfect = true): State {
  const cells: CellKind[] = new Array(COLS * ROWS).fill('solid');
  const owner: number[] = new Array(COLS * ROWS).fill(-1);
  const holes: Hole[] = holeCells.map((cs, i) => {
    const id = 100 + i;
    for (const p of cs) {
      cells[idx(p.x, p.y)] = 'hole';
      owner[idx(p.x, p.y)] = id;
    }
    return { id, cells: normaliseShape(cs).map((p) => ({ x: p.x + Math.min(...cs.map((q) => q.x)), y: p.y + Math.min(...cs.map((q) => q.y)) })), filled: 0, perfect, bornAt: 0 };
  });
  return { ...base, cells, owner, holes, nextHoleId: 200, tray };
}

const shape = (kind: string): Pt[] => normaliseShape(PIECE_LIBRARY[kind]!);
const at = (kind: string, ox: number, oy: number): Pt[] => shape(kind).map((p) => ({ x: p.x + ox, y: p.y + oy }));

/** Deterministic pseudo-random driver producing a replayable log. */
function drive(seed: number, steps: number): { log: LogEntry<Action>[]; end: number } {
  let s = def.init(seed);
  let rng = rngFromSeed(seed ^ 0xabcdef);
  const log: LogEntry<Action>[] = [];
  let t = 0;
  for (let i = 0; i < steps && !s.over; i++) {
    let dt: number;
    [rng, dt] = rngInt(rng, 1500);
    t += dt;
    s = def.tick(s, dt);
    let roll: number;
    [rng, roll] = rngInt(rng, 10);
    let a: Action;
    if (roll < 6) {
      const p = findPlacement(s);
      if (p) {
        for (const pre of p.pre) {
          log.push({ at: t, a: pre });
          s = def.reduce(s, pre);
        }
        a = { type: 'place', slot: p.slot, x: p.x, y: p.y };
      } else {
        a = { type: 'discard', slot: 0 };
      }
    } else if (roll < 8) {
      let slot: number;
      [rng, slot] = rngInt(rng, 3);
      a = { type: 'rotate', slot };
    } else if (roll < 9) {
      let slot: number;
      [rng, slot] = rngInt(rng, 3);
      a = { type: 'flip', slot };
    } else {
      let x: number;
      let y: number;
      [rng, x] = rngInt(rng, COLS);
      [rng, y] = rngInt(rng, ROWS);
      a = { type: 'place', slot: 1, x, y };
    }
    log.push({ at: t, a });
    s = def.reduce(s, a);
  }
  return { log, end: t + 500 };
}

describe('carpentry: shapes', () => {
  it('library pieces are normalised and sized 2..5', () => {
    for (const [kind, sh] of Object.entries(PIECE_LIBRARY)) {
      expect(sh.length).toBeGreaterThanOrEqual(2);
      expect(sh.length).toBeLessThanOrEqual(5);
      expect(sameShape(normaliseShape(sh), sh)).toBe(true);
      expect(isConnected(sh)).toBe(true);
      expect(kind.endsWith(String(sh.length))).toBe(true);
    }
  });

  it('four rotations and two flips are identities', () => {
    for (const sh of Object.values(PIECE_LIBRARY)) {
      let r = sh;
      for (let i = 0; i < 4; i++) r = rotateShape(r);
      expect(sameShape(r, sh)).toBe(true);
      expect(sameShape(flipShape(flipShape(sh)), sh)).toBe(true);
    }
  });

  it('rotation is clockwise in screen space', () => {
    // vertical domino -> horizontal domino; L3 rotates clockwise
    expect(rotateShape([{ x: 0, y: 0 }, { x: 0, y: 1 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    // T4 pointing down becomes T pointing left
    expect(rotateShape(shape('T4'))).toEqual(normaliseShape([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 1 }]));
  });

  it('orientations are distinct and bounded by 8', () => {
    expect(shapeOrientations(shape('O4')).length).toBe(1);
    expect(shapeOrientations(shape('I4')).length).toBe(2);
    expect(shapeOrientations(shape('T4')).length).toBe(4);
    expect(shapeOrientations(shape('F5')).length).toBe(8);
  });
});

describe('carpentry: init', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    expect(def.init(7)).toEqual(def.init(7));
    expect(def.init(7)).not.toEqual(def.init(8));
  });

  it('carves three valid, non-touching holes of 5..9 cells', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = def.init(seed);
      expect(s.holes.length).toBe(3);
      for (const h of s.holes) {
        expect(h.cells.length).toBeGreaterThanOrEqual(5);
        expect(h.cells.length).toBeLessThanOrEqual(9);
        expect(h.filled).toBe(0);
        expect(h.perfect).toBe(true);
      }
      assertHullValid(s);
    }
  });

  it('offers a tray of three normalised pieces, at least one of which fits', () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = def.init(seed);
      expect(s.tray.length).toBe(3);
      for (const p of s.tray) {
        expect(p.shape.length).toBeGreaterThanOrEqual(2);
        expect(p.shape.length).toBeLessThanOrEqual(5);
        expect(sameShape(normaliseShape(p.shape), p.shape)).toBe(true);
      }
      expect(anyPieceFits(s.cells, s.owner, s.tray)).toBe(true);
      expect(findPlacement(s)).not.toBeNull();
    }
  });

  it('respects config duration and is not over at start', () => {
    const s = def.init(3, { durationMs: 60000 });
    expect(s.durationMs).toBe(60000);
    expect(s.over).toBe(false);
    expect(s.points).toBe(0);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('carpentry: rotate / flip', () => {
  it('rotates the tray piece and returns the same reference for a symmetric piece', () => {
    const base = def.init(11);
    const s = craft(base, [at('U5', 1, 1)], [{ kind: 'O4', shape: shape('O4') }, { kind: 'L3', shape: shape('L3') }, { kind: 'I2', shape: shape('I2') }]);
    expect(def.reduce(s, { type: 'rotate', slot: 0 })).toBe(s);
    expect(def.reduce(s, { type: 'flip', slot: 0 })).toBe(s);
    const r = def.reduce(s, { type: 'rotate', slot: 2 });
    expect(r).not.toBe(s);
    expect(r.tray[2]!.shape).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
    expect(r.tray[0]).toBe(s.tray[0]);
    const f = def.reduce(s, { type: 'flip', slot: 1 });
    expect(f.tray[1]!.shape).toEqual(flipShape(shape('L3')));
    expect(f.rng).toEqual(s.rng);
  });

  it('ignores invalid slots', () => {
    const s = def.init(11);
    expect(def.reduce(s, { type: 'rotate', slot: 3 })).toBe(s);
    expect(def.reduce(s, { type: 'flip', slot: -1 })).toBe(s);
    expect(def.reduce(s, { type: 'rotate', slot: 1.5 })).toBe(s);
  });
});

describe('carpentry: placement', () => {
  it('places a fitting piece, fills cells, refills the slot and keeps the hull valid', () => {
    for (let seed = 1; seed < 30; seed++) {
      let s = def.init(seed);
      const p = findPlacement(s)!;
      expect(p).not.toBeNull();
      for (const a of p.pre) s = def.reduce(s, a);
      const before = s;
      const piece = before.tray[p.slot]!;
      const n = def.reduce(before, { type: 'place', slot: p.slot, x: p.x, y: p.y });
      expect(n).not.toBe(before);
      expect(n.placeSeq).toBe(before.placeSeq + 1);
      expect(n.lastPlaced.length).toBe(piece.shape.length);
      const hid = before.owner[idx(p.x + piece.shape[0]!.x, p.y + piece.shape[0]!.y)]!;
      const stillOpen = n.holes.some((h) => h.id === hid);
      for (const c of piece.shape) {
        const k = idx(p.x + c.x, p.y + c.y);
        expect(before.cells[k]).toBe('hole');
        expect(before.owner[k]).toBe(hid);
        if (stillOpen) expect(n.cells[k]).toBe('filled');
        else expect(n.owner[k]).not.toBe(hid); // completed: hull again (maybe re-carved)
      }
      if (stillOpen) expect(n.holes.find((h) => h.id === hid)!.filled).toBe(before.holes.find((h) => h.id === hid)!.filled + piece.shape.length);
      expect(n.tray[p.slot]).not.toBe(piece);
      for (let i = 0; i < 3; i++) if (i !== p.slot) expect(n.tray[i]).toBe(before.tray[i]);
      expect(n.rng).not.toEqual(before.rng);
      assertHullValid(n);
      expect(n.holes.length).toBe(3);
    }
  });

  it('rejects placements on solid, filled, out-of-bounds or multi-hole cells (same reference)', () => {
    const base = def.init(5);
    const o4 = { kind: 'O4', shape: shape('O4') };
    const i2 = { kind: 'I2', shape: shape('I2') };
    // two holes separated by one solid column: (1,1)-(2,2) block and (4,1)-(5,2) block
    const s = craft(base, [at('O4', 1, 1), at('O4', 4, 1)], [o4, i2, i2]);
    expect(def.reduce(s, { type: 'place', slot: 0, x: 0, y: 0 })).toBe(s); // overlaps solid
    expect(def.reduce(s, { type: 'place', slot: 0, x: 9, y: 9 })).toBe(s); // out of bounds
    expect(def.reduce(s, { type: 'place', slot: 1, x: 2, y: 1 })).toBe(s); // (2,1) hole + (3,1) solid
    expect(def.reduce(s, { type: 'place', slot: 1, x: -1, y: 1 })).toBe(s);
    expect(def.reduce(s, { type: 'place', slot: 5, x: 1, y: 1 })).toBe(s);
    expect(def.reduce(s, { type: 'place', slot: 0, x: 1.5, y: 1 })).toBe(s);
    // bridging two holes: a 4-wide hole pair with a touching gap is impossible by construction,
    // so build adjacent-looking holes with distinct owners manually
    const bridged: State = { ...s };
    const cells = bridged.cells.slice();
    const owner = bridged.owner.slice();
    cells[idx(3, 1)] = 'hole';
    owner[idx(3, 1)] = s.holes[1]!.id;
    const t = { ...bridged, cells, owner };
    expect(def.reduce(t, { type: 'place', slot: 1, x: 2, y: 1 })).toBe(t); // (2,1) hole A, (3,1) hole B
    // filled cells cannot be re-covered
    const placed = def.reduce(s, { type: 'place', slot: 1, x: 1, y: 1 });
    expect(placed.cells[idx(1, 1)]).toBe('filled');
    expect(placed.cells[idx(2, 1)]).toBe('filled');
    expect(def.reduce(placed, { type: 'place', slot: 2, x: 1, y: 1 })).toBe(placed);
    expect(placed.holes[0]!.filled).toBe(2);
  });

  it('unknown action types are no-ops', () => {
    const s = def.init(2);
    expect(def.reduce(s, { type: 'nope' } as unknown as Action)).toBe(s);
  });
});

describe('carpentry: completion and scoring', () => {
  it('scores a completed hole with the perfect bonus, solidifies it and carves a replacement', () => {
    const base = def.init(21);
    const t4 = { kind: 'T4', shape: shape('T4') };
    const i2 = { kind: 'I2', shape: shape('I2') };
    const s = craft(base, [at('T4', 2, 2)], [t4, i2, i2]);
    expect(holeScore(4, true)).toBe(27);
    const n = def.reduce(s, { type: 'place', slot: 0, x: 2, y: 2 });
    expect(n.points).toBe(27);
    expect(n.completedHoles).toBe(1);
    expect(n.clearSeq).toBe(1);
    expect(n.lastCompletedPerfect).toBe(true);
    expect(n.lastCompleted).toEqual(s.holes[0]!.cells);
    expect(n.lastCompletedAt).toBe(s.elapsedMs);
    for (const p of s.holes[0]!.cells) {
      // patched cells are hull again (the replacement hole may legitimately be carved over them)
      expect(n.cells[idx(p.x, p.y)]).not.toBe('filled');
      expect(n.owner[idx(p.x, p.y)]).not.toBe(s.holes[0]!.id);
    }
    expect(n.holes.some((h) => h.id === s.holes[0]!.id)).toBe(false);
    expect(n.holes.length).toBe(3); // topped back up to three active holes
    assertHullValid(n);
    expect(n.rate).toBeGreaterThan(0);
    expect(def.score(n).performance).toBeGreaterThan(def.score(s).performance);
  });

  it('drops the perfect bonus once a discard happened while the hole was open', () => {
    const base = def.init(22);
    const t4 = { kind: 'T4', shape: shape('T4') };
    const i2 = { kind: 'I2', shape: shape('I2') };
    const s = craft(base, [at('T4', 2, 2)], [t4, i2, i2]);
    const d = def.reduce(s, { type: 'discard', slot: 1 });
    expect(d.holes[0]!.perfect).toBe(false);
    const n = def.reduce(d, { type: 'place', slot: 0, x: 2, y: 2 });
    expect(holeScore(4, false)).toBe(18);
    expect(n.points).toBe(18);
    expect(n.lastCompletedPerfect).toBe(false);
    // the replacement hole carved afterwards starts perfect again
    for (const h of n.holes) expect(h.perfect).toBe(true);
  });

  it('completes a hole across several placements', () => {
    const base = def.init(23);
    const i2 = { kind: 'I2', shape: shape('I2') };
    const l3 = { kind: 'L3', shape: shape('L3') };
    // hole = 2x2 at (4,4) + cell (4,6)? keep it simple: a 1x4 column at x=4, y=3..6
    const col = [{ x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }];
    let s = craft(base, [col], [i2, l3, i2]);
    s = def.reduce(s, { type: 'rotate', slot: 0 }); // vertical domino
    const a = def.reduce(s, { type: 'place', slot: 0, x: 4, y: 3 });
    expect(a.holes[0]!.filled).toBe(2);
    expect(a.completedHoles).toBe(0);
    expect(a.points).toBe(0);
    let b = def.reduce(a, { type: 'rotate', slot: 2 });
    b = def.reduce(b, { type: 'place', slot: 2, x: 4, y: 5 });
    expect(b.completedHoles).toBe(1);
    expect(b.points).toBe(holeScore(4, true));
  });
});

describe('carpentry: rough patches', () => {
  it('closes a hole without bonus when its remainder can never be tiled', () => {
    const base = def.init(24);
    const l3 = { kind: 'L3', shape: shape('L3') };
    const i2 = { kind: 'I2', shape: shape('I2') };
    // 2x2 hole at (3,3); placing an L3 leaves one lone cell -> rough patch
    const s = craft(base, [at('O4', 3, 3)], [l3, i2, i2]);
    expect(holeStuck(s.cells, s.owner, s.holes[0]!)).toBe(false);
    const n = def.reduce(s, { type: 'place', slot: 0, x: 3, y: 3 });
    expect(n.completedHoles).toBe(1);
    expect(n.roughPatches).toBe(1);
    expect(n.lastCompletedPerfect).toBe(false);
    expect(n.points).toBe(holeScore(4, false));
    expect(n.holes.some((h) => h.id === s.holes[0]!.id)).toBe(false);
    expect(n.cells[idx(4, 3)]).not.toBe('filled');
    assertHullValid(n);
  });

  it('does not close a hole whose remainder still takes a piece', () => {
    const base = def.init(25);
    const i3 = { kind: 'I3', shape: shape('I3') };
    const row = [0, 1, 2, 3, 4].map((x) => ({ x: x + 2, y: 5 }));
    const s = craft(base, [row], [i3, i3, i3]);
    const n = def.reduce(s, { type: 'place', slot: 0, x: 2, y: 5 });
    expect(n.completedHoles).toBe(0);
    expect(n.holes[0]!.filled).toBe(3);
    expect(holeStuck(n.cells, n.owner, n.holes[0]!)).toBe(false);
  });
});

describe('carpentry: discard', () => {
  it('costs points (floored at zero), refills the slot and counts', () => {
    const s = def.init(31);
    const d = def.reduce(s, { type: 'discard', slot: 2 });
    expect(d).not.toBe(s);
    expect(d.points).toBe(0);
    expect(d.discards).toBe(1);
    expect(d.tray[2]).not.toBe(s.tray[2]);
    expect(d.tray[0]).toBe(s.tray[0]);
    expect(d.tray[1]).toBe(s.tray[1]);
    expect(d.rng).not.toEqual(s.rng);
    for (const h of d.holes) expect(h.perfect).toBe(false);
    const rich = { ...s, points: 10 };
    expect(def.reduce(rich, { type: 'discard', slot: 0 }).points).toBe(10 - DISCARD_COST);
    expect(def.reduce(s, { type: 'discard', slot: 3 })).toBe(s);
  });

  it('is always available and keeps offering a fitting piece', () => {
    let s = def.init(32);
    for (let i = 0; i < 15; i++) {
      s = def.reduce(s, { type: 'discard', slot: i % 3 });
      expect(anyPieceFits(s.cells, s.owner, s.tray)).toBe(true);
    }
    expect(s.discards).toBe(15);
  });
});

describe('carpentry: tick, sea pressure and game over', () => {
  it('advances elapsedMs and ends at durationMs', () => {
    const s = def.init(41, { durationMs: 30000 });
    const a = def.tick(s, 29999);
    expect(a.elapsedMs).toBe(29999);
    expect(a.over).toBe(false);
    const b = def.tick(a, 1);
    expect(b.over).toBe(true);
    expect(def.isOver(b)).toBe(true);
    expect(def.tick(b, 1000)).toBe(b);
    expect(def.reduce(b, { type: 'discard', slot: 0 })).toBe(b);
    expect(def.reduce(b, { type: 'rotate', slot: 0 })).toBe(b);
    expect(def.tick(s, 0)).toBe(s);
  });

  it('adds a small hole every 25 seconds while fewer than five are open', () => {
    const s = def.init(42);
    const a = def.tick(s, SEA_INTERVAL_MS - 1);
    expect(a.holes.length).toBe(3);
    expect(a.seaSeq).toBe(0);
    const b = def.tick(a, 1);
    expect(b.seaSeq).toBe(1);
    expect(b.holes.length).toBe(4);
    const newest = b.holes[3]!;
    expect(newest.cells.length).toBeGreaterThanOrEqual(3);
    expect(newest.cells.length).toBeLessThanOrEqual(5);
    expect(newest.bornAt).toBe(SEA_INTERVAL_MS);
    expect(b.lastSea).toEqual(newest.cells);
    assertHullValid(b);
    const c = def.tick(b, SEA_INTERVAL_MS);
    expect(c.holes.length).toBe(5);
    assertHullValid(c);
    // at five holes the sea widens an existing one instead
    const d = def.tick(c, SEA_INTERVAL_MS);
    expect(d.seaSeq).toBe(3);
    expect(d.holes.length).toBe(5);
    expect(openCells(d)).toBeGreaterThan(openCells(c));
    expect(d.lastSea.length).toBeGreaterThanOrEqual(2);
    assertHullValid(d);
  });

  it('breaches (game over) when open hole cells exceed the limit', () => {
    const base = def.init(43);
    // one giant 5x9 hole = 45 cells (exactly at the limit, not breached)
    const big: Pt[] = [];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 5; x++) big.push({ x, y });
    const i2 = { kind: 'I2', shape: shape('I2') };
    const s = craft(base, [big], [i2, i2, i2]);
    expect(openCells(s)).toBe(BREACH_CELLS);
    const a = def.tick(s, 1000);
    expect(a.over).toBe(false);
    // the next sea event carves a new hole on the right and pushes it over
    const b = def.tick(a, SEA_INTERVAL_MS);
    expect(openCells(b)).toBeGreaterThan(BREACH_CELLS);
    expect(b.over).toBe(true);
    expect(b.breached).toBe(true);
    expect(def.isOver(b)).toBe(true);
    expect(def.reduce(b, { type: 'place', slot: 0, x: 0, y: 0 })).toBe(b);
  });

  it('is split/merge invariant across sea events', () => {
    const s = def.init(44);
    const one = def.tick(s, 60000);
    let many = s;
    for (let i = 0; i < 60; i++) many = def.tick(many, 1000);
    expect(many).toEqual(one);
    let odd = s;
    for (const dt of [7, 25000 - 7, 333, 12000, 667, 12000, 10000]) odd = def.tick(odd, dt);
    expect(odd).toEqual(one);
  });

  it('decays performance while idle', () => {
    const base = def.init(45);
    const t4 = { kind: 'T4', shape: shape('T4') };
    const i2 = { kind: 'I2', shape: shape('I2') };
    const s = craft(base, [at('T4', 2, 2), at('T4', 6, 2), at('T4', 2, 6)], [t4, i2, i2]);
    const done = def.reduce(s, { type: 'place', slot: 0, x: 2, y: 2 });
    const p0 = def.score(done).performance;
    expect(p0).toBeGreaterThan(0);
    const later = def.tick(done, 20000);
    const p1 = def.score(later).performance;
    expect(p1).toBeLessThan(p0);
    expect(def.score(later).label).toBeTypeOf('string');
    expect(def.score(s).performance).toBe(0);
  });

  it('sustained good play approaches top performance', () => {
    const base = def.init(46);
    const t4 = { kind: 'T4', shape: shape('T4') };
    let s = craft(base, [at('T4', 2, 2)], [t4, t4, t4]);
    // repeatedly: ensure a T4 hole exists at (2,2), place a T4 every second
    for (let i = 0; i < 60; i++) {
      s = craft(s, [at('T4', 2, 2)], [t4, t4, t4]);
      s = def.reduce(s, { type: 'place', slot: 0, x: 2, y: 2 });
      s = def.tick(s, 1000);
    }
    // 27 pts/s is far above target; penalty is small with few open cells
    expect(def.score(s).performance).toBeGreaterThan(0.9);
    expect(def.score(s).points).toBe(27 * 60);
  });
});

describe('carpentry: determinism', () => {
  it('replaying a log reproduces the exact same state', () => {
    for (const seed of [1, 99, 12345]) {
      const { log, end } = drive(seed, 80);
      const a = replay(def, seed, undefined, log, end);
      const b = replay(def, seed, undefined, log, end);
      expect(a).toEqual(b);
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      assertHullValid(a);
      expect(a.points).toBeGreaterThan(0);
      expect(a.completedHoles).toBeGreaterThan(0);
    }
  });

  it('different seeds diverge', () => {
    const { log, end } = drive(5, 40);
    const a = replay(def, 5, undefined, log, end);
    const b = replay(def, 6, undefined, log, end);
    expect(a).not.toEqual(b);
  });
});
