import type {
  BattleState, ClientMsg, CommodityId, Pirate, Rng, Ship, SwordfightView, TurnOrders,
} from '@tidebound/shared';
import {
  BATTLE_MAX_TURNS, BATTLE_RESOLVE_MS, BATTLE_TURN_MS, COMMODITIES, SHIP_TYPES,
  createBattle, getPuzzle, grantTokens, npcOrders, resolveTurn, randomSeed, rngFromSeed, rngInt, rngNext, rngPick,
} from '@tidebound/shared';
import { aiChoose, garbagePatternFor, swordfight as sfEngine } from '@tidebound/shared';
import type { Session } from './session';
import type { World } from './world';
import { uid } from './ids';
import { brigandName, brigandShipName } from './names';

interface Battle {
  id: string;
  shipId: string;
  state: BattleState;
  rng: Rng;
  npcShipId: string;
  npcType: keyof typeof SHIP_TYPES;
  npcSail: number;
  captainReady: boolean;
  swordfightId: string | null;
  /** Server time when the 'over' phase should clean up. */
  cleanupAt: number | null;
  startedAt: number;
}

interface Fighter {
  id: string;          // pirate id or npc id
  name: string;
  side: 0 | 1;
  npc: boolean;
  state: any;
  lastAi: number;
  skill: number;
  lastSeq: number;
}

interface Swordfight {
  id: string;
  battleId: string;
  shipId: string;
  rng: Rng;
  fighters: Fighter[];
  endsAt: number;
  lastTick: number;
  lastBroadcast: number;
  over: boolean;
  winnerSide: 0 | 1 | null;
  sides: [string, string];
}

const SF_DURATION = 100000;

/** Encounters, sea-battle turns, boarding swordfights, and booty. */
export class BattleManager {
  battles = new Map<string, Battle>();
  byShip = new Map<string, string>();
  swordfights = new Map<string, Swordfight>();

  constructor(private world: World) {}

  viewFor(shipId: string): BattleState | null {
    const id = this.byShip.get(shipId);
    return id ? this.battles.get(id)?.state ?? null : null;
  }

  cannonCap(ship: Ship): number {
    return SHIP_TYPES[ship.type].cannons * 2;
  }

  /** Mirror ship.stats.loaded into the live battle ship. */
  syncLoaded(ship: Ship): void {
    const b = this.battles.get(this.byShip.get(ship.id) ?? '');
    if (!b) return;
    b.state = { ...b.state, ships: b.state.ships.map((s) => (s.id === ship.id ? { ...s, loaded: ship.stats.loaded } : s)) };
  }

  // ---------------------------------------------------------------- encounters

  startEncounter(ship: Ship): void {
    if (this.byShip.has(ship.id)) return;
    this.rememberVoyage(ship);
    let rng = rngFromSeed(randomSeed());
    const type = SHIP_TYPES[ship.type];
    // Brigand ship type: same class or one below, occasionally one above.
    const order: (keyof typeof SHIP_TYPES)[] = ['sloop', 'cutter', 'brig', 'frigate'];
    const idx = order.indexOf(ship.type);
    let roll: number;
    [rng, roll] = rngNext(rng);
    const npcIdx = Math.max(0, Math.min(order.length - 1, idx + (roll < 0.15 ? 1 : roll < 0.55 ? 0 : -1)));
    const npcType = order[npcIdx]!;
    const nt = SHIP_TYPES[npcType];
    let npcName: string;
    [rng, npcName] = brigandShipName(rng);
    const npcShipId = uid('npc');
    const crewCount = Math.max(1, Math.min(4, Math.round(ship.aboard.length * 0.9 + roll * 2)));
    const npcCrew: string[] = [];
    for (let i = 0; i < crewCount; i++) { let n: string; [rng, n] = brigandName(rng); npcCrew.push(n); }
    const now = Date.now();
    const [rng2, state] = createBattle(uid('b'), [
      { id: ship.id, name: ship.name, type: ship.type, npc: false, side: 0, hull: Math.max(5, type.hull - ship.stats.damage), maxHull: type.hull, cannons: type.cannons, loaded: ship.stats.loaded, crew: [...ship.aboard.map((id) => this.world.data.pirates[id]?.name ?? '?'), ...ship.hands.map((h) => h.name)], sprite: type.sprite },
      { id: npcShipId, name: npcName, type: npcType, npc: true, side: 1, hull: Math.round(nt.hull * 0.85), maxHull: nt.hull, cannons: nt.cannons, loaded: nt.cannons, crew: npcCrew, sprite: nt.sprite },
    ], rng, now, BATTLE_TURN_MS);
    const npcSail = 0.45 + roll * 0.3;
    const granted = { ...state, ships: state.ships.map((s) => (s.id === ship.id ? grantTokens(s, Math.max(0.3, ship.stats.sailPower), ship.stats.nav, type.maxMoves) : grantTokens(s, npcSail, 0.2, nt.maxMoves))) };
    const b: Battle = { id: state.id, shipId: ship.id, state: granted, rng: rng2, npcShipId, npcType, npcSail, captainReady: false, swordfightId: null, cleanupAt: null, startedAt: now };
    this.battles.set(b.id, b);
    this.byShip.set(ship.id, b.id);
    ship.status = { kind: 'battle', battleId: b.id };
    this.world.systemChat('ship', ship.id, `Sail ho! The brigand ${nt.name} "${npcName}" bears down on us. To arms!`);
    this.world.pushShip(ship);
    this.broadcast(b);
  }

