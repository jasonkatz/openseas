import type { Rng } from '../rng';
import { rngInt, rngNext } from '../rng';
import {
  BATTLE_H, BATTLE_W, CANNON_RANGE, RAM_DAMAGE, ROCK_DAMAGE, SEGMENTS, SHOT_DAMAGE, SQ_DIRS,
  emptyOrders,
} from './types';
import type { BattleEvent, BattleShip, BattleState, Cell, MoveToken, TurnOrders } from './types';

export const BATTLE_SIM_VERSION = 2;

export function cellEq(a: Cell, b: Cell): boolean { return a.q === b.q && a.r === b.r; }
export function cellKey(c: Cell): string { return `${c.q},${c.r}`; }
export function inBounds(c: Cell): boolean { return c.q >= 0 && c.r >= 0 && c.q < BATTLE_W && c.r < BATTLE_H; }
export function stepCell(c: Cell, heading: number): Cell {
  const d = SQ_DIRS[((heading % 4) + 4) % 4]!;
  return { q: c.q + d.q, r: c.r + d.r };
}
export function sqTurnLeft(h: number): number { return (h + 3) % 4; }
export function sqTurnRight(h: number): number { return (h + 1) % 4; }
export function chebyshev(a: Cell, b: Cell): number { return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r)); }

export interface BattleShipSpec {
  id: string; name: string; type: string; npc: boolean; side: 0 | 1;
  hull: number; maxHull: number; cannons: number; loaded: number; crew: string[]; sprite: number;
}

export function createBattle(id: string, specs: BattleShipSpec[], rng: Rng, now: number, turnMs: number): [Rng, BattleState] {
  // Rocks: a handful, away from the two spawn corners.
  const rocks: Cell[] = [];
  let r = rng;
  const taken = new Set<string>();
  const spawnA: Cell = { q: 2, r: BATTLE_H - 3 };
  const spawnB: Cell = { q: BATTLE_W - 3, r: 2 };
  let tries = 0;
  while (rocks.length < 7 && tries++ < 200) {
    let q: number, rr: number;
    [r, q] = rngInt(r, BATTLE_W);
    [r, rr] = rngInt(r, BATTLE_H);
    const c = { q, r: rr };
    if (chebyshev(c, spawnA) <= 2 || chebyshev(c, spawnB) <= 2) continue;
    if (taken.has(cellKey(c))) continue;
    taken.add(cellKey(c));
    rocks.push(c);
  }
  const ships: BattleShip[] = specs.map((s) => ({
    id: s.id, name: s.name, type: s.type, npc: s.npc, side: s.side,
    cell: s.side === 0 ? spawnA : spawnB,
    heading: s.side === 0 ? 0 : 2,
    hull: s.hull, maxHull: s.maxHull,
    tokens: { L: 0, F: 0, R: 0 },
    loaded: s.loaded, cannons: s.cannons,
    grappleReady: false,
    crew: s.crew,
    orders: null,
    sunk: false,
    sprite: s.sprite,
  }));
  const state: BattleState = {
    id, turn: 1, phase: 'orders', phaseEndsAt: now + turnMs, ships, rocks,
    lastEvents: [], winnerSide: null, outcome: null, boardingSide: null,
    log: ['Battle joined! Give your orders, captain.'],
  };
  return [r, state];
}

/** Replenish tokens from sail power (0..1) and nav (0..1); unused tokens carry over up to a cap. */
export function grantTokens(ship: BattleShip, sailPower: number, nav: number, maxMoves: number): BattleShip {
  const f = Math.round(1 + sailPower * (maxMoves - 1) + nav * 0.5);
  const turns = Math.round(0.5 + sailPower * 1.5 + nav * 0.6);
  const cap = 6;
  return {
    ...ship,
    tokens: {
      F: Math.min(cap, ship.tokens.F + f),
      L: Math.min(cap, ship.tokens.L + turns),
      R: Math.min(cap, ship.tokens.R + turns),
    },
  };
}

function rockAt(state: BattleState, c: Cell): boolean {
  return state.rocks.some((r) => cellEq(r, c));
}

function shipAt(ships: BattleShip[], c: Cell, except?: string): BattleShip | undefined {
  return ships.find((s) => !s.sunk && s.id !== except && cellEq(s.cell, c));
}

