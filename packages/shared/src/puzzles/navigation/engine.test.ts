import { describe, expect, it } from 'vitest';
import { replay, type LogEntry } from '../types';
import { def, computeLit, reachedStar, rotateMask, openingCount, N, E, S, W, HELM_X, NAV_W, NAV_H, MAX_LOCKED, type Action, type State } from './engine';

function rotate(x: number, y: number, dir: 1 | -1 = 1): Action {
  return { type: 'rotate', x, y, dir };
}

function litCount(s: State): number {
  return s.lit.flat().filter(Boolean).length;
}

/** Greedy deterministic move: completes a course if one rotation can, else grows the lit set, else pseudo-random. */
function greedyMove(s: State, k: number): { a: Action; k: number } {
  let best: { a: Action; lit: number } | null = null;
  for (let y = 0; y < NAV_H; y++) {
    for (let x = 0; x < NAV_W; x++) {
      for (const dir of [1, -1] as const) {
        const a = rotate(x, y, dir);
        const next = def.reduce(s, a);
        if (next === s) continue;
        if (next.courseSeq > s.courseSeq) return { a, k };
        const l = litCount(next);
        if (!best || l > best.lit) best = { a, lit: l };
      }
    }
  }
  if (best && best.lit > litCount(s)) return { a: best.a, k };
  k = (k * 1103515245 + 12345) >>> 0;
  return { a: rotate((k >>> 8) % NAV_W, (k >>> 16) % NAV_H, (k & 1) ? 1 : -1), k };
}

/** Plays greedily until a course completes. */
function findCourse(seed: number, maxMoves = 2000): { before: State; after: State; action: Action } | null {
  let s = def.init(seed);
  let k = seed;
  for (let i = 0; i < maxMoves; i++) {
    const m = greedyMove(s, k);
    k = m.k;
    const next = def.reduce(s, m.a);
    if (next.courseSeq > s.courseSeq) return { before: s, after: next, action: m.a };
    s = next;
  }
  return null;
}

function anyStarReached(s: State): boolean {
  return reachedStar(s, computeLit(s.tiles, s.w, s.h)) >= 0;
}

describe('navigation: masks', () => {
  it('rotates clockwise and counter-clockwise', () => {
    expect(rotateMask(N, 1)).toBe(E);
    expect(rotateMask(E, 1)).toBe(S);
    expect(rotateMask(S, 1)).toBe(W);
    expect(rotateMask(W, 1)).toBe(N);
    expect(rotateMask(N, -1)).toBe(W);
    expect(rotateMask(W, -1)).toBe(S);
    expect(rotateMask(N | E, 1)).toBe(E | S);
    expect(rotateMask(N | S, 1)).toBe(E | W);
    expect(rotateMask(N | E | S | W, 1)).toBe(15);
  });
  it('four CW rotations is identity; CW then CCW is identity', () => {
    for (let m = 0; m < 16; m++) {
      let r = m;
      for (let i = 0; i < 4; i++) r = rotateMask(r, 1);
      expect(r).toBe(m);
      expect(rotateMask(rotateMask(m, 1), -1)).toBe(m);
    }
  });
  it('openingCount counts bits', () => {
    expect(openingCount(0)).toBe(0);
    expect(openingCount(N | S)).toBe(2);
    expect(openingCount(15)).toBe(4);
  });
});