  private broadcast(b: Battle): void {
    this.world.broadcastShip(b.shipId, { t: 'battle', state: b.state });
  }

  orders(s: Session, p: Pirate, m: Extract<ClientMsg, { t: 'battleOrders' }>): void {
    const ship = this.world.shipOf(p);
    if (!ship) return;
    const b = this.battles.get(this.byShip.get(ship.id) ?? '');
    if (!b || b.state.phase !== 'orders') return;
    if (this.world.captainOf(ship) !== p.id) return s.send({ t: 'toast', text: 'Only the captain gives orders.', kind: 'bad' });
    const o: TurnOrders = { moves: m.moves.slice(0, 4), shots: m.shots.slice(0, 4), grapple: m.grapple };
    b.state = { ...b.state, ships: b.state.ships.map((sh) => (sh.id === ship.id ? { ...sh, orders: o } : sh)) };
    this.broadcast(b);
  }

  ready(s: Session, p: Pirate): void {
    const ship = this.world.shipOf(p);
    if (!ship) return;
    const b = this.battles.get(this.byShip.get(ship.id) ?? '');
    if (!b || b.state.phase !== 'orders') return;
    if (this.world.captainOf(ship) !== p.id) return;
    b.captainReady = true;
  }

  abandon(shipId: string): void {
    const id = this.byShip.get(shipId);
    if (!id) return;
    const b = this.battles.get(id);
    if (b?.swordfightId) this.swordfights.delete(b.swordfightId);
    this.battles.delete(id);
    this.byShip.delete(shipId);
  }

  // ---------------------------------------------------------------- turn loop

  tick(now: number): void {
    for (const b of [...this.battles.values()]) {
      const ship = this.world.data.ships[b.shipId];
      if (!ship) { this.abandon(b.shipId); continue; }
      const st = b.state;
      if (st.phase === 'orders' && (now >= st.phaseEndsAt || b.captainReady)) {
        this.resolve(b, ship, now);
      } else if (st.phase === 'resolving' && now >= st.phaseEndsAt) {
        this.nextTurn(b, ship, now);
      } else if (st.phase === 'boarding' && !b.swordfightId) {
        this.startSwordfight(b, ship, now);
      } else if (st.phase === 'over' && b.cleanupAt !== null && now >= b.cleanupAt) {
        this.finish(b, ship);
      }
    }
    for (const sf of [...this.swordfights.values()]) this.tickSwordfight(sf, now);
  }

  private resolve(b: Battle, ship: Ship, now: number): void {
    b.captainReady = false;
    // Sync loaded cannons from ship stats, NPC orders.
    let state = b.state;
    const [rng, npcO] = npcOrders(state, b.npcShipId, b.rng, 0.65);
    b.rng = rng;
    state = { ...state, ships: state.ships.map((s) => (s.id === b.npcShipId ? { ...s, orders: npcO } : s.id === ship.id ? { ...s, loaded: ship.stats.loaded } : s)) };
    state = resolveTurn(state, now, BATTLE_RESOLVE_MS);
    // Write back hull & loaded.
    const mine = state.ships.find((s) => s.id === ship.id)!;
    const type = SHIP_TYPES[ship.type];
    ship.stats.damage = Math.max(0, type.hull - mine.hull);
    ship.stats.loaded = mine.loaded;
    b.state = state;
    if (state.phase === 'over') {
      b.cleanupAt = now + 7000;
      this.onOutcome(b, ship, state.winnerSide === 0, state.outcome === 'sunk' ? 'sunk' : 'disengaged');
    }
    this.broadcast(b);
    this.world.pushShip(ship);
  }