/** Sanitise orders against available tokens/cannons; returns a legal order set. */
export function sanitizeOrders(ship: BattleShip, o: TurnOrders | null): TurnOrders {
  const out = emptyOrders();
  if (!o) return out;
  const left = { ...ship.tokens };
  let shotsLeft = ship.loaded;
  for (let i = 0; i < SEGMENTS; i++) {
    const m = o.moves[i] ?? null;
    if (m && left[m] > 0) { left[m]--; out.moves[i] = m; }
    const s = o.shots[i] ?? { port: false, starboard: false };
    const port = !!s.port && shotsLeft > 0 && ship.cannons > 0;
    if (port) shotsLeft--;
    const starboard = !!s.starboard && shotsLeft > 0 && ship.cannons > 0;
    if (starboard) shotsLeft--;
    out.shots[i] = { port, starboard };
  }
  out.grapple = !!o.grapple;
  return out;
}

interface Mover { ship: BattleShip; token: MoveToken; }

/**
 * Resolves one battle turn. Pure. Expects every living ship to have `orders` set
 * (null orders = hold position). Returns the new state with phase 'resolving',
 * 'boarding' or 'over'.
 */
export function resolveTurn(state: BattleState, now: number, resolveMs: number): BattleState {
  const events: BattleEvent[] = [];
  const log: string[] = [];
  let ships: BattleShip[] = state.ships.map((s) => ({ ...s, tokens: { ...s.tokens }, orders: sanitizeOrders(s, s.orders) }));
  const turn = state.turn;

  const applyDamage = (s: BattleShip, dmg: number): BattleShip => {
    const hull = Math.max(0, s.hull - dmg);
    return { ...s, hull, sunk: hull <= 0 };
  };

  for (let seg = 0; seg < SEGMENTS; seg++) {
    // ---- Movement (two steps for turns) ----
    const movers: Mover[] = ships.map((ship) => ({ ship, token: ship.sunk ? null : (ship.orders!.moves[seg] ?? null) }));
    // Step 1: forward for any token.
    ships = resolveStep(ships, movers.map((m) => ({ id: m.ship.id, go: m.token !== null, rotate: 0 })), state, events, turn, seg, applyDamage);
    // Step 2: rotate and go forward again for L/R.
    ships = ships.map((s) => {
      const m = movers.find((x) => x.ship.id === s.id)!;
      if (s.sunk || (m.token !== 'L' && m.token !== 'R')) return s;
      const heading = m.token === 'L' ? sqTurnLeft(s.heading) : sqTurnRight(s.heading);
      events.push({ turn, seg, kind: 'turn', shipId: s.id, heading, from: s.cell, to: s.cell });
      return { ...s, heading };
    });
    ships = resolveStep(ships, movers.map((m) => ({ id: m.ship.id, go: m.token === 'L' || m.token === 'R', rotate: 0 })), state, events, turn, seg, applyDamage);
    // Spend tokens.
    ships = ships.map((s) => {
      const m = movers.find((x) => x.ship.id === s.id)!;
      if (!m.token) return s;
      const tokens = { ...s.tokens };
      tokens[m.token] = Math.max(0, tokens[m.token] - 1);
      return { ...s, tokens };
    });

    // ---- Shots ----
    for (const shooter of ships) {
      if (shooter.sunk) continue;
      const so = shooter.orders!.shots[seg]!;
      for (const side of ['port', 'starboard'] as const) {
        if (!so[side]) continue;
        const sh = ships.find((s) => s.id === shooter.id)!;
        if (sh.loaded <= 0) continue;
        const dir = side === 'port' ? sqTurnLeft(sh.heading) : sqTurnRight(sh.heading);
        const path: Cell[] = [];
        let c = sh.cell;
        let hit: BattleShip | undefined;
        for (let i = 0; i < CANNON_RANGE; i++) {
          c = stepCell(c, dir);
          if (!inBounds(c) || rockAt(state, c)) break;
          path.push(c);
          hit = shipAt(ships, c, sh.id);
          if (hit) break;
        }
        ships = ships.map((s) => (s.id === sh.id ? { ...s, loaded: s.loaded - 1 } : s));
        events.push({ turn, seg, kind: 'shot', shipId: sh.id, from: sh.cell, path, heading: dir });
        if (hit) {
          const dmg = SHOT_DAMAGE;
          ships = ships.map((s) => (s.id === hit!.id ? applyDamage(s, dmg) : s));
          events.push({ turn, seg, kind: 'hit', shipId: sh.id, targetId: hit.id, dmg, to: hit.cell });
          log.push(`${sh.name} hits ${hit.name} for ${dmg}.`);
          const after = ships.find((s) => s.id === hit!.id)!;
          if (after.sunk) {
            events.push({ turn, seg, kind: 'sunk', shipId: after.id, to: after.cell });
            log.push(`${after.name} is sunk!`);
          }
        } else {
          events.push({ turn, seg, kind: 'miss', shipId: sh.id, path });
        }
      }
    }
    if (ships.some((s) => s.sunk)) break;
  }

  // ---- Outcome ----
  let phase: BattleState['phase'] = 'orders';
  let winnerSide: 0 | 1 | null = null;
  let outcome: BattleState['outcome'] = null;
  let boardingSide: 0 | 1 | null = null;
  const alive0 = ships.filter((s) => s.side === 0 && !s.sunk);
  const alive1 = ships.filter((s) => s.side === 1 && !s.sunk);
  if (alive0.length === 0 || alive1.length === 0) {
    phase = 'over';
    outcome = 'sunk';
    winnerSide = alive0.length === 0 ? 1 : 0;
    log.push(winnerSide === 0 ? 'The enemy slips beneath the waves!' : 'Your ship is lost to the deep.');
  } else {
    // Grapple: any ship ordering grapple that is adjacent (8-neighbour) to an enemy.
    for (const s of ships) {
      if (s.sunk || !s.orders!.grapple) continue;
      const enemy = ships.find((e) => !e.sunk && e.side !== s.side && chebyshev(e.cell, s.cell) <= 1);
      if (enemy) {
        phase = 'boarding';
        boardingSide = s.side;
        events.push({ turn, seg: SEGMENTS - 1, kind: 'grapple', shipId: s.id, targetId: enemy.id });
        log.push(`${s.name} throws grapples onto ${enemy.name}! Prepare to board!`);
        break;
      }
    }
  }
  if (phase === 'orders') phase = 'resolving';
  const next: BattleState = {
    ...state,
    ships: ships.map((s) => ({ ...s, orders: null, grappleReady: false })),
    phase,
    phaseEndsAt: now + resolveMs,
    lastEvents: events,
    winnerSide,
    outcome,
    boardingSide,
    log: [...state.log, ...log].slice(-30),
  };
  return next;
}

