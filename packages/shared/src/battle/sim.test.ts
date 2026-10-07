import { describe, expect, it } from 'vitest';
import { rngFromSeed } from '../rng';
import { createBattle, npcOrders, resolveTurn, grantTokens, sanitizeOrders } from './sim';
import { emptyOrders } from './types';

const specs = [
  { id: 'a', name: 'Alpha', type: 'sloop', npc: false, side: 0 as const, hull: 60, maxHull: 60, cannons: 2, loaded: 4, crew: ['p1'], sprite: 0 },
  { id: 'b', name: 'Bravo', type: 'sloop', npc: true, side: 1 as const, hull: 60, maxHull: 60, cannons: 2, loaded: 4, crew: [], sprite: 0 },
];

describe('sea battle sim', () => {
  it('creates a deterministic board', () => {
    const [, s1] = createBattle('x', specs, rngFromSeed(7), 0, 20000);
    const [, s2] = createBattle('x', specs, rngFromSeed(7), 0, 20000);
    expect(s1).toEqual(s2);
    expect(s1.rocks.length).toBeGreaterThan(0);
    expect(s1.ships[0]!.heading).toBe(0);
  });

  it('moves forward with F tokens and spends them', () => {
    let [, s] = createBattle('x', specs, rngFromSeed(1), 0, 20000);
    s.ships = s.ships.map((sh) => grantTokens(sh, 1, 0, 4));
    const o = emptyOrders();
    o.moves = ['F', 'F', null, null];
    s.ships[0]!.orders = o;
    const before = s.ships[0]!.cell;
    const n = resolveTurn(s, 1000, 5000);
    const after = n.ships[0]!;
    expect(after.cell.r).toBe(before.r - 2);
    expect(after.tokens.F).toBe(s.ships[0]!.tokens.F - 2);
    expect(n.lastEvents.filter((e) => e.kind === 'move' && e.shipId === 'a').length).toBe(2);
  });

  it('turn tokens move forward then turn then forward', () => {
    let [, s] = createBattle('x', specs, rngFromSeed(3), 0, 20000);
    s.rocks = [];
    s.ships = s.ships.map((sh) => grantTokens(sh, 1, 1, 4));
    const o = emptyOrders();
    o.moves = ['R', null, null, null];
    s.ships[0]!.orders = o;
    const n = resolveTurn(s, 1000, 5000);
    const a = n.ships[0]!;
    expect(a.heading).toBe(1);
    expect(a.cell).toEqual({ q: s.ships[0]!.cell.q + 1, r: s.ships[0]!.cell.r - 1 });
  });

  it('sanitises orders against tokens and cannons', () => {
    const [, s] = createBattle('x', specs, rngFromSeed(3), 0, 20000);
    const ship = { ...s.ships[0]!, tokens: { L: 0, F: 1, R: 0 }, loaded: 1 };
    const o = emptyOrders();
    o.moves = ['F', 'F', 'L', null];
    o.shots = [{ port: true, starboard: true }, { port: true, starboard: false }, { port: false, starboard: false }, { port: false, starboard: false }];
    const c = sanitizeOrders(ship, o);
    expect(c.moves).toEqual(['F', null, null, null]);
    expect(c.shots[0]).toEqual({ port: true, starboard: false });
    expect(c.shots[1]).toEqual({ port: false, starboard: false });
  });

  it('cannon fire damages a ship in the lane', () => {
    let [, s] = createBattle('x', specs, rngFromSeed(5), 0, 20000);
    s.rocks = [];
    // Place b directly to the east of a (a faces north, so starboard = east).
    s.ships[0]!.cell = { q: 5, r: 5 };
    s.ships[1]!.cell = { q: 7, r: 5 };
    const o = emptyOrders();
    o.shots[0] = { port: false, starboard: true };
    s.ships[0]!.orders = o;
    const n = resolveTurn(s, 1000, 5000);
    expect(n.ships[1]!.hull).toBe(50);
    expect(n.ships[0]!.loaded).toBe(3);
    expect(n.lastEvents.some((e) => e.kind === 'hit')).toBe(true);
  });

  it('grapple when adjacent moves to boarding', () => {
    let [, s] = createBattle('x', specs, rngFromSeed(5), 0, 20000);
    s.rocks = [];
    s.ships[0]!.cell = { q: 5, r: 5 };
    s.ships[1]!.cell = { q: 6, r: 5 };
    const o = emptyOrders();
    o.grapple = true;
    s.ships[0]!.orders = o;
    const n = resolveTurn(s, 1000, 5000);
    expect(n.phase).toBe('boarding');
    expect(n.boardingSide).toBe(0);
  });

  it('npc produces legal orders', () => {
    let [, s] = createBattle('x', specs, rngFromSeed(9), 0, 20000);
    s.ships = s.ships.map((sh) => grantTokens(sh, 0.8, 0.3, 4));
    const [, o] = npcOrders(s, 'b', rngFromSeed(2));
    const clean = sanitizeOrders(s.ships[1]!, o);
    expect(clean.moves.length).toBe(4);
  });

  it('ships ramming the same cell are both blocked and damaged', () => {
    let [, s] = createBattle('x', specs, rngFromSeed(5), 0, 20000);
    s.rocks = [];
    s.ships[0]!.cell = { q: 5, r: 6 }; s.ships[0]!.heading = 0;
    s.ships[1]!.cell = { q: 5, r: 4 }; s.ships[1]!.heading = 2;
    s.ships = s.ships.map((sh) => grantTokens(sh, 1, 0, 4));
    const o1 = emptyOrders(); o1.moves = ['F', null, null, null];
    const o2 = emptyOrders(); o2.moves = ['F', null, null, null];
    s.ships[0]!.orders = o1; s.ships[1]!.orders = o2;
    const n = resolveTurn(s, 1000, 5000);
    expect(n.ships[0]!.cell).toEqual({ q: 5, r: 6 });
    expect(n.ships[1]!.cell).toEqual({ q: 5, r: 4 });
    expect(n.ships[0]!.hull).toBeLessThan(60);
    expect(n.ships[1]!.hull).toBeLessThan(60);
  });
});