  private nextTurn(b: Battle, ship: Ship, now: number): void {
    const st = b.state;
    if (st.turn >= BATTLE_MAX_TURNS) {
      b.state = { ...st, phase: 'over', outcome: 'disengaged', winnerSide: null, log: [...st.log, 'The ships drift apart. The brigands slip away in the swell.'] };
      b.cleanupAt = now + 6000;
      this.onOutcome(b, ship, false, 'disengaged');
      this.broadcast(b);
      return;
    }
    const type = SHIP_TYPES[ship.type];
    const nt = SHIP_TYPES[b.npcType];
    b.state = {
      ...st,
      turn: st.turn + 1,
      phase: 'orders',
      phaseEndsAt: now + BATTLE_TURN_MS,
      ships: st.ships.map((s) => s.sunk ? s : (s.id === ship.id
        ? { ...grantTokens(s, Math.max(0.25, ship.stats.sailPower) * (1 - ship.stats.bilge / 250), ship.stats.nav, type.maxMoves), loaded: ship.stats.loaded }
        : { ...grantTokens(s, b.npcSail, 0.2, nt.maxMoves), loaded: Math.min(nt.cannons * 2, s.loaded + Math.round(nt.cannons * 0.75)) })),
    };
    this.broadcast(b);
  }

  // ---------------------------------------------------------------- outcome & booty

  private onOutcome(b: Battle, ship: Ship, won: boolean, how: 'sunk' | 'boarded' | 'disengaged'): void {
    const sessions = this.world.sessionsOnShip(ship.id);
    if (!won) {
      const summary = how === 'disengaged' ? 'The brigands escaped. No booty this time.' : how === 'sunk' ? 'Your ship took a terrible beating. You limp on with what you have.' : 'The brigands repelled the boarding party and made off.';
      if (how === 'sunk' && b.state.ships.find((s) => s.id === ship.id)?.sunk) {
        // Our ship "sunk": heavy damage, lose hold goods, but keep sailing (no permadeath).
        ship.stats.damage = SHIP_TYPES[ship.type].hull * 0.8;
        ship.hold.goods = {};
      }
      for (const s of sessions) s.send({ t: 'battleEnd', won: false, booty: null, summary });
      return;
    }
    let rng = b.rng;
    const nt = SHIP_TYPES[b.npcType];
    let v: number;
    [rng, v] = rngNext(rng);
    const basePoe = Math.round(nt.price * (how === 'boarded' ? 0.12 : 0.06) * (0.8 + v * 0.6));
    const goods: Partial<Record<CommodityId, number>> = {};
    let n: number;
    [rng, n] = rngInt(rng, 3);
    for (let i = 0; i < n + 1; i++) {
      let c: (typeof COMMODITIES)[number];
      [rng, c] = rngPick(rng, COMMODITIES);
      let q: number;
      [rng, q] = rngInt(rng, 12);
      goods[c.id] = (goods[c.id] ?? 0) + q + 3;
    }
    b.rng = rng;
    // Split PoE among those aboard, captain gets a bonus share.
    const aboard = ship.aboard.map((id) => this.world.data.pirates[id]).filter((p): p is Pirate => !!p);
    const captain = this.world.captainOf(ship);
    const shares = aboard.length + 0.5;
    for (const p of aboard) {
      const share = Math.round((basePoe / shares) * (p.id === captain ? 1.5 : 1));
      p.poe += share;
      const s = this.world.byPirate.get(p.id);
      if (s) s.send({ t: 'pirate', pirate: p });
    }
    const type = SHIP_TYPES[ship.type];
    const total = Object.values(ship.hold.goods).reduce((a, x) => a + (x ?? 0), 0);
    let room = type.holdSize - total;
    for (const [k, q] of Object.entries(goods) as [CommodityId, number][]) {
      const take = Math.max(0, Math.min(q, room));
      room -= take;
      if (take > 0) ship.hold.goods[k] = (ship.hold.goods[k] ?? 0) + take;
    }
    ship.hold.poe += 0;
    if (ship.crewId) {
      const crew = this.world.data.crews[ship.crewId];
      if (crew) crew.fame += how === 'boarded' ? 3 : 1;
    }
    this.world.store.markDirty();
    const summary = how === 'boarded' ? `Victory! The brigands yield. ${basePoe} PoE and crates of goods are hauled aboard.` : `The brigand ship is sunk! Salvage worth ${basePoe} PoE is fished from the wreck.`;
    for (const s of sessions) s.send({ t: 'battleEnd', won: true, booty: { poe: basePoe, goods }, summary });
    this.world.systemChat('ship', ship.id, summary);
  }