function resolveStep(
  ships: BattleShip[],
  intents: { id: string; go: boolean; rotate: number }[],
  state: BattleState,
  events: BattleEvent[],
  turn: number,
  seg: number,
  applyDamage: (s: BattleShip, dmg: number) => BattleShip,
): BattleShip[] {
  const targets = new Map<string, Cell | null>();
  for (const s of ships) {
    const it = intents.find((i) => i.id === s.id);
    if (!it || !it.go || s.sunk) { targets.set(s.id, null); continue; }
    targets.set(s.id, stepCell(s.cell, s.heading));
  }
  const blocked = new Set<string>();
  const dmgs = new Map<string, { dmg: number; kind: 'rock' | 'ram'; other?: string }>();
  // Rocks & bounds.
  for (const s of ships) {
    const t = targets.get(s.id);
    if (!t) continue;
    if (!inBounds(t) || rockAt(state, t)) {
      blocked.add(s.id);
      dmgs.set(s.id, { dmg: ROCK_DAMAGE, kind: 'rock' });
    }
  }
  // Same target.
  for (const a of ships) {
    const ta = targets.get(a.id);
    if (!ta) continue;
    for (const b of ships) {
      if (a.id === b.id) continue;
      const tb = targets.get(b.id);
      if (tb && cellEq(ta, tb)) {
        blocked.add(a.id); blocked.add(b.id);
        dmgs.set(a.id, { dmg: RAM_DAMAGE, kind: 'ram', other: b.id });
        dmgs.set(b.id, { dmg: RAM_DAMAGE, kind: 'ram', other: a.id });
      }
    }
  }
  // Moving into a ship that stays (or is blocked) — iterate to a fixpoint.
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of ships) {
      const ta = targets.get(a.id);
      if (!ta || blocked.has(a.id)) continue;
      const occupant = ships.find((b) => b.id !== a.id && !b.sunk && cellEq(b.cell, ta));
      if (occupant && (!targets.get(occupant.id) || blocked.has(occupant.id))) {
        blocked.add(a.id);
        dmgs.set(a.id, { dmg: RAM_DAMAGE, kind: 'ram', other: occupant.id });
        if (!dmgs.has(occupant.id)) dmgs.set(occupant.id, { dmg: Math.ceil(RAM_DAMAGE / 2), kind: 'ram', other: a.id });
        changed = true;
      }
      // Head-on swap (A→B's cell while B→A's cell).
      if (occupant && targets.get(occupant.id) && cellEq(targets.get(occupant.id)!, a.cell)) {
        blocked.add(a.id); blocked.add(occupant.id);
        dmgs.set(a.id, { dmg: RAM_DAMAGE, kind: 'ram', other: occupant.id });
        dmgs.set(occupant.id, { dmg: RAM_DAMAGE, kind: 'ram', other: a.id });
        changed = true;
      }
    }
  }
  return ships.map((s) => {
    const t = targets.get(s.id);
    let out = s;
    const d = dmgs.get(s.id);
    if (d) {
      out = applyDamage(out, d.dmg);
      events.push({ turn, seg, kind: d.kind, shipId: s.id, dmg: d.dmg, targetId: d.other, from: s.cell, to: s.cell });
      if (out.sunk) events.push({ turn, seg, kind: 'sunk', shipId: s.id, to: s.cell });
    }
    if (t && !blocked.has(s.id)) {
      events.push({ turn, seg, kind: 'move', shipId: s.id, from: s.cell, to: t, heading: s.heading });
      out = { ...out, cell: t };
    } else if (t && blocked.has(s.id) && !d) {
      events.push({ turn, seg, kind: 'blocked', shipId: s.id, from: s.cell, to: s.cell });
    }
    return out;
  });
}

