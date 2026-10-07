import type {
  Avatar, ClientMsg, Crew, Island, Pirate, PresenceEntry, PuzzleId, RoomView, ServerMsg, Ship, ShipView, CommodityId,
} from '@tidebound/shared';
import {
  ClientMsgSchema, HOME_ISLAND_ID, ISLANDS, ISLAND_BY_ID, PUZZLE_IDS, SHIP_TYPES, STATIONS, STATION_INFO, COMMODITIES,
  hexPath, isOceanBlocked, islandAnchorage, randomSeed, ratingLabel, rngFromSeed, rngNext, rngInt,
} from '@tidebound/shared';
import { Store } from './store';
import { Session } from './session';
import { token as makeToken, uid } from './ids';
import { PuzzleManager } from './puzzles';
import { BattleManager } from './battle';
import { deckhandName } from './names';
import { Bots } from './bots';

const START_POE = 3000;
const HAND_COST = 150;
/** Per-hex chance of a brigand encounter while sailing (override for testing). */
const ENCOUNTER_RATE = Number(process.env.TIDEBOUND_ENCOUNTER ?? 0.07);
const PRESENCE_MS = 100;

export class World {
  store: Store;
  sessions = new Map<string, Session>();          // session id -> session
  byPirate = new Map<string, Session>();           // pirate id -> session
  puzzles: PuzzleManager;
  battles: BattleManager;
  bots: Bots;
  private lastPresence = 0;
  private lastTick = Date.now();
  /** Per-station latest performance per ship (not persisted). */
  stationPerf = new Map<string, Partial<Record<PuzzleId, { p: number; at: number }>>>();

  constructor(dataPath: string) {
    this.store = new Store(dataPath);
    this.puzzles = new PuzzleManager(this);
    this.battles = new BattleManager(this);
    this.bots = new Bots(this);
    this.ensureNavyShips();
    // Reset transient state from a previous run: everyone starts ashore.
    for (const p of Object.values(this.store.data.pirates)) {
      if (p.location.kind === 'ship') p.location = { kind: 'island', islandId: HOME_ISLAND_ID, x: 800, y: 740 };
    }
    for (const s of Object.values(this.store.data.ships)) {
      s.aboard = [];
      s.hands = s.hands ?? [];
      for (const st of PUZZLE_IDS) if (s.stations[st] && !s.hands.some((h) => h.id === s.stations[st])) s.stations[st] = null;
      for (const st of PUZZLE_IDS) s.stations[st] = null;
      if (s.status.kind === 'battle' || s.status.kind === 'adrift') s.status = { kind: 'docked', islandId: nearestIsland(s).id };
      if (s.status.kind === 'sailing') s.status = { kind: 'docked', islandId: s.status.from };
    }
    this.store.markDirty();
  }

  // ---------------------------------------------------------------- lifecycle

  get data() { return this.store.data; }

  connect(ws: Session['ws']): Session {
    const s = new Session(uid('s'), ws);
    this.sessions.set(s.id, s);
    return s;
  }

  disconnect(s: Session): void {
    s.alive = false;
    this.sessions.delete(s.id);
    if (s.pirateId) {
      const p = this.data.pirates[s.pirateId];
      if (this.byPirate.get(s.pirateId) === s) this.byPirate.delete(s.pirateId);
      if (s.puzzleSessionId) this.puzzles.end(s, s.puzzleSessionId, true);
      if (p) {
        if (p.location.kind === 'ship') {
          const ship = this.data.ships[p.location.shipId];
          if (ship) this.removeFromShip(p, ship, true);
        } else {
          this.broadcastIsland(p.location.islandId, { t: 'presenceLeave', id: p.id }, s);
        }
      }
    }
  }