  private finish(b: Battle, ship: Ship): void {
    if (b.swordfightId) this.swordfights.delete(b.swordfightId);
    this.battles.delete(b.id);
    this.byShip.delete(ship.id);
    // Resume the voyage.
    const prior = ship.status;
    if (prior.kind === 'battle') {
      const v = this.resumeVoyage(ship);
      if (!v) ship.status = { kind: 'adrift' };
    }
    this.world.pushShip(ship);
    this.world.broadcastShip(ship.id, { t: 'room', view: this.world.roomView(this.world.data.pirates[ship.aboard[0] ?? '']!) });
  }

  private voyages = new Map<string, Extract<Ship['status'], { kind: 'sailing' }>>();

  private resumeVoyage(ship: Ship): boolean {
    const v = this.voyages.get(ship.id);
    this.voyages.delete(ship.id);
    if (v) { ship.status = v; return true; }
    return false;
  }

  /** World calls this right before switching the ship status to battle so we can resume later. */
  rememberVoyage(ship: Ship): void {
    if (ship.status.kind === 'sailing') this.voyages.set(ship.id, ship.status);
  }

  // ---------------------------------------------------------------- swordfight

  private startSwordfight(b: Battle, ship: Ship, now: number): void {
    const def = getPuzzle('swordfight');
    const fighters: Fighter[] = [];
    let rng = b.rng;
    const npcShip = b.state.ships.find((s) => s.id === b.npcShipId)!;
    const difficulty = 0.4;
    for (const id of ship.aboard) {
      const p = this.world.data.pirates[id];
      if (!p) continue;
      let seed: number;
      [rng, seed] = rngInt(rng, 0x7fffffff);
      fighters.push({ id, name: p.name, side: 0, npc: false, state: def.init(seed, { difficulty, durationMs: SF_DURATION }), lastAi: 0, skill: 0, lastSeq: 0 });
    }
    for (const h of ship.hands) {
      let seed: number;
      [rng, seed] = rngInt(rng, 0x7fffffff);
      fighters.push({ id: h.id, name: h.name, side: 0, npc: true, state: def.init(seed, { difficulty, durationMs: SF_DURATION }), lastAi: now, skill: h.skill, lastSeq: 0 });
    }
    npcShip.crew.forEach((name, i) => {
      let seed: number;
      [rng, seed] = rngInt(rng, 0x7fffffff);
      let sk: number;
      [rng, sk] = rngNext(rng);
      fighters.push({ id: `npc${i}`, name, side: 1, npc: true, state: def.init(seed, { difficulty, durationMs: SF_DURATION }), lastAi: now, skill: 0.35 + sk * 0.4, lastSeq: 0 });
    });
    b.rng = rng;
    const sf: Swordfight = { id: uid('f'), battleId: b.id, shipId: ship.id, rng, fighters, endsAt: now + SF_DURATION, lastTick: now, lastBroadcast: 0, over: false, winnerSide: null, sides: [ship.name, npcShip.name] };
    this.swordfights.set(sf.id, sf);
    b.swordfightId = sf.id;
    // End any duty puzzles: everyone fights.
    for (const s of this.world.sessionsOnShip(ship.id)) {
      if (s.puzzleSessionId) this.world.puzzles.end(s, s.puzzleSessionId, true);
    }
    this.world.systemChat('ship', ship.id, 'Boarders! Every hand to the deck — draw steel!');
    this.broadcastSwordfight(sf);
  }