describe('navigation: init', () => {
  it('creates a 7x7 chart with valid tiles and stars', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const s = def.init(seed);
      expect(s.w).toBe(7);
      expect(s.h).toBe(7);
      expect(s.tiles).toHaveLength(7);
      for (const row of s.tiles) {
        expect(row).toHaveLength(7);
        for (const t of row) {
          const n = openingCount(t.mask);
          expect(n).toBeGreaterThanOrEqual(2);
          expect(n).toBeLessThanOrEqual(4);
        }
      }
      expect(s.stars.length).toBeGreaterThanOrEqual(2);
      expect(s.stars.length).toBeLessThanOrEqual(3);
      expect(new Set(s.stars).size).toBe(s.stars.length);
      expect(s.starValues).toHaveLength(s.stars.length);
      for (const c of s.stars) expect(c >= 0 && c < NAV_W).toBe(true);
      for (const v of s.starValues) expect(v >= 1 && v <= 3).toBe(true);
      expect(s.fog).toBe(0);
      expect(s.points).toBe(0);
      expect(s.over).toBe(false);
      expect(s.elapsedMs).toBe(0);
    }
  });

  it('is deterministic for the same seed and differs across seeds', () => {
    expect(def.init(7)).toEqual(def.init(7));
    expect(JSON.stringify(def.init(7).tiles)).not.toBe(JSON.stringify(def.init(8).tiles));
  });

  it('never starts with a completed course', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const difficulty of [0, 0.4, 1]) {
        const s = def.init(seed, { difficulty });
        expect(anyStarReached(s)).toBe(false);
        expect(s.lit).toEqual(computeLit(s.tiles, s.w, s.h));
      }
    }
  });

  it('has no locked tiles at default difficulty, at most 3 at high difficulty, none near the helm', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const easy = def.init(seed, { difficulty: 0.4 });
      expect(easy.tiles.flat().filter((t) => t.locked)).toHaveLength(0);
      const hard = def.init(seed, { difficulty: 1 });
      const locked = hard.tiles.flat().filter((t) => t.locked);
      expect(locked.length).toBeLessThanOrEqual(MAX_LOCKED);
      for (let y = 0; y < NAV_H; y++) {
        for (let x = 0; x < NAV_W; x++) {
          if (hard.tiles[y]![x]!.locked) {
            expect(Math.abs(x - HELM_X) + Math.abs(y - (NAV_H - 1))).toBeGreaterThan(1);
          }
        }
      }
    }
    let anyLocked = false;
    for (let seed = 1; seed <= 100; seed++) if (def.init(seed, { difficulty: 1 }).tiles.flat().some((t) => t.locked)) anyLocked = true;
    expect(anyLocked).toBe(true);
  });

  it('uses more straights at low difficulty than high', () => {
    let lo = 0;
    let hi = 0;
    for (let seed = 1; seed <= 60; seed++) {
      lo += def.init(seed, { difficulty: 0 }).tiles.flat().filter((t) => t.mask === (N | S) || t.mask === (E | W)).length;
      hi += def.init(seed, { difficulty: 1 }).tiles.flat().filter((t) => t.mask === (N | S) || t.mask === (E | W)).length;
    }
    expect(lo).toBeGreaterThan(hi);
  });

  it('is plain JSON', () => {
    const s = def.init(5);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('navigation: connectivity', () => {
  const mk = (rows: number[][]) => rows.map((r) => r.map((mask) => ({ mask, locked: false })));

  it('requires the helm tile to open south', () => {
    const tiles = mk(Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => N | E)));
    tiles[6]![HELM_X] = { mask: N | E, locked: false };
    expect(computeLit(tiles, 7, 7).flat().some(Boolean)).toBe(false);
    tiles[6]![HELM_X] = { mask: N | S, locked: false };
    expect(computeLit(tiles, 7, 7)[6]![HELM_X]).toBe(true);
  });

  it('only lights neighbours with a reciprocal opening', () => {
    const tiles = mk(Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => E | W)));
    // Vertical column of straights up from the helm.
    for (let y = 0; y < 7; y++) tiles[y]![HELM_X] = { mask: N | S, locked: false };
    let lit = computeLit(tiles, 7, 7);
    for (let y = 0; y < 7; y++) expect(lit[y]![HELM_X]).toBe(true);
    // Neighbours are E|W straights: they face us but we don't open to them.
    expect(lit[6]![HELM_X + 1]).toBe(false);
    // A tee at the bottom opens east but the east neighbour must open west.
    tiles[6]![HELM_X] = { mask: N | S | E, locked: false };
    tiles[6]![HELM_X + 1] = { mask: N | S, locked: false }; // no W opening
    lit = computeLit(tiles, 7, 7);
    expect(lit[6]![HELM_X + 1]).toBe(false);
    tiles[6]![HELM_X + 1] = { mask: W | N, locked: false };
    lit = computeLit(tiles, 7, 7);
    expect(lit[6]![HELM_X + 1]).toBe(true);
    // Break the column halfway: tiles above the gap go dark.
    tiles[3]![HELM_X] = { mask: E | W, locked: false };
    lit = computeLit(tiles, 7, 7);
    expect(lit[4]![HELM_X]).toBe(true);
    expect(lit[3]![HELM_X]).toBe(false);
    expect(lit[2]![HELM_X]).toBe(false);
  });

  it('reachedStar requires a lit top tile opening north and prefers the higher value', () => {
    const tiles = mk(Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => E | W)));
    for (let y = 0; y < 7; y++) tiles[y]![HELM_X] = { mask: N | S, locked: false };
    const lit = computeLit(tiles, 7, 7);
    expect(reachedStar({ tiles, stars: [HELM_X], starValues: [2] }, lit)).toBe(0);
    expect(reachedStar({ tiles, stars: [0, HELM_X], starValues: [3, 2] }, lit)).toBe(1);
    tiles[0]![HELM_X] = { mask: S | E, locked: false }; // lit but no north opening
    const lit2 = computeLit(tiles, 7, 7);
    expect(lit2[0]![HELM_X]).toBe(true);
    expect(reachedStar({ tiles, stars: [HELM_X], starValues: [2] }, lit2)).toBe(-1);
    // Two reachable stars: pick the higher value.
    for (let y = 0; y < 7; y++) {
      tiles[y]![HELM_X] = { mask: N | S | E, locked: false };
      tiles[y]![HELM_X + 1] = { mask: N | S | W, locked: false };
    }
    const lit3 = computeLit(tiles, 7, 7);
    expect(reachedStar({ tiles, stars: [HELM_X, HELM_X + 1], starValues: [1, 3] }, lit3)).toBe(1);
    expect(reachedStar({ tiles, stars: [HELM_X, HELM_X + 1], starValues: [3, 1] }, lit3)).toBe(0);
  });
});

