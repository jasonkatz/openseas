import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientMsg, ServerMsg } from '@tidebound/shared';
import { getPuzzle } from '@tidebound/shared';
import { World } from './world';
import type { Session } from './session';

class FakeWs {
  readyState = 1;
  OPEN = 1;
  sent: ServerMsg[] = [];
  send(s: string) { this.sent.push(JSON.parse(s) as ServerMsg); }
  close() { this.readyState = 3; }
}

function client(world: World, name: string): { s: Session; ws: FakeWs; send: (m: ClientMsg) => void; last: <T extends ServerMsg['t']>(t: T) => Extract<ServerMsg, { t: T }> | undefined; all: <T extends ServerMsg['t']>(t: T) => Extract<ServerMsg, { t: T }>[] } {
  const ws = new FakeWs();
  const s = world.connect(ws as unknown as Session['ws']);
  const send = (m: ClientMsg) => world.handle(s, JSON.stringify(m));
  send({ t: 'login', name });
  const all = <T extends ServerMsg['t']>(t: T) => ws.sent.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  const last = <T extends ServerMsg['t']>(t: T) => all(t).at(-1);
  return { s, ws, send, last, all };
}

describe('world', () => {
  let world: World;
  beforeEach(() => {
    world = new World(join(mkdtempSync(join(tmpdir(), 'tb-')), 'world.json'));
  });

  it('creates pirates on login and seeds navy sloops', () => {
    const a = client(world, 'Marla');
    const w = a.last('welcome')!;
    expect(w.pirate.name).toBe('Marla');
    expect(w.pirate.poe).toBe(3000);
    const room = a.last('room')!;
    expect(room.view.kind).toBe('island');
    if (room.view.kind === 'island') expect(room.view.ships.filter((s) => s.ownerId === 'navy').length).toBe(3);
  });

  it('rejects duplicate names without a token and reclaims with one', () => {
    const a = client(world, 'Marla');
    const tok = a.last('welcome')!.token;
    const b = client(world, 'marla');
    expect(b.last('error')?.msg).toMatch(/already/);
    const ws = new FakeWs();
    const s = world.connect(ws as unknown as Session['ws']);
    world.handle(s, JSON.stringify({ t: 'login', name: 'Marla', token: tok }));
    expect(ws.sent.some((m) => m.t === 'welcome')).toBe(true);
  });

  it('boards a ship, takes a station, sets sail and arrives', () => {
    const a = client(world, 'Marla');
    const b = client(world, 'Finn');
    const ships = (a.last('room')!.view as { ships: { id: string }[] }).ships;
    a.send({ t: 'boardShip', shipId: ships[0]!.id });
    b.send({ t: 'boardShip', shipId: ships[0]!.id });
    const room = b.last('room')!;
    expect(room.view.kind).toBe('ship');
    if (room.view.kind === 'ship') expect(room.view.ship.aboard.length).toBe(2);
    // b is not captain
    b.send({ t: 'setSail', islandId: 'gullrock' });
    expect(b.last('toast')?.text).toMatch(/captain/);
    a.send({ t: 'setSail', islandId: 'gullrock' });
    const ship = world.data.ships[ships[0]!.id]!;
    expect(ship.status.kind).toBe('sailing');
    b.send({ t: 'takeStation', station: 'bilging' });
    expect(ship.stations.bilging).toBe(b.s.pirateId);
    // Simulate time: force progress by ticking with fake clock.
    const path = ship.status.kind === 'sailing' ? ship.status.path : [];
    expect(path.length).toBeGreaterThan(3);
    // Fast-forward voyage deterministically by advancing progress manually and ticking.
    for (let i = 0; i < 2000 && ship.status.kind === 'sailing'; i++) {
      if (ship.status.kind === 'sailing') ship.status.progress += 1;
      world.tick();
      if ((ship.status as { kind: string }).kind === 'battle') {
        // abandon the battle quickly for this test
        world.battles.abandon(ship.id);
        ship.status = { kind: 'sailing', from: 'saltmarrow', to: 'gullrock', path, index: Math.min(path.length - 1, i), progress: 0 };
      }
    }
    expect(ship.status.kind).toBe('docked');
    if (ship.status.kind === 'docked') expect(ship.status.islandId).toBe('gullrock');
  });

  it('verifies puzzle checkpoints by replaying the action log and rewards PoE', () => {
    const a = client(world, 'Marla');
    a.send({ t: 'puzzleStart', puzzle: 'bilging', practice: true });
    const seed = a.last('puzzleSeed')!;
    expect(seed.puzzle).toBe('bilging');
    const def = getPuzzle('bilging');
    // Client-side simulation: find a swap that scores by brute force.
    let st = def.init(seed.seed, seed.config);
    const entries: { at: number; a: unknown }[] = [];
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t += 100;
      st = def.tick(st, 100);
      for (let y = 0; y < 12 && def.score(st).points < 30; y++) {
        for (let x = 0; x < 5; x++) {
          const next = def.reduce(st, { type: 'swap', x, y });
          if (def.score(next).points > def.score(st).points) { st = next; entries.push({ at: t, a: { type: 'swap', x, y } }); break; }
        }
      }
    }
    const sc = def.score(st);
    expect(sc.points).toBeGreaterThan(0);
    a.send({ t: 'puzzleCheckpoint', sessionId: seed.sessionId, entries, elapsedMs: t, points: sc.points, performance: sc.performance });
    const v = a.last('puzzleVerified')!;
    expect(v.ok).toBe(true);
    expect(v.points).toBe(sc.points);
    // A lying checkpoint is flagged.
    a.send({ t: 'puzzleCheckpoint', sessionId: seed.sessionId, entries: [], elapsedMs: t + 1000, points: sc.points + 5000, performance: 1 });
    expect(a.last('puzzleVerified')!.ok).toBe(false);
    const before = world.data.pirates[a.s.pirateId!]!.poe;
    a.send({ t: 'puzzleEnd', sessionId: seed.sessionId });
    expect(world.data.pirates[a.s.pirateId!]!.poe).toBeGreaterThan(before);
    expect(a.last('puzzleReward')!.points).toBe(Math.round(sc.points));
  });

  it('runs a sea battle through boarding and a swordfight against NPCs', () => {
    const a = client(world, 'Marla');
    const ships = (a.last('room')!.view as { ships: { id: string }[] }).ships;
    a.send({ t: 'boardShip', shipId: ships[0]!.id });
    a.send({ t: 'setSail', islandId: 'gullrock' });
    const ship = world.data.ships[ships[0]!.id]!;
    world.battles.startEncounter(ship);
    expect(ship.status.kind).toBe('battle');
    const b = a.last('battle')!.state;
    expect(b.ships.length).toBe(2);
    // Teleport adjacent and grapple.
    const bt = world.battles.battles.get(b.id)!;
    bt.state = { ...bt.state, ships: bt.state.ships.map((s, i) => ({ ...s, cell: { q: 5 + i, r: 5 } })) };
    a.send({ t: 'battleOrders', moves: [null, null, null, null], shots: [{ port: true, starboard: true }, { port: false, starboard: false }, { port: false, starboard: false }, { port: false, starboard: false }], grapple: true });
    a.send({ t: 'battleReady' });
    world.tick();
    expect(bt.state.phase).toBe('boarding');
    world.tick();
    const sf = a.last('swordfight')!.view;
    expect(sf.players.some((p) => p.pirateId === a.s.pirateId)).toBe(true);
    expect(sf.players.some((p) => p.npc)).toBe(true);
    // Player acts; NPCs act over time.
    a.send({ t: 'sfAction', action: { type: 'hardDrop' } });
    const fight = world.battles.swordfights.get(sf.id)!;
    for (let i = 0; i < 200 && !fight.over; i++) {
      fight.lastTick -= 1000; // pretend a second passed
      for (const f of fight.fighters) f.lastAi -= 1000;
      world.battles.tick(Date.now());
      if (i % 3 === 0) a.send({ t: 'sfAction', action: { type: 'hardDrop' } });
    }
    expect(fight.over).toBe(true);
    expect(a.last('battleEnd')).toBeTruthy();
  });

  it('hires deckhands that hold stations and contribute power', () => {
    const a = client(world, 'Marla');
    const ships = (a.last('room')!.view as { ships: { id: string }[] }).ships;
    a.send({ t: 'boardShip', shipId: ships[0]!.id });
    a.send({ t: 'hireHand', station: 'sailing' });
    const ship = world.data.ships[ships[0]!.id]!;
    expect(ship.hands.length).toBe(1);
    expect(ship.stations.sailing).toBe(ship.hands[0]!.id);
    expect(world.data.pirates[a.s.pirateId!]!.poe).toBe(3000 - 150);
    a.send({ t: 'setSail', islandId: 'lantern' });
    for (let i = 0; i < 30; i++) world.tick();
    expect(ship.stats.sailPower).toBeGreaterThan(0);
    // Pirate bumps the hand off the station.
    a.send({ t: 'takeStation', station: 'sailing' });
    expect(ship.stations.sailing).toBe(a.s.pirateId);
  });
});