  private sfView(sf: Swordfight): SwordfightView {
    return {
      id: sf.id,
      phase: sf.over ? 'over' : 'fighting',
      endsAt: sf.endsAt,
      players: sf.fighters.map((f) => ({ pirateId: f.id, name: f.name, side: f.side, npc: f.npc, state: f.state, ko: !!f.state.ko })),
      winnerSide: sf.winnerSide,
      sides: sf.sides,
    };
  }

  private broadcastSwordfight(sf: Swordfight): void {
    this.world.broadcastShip(sf.shipId, { t: 'swordfight', view: this.sfView(sf) });
  }

  sfAction(s: Session, p: Pirate, action: unknown): void {
    const ship = this.world.shipOf(p);
    if (!ship) return;
    const b = this.battles.get(this.byShip.get(ship.id) ?? '');
    const sf = b?.swordfightId ? this.swordfights.get(b.swordfightId) : undefined;
    if (!sf || sf.over) return;
    const f = sf.fighters.find((x) => x.id === p.id);
    if (!f || f.state.ko) return;
    const a = action as { type?: string };
    if (!a || typeof a.type !== 'string' || a.type === 'garbage' || a.type === 'warn') return;
    const def = getPuzzle('swordfight');
    f.state = def.reduce(f.state, action);
    this.drainAttacks(sf, f);
  }

  private drainAttacks(sf: Swordfight, f: Fighter): void {
    const [next, attacks] = sfEngine.drainOutgoing(f.state);
    if (attacks.length === 0) return;
    f.state = next;
    const def = getPuzzle('swordfight');
    for (const atk of attacks) {
      const targets = sf.fighters.filter((t) => t.side !== f.side && !t.state.ko);
      if (targets.length === 0) continue;
      let idx: number;
      [sf.rng, idx] = rngInt(sf.rng, targets.length);
      const target = targets[idx]!;
      let pattern: number[][];
      [sf.rng, pattern] = garbagePatternFor(atk.power, sf.rng);
      if (pattern.length === 0) continue;
      target.state = def.reduce(target.state, { type: 'garbage', pattern });
    }
  }

  private tickSwordfight(sf: Swordfight, now: number): void {
    if (sf.over) return;
    const def = getPuzzle('swordfight');
    const dt = Math.min(1000, now - sf.lastTick);
    sf.lastTick = now;
    for (const f of sf.fighters) {
      if (f.state.ko) continue;
      f.state = def.tick(f.state, dt);
      if (f.npc && now - f.lastAi >= 800 - f.skill * 350) {
        f.lastAi = now;
        let actions: unknown[];
        [sf.rng, actions] = aiChoose(f.state, sf.rng, f.skill);
        for (const a of actions) f.state = def.reduce(f.state, a);
      }
      this.drainAttacks(sf, f);
    }
    const alive0 = sf.fighters.some((f) => f.side === 0 && !f.state.ko);
    const alive1 = sf.fighters.some((f) => f.side === 1 && !f.state.ko);
    if (!alive0 || !alive1 || now >= sf.endsAt) {
      sf.over = true;
      if (alive0 !== alive1) sf.winnerSide = alive0 ? 0 : 1;
      else {
        const d = (side: 0 | 1) => sf.fighters.filter((f) => f.side === side).reduce((a, f) => a + Number(f.state.damageDealt ?? 0), 0);
        sf.winnerSide = d(0) >= d(1) ? 0 : 1;
      }
      this.broadcastSwordfight(sf);
      const b = this.battles.get(sf.battleId);
      const ship = this.world.data.ships[sf.shipId];
      if (b && ship) {
        const won = sf.winnerSide === 0;
        b.state = { ...b.state, phase: 'over', outcome: 'boarded', winnerSide: sf.winnerSide, log: [...b.state.log, won ? 'The deck is ours!' : 'We are driven back to our own deck.'] };
        b.cleanupAt = now + 8000;
        for (const f of sf.fighters) {
          if (f.npc) continue;
          const p = this.world.data.pirates[f.id];
          if (!p) continue;
          const sc = def.score(f.state);
          this.world.reward(p, 'swordfight', sc.points + (won ? 40 : 0), sc.performance, false);
        }
        this.onOutcome(b, ship, won, 'boarded');
        this.broadcast(b);
        this.world.pushShip(ship);
      }
      return;
    }
    if (now - sf.lastBroadcast >= 100) {
      sf.lastBroadcast = now;
      this.broadcastSwordfight(sf);
    }
  }
}