describe('navigation: reduce', () => {
  it('rotates the target tile and recomputes lit', () => {
    const s0 = def.init(11);
    const before = s0.tiles[2]![4]!.mask;
    const s1 = def.reduce(s0, rotate(4, 2, 1));
    expect(s1).not.toBe(s0);
    expect(s1.tiles[2]![4]!.mask).toBe(rotateMask(before, 1));
    expect(s1.moves).toBe(1);
    expect(s1.lit).toEqual(computeLit(s1.tiles, 7, 7));
    // Other tiles untouched, original state not mutated.
    expect(s0.tiles[2]![4]!.mask).toBe(before);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (x !== 4 || y !== 2) expect(s1.tiles[y]![x]).toEqual(s0.tiles[y]![x]);
    const s2 = def.reduce(s1, rotate(4, 2, -1));
    expect(s2.tiles[2]![4]!.mask).toBe(before);
  });

  it('is a no-op (same reference) for out-of-range, malformed, or over states', () => {
    const s = def.init(3);
    expect(def.reduce(s, rotate(-1, 0))).toBe(s);
    expect(def.reduce(s, rotate(7, 0))).toBe(s);
    expect(def.reduce(s, rotate(0, 7))).toBe(s);
    expect(def.reduce(s, rotate(1.5, 0))).toBe(s);
    expect(def.reduce(s, { type: 'rotate', x: 0, y: 0, dir: 2 as unknown as 1 })).toBe(s);
    expect(def.reduce(s, { type: 'nope' } as unknown as Action)).toBe(s);
    const over = def.tick(s, s.durationMs);
    expect(over.over).toBe(true);
    expect(def.reduce(over, rotate(0, 0))).toBe(over);
  });

  it('rotating a locked tile is a no-op', () => {
    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const s = def.init(seed, { difficulty: 1 });
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          if (s.tiles[y]![x]!.locked) {
            expect(def.reduce(s, rotate(x, y, 1))).toBe(s);
            expect(def.reduce(s, rotate(x, y, -1))).toBe(s);
            found = true;
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it('rotating a cross is a no-op (nothing changes)', () => {
    const s = def.init(5);
    const tiles = s.tiles.map((r) => r.slice());
    tiles[1]![1] = { mask: 15, locked: false };
    const s2: State = { ...s, tiles, lit: computeLit(tiles, 7, 7) };
    expect(def.reduce(s2, rotate(1, 1, 1))).toBe(s2);
  });

  it('completes a course: scores, replaces lit tiles, re-rolls stars, clears fog', () => {
    let seen = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const r = findCourse(seed, 800);
      if (!r) continue;
      seen++;
      const { before, after, action } = r;
      // Simulate the rotation in isolation to learn the course.
      const tiles = before.tiles.map((row) => row.slice());
      const t = tiles[action.y]![action.x]!;
      tiles[action.y]![action.x] = { mask: rotateMask(t.mask, action.dir), locked: false };
      const lit = computeLit(tiles, 7, 7);
      const idx = reachedStar({ tiles, stars: before.stars, starValues: before.starValues }, lit);
      expect(idx).toBeGreaterThanOrEqual(0);
      const litCount = lit.flat().filter(Boolean).length;
      const gained = 4 * before.starValues[idx]! + litCount;

      expect(after.courseSeq).toBe(before.courseSeq + 1);
      expect(after.points).toBe(before.points + gained);
      expect(after.lastCourse).not.toBeNull();
      expect(after.lastCourse!.star).toBe(before.stars[idx]);
      expect(after.lastCourse!.starValue).toBe(before.starValues[idx]);
      expect(after.lastCourse!.points).toBe(gained);
      expect(after.lastCourse!.cells).toHaveLength(litCount);
      for (const [x, y] of after.lastCourse!.cells) expect(lit[y]![x]).toBe(true);
      // Unlit tiles are unchanged; the chart has no completed course afterwards.
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (!lit[y]![x]) expect(after.tiles[y]![x]).toEqual(tiles[y]![x]);
      expect(anyStarReached(after)).toBe(false);
      expect(after.lit).toEqual(computeLit(after.tiles, 7, 7));
      expect(after.stars.length).toBeGreaterThanOrEqual(2);
      expect(after.fogMs).toBeLessThanOrEqual(before.fogMs);
      expect(after.windowPts).toBe(before.windowPts + gained);
    }
    expect(seen).toBeGreaterThanOrEqual(5);
  }, 30000);

  it('a course clears fog by 0.35', () => {
    const r = findCourse(1);
    expect(r).not.toBeNull();
    const { before, action } = r!;
    const foggy = def.tick(before, Math.round(before.fogFillMs * 0.8));
    expect(foggy.fog).toBeCloseTo(0.8, 5);
    const after = def.reduce(foggy, action);
    expect(after.courseSeq).toBe(1);
    expect(after.fog).toBeCloseTo(0.45, 2);
  });

  it('never leaves a completed course on the board after any rotate', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = def.init(seed, { difficulty: seed % 2 ? 0.4 : 0.9 });
      let k = seed * 7919;
      for (let i = 0; i < 300; i++) {
        k = (k * 1103515245 + 12345) >>> 0;
        s = def.reduce(s, rotate((k >>> 8) % NAV_W, (k >>> 16) % NAV_H, (k & 1) ? 1 : -1));
        expect(anyStarReached(s)).toBe(false);
      }
    }
  });
});