/** Simple NPC captain: close distance, line up broadsides, grapple when adjacent and strong. */
export function npcOrders(state: BattleState, shipId: string, rng: Rng, aggression = 0.6): [Rng, TurnOrders] {
  const me = state.ships.find((s) => s.id === shipId)!;
  const enemy = state.ships.find((s) => s.side !== me.side && !s.sunk);
  const o = emptyOrders();
  if (!enemy) return [rng, o];
  let r = rng;
  // Plan greedily segment by segment using a copy of position/heading.
  let cell = me.cell;
  let heading = me.heading;
  const tokens = { ...me.tokens };
  let shots = me.loaded;
  const simulate = (c: Cell, h: number, tok: MoveToken): { c: Cell; h: number } => {
    if (!tok) return { c, h };
    let nc = stepCell(c, h);
    if (!inBounds(nc) || state.rocks.some((x) => cellEq(x, nc))) nc = c;
    let nh = h;
    if (tok === 'L' || tok === 'R') {
      nh = tok === 'L' ? sqTurnLeft(h) : sqTurnRight(h);
      const n2 = stepCell(nc, nh);
      if (inBounds(n2) && !state.rocks.some((x) => cellEq(x, n2))) nc = n2;
    }
    return { c: nc, h: nh };
  };
  const scorePos = (c: Cell, h: number): number => {
    const d = chebyshev(c, enemy.cell);
    let s = -Math.abs(d - 1.5) * 2;
    // Broadside alignment: enemy in a line perpendicular to heading within range.
    for (const side of [sqTurnLeft(h), sqTurnRight(h)]) {
      let cc = c;
      for (let i = 0; i < CANNON_RANGE; i++) {
        cc = stepCell(cc, side);
        if (cellEq(cc, enemy.cell)) s += 4 - i;
      }
    }
    if (!inBounds(c)) s -= 50;
    return s;
  };
  for (let seg = 0; seg < SEGMENTS; seg++) {
    let best: { tok: MoveToken; score: number } = { tok: null, score: scorePos(cell, heading) - 0.5 };
    for (const tok of ['F', 'L', 'R'] as const) {
      if (tokens[tok] <= 0) continue;
      const sim = simulate(cell, heading, tok);
      let noise: number;
      [r, noise] = rngNext(r);
      const sc = scorePos(sim.c, sim.h) + (noise - 0.5) * (1 - aggression) * 3;
      if (sc > best.score) best = { tok, score: sc };
    }
    if (best.tok) {
      tokens[best.tok]--;
      const sim = simulate(cell, heading, best.tok);
      cell = sim.c; heading = sim.h;
    }
    o.moves[seg] = best.tok;
    // Fire if enemy is roughly in the broadside lane after this move.
    for (const side of ['port', 'starboard'] as const) {
      const dir = side === 'port' ? sqTurnLeft(heading) : sqTurnRight(heading);
      let cc = cell;
      let aligned = false;
      for (let i = 0; i < CANNON_RANGE; i++) {
        cc = stepCell(cc, dir);
        if (chebyshev(cc, enemy.cell) <= (i === 0 ? 0 : 1)) aligned = true;
      }
      if (aligned && shots > 0) { o.shots[seg]![side] = true; shots--; }
    }
  }
  // Fire remaining shots blindly on the last segment if we still have many loaded.
  if (shots > 2) { o.shots[3]!.port = true; o.shots[3]!.starboard = true; }
  o.grapple = chebyshev(cell, enemy.cell) <= 1 && me.hull / me.maxHull > 0.35;
  return [r, o];
}