  handle(s: Session, raw: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return s.send({ t: 'error', msg: 'bad json' }); }
    const res = ClientMsgSchema.safeParse(parsed);
    if (!res.success) return s.send({ t: 'error', msg: 'bad message: ' + res.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ') });
    const msg = res.data;
    s.lastSeen = Date.now();
    if (msg.t === 'login') return this.login(s, msg);
    if (msg.t === 'ping') return s.send({ t: 'pong', at: msg.at, serverTime: Date.now() });
    const p = s.pirateId ? this.data.pirates[s.pirateId] : undefined;
    if (!p) return s.send({ t: 'error', msg: 'not logged in' });
    try {
      this.dispatch(s, p, msg);
    } catch (e) {
      console.error('[world] handler error', (e as Error).stack);
      s.send({ t: 'error', msg: 'server error: ' + (e as Error).message });
    }
  }

  private dispatch(s: Session, p: Pirate, msg: ClientMsg): void {
    switch (msg.t) {
      case 'pos': return this.onPos(s, p, msg);
      case 'chat': return this.onChat(s, p, msg.channel, msg.text);
      case 'emote': s.emote = msg.emote; s.emoteUntil = Date.now() + 3000; return;
      case 'setAvatar': p.avatar = msg.avatar; this.store.markDirty(); s.send({ t: 'pirate', pirate: p }); return;
      case 'createCrew': return this.createCrew(s, p, msg.name, msg.motto ?? '');
      case 'joinCrew': return this.joinCrew(s, p, msg.crewId);
      case 'leaveCrew': return this.leaveCrew(s, p);
      case 'listCrews': return s.send({ t: 'crews', crews: Object.values(this.data.crews) });
      case 'buyShip': return this.buyShip(s, p, msg.type, msg.name);
      case 'trade': return this.trade(s, p, msg.commodity, msg.qty, msg.side);
      case 'unloadHold': return;
      case 'boardShip': return this.boardShip(s, p, msg.shipId);
      case 'leaveShip': return this.leaveShip(s, p);
      case 'takeStation': return this.takeStation(s, p, msg.station);
      case 'setSail': return this.setSail(s, p, msg.islandId);
      case 'dock': return this.dockNow(s, p);
      case 'listShips': return this.sendShips(s, p);
      case 'hireHand': return this.hireHand(s, p, msg.station);
      case 'dismissHand': return this.dismissHand(s, p, msg.handId);
      case 'puzzleStart': return this.puzzles.start(s, p, msg.puzzle, !!msg.practice);
      case 'puzzleCheckpoint': return this.puzzles.checkpoint(s, p, msg);
      case 'puzzleEnd': return this.puzzles.end(s, msg.sessionId, false);
      case 'battleOrders': return this.battles.orders(s, p, msg);
      case 'battleReady': return this.battles.ready(s, p);
      case 'sfAction': return this.battles.sfAction(s, p, msg.action);
      case 'leaderboard': return this.sendLeaderboard(s);
      default: return;
    }
  }

  // ---------------------------------------------------------------- login

  private login(s: Session, msg: Extract<ClientMsg, { t: 'login' }>): void {
    let pirate: Pirate | undefined;
    let tok = msg.token;
    if (tok && this.data.tokens[tok]) pirate = this.data.pirates[this.data.tokens[tok]!];
    const name = msg.name.trim().replace(/\s+/g, ' ');
    if (!pirate) {
      // Name must be unique (case-insensitive) unless reclaimed by token.
      const clash = Object.values(this.data.pirates).find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (clash) return s.send({ t: 'error', msg: `The name "${name}" is already sailing these seas. Pick another, or use your saved pirate.` });
      pirate = this.createPirate(name, msg.avatar);
      tok = makeToken();
      this.data.tokens[tok] = pirate.id;
      this.store.markDirty();
    } else if (msg.avatar) {
      pirate.avatar = msg.avatar;
    }
    // Kick a previous session for this pirate.
    const prev = this.byPirate.get(pirate.id);
    if (prev && prev !== s) {
      prev.send({ t: 'error', msg: 'You logged in elsewhere.' });
      prev.ws.close();
      this.disconnect(prev);
    }
    s.pirateId = pirate.id;
    this.byPirate.set(pirate.id, s);
    // Always start ashore on (re)connect.
    if (pirate.location.kind !== 'island') pirate.location = { kind: 'island', islandId: HOME_ISLAND_ID, x: 800, y: 740 };
    s.pos = { x: pirate.location.x, y: pirate.location.y, facing: 2, moving: false };
    s.send({ t: 'welcome', pirate, token: tok!, serverTime: Date.now() });
    s.send({ t: 'crew', crew: pirate.crewId ? this.data.crews[pirate.crewId] ?? null : null });
    this.sendRoom(s, pirate);
    this.sendShips(s, pirate);
    this.sendLeaderboard(s);
    this.broadcastIsland(pirate.location.islandId, { t: 'chat', from: 'Harbourmaster', fromId: 'system', channel: 'system', text: `${pirate.name} comes ashore.`, at: Date.now() }, s);
  }

  private createPirate(name: string, avatar?: Avatar): Pirate {
    return this.makePirate(name, avatar, 'p');
  }

  makePirate(name: string, avatar: Avatar | undefined, prefix: string): Pirate {
    const stats = {} as Pirate['stats'];
    for (const id of PUZZLE_IDS) stats[id] = { games: 0, best: 0, rating: 0 };
    const p: Pirate = {
      id: uid(prefix),
      name,
      avatar: avatar ?? randomAvatar(),
      poe: START_POE,
      crewId: null,
      stats,
      location: { kind: 'island', islandId: HOME_ISLAND_ID, x: 800, y: 740 },
      createdAt: Date.now(),
      title: 'Cabin Person',
    };
    this.data.pirates[p.id] = p;
    return p;
  }

  // ---------------------------------------------------------------- rooms

  island(p: Pirate): Island | null {
    return p.location.kind === 'island' ? ISLAND_BY_ID[p.location.islandId] ?? null : null;
  }

  shipOf(p: Pirate): Ship | null {
    return p.location.kind === 'ship' ? this.data.ships[p.location.shipId] ?? null : null;
  }

  presenceOf(p: Pirate, s: Session | undefined): PresenceEntry {
    const crew = p.crewId ? this.data.crews[p.crewId] : undefined;
    const e: PresenceEntry = {
      id: p.id, name: p.name, x: s?.pos.x ?? 0, y: s?.pos.y ?? 0, facing: s?.pos.facing ?? 2, moving: s?.pos.moving ?? false,
      avatar: p.avatar, title: p.title,
    };
    if (crew) e.crewName = crew.name;
    if (s?.emote && s.emoteUntil > Date.now()) e.emote = s.emote;
    return e;
  }

  piratesOnIsland(islandId: string): Session[] {
    const out: Session[] = [];
    for (const s of this.byPirate.values()) {
      const p = this.data.pirates[s.pirateId!];
      if (p && p.location.kind === 'island' && p.location.islandId === islandId) out.push(s);
    }
    return out;
  }

  sessionsOnShip(shipId: string): Session[] {
    const out: Session[] = [];
    for (const s of this.byPirate.values()) {
      const p = this.data.pirates[s.pirateId!];
      if (p && p.location.kind === 'ship' && p.location.shipId === shipId) out.push(s);
    }
    return out;
  }

  broadcastIsland(islandId: string, msg: ServerMsg, except?: Session): void {
    for (const s of this.piratesOnIsland(islandId)) if (s !== except) s.send(msg);
  }

  broadcastShip(shipId: string, msg: ServerMsg, except?: Session): void {
    for (const s of this.sessionsOnShip(shipId)) if (s !== except) s.send(msg);
  }

  broadcastAll(msg: ServerMsg): void {
    for (const s of this.byPirate.values()) s.send(msg);
  }

  shipView(ship: Ship): ShipView {
    const crewNames: Record<string, string> = {};
    const aboardPirates: PresenceEntry[] = [];
    for (const id of ship.aboard) {
      const p = this.data.pirates[id];
      if (!p) continue;
      crewNames[id] = p.name;
      aboardPirates.push(this.presenceOf(p, this.byPirate.get(id)));
    }
    for (const h of ship.hands) {
      crewNames[h.id] = h.name;
      aboardPirates.push({ id: h.id, name: h.name, x: 0, y: 0, facing: 2, moving: false, avatar: h.avatar, title: 'Deckhand' });
    }
    return { ...ship, crewNames, aboardPirates };
  }

  roomView(p: Pirate): RoomView {
    if (p.location.kind === 'ship') {
      const ship = this.data.ships[p.location.shipId]!;
      return { kind: 'ship', ship: this.shipView(ship), battle: this.battles.viewFor(ship.id) };
    }
    const islandId = p.location.islandId;
    const pirates = this.piratesOnIsland(islandId).map((s) => this.presenceOf(this.data.pirates[s.pirateId!]!, s));
    const ships = Object.values(this.data.ships).filter((sh) => sh.status.kind === 'docked' && sh.status.islandId === islandId);
    return { kind: 'island', islandId, pirates, ships };
  }

  sendRoom(s: Session, p: Pirate): void {
    s.send({ t: 'room', view: this.roomView(p) });
  }

  /** Push a fresh ship view to everyone aboard. */
  pushShip(ship: Ship): void {
    const view = this.shipView(ship);
    this.broadcastShip(ship.id, { t: 'ship', ship: view });
  }

  sendShips(s: Session, p: Pirate): void {
    // Ships relevant to this pirate: owned, crew's, and docked at the current island.
    const here = p.location.kind === 'island' ? p.location.islandId : null;
    const ships = Object.values(this.data.ships).filter((sh) =>
      sh.ownerId === p.id || (p.crewId && sh.crewId === p.crewId) || (here && sh.status.kind === 'docked' && sh.status.islandId === here));
    s.send({ t: 'ships', ships });
  }

  sendLeaderboard(s: Session): void {
    const rows: { name: string; puzzle: PuzzleId; best: number; rating: number }[] = [];
    for (const p of Object.values(this.data.pirates)) {
      if (p.id.startsWith('bot')) continue;
      for (const id of PUZZLE_IDS) {
        const st = p.stats[id];
        if (st && st.games > 0) rows.push({ name: p.name, puzzle: id, best: st.best, rating: st.rating });
      }
    }
    rows.sort((a, b) => b.best - a.best);
    s.send({ t: 'leaderboard', rows: rows.slice(0, 60) });
  }

  // ---------------------------------------------------------------- movement & chat

  private onPos(s: Session, p: Pirate, m: Extract<ClientMsg, { t: 'pos' }>): void {
    if (p.location.kind !== 'island') return;
    const isl = ISLAND_BY_ID[p.location.islandId]!;
    s.pos.x = Math.max(0, Math.min(isl.width, m.x));
    s.pos.y = Math.max(0, Math.min(isl.height, m.y));
    s.pos.facing = m.facing;
    s.pos.moving = m.moving;
    p.location.x = s.pos.x;
    p.location.y = s.pos.y;
  }

  private onChat(s: Session, p: Pirate, channel: 'local' | 'crew' | 'global', text: string): void {
    const msg: ServerMsg = { t: 'chat', from: p.name, fromId: p.id, channel, text: text.slice(0, 240), at: Date.now() };
    if (channel === 'global') return this.broadcastAll(msg);
    if (channel === 'crew') {
      if (!p.crewId) return s.send({ t: 'toast', text: 'You are not in a crew.', kind: 'bad' });
      for (const o of this.byPirate.values()) {
        const op = this.data.pirates[o.pirateId!];
        if (op && op.crewId === p.crewId) o.send(msg);
      }
      return;
    }
    if (p.location.kind === 'ship') return this.broadcastShip(p.location.shipId, msg);
    this.broadcastIsland(p.location.islandId, msg);
  }

  systemChat(target: 'island' | 'ship', id: string, text: string): void {
    const msg: ServerMsg = { t: 'chat', from: 'Harbourmaster', fromId: 'system', channel: 'system', text, at: Date.now() };
    if (target === 'island') this.broadcastIsland(id, msg);
    else this.broadcastShip(id, msg);
  }

  // ---------------------------------------------------------------- crews

  private createCrew(s: Session, p: Pirate, name: string, motto: string): void {
    if (p.crewId) return s.send({ t: 'toast', text: 'Leave your current crew first.', kind: 'bad' });
    if (Object.values(this.data.crews).some((c) => c.name.toLowerCase() === name.toLowerCase())) return s.send({ t: 'toast', text: 'That crew name is taken.', kind: 'bad' });
    const crew: Crew = { id: uid('c'), name, captainId: p.id, members: [p.id], color: Object.keys(this.data.crews).length % 8, motto, treasury: 0, fame: 0 };
    this.data.crews[crew.id] = crew;
    p.crewId = crew.id;
    p.title = 'Captain';
    this.store.markDirty();
    s.send({ t: 'crew', crew });
    s.send({ t: 'pirate', pirate: p });
    s.send({ t: 'toast', text: `Crew "${name}" founded. You are its captain.`, kind: 'good' });
    this.broadcastAll({ t: 'chat', from: 'Harbourmaster', fromId: 'system', channel: 'system', text: `A new crew sails: ${name}, captained by ${p.name}.`, at: Date.now() });
  }

  private joinCrew(s: Session, p: Pirate, crewId: string): void {
    const crew = this.data.crews[crewId];
    if (!crew) return s.send({ t: 'toast', text: 'No such crew.', kind: 'bad' });
    if (p.crewId) return s.send({ t: 'toast', text: 'Leave your current crew first.', kind: 'bad' });
    crew.members.push(p.id);
    p.crewId = crew.id;
    p.title = 'Pirate';
    this.store.markDirty();
    s.send({ t: 'crew', crew });
    s.send({ t: 'pirate', pirate: p });
    s.send({ t: 'toast', text: `Welcome aboard the ${crew.name}!`, kind: 'good' });
  }

  private leaveCrew(s: Session, p: Pirate): void {
    const crew = p.crewId ? this.data.crews[p.crewId] : undefined;
    if (!crew) return;
    crew.members = crew.members.filter((m) => m !== p.id);
    if (crew.captainId === p.id) {
      if (crew.members.length === 0) delete this.data.crews[crew.id];
      else { crew.captainId = crew.members[0]!; const np = this.data.pirates[crew.captainId]; if (np) np.title = 'Captain'; }
    }
    p.crewId = null;
    p.title = 'Cabin Person';
    this.store.markDirty();
    s.send({ t: 'crew', crew: null });
    s.send({ t: 'pirate', pirate: p });
  }

  // ---------------------------------------------------------------- economy

  private buyShip(s: Session, p: Pirate, type: Ship['type'], name: string): void {
    const isl = this.island(p);
    if (!isl) return s.send({ t: 'toast', text: 'You must be ashore at a shipwright.', kind: 'bad' });
    const st = SHIP_TYPES[type];
    if (p.poe < st.price) return s.send({ t: 'toast', text: `You need ${st.price} PoE for a ${st.name}.`, kind: 'bad' });
    p.poe -= st.price;
    const ship = this.makeShip(p.id, type, name, isl.id);
    ship.crewId = p.crewId;
    this.store.markDirty();
    s.send({ t: 'pirate', pirate: p });
    s.send({ t: 'toast', text: `The ${st.name} "${name}" is yours! She waits at the dock.`, kind: 'good' });
    for (const o of this.piratesOnIsland(isl.id)) this.sendShips(o, this.data.pirates[o.pirateId!]!);
  }

  makeShip(ownerId: string, type: Ship['type'], name: string, islandId: string): Ship {
    const isl = ISLAND_BY_ID[islandId]!;
    const stations = {} as Ship['stations'];
    for (const id of PUZZLE_IDS) stations[id] = null;
    const anchor = islandAnchorage(isl)[0] ?? isl.hex;
    const ship: Ship = {
      id: uid('v'),
      name, type, ownerId, crewId: null,
      hex: anchor, heading: 0,
      status: { kind: 'docked', islandId },
      stats: { damage: 0, bilge: 0, sailPower: 0, loaded: 0, nav: 0, carpentry: 0 },
      stations, aboard: [], hold: { poe: 0, goods: {} }, duty: {}, hands: [],
    };
    this.data.ships[ship.id] = ship;
    this.data.nextShipNo++;
    return ship;
  }

  private ensureNavyShips(): void {
    const navy = Object.values(this.data.ships).filter((s) => s.ownerId === 'navy');
    for (const isl of ISLANDS) {
      const want = isl.id === HOME_ISLAND_ID ? 3 : 1;
      const have = navy.filter((s) => s.status.kind === 'docked' && s.status.islandId === isl.id).length;
      for (let i = have; i < want; i++) {
        const n = this.data.nextShipNo;
        this.makeShip('navy', 'sloop', `Navy Sloop ${n}`, isl.id);
      }
    }
    this.store.markDirty();
  }

  private trade(s: Session, p: Pirate, commodity: CommodityId, qty: number, side: 'buy' | 'sell'): void {
    const ship = this.shipOf(p);
    if (!ship || ship.status.kind !== 'docked') return s.send({ t: 'toast', text: 'Trade from a ship docked at an island.', kind: 'bad' });
    if (this.captainOf(ship) !== p.id) return s.send({ t: 'toast', text: 'Only the captain trades the hold.', kind: 'bad' });
    const isl = ISLAND_BY_ID[ship.status.islandId]!;
    const price = isl.market[commodity];
    const type = SHIP_TYPES[ship.type];
    const held = ship.hold.goods[commodity] ?? 0;
    const total = Object.values(ship.hold.goods).reduce((a, b) => a + (b ?? 0), 0);
    if (side === 'buy') {
      const cost = price * qty;
      if (p.poe < cost) return s.send({ t: 'toast', text: `Not enough PoE (${cost} needed).`, kind: 'bad' });
      if (total + qty > type.holdSize) return s.send({ t: 'toast', text: `The hold only fits ${type.holdSize} crates.`, kind: 'bad' });
      p.poe -= cost;
      ship.hold.goods[commodity] = held + qty;
      s.send({ t: 'toast', text: `Bought ${qty} ${COMMODITIES.find((c) => c.id === commodity)!.name} for ${cost} PoE.`, kind: 'good' });
    } else {
      if (held < qty) return s.send({ t: 'toast', text: `You only hold ${held}.`, kind: 'bad' });
      const gain = price * qty;
      p.poe += gain;
      ship.hold.goods[commodity] = held - qty;
      if (ship.hold.goods[commodity] === 0) delete ship.hold.goods[commodity];
      s.send({ t: 'toast', text: `Sold ${qty} ${COMMODITIES.find((c) => c.id === commodity)!.name} for ${gain} PoE.`, kind: 'good' });
    }
    this.store.markDirty();
    s.send({ t: 'pirate', pirate: p });
    this.pushShip(ship);
  }

  // ---------------------------------------------------------------- ships

  captainOf(ship: Ship): string | null {
    if (ship.aboard.includes(ship.ownerId)) return ship.ownerId;
    return ship.aboard[0] ?? null;
  }

  private boardShip(s: Session, p: Pirate, shipId: string): void {
    const ship = this.data.ships[shipId];
    const isl = this.island(p);
    if (!ship || !isl) return s.send({ t: 'toast', text: 'No such ship here.', kind: 'bad' });
    if (ship.status.kind !== 'docked' || ship.status.islandId !== isl.id) return s.send({ t: 'toast', text: 'That ship is not docked here.', kind: 'bad' });
    const type = SHIP_TYPES[ship.type];
    if (ship.aboard.length >= type.maxCrew) return s.send({ t: 'toast', text: 'The ship is full.', kind: 'bad' });
    if (ship.ownerId !== 'navy' && ship.ownerId !== p.id && ship.crewId && ship.crewId !== p.crewId) {
      return s.send({ t: 'toast', text: 'That ship belongs to another crew.', kind: 'bad' });
    }
    this.broadcastIsland(isl.id, { t: 'presenceLeave', id: p.id }, s);
    if (s.puzzleSessionId) this.puzzles.end(s, s.puzzleSessionId, true);
    p.location = { kind: 'ship', shipId: ship.id, station: null };
    ship.aboard.push(p.id);
    this.store.markDirty();
    s.send({ t: 'pirate', pirate: p });
    this.sendRoom(s, p);
    this.pushShip(ship);
    this.systemChat('ship', ship.id, `${p.name} comes aboard.${this.captainOf(ship) === p.id ? ' They take the helm as captain.' : ''}`);
  }

  removeFromShip(p: Pirate, ship: Ship, disconnected: boolean): void {
    ship.aboard = ship.aboard.filter((id) => id !== p.id);
    for (const st of PUZZLE_IDS) if (ship.stations[st] === p.id) ship.stations[st] = null;
    delete ship.duty[p.id];
    const islandId = ship.status.kind === 'docked' ? ship.status.islandId : nearestIsland(ship).id;
    p.location = { kind: 'island', islandId, x: 800, y: 740 };
    this.store.markDirty();
    this.systemChat('ship', ship.id, `${p.name} ${disconnected ? 'is lost overboard (disconnected)' : 'goes ashore'}.`);
    this.pushShip(ship);
    if (ship.aboard.length === 0 && ship.status.kind !== 'docked') {
      // Nobody left aboard: the ship drifts to the nearest island.
      this.battles.abandon(ship.id);
      ship.status = { kind: 'docked', islandId };
      ship.hex = islandAnchorage(ISLAND_BY_ID[islandId]!)[0] ?? ship.hex;
    }
  }

  private leaveShip(s: Session, p: Pirate): void {
    const ship = this.shipOf(p);
    if (!ship) return;
    if (ship.status.kind !== 'docked') return s.send({ t: 'toast', text: 'You cannot go ashore at sea! Dock first.', kind: 'bad' });
    if (s.puzzleSessionId) this.puzzles.end(s, s.puzzleSessionId, true);
    this.removeFromShip(p, ship, false);
    s.pos = { x: 800, y: 740, facing: 2, moving: false };
    s.send({ t: 'pirate', pirate: p });
    this.sendRoom(s, p);
    this.sendShips(s, p);
  }

  private takeStation(s: Session, p: Pirate, station: PuzzleId | null): void {
    const ship = this.shipOf(p);
    if (!ship || p.location.kind !== 'ship') return;
    for (const st of PUZZLE_IDS) if (ship.stations[st] === p.id) ship.stations[st] = null;
    if (station) {
      if (!STATIONS.includes(station)) return;
      const holder = ship.stations[station];
      if (holder && holder !== p.id) {
        const hand = ship.hands.find((h) => h.id === holder);
        if (!hand) return s.send({ t: 'toast', text: 'Someone is already at that station.', kind: 'bad' });
        // Pirates outrank deckhands: the hand steps aside and takes any other open station.
        ship.stations[station] = null;
        const open = STATIONS.find((st) => st !== station && ship.stations[st] === null);
        if (open) ship.stations[open] = hand.id;
      }
      ship.stations[station] = p.id;
    } else if (s.puzzleSessionId) {
      this.puzzles.end(s, s.puzzleSessionId, true);
    }
    p.location.station = station;
    s.send({ t: 'pirate', pirate: p });
    this.pushShip(ship);
  }

  private setSail(s: Session, p: Pirate, islandId: string): void {
    const ship = this.shipOf(p);
    if (!ship) return;
    if (this.captainOf(ship) !== p.id) return s.send({ t: 'toast', text: 'Only the captain sets the course.', kind: 'bad' });
    if (ship.status.kind !== 'docked') return s.send({ t: 'toast', text: 'You are already under way.', kind: 'bad' });
    const dest = ISLAND_BY_ID[islandId];
    if (!dest || dest.id === ship.status.islandId) return s.send({ t: 'toast', text: 'Pick another island.', kind: 'bad' });
    const from = ISLAND_BY_ID[ship.status.islandId]!;
    const start = islandAnchorage(from)[0] ?? ship.hex;
    const goal = islandAnchorage(dest)[0] ?? dest.hex;
    const path = hexPath(start, goal, isOceanBlocked);
    if (!path) return s.send({ t: 'toast', text: 'No passage to that island.', kind: 'bad' });
    ship.hex = start;
    ship.status = { kind: 'sailing', from: from.id, to: dest.id, path, index: 0, progress: 0 };
    this.store.markDirty();
    this.pushShip(ship);
    this.systemChat('ship', ship.id, `Anchors aweigh! ${ship.name} sets sail for ${dest.name} (${path.length} leagues). Take your stations!`);
    for (const o of this.piratesOnIsland(from.id)) this.sendShips(o, this.data.pirates[o.pirateId!]!);
  }

  private dockNow(s: Session, p: Pirate): void {
    const ship = this.shipOf(p);
    if (!ship) return;
    if (this.captainOf(ship) !== p.id) return s.send({ t: 'toast', text: 'Only the captain can dock.', kind: 'bad' });
    if (ship.status.kind !== 'sailing') return;
    // Allowed when within 1 hex of destination anchorage.
    const dest = ISLAND_BY_ID[ship.status.to]!;
    const remaining = ship.status.path.length - ship.status.index;
    if (remaining > 1) return s.send({ t: 'toast', text: `Still ${remaining} leagues to ${dest.name}.`, kind: 'bad' });
    this.arrive(ship);
  }

  arrive(ship: Ship): void {
    if (ship.status.kind !== 'sailing') return;
    const dest = ISLAND_BY_ID[ship.status.to]!;
    ship.status = { kind: 'docked', islandId: dest.id };
    ship.hex = islandAnchorage(dest)[0] ?? dest.hex;
    ship.stats.loaded = 0;
    this.store.markDirty();
    this.pushShip(ship);
    this.systemChat('ship', ship.id, `${ship.name} makes port at ${dest.name}. ${dest.tagline}.`);
    // Duty report: who pulled their weight this voyage.
    const report = Object.entries(ship.duty)
      .map(([id, perf]) => ({ name: this.data.pirates[id]?.name ?? ship.hands.find((h) => h.id === id)?.name ?? '?', perf }))
      .sort((x, y) => y.perf - x.perf)
      .slice(0, 5)
      .map((r) => `${r.name} (${ratingLabel(r.perf)})`);
    if (report.length > 0) this.systemChat('ship', ship.id, `Duty report: ${report.join(', ')}.`);
    ship.duty = {};
    for (const o of this.piratesOnIsland(dest.id)) this.sendShips(o, this.data.pirates[o.pirateId!]!);
  }

  private hireHand(s: Session, p: Pirate, station: PuzzleId): void {
    const ship = this.shipOf(p);
    if (!ship) return;
    if (this.captainOf(ship) !== p.id) return s.send({ t: 'toast', text: 'Only the captain hires hands.', kind: 'bad' });
    const type = SHIP_TYPES[ship.type];
    if (ship.aboard.length + ship.hands.length >= type.maxCrew) return s.send({ t: 'toast', text: 'No berths left for another hand.', kind: 'bad' });
    if (ship.stations[station]) return s.send({ t: 'toast', text: 'That station is taken.', kind: 'bad' });
    const cost = HAND_COST;
    if (p.poe < cost) return s.send({ t: 'toast', text: `A deckhand costs ${cost} PoE.`, kind: 'bad' });
    p.poe -= cost;
    let rng = rngFromSeed(randomSeed());
    let name: string;
    [rng, name] = deckhandName(rng);
    let sk: number;
    [rng, sk] = rngNext(rng);
    const hand = { id: uid('h'), name, skill: 0.35 + sk * 0.3, avatar: randomAvatar() };
    ship.hands.push(hand);
    ship.stations[station] = hand.id;
    this.store.markDirty();
    s.send({ t: 'pirate', pirate: p });
    this.pushShip(ship);
    this.systemChat('ship', ship.id, `${hand.name} signs on as a deckhand and takes the ${STATION_INFO[station].name.toLowerCase()}.`);
  }

  private dismissHand(s: Session, p: Pirate, handId: string): void {
    const ship = this.shipOf(p);
    if (!ship) return;
    if (this.captainOf(ship) !== p.id) return s.send({ t: 'toast', text: 'Only the captain dismisses hands.', kind: 'bad' });
    const hand = ship.hands.find((h) => h.id === handId);
    if (!hand) return;
    ship.hands = ship.hands.filter((h) => h.id !== handId);
    for (const st of PUZZLE_IDS) if (ship.stations[st] === handId) ship.stations[st] = null;
    this.store.markDirty();
    this.pushShip(ship);
    this.systemChat('ship', ship.id, `${hand.name} is paid off and goes ashore.`);
  }

  // ---------------------------------------------------------------- station performance

  reportStation(ship: Ship, pirateId: string, station: PuzzleId, perf: number): void {
    const m = this.stationPerf.get(ship.id) ?? {};
    m[station] = { p: perf, at: Date.now() };
    this.stationPerf.set(ship.id, m);
    ship.duty[pirateId] = perf;
  }

  private stationPower(ship: Ship, station: PuzzleId, now: number): number {
    const holder = ship.stations[station];
    if (holder === null) return 0;
    const hand = ship.hands.find((h) => h.id === holder);
    if (hand) {
      // Deckhands work steadily with a little swell to their rhythm.
      return hand.skill * (0.85 + 0.15 * Math.sin(now / 7000 + hand.skill * 40));
    }
    const e = this.stationPerf.get(ship.id)?.[station];
    if (!e) return 0;
    const age = (now - e.at) / 1000;
    const fade = age < 12 ? 1 : Math.max(0, 1 - (age - 12) / 20);
    return e.p * fade;
  }

  // ---------------------------------------------------------------- tick

  tick(): void {
    const now = Date.now();
    const dt = Math.min(2, (now - this.lastTick) / 1000);
    this.lastTick = now;

    for (const ship of Object.values(this.data.ships)) {
      if (ship.status.kind === 'docked') {
        // Dockyard crews slowly patch hulls and pump bilges of anything tied up at the quay.
        ship.stats.damage = Math.max(0, ship.stats.damage - 0.6 * dt);
        ship.stats.bilge = Math.max(0, ship.stats.bilge - 2.5 * dt);
      }
      if (ship.aboard.length === 0) continue;
      const type = SHIP_TYPES[ship.type];
      const atSea = ship.status.kind !== 'docked';
      // Station powers.
      const pb = this.stationPower(ship, 'bilging', now);
      const ps = this.stationPower(ship, 'sailing', now);
      const pc = this.stationPower(ship, 'carpentry', now);
      const pn = this.stationPower(ship, 'navigation', now);
      const st = ship.stats;
      // Bilge: rises with damage, pumped by bilging.
      const dmgFrac = st.damage / type.hull;
      const rise = atSea ? 0.35 + dmgFrac * 1.4 : 0.05;
      st.bilge = Math.max(0, Math.min(100, st.bilge + (rise - pb * 2.4) * dt));
      // Carpentry repairs.
      st.damage = Math.max(0, st.damage - pc * 1.4 * dt);
      st.carpentry = pc;
      // Sails & nav are smoothed.
      st.sailPower += (ps - st.sailPower) * Math.min(1, dt * 0.35);
      st.nav += (pn - st.nav) * Math.min(1, dt * 0.35);
      // Voyage progress.
      if (ship.status.kind === 'sailing') {
        const v = ship.status;
        const hexPerSec = (type.baseSpeed / 60) * (0.35 + 0.9 * st.sailPower + 0.25 * st.nav) * (1 - 0.5 * (st.bilge / 100));
        v.progress += hexPerSec * dt;
        let moved = false;
        while (v.progress >= 1 && v.index < v.path.length) {
          v.progress -= 1;
          const next = v.path[v.index]!;
          ship.heading = headingBetween(ship.hex, next);
          ship.hex = next;
          v.index++;
          moved = true;
          // Encounter roll.
          if (v.index < v.path.length - 1 && this.battles.viewFor(ship.id) === null) {
            const roll = Math.random();
            const danger = ENCOUNTER_RATE + (v.to === 'wyrmtooth' || v.from === 'wyrmtooth' ? 0.08 : 0);
            if (roll < danger && v.index > 1) {
              this.battles.startEncounter(ship);
              break;
            }
          }
        }
        if (ship.status.kind === 'sailing' && v.index >= v.path.length) {
          this.arrive(ship);
        } else if (moved) {
          this.pushShip(ship);
        }
      }
    }

    this.battles.tick(now);
    this.bots.tick(now, dt);

    // Presence broadcast.
    if (now - this.lastPresence >= PRESENCE_MS) {
      this.lastPresence = now;
      const byIsland = new Map<string, Session[]>();
      for (const s of this.byPirate.values()) {
        const p = this.data.pirates[s.pirateId!];
        if (!p || p.location.kind !== 'island') continue;
        const arr = byIsland.get(p.location.islandId) ?? [];
        arr.push(s);
        byIsland.set(p.location.islandId, arr);
      }
      for (const [islandId, list] of byIsland) {
        if (list.length < 2) continue;
        const entries = list.map((s) => this.presenceOf(this.data.pirates[s.pirateId!]!, s));
        const msg: ServerMsg = { t: 'presence', islandId, pirates: entries };
        for (const s of list) s.send(msg);
      }
      // Ship decks: send a light presence tick every second so emotes show.
      if (Math.floor(now / 1000) !== Math.floor((now - PRESENCE_MS) / 1000)) {
        for (const ship of Object.values(this.data.ships)) {
          if (ship.aboard.length > 0 && ship.status.kind !== 'docked') this.pushShipStatsOnly(ship);
        }
      }
    }
  }

  private pushShipStatsOnly(ship: Ship): void {
    this.pushShip(ship);
  }

  reward(p: Pirate, puzzle: PuzzleId, points: number, performance: number, practice: boolean): void {
    const st = p.stats[puzzle];
    st.games++;
    st.best = Math.max(st.best, Math.round(points));
    st.rating = st.rating === 0 ? performance : st.rating + (performance - st.rating) * 0.25;
    const poe = Math.max(0, Math.round(points * (practice ? 0.2 : 0.35)));
    p.poe += poe;
    this.store.markDirty();
    const s = this.byPirate.get(p.id);
    if (s) {
      s.send({ t: 'puzzleReward', puzzle, points: Math.round(points), performance, poe });
      s.send({ t: 'pirate', pirate: p });
    }
    if (performance >= 0.85 && !practice) {
      const ship = this.shipOf(p);
      if (ship) this.systemChat('ship', ship.id, `${p.name} turns in an ${performance >= 0.95 ? 'Incredible' : 'Excellent'} ${puzzle} shift!`);
    }
  }
}

function headingBetween(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = b.q - a.q, dr = b.r - a.r;
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const i = dirs.findIndex((d) => d[0] === dq && d[1] === dr);
  return i < 0 ? 0 : i;
}

function nearestIsland(ship: Ship): Island {
  let best = ISLANDS[0]!;
  let bd = Infinity;
  for (const i of ISLANDS) {
    const d = Math.abs(i.hex.q - ship.hex.q) + Math.abs(i.hex.r - ship.hex.r);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function randomAvatar(): Avatar {
  let rng = rngFromSeed(randomSeed());
  const pick = (n: number) => { let v: number; [rng, v] = rngInt(rng, n); return v; };
  return { skin: pick(6), hair: pick(8), hairColor: pick(6), shirt: pick(10), pants: pick(10), hat: pick(6) };
}

// keep rngNext referenced for tree-shaking friendliness in bundlers
void rngNext;