describe('navigation: tick & scoring', () => {
  it('advances elapsed and fog; fills in ~45s at difficulty 0.4', () => {
    const s = def.init(9, { difficulty: 0.4 });
    expect(s.fogFillMs).toBe(45000);
    const s1 = def.tick(s, 1000);
    expect(s1.elapsedMs).toBe(1000);
    expect(s1.fog).toBeCloseTo(1000 / 45000, 8);
    expect(def.tick(s, 0)).toBe(s);
  });

  it('fog reaching 1.0 ends the game (fog game-over)', () => {
    const s = def.init(9, { difficulty: 0.4 });
    const almost = def.tick(s, s.fogFillMs - 1);
    expect(almost.over).toBe(false);
    expect(almost.fog).toBeLessThan(1);
    const lost = def.tick(almost, 1);
    expect(lost.over).toBe(true);
    expect(lost.fog).toBe(1);
    expect(def.isOver(lost)).toBe(true);
    expect(def.tick(lost, 1000)).toBe(lost);
    // Elapsed does not run past the moment of loss.
    const big = def.tick(s, 1_000_000);
    expect(big.over).toBe(true);
    expect(big.elapsedMs).toBe(s.fogFillMs);
  });

  it('ends at durationMs', () => {
    const s = def.init(2, { durationMs: 20000, difficulty: 0 });
    const a = def.tick(s, 19999);
    expect(a.over).toBe(false);
    const b = def.tick(a, 1);
    expect(b.over).toBe(true);
    expect(b.elapsedMs).toBe(20000);
  });

  it('split ticks equal merged ticks', () => {
    for (const seed of [1, 2, 3]) {
      const s = def.init(seed);
      const merged = def.tick(s, 5000);
      let split = s;
      for (let i = 0; i < 5; i++) split = def.tick(split, 1000);
      expect(split).toEqual(merged);
      let odd = s;
      for (const d of [333, 1, 2666, 700, 1300]) odd = def.tick(odd, d);
      expect(odd).toEqual(merged);
    }
  });

  it('split ticks interleaved with actions equal merged (replay)', () => {
    const r = findCourse(4)!;
    expect(r).not.toBeNull();
    const log: LogEntry<Action>[] = [
      { at: 1234, a: rotate(0, 0, 1) },
      { at: 4567, a: rotate(0, 0, -1) },
      { at: 9000, a: r.action },
    ];
    // Build the same thing manually with odd tick sizes.
    let s = def.init(4);
    s = def.tick(s, 1000);
    s = def.tick(s, 234);
    s = def.reduce(s, rotate(0, 0, 1));
    s = def.tick(s, 3333);
    s = def.reduce(s, rotate(0, 0, -1));
    s = def.tick(s, 4433);
    s = def.reduce(s, r.action);
    s = def.tick(s, 1000);
    s = def.tick(s, 2000);
    const replayed = replay(def, 4, undefined, log, 12000);
    expect(replayed).toEqual(s);
  });

  it('determinism: same seed + same log => deep-equal state', () => {
    // Build a log by greedy play so courses actually complete.
    const log: LogEntry<Action>[] = [];
    let s = def.init(123, { difficulty: 0.7 });
    let k = 77;
    for (let i = 0; i < 200; i++) {
      s = def.tick(s, 300);
      const m = greedyMove(s, k);
      k = m.k;
      log.push({ at: (i + 1) * 300, a: m.a });
      s = def.reduce(s, m.a);
    }
    const a = replay(def, 123, { difficulty: 0.7 }, log, 70000);
    const b = replay(def, 123, { difficulty: 0.7 }, log, 70000);
    expect(a).toEqual(b);
    expect(a.points).toBeGreaterThan(0);
    expect(a.courseSeq).toBeGreaterThan(0);
  });

  it('performance rises with scoring and decays when idle; fog penalises', () => {
    const r = findCourse(1)!;
    let s = r.before;
    expect(def.score(s).performance).toBe(0);
    // Score a few courses quickly (replay the same completing rotation on fresh boards isn't
    // possible, so simulate by injecting windowPts through a scored state).
    s = r.after;
    expect(s.points).toBeGreaterThan(0);
    s = def.tick(s, 1000);
    const p1 = def.score(s).performance;
    expect(p1).toBeGreaterThan(0);
    expect(def.score(s).label).toBeTypeOf('string');
    // Idle 20s: noticeably lower.
    const idle = def.tick(s, 20000);
    expect(def.score(idle).performance).toBeLessThan(p1 * 0.6);
    // Fog penalty: a foggy state with the same perf scores lower.
    const foggy: State = { ...s, fog: 0.9 };
    expect(def.score(foggy).performance).toBeLessThan(def.score(s).performance);
    // Sustained 2.5 pts/s converges near 1.0.
    let sustained = def.init(1);
    for (let i = 0; i < 120; i++) {
      sustained = { ...sustained, windowPts: sustained.windowPts + 2.5 };
      sustained = def.tick(sustained, 1000);
      // keep fog clear so the penalty doesn't apply
      sustained = { ...sustained, fogMs: 0, fog: 0 };
    }
    expect(def.score(sustained).performance).toBeGreaterThan(0.95);
    expect(def.score(sustained).performance).toBeLessThanOrEqual(1);
  }, 20000);

  it('score reports points', () => {
    const r = findCourse(2)!;
    expect(def.score(r.after).points).toBe(r.after.points);
    expect(r.after.points).toBeGreaterThanOrEqual(4 + 1);
  });

  it('registers with the puzzle registry', async () => {
    const mod = await import('./index');
    const { getPuzzle } = await import('../index');
    expect(getPuzzle('navigation').id).toBe('navigation');
    expect(mod.def.name).toBe('Navigation');
  });
});
