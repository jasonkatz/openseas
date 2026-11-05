import { and, eq, inArray } from "drizzle-orm";
import type { BrigandTier, Content, RouteLeg, ShipClass } from "@openseas/content";
import {
  InvalidMoveError,
  STATIONS,
  battleIsWin,
  createShip,
  crewAtStation,
  crewMember,
  legUnits,
  progressPermille,
  reduceShip,
  type BattleConfig,
  type BattleState,
  type ShipBattleOutcome,
  type ShipConfig,
  type ShipEvent,
  type ShipMove,
  type ShipState,
  type Station,
} from "@openseas/engine";
import type { BoardShip, CrewView, ErrorCode, PuzzleStarted, ServerMessage, ShipEventWire, ShipLocation, ShipSnapshot } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import { recordEvent } from "../events.js";
import { appendLedger } from "../ledger.js";
import type { Logger } from "../log.js";
import type { PuzzleService } from "../puzzles/service.js";
import type { PuzzleSession, ShipSupply } from "../puzzles/sessions.js";
import { Room, type RoomMember } from "../rooms.js";

/** A request the ship refuses. The code is sent to the client as is. */
export class ShipError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "ShipError";
  }
}

interface StationSession {
  sessionId: string;
  /** The board's score at the last turn, so each turn takes only what was earned since. */
  lastScore: number;
}

/** The captain's fight in progress (M4): its board session, and what the crew earned during it. */
interface BattleRun {
  sessionId: string;
  tierId: string;
  /** Duty points per pirate since the fight began, for the booty split. */
  dutyPoints: Map<string, number>;
  /** The last battle turn the ship has taken hits and shots from. */
  turnsSeen: number;
  /** The ship's hull as the board last learned it, to read what a turn took off it. */
  hullSent: number;
}

/** One ship with people aboard. Exists from the first boarding until the last pirate goes ashore. */
export class ShipRoom {
  /** Connections of the crew, keyed by pirate id. A dropped pirate is not in here but is still aboard. */
  readonly conns: Room<ServerMessage>;
  /** Every name seen aboard, kept after leaving so events can still say who. */
  readonly names = new Map<string, string>();
  readonly stations = new Map<Station, StationSession>();
  voyageId: string | null = null;
  battle: BattleRun | null = null;
  state: ShipState;

  constructor(
    readonly shipId: string,
    readonly name: string,
    readonly shipClass: ShipClass,
    readonly ownerId: string,
    state: ShipState,
    public nextTurnAt: number,
  ) {
    this.state = state;
    this.conns = new Room<ServerMessage>(shipId);
  }
}

export interface ShipServiceOptions {
  now?: () => number;
  randomSeed: () => string;
  randomId: () => string;
}

/**
 * Ships as rooms (ADR 0005): runs the engine's ship reducer on a turn clock, binds duty boards to
 * stations, and persists what must outlive the process (where ships and pirates are, voyages).
 * Everything else about a ship at sea is in memory; a restart puts every ship back in port.
 */
export class ShipService {
  /** A pirate stepped (or was put) ashore at an island. The connection layer rejoins them to the island. */
  onAshore: ((pirateId: string, islandId: string) => void) | null = null;
  /** A pirate went aboard; they are no longer ashore anywhere. */
  onBoarded: ((pirateId: string) => void) | null = null;
  /** These pirates' summaries changed (a ship or a pirate moved islands); the connection layer re-sends them. */
  onSummaryChanged: ((pirateIds: readonly string[]) => void) | null = null;
  private readonly rooms = new Map<string, ShipRoom>();
  private readonly byPirate = new Map<string, string>();
  private readonly configs = new Map<string, ShipConfig>();
  private readonly now: () => number;
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly content: Content,
    private readonly log: Logger,
    private readonly puzzles: PuzzleService,
    private readonly opts: ShipServiceOptions,
  ) {
    this.now = opts.now ?? Date.now;
    for (const c of content.world.shipClasses) this.configs.set(c.id, shipConfigFor(content, c));
    puzzles.onDutyEnd = (session) => this.takeFinalPoints(session);
    puzzles.onBattleMove = (session) => this.takeBattleTurn(session);
    puzzles.onBattleEnd = (session, how, result) => void this.battleEnded(session, how, result).catch((e) => log.error({ err: e, sessionId: session.id }, "battle end failed"));
  }

  get turnMs(): number {
    return this.content.world.ship.turnSeconds * 1000;
  }

  configFor(classId: string): ShipConfig {
    const c = this.configs.get(classId);
    if (!c) throw new Error(`unknown ship class ${classId}`);
    return c;
  }

  roomOf(pirateId: string): ShipRoom | null {
    const id = this.byPirate.get(pirateId);
    return id ? (this.rooms.get(id) ?? null) : null;
  }

  room(shipId: string): ShipRoom | null {
    return this.rooms.get(shipId) ?? null;
  }

  get size(): number {
    return this.rooms.size;
  }

  // ---- crew actions

  async board(pirateId: string, name: string, shipId: string, conn: RoomMember<ServerMessage>): Promise<void> {
    if (this.byPirate.has(pirateId)) throw new ShipError("already_aboard");
    let room = this.rooms.get(shipId);
    if (!room) {
      const [ship] = await this.db.select().from(schema.ship).where(eq(schema.ship.id, shipId));
      if (!ship) throw new ShipError("no_ship");
      const shipClass = this.content.world.shipClasses.find((c) => c.id === ship.classId);
      if (!shipClass) throw new ShipError("no_ship");
      const islandId = ship.islandId ?? this.content.world.startIslandId;
      if (islandId !== (await this.pirateIsland(pirateId))) throw new ShipError("ship_elsewhere");
      const state = createShip(this.opts.randomSeed(), this.configFor(ship.classId), islandId);
      room = new ShipRoom(ship.id, ship.name, shipClass, ship.ownerId, state, this.now() + this.turnMs);
      this.rooms.set(shipId, room);
    } else if (room.state.islandId !== null && room.state.islandId !== (await this.pirateIsland(pirateId))) {
      throw new ShipError("ship_elsewhere");
    }
    if (room.state.inviteOnly && pirateId !== room.ownerId) throw new ShipError("ship_locked");
    this.apply(room, { type: "board", pirateId }, (e) => (e.message === "ship is full" ? "ship_full" : "already_aboard"));
    room.names.set(pirateId, name);
    room.conns.join(conn);
    this.byPirate.set(pirateId, shipId);
    if (room.voyageId) {
      await this.db.insert(schema.voyageCrew).values({ voyageId: room.voyageId, pirateId }).onConflictDoNothing();
    }
    void recordEvent(this.db, pirateId, "ship.boarded", { shipId, atSea: room.state.voyage !== null }).catch((e) => this.log.warn({ err: e }, "event write failed"));
    this.onBoarded?.(pirateId);
    await this.afterChange(room);
  }

  /** The ships at sea right now, for the chart of a pirate who is ashore. */
  shipsAtSea(): ShipRoom[] {
    return [...this.rooms.values()].filter((r) => r.state.voyage !== null);
  }

  async leave(pirateId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    this.apply(room, { type: "leave", pirateId }, () => "not_aboard");
    await this.afterChange(room);
  }

  async station(pirateId: string, station: Station | null): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    const before = crewMember(room.state, pirateId)?.station ?? null;
    this.apply(room, { type: "station", pirateId, station }, (e) => (e.message === "station taken" ? "station_taken" : "no_station"));
    if (before !== null && before !== station) await this.endStation(room, before);
    await this.afterChange(room);
  }

  async sail(pirateId: string, routeId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    if (room.state.islandId === null) throw new ShipError("not_docked");
    const route = this.content.world.routes.find((r) => r.id === routeId);
    if (!route || route.from !== room.state.islandId) throw new ShipError("bad_route");
    this.apply(room, { type: "sail", leg: legPlan(route) }, () => "bad_route");
    const voyageId = this.opts.randomId();
    room.voyageId = voyageId;
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.voyage).values({ id: voyageId, shipId: room.shipId, routeId, captainId: pirateId, startedAt: new Date(this.now()) });
      await tx.insert(schema.voyageCrew).values(room.state.crew.map((c) => ({ voyageId, pirateId: c.pirateId, boardedAt: new Date(this.now()) })));
      await recordEvent(tx, pirateId, "voyage.started", { shipId: room.shipId, voyageId, routeId, crew: room.state.crew.length });
    });
    await this.afterChange(room);
  }

  async evade(pirateId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    this.apply(room, { type: "evade" }, () => "not_hailed");
    await this.afterChange(room);
  }

  async wheel(pirateId: string, toPirateId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    // The battle board is the captain's own; the wheel changes hands once the fight is over.
    if (room.battle) throw new ShipError("in_battle");
    this.apply(room, { type: "wheel", pirateId: toPirateId }, () => "not_aboard");
    await this.afterChange(room);
  }

  // ---- the sea battle (M4)

  /**
   * The captain fights the brigand that hailed. The ship holds position; the battle board is a
   * puzzle session on the ship's own config: the tier's knobs, the ship's guns and hull, the
   * ship's turn. Returns the deal; the caller sends it, then calls `supplyNow` for the first deal.
   */
  async engage(pirateId: string): Promise<PuzzleStarted> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    if (room.battle) throw new ShipError("in_battle");
    const hail = room.state.voyage?.hail;
    if (!hail || !room.voyageId) throw new ShipError("not_hailed");
    const tier = this.content.world.brigandTiers.find((t) => t.id === hail.tierId);
    if (!tier) throw new ShipError("not_hailed");
    this.apply(room, { type: "engage" }, () => "not_hailed");
    const config = this.battleConfigFor(room, tier);
    const rules = this.content.world.ship;
    // Room for every turn, the captain's grace period if they drop, and a minute to spare.
    const roundMs = (config.maxTurns + rules.graceTurns) * this.turnMs + 60_000;
    const started = this.puzzles.startBattle(pirateId, { shipId: room.shipId, voyageId: room.voyageId, tierId: tier.id }, { config, roundMs });
    room.battle = { sessionId: started.sessionId, tierId: tier.id, dutyPoints: new Map(), turnsSeen: 0, hullSent: room.state.damage };
    this.log.info({ shipId: room.shipId, tierId: tier.id, sessionId: started.sessionId }, "battle engaged");
    await this.afterChange(room);
    return started;
  }

  /** The battle board's config aboard: content's rules with the ship's guns and hull, the tier's brigand, the ship's turn. */
  battleConfigFor(room: ShipRoom, tier: BrigandTier): BattleConfig {
    const base = this.content.puzzles.battle.config;
    const theirClass = this.content.world.shipClasses.find((c) => c.id === tier.shipClassId) ?? room.shipClass;
    return {
      ...base,
      turnSeconds: this.content.world.ship.turnSeconds,
      cannons: room.shipClass.cannons,
      startLoaded: Math.min(room.shipClass.cannons, room.state.loaded),
      startDamage: Math.min(999, room.state.damage),
      supply: null,
      brigand: {
        cannons: theirClass.cannons,
        tokensPerTurn: tier.movesPerTurn,
        reloadPerTurn: tier.reloadPerTurn,
        accuracy: Math.round(tier.accuracy * 100),
        aggression: Math.round(tier.aggression * 100),
        startDamage: 0,
      },
    };
  }

  /** Tell the captain's board what the ship brings right now. Called after the deal is sent and after every turn. */
  supplyNow(pirateId: string): void {
    const room = this.roomOf(pirateId);
    if (room) this.pushSupply(room);
  }

  private pushSupply(room: ShipRoom): void {
    const run = room.battle;
    if (!run) return;
    const session = this.puzzles.sessions.get(run.sessionId);
    if (!session || session.closed) return;
    const s = room.state;
    const supply: ShipSupply = { ...splitTokens(s.tokens), cannons: Math.min(room.shipClass.cannons, s.loaded), hull: s.damage };
    session.shipSupply = supply;
    run.hullSent = s.damage;
    room.conns.send(session.pirateId, { type: "battle.supply", sessionId: session.id, ...supply });
  }

  /** A battle turn resolved on the captain's board: the ship takes the hits and spends the shots. */
  private takeBattleTurn(session: PuzzleSession): void {
    const run = session.battle;
    if (!run) return;
    const room = this.rooms.get(run.shipId);
    if (!room || !room.battle || room.battle.sessionId !== session.id) return;
    const state = session.state as BattleState;
    const report = state.lastTurn;
    if (report && report.turn > room.battle.turnsSeen) {
      room.battle.turnsSeen = report.turn;
      if (room.state.voyage?.battle) {
        if (report.shots > 0) room.state = reduceShip(room.state, { type: "fired", shots: report.shots });
        if (report.damageTaken > 0) room.state = reduceShip(room.state, { type: "hit", damage: report.damageTaken });
      }
      this.broadcast(room, []);
    }
    // A turn can end the fight, and so can a deal that reports a wrecked hull: either way the
    // engine has the outcome and the captain is owed the result.
    if (state.finished && !session.closed) {
      // Settle now rather than wait for the captain's finish message: the outcome is the engine's.
      void this.puzzles
        .finish(session, null, null)
        .then((result) => room.conns.send(session.pirateId, result))
        .catch((e) => this.log.error({ err: e, sessionId: session.id }, "battle finish failed"));
    }
  }

  /** The battle session closed, however it closed: pay out, tell the ship, log it. */
  private async battleEnded(session: PuzzleSession, how: "finished" | "rejected" | "abandoned", _result: ServerMessage | null): Promise<void> {
    const run = session.battle;
    if (!run) return;
    const room = this.rooms.get(run.shipId);
    if (!room || !room.battle || room.battle.sessionId !== session.id) return;
    const state = session.state as BattleState;
    const outcome: ShipBattleOutcome = state.outcome ?? (how === "abandoned" ? "disengaged" : "broke_off");
    await this.settleBattle(room, outcome, state.turn);
  }

  /** Cut the captain's fight short: they left, dropped past the grace period, or the ship emptied. */
  private async cutBattleShort(room: ShipRoom, outcome: ShipBattleOutcome): Promise<void> {
    const run = room.battle;
    if (!run) return;
    const session = this.puzzles.sessions.get(run.sessionId);
    const turns = session ? (session.state as BattleState).turn : 0;
    // Settle first so the session's own end hook finds nothing left to do.
    await this.settleBattle(room, outcome, turns);
    if (session && !session.closed) {
      const result = await this.puzzles.cutShort(session);
      if (result) room.conns.send(session.pirateId, result);
    }
  }

  private async settleBattle(room: ShipRoom, outcome: ShipBattleOutcome, turns: number): Promise<void> {
    const run = room.battle;
    if (!run) return;
    room.battle = null;
    const tier = this.content.world.brigandTiers.find((t) => t.id === run.tierId);
    const won = battleIsWin(outcome);
    const booty = won && tier ? tier.booty : 0;
    const crew = room.state.crew.map((c) => ({ pirateId: c.pirateId, captain: c.pirateId === room.state.captainId, points: run.dutyPoints.get(c.pirateId) ?? 0 }));
    const shares = booty > 0 ? splitBooty(booty, crew) : new Map<string, number>();
    if (room.state.voyage?.battle) {
      try {
        room.state = reduceShip(room.state, { type: "battle_end", outcome, booty, turns });
      } catch (e) {
        if (!(e instanceof InvalidMoveError)) throw e;
      }
    }
    const voyageId = room.voyageId;
    await this.db.transaction(async (tx) => {
      for (const [pirateId, coins] of shares) if (coins > 0) await appendLedger(tx, pirateId, coins, "booty", voyageId);
      if (voyageId) await tx.update(schema.voyage).set({ encounter: { tierId: run.tierId, evaded: false, outcome, booty } }).where(eq(schema.voyage.id, voyageId));
      await recordEvent(tx, room.state.captainId, "ship.battle_ended", { shipId: room.shipId, voyageId, tierId: run.tierId, outcome, booty, turns, shares: Object.fromEntries(shares) });
    });
    this.log.info({ shipId: room.shipId, tierId: run.tierId, outcome, booty, turns }, "battle ended");
    if (shares.size) this.onSummaryChanged?.([...shares.keys()]);
    await this.afterChange(room);
  }

  async lock(pirateId: string, inviteOnly: boolean): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.ownerId !== pirateId) throw new ShipError("not_owner");
    this.apply(room, { type: "lock", inviteOnly }, () => "internal");
    await this.afterChange(room);
  }

  /** Deal a board for the pirate's station. Any board already running there is cut short first. */
  async dutyStart(pirateId: string): Promise<PuzzleStarted> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    const me = crewMember(room.state, pirateId);
    if (!me || me.station === null) throw new ShipError("no_station");
    if (!room.state.voyage || !room.voyageId) throw new ShipError("not_at_sea");
    await this.endStation(room, me.station);
    const water = me.station === "bilging" ? this.bilgeRows(room) : undefined;
    const started = this.puzzles.start(pirateId, me.station, { shipId: room.shipId, station: me.station, voyageId: room.voyageId, ...(water !== undefined ? { water } : {}) });
    room.stations.set(me.station, { sessionId: started.sessionId, lastScore: 0 });
    return started;
  }

  /** The ship's bilge as rows of the Bilging board: the board's water is the ship's (DESIGN.md 3.3). */
  bilgeRows(room: ShipRoom): number {
    const height = this.content.puzzles.bilging.config.height;
    return Math.min(height, Math.round((room.state.water * height) / 1000));
  }

  /** After a turn, tell the pirate at the pump how deep the bilge is now; their board logs it as a water event. */
  private pushBilge(room: ShipRoom): void {
    const ss = room.stations.get("bilging");
    if (!ss) return;
    const session = this.puzzles.sessions.get(ss.sessionId);
    if (!session || session.closed) return;
    const row = this.bilgeRows(room);
    if (session.shipWaterRow === row) return;
    session.shipWaterRow = row;
    room.conns.send(session.pirateId, { type: "duty.water", sessionId: session.id, row });
  }

  // ---- connections

  /** A pirate's socket opened: if they are aboard, take the seat back and show them the ship. */
  reconnect(pirateId: string, conn: RoomMember<ServerMessage>): void {
    const room = this.roomOf(pirateId);
    if (!room) return;
    const me = crewMember(room.state, pirateId);
    if (me?.awaySinceTurn !== null && me) room.state = reduceShip(room.state, { type: "back", pirateId });
    room.conns.join(conn);
    conn.send(this.stateMessage(room, []));
    // The captain's fight waited for them: hand the board back with every move so far, and the deal they missed.
    const run = room.battle;
    if (run) {
      const session = this.puzzles.sessions.get(run.sessionId);
      if (session && !session.closed && session.pirateId === pirateId) {
        conn.send(this.puzzles.startedMessage(session, true));
        if (session.shipSupply) conn.send({ type: "battle.supply", sessionId: session.id, ...session.shipSupply });
      }
    }
  }

  /** A pirate's socket closed. Their seat is held for the grace period; their board is discarded. */
  async disconnect(pirateId: string, conn: RoomMember<ServerMessage>): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room || room.conns.get(pirateId) !== conn) return;
    room.conns.leave(pirateId);
    const me = crewMember(room.state, pirateId);
    if (me && me.awaySinceTurn === null) room.state = reduceShip(room.state, { type: "away", pirateId });
    if (me?.station) await this.endStation(room, me.station);
    await this.afterChange(room);
  }

  // ---- the clock

  /** Called every second. Applies every turn that is due on every ship. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const room of [...this.rooms.values()]) {
        try {
          let turns = 0;
          while (this.now() >= room.nextTurnAt && turns < 1000) {
            this.takeTurnPoints(room);
            room.state = reduceShip(room.state, { type: "turn" });
            room.nextTurnAt += this.turnMs;
            turns += 1;
            await this.settle(room);
            if (this.rooms.has(room.shipId)) {
              this.pushBilge(room);
              this.pushSupply(room);
            }
          }
          if (turns > 0 && this.rooms.has(room.shipId)) this.broadcast(room, []);
        } catch (e) {
          this.log.error({ err: e, shipId: room.shipId }, "ship turn failed");
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  // ---- the notice board

  async noticeBoard(pirateId: string): Promise<ServerMessage> {
    const islandId = await this.pirateIsland(pirateId);
    const ships: BoardShip[] = [];
    for (const room of this.rooms.values()) {
      const s = room.state;
      if (s.crew.length === 0) continue;
      if (s.islandId !== null && s.islandId !== islandId) continue;
      ships.push({
        shipId: room.shipId,
        name: room.name,
        classId: room.shipClass.id,
        captainName: (s.captainId && room.names.get(s.captainId)) || "",
        crew: s.crew.length,
        maxCrew: room.shipClass.maxCrew,
        location: location(s),
        inviteOnly: s.inviteOnly,
        yours: room.ownerId === pirateId,
      });
    }
    return { type: "board.ships", islandId, ships, serverNow: this.now() };
  }

  async pirateIsland(pirateId: string): Promise<string> {
    const [p] = await this.db.select({ islandId: schema.pirate.islandId }).from(schema.pirate).where(eq(schema.pirate.id, pirateId));
    return p?.islandId ?? this.content.world.startIslandId;
  }

  // ---- internals

  private apply(room: ShipRoom, move: ShipMove, code: (e: InvalidMoveError) => ErrorCode): void {
    try {
      room.state = reduceShip(room.state, move);
    } catch (e) {
      if (e instanceof InvalidMoveError) throw new ShipError(code(e));
      throw e;
    }
  }

  /** Feed each station's points since the last turn into the ship, right before the turn. */
  private takeTurnPoints(room: ShipRoom): void {
    for (const [station, ss] of room.stations) {
      const session = this.puzzles.sessions.get(ss.sessionId);
      if (!session || session.closed) {
        room.stations.delete(station);
        continue;
      }
      const score = this.puzzles.sessions.score(session);
      this.report(room, station, score - ss.lastScore);
      ss.lastScore = score;
    }
  }

  /** The puzzle service is closing a duty board: take what it earned since the last turn. */
  private takeFinalPoints(session: PuzzleSession): void {
    if (!session.duty) return;
    const room = this.rooms.get(session.duty.shipId);
    if (!room) return;
    const station = session.duty.station;
    const ss = room.stations.get(station);
    if (!ss || ss.sessionId !== session.id) return;
    this.report(room, station, this.puzzles.sessions.score(session) - ss.lastScore);
    room.stations.delete(station);
  }

  private report(room: ShipRoom, station: Station, points: number): void {
    if (points <= 0 || !room.state.voyage || !crewAtStation(room.state, station)) return;
    room.state = reduceShip(room.state, { type: "duty", station, points });
    const run = room.battle;
    const who = crewAtStation(room.state, station);
    if (run && who) run.dutyPoints.set(who.pirateId, (run.dutyPoints.get(who.pirateId) ?? 0) + points);
  }

  /** Cut short whatever board is running at a station. */
  private async endStation(room: ShipRoom, station: Station): Promise<void> {
    const ss = room.stations.get(station);
    if (!ss) return;
    const session = this.puzzles.sessions.get(ss.sessionId);
    room.stations.delete(station);
    if (!session) return;
    const result = await this.puzzles.cutShort(session);
    if (result) room.conns.send(session.pirateId, result);
  }

  /** After a crew action: persist its consequences, broadcast, and drop the room if empty. */
  private async afterChange(room: ShipRoom): Promise<void> {
    const events = room.state.events;
    await this.settle(room);
    if (this.rooms.has(room.shipId)) this.broadcast(room, events);
  }

  /** Act on the engine's events: people put ashore, arrivals, abandonments. May delete the room. */
  private async settle(room: ShipRoom): Promise<void> {
    const events = room.state.events;
    for (const e of events) {
      switch (e.type) {
        case "left":
          await this.putAshore(room, e.pirateId, e.reason);
          break;
        case "arrived":
          await this.arrive(room, e.islandId, e.turns);
          break;
        case "abandoned":
          await this.abandon(room, e.islandId);
          break;
        case "sailed":
        case "hailed":
        case "evaded":
        case "engaged":
          void recordEvent(this.db, room.state.captainId, `ship.${e.type}`, { shipId: room.shipId, voyageId: room.voyageId, ...e }).catch((err) =>
            this.log.warn({ err }, "event write failed"),
          );
          break;
        default:
          break;
      }
    }
    if (room.state.crew.length === 0) {
      for (const st of [...room.stations.keys()]) await this.endStation(room, st);
      this.rooms.delete(room.shipId);
    }
  }

  private async putAshore(room: ShipRoom, pirateId: string, reason: "left" | "timed_out"): Promise<void> {
    this.byPirate.delete(pirateId);
    for (const [st, ss] of room.stations) {
      const session = this.puzzles.sessions.get(ss.sessionId);
      if (session?.pirateId === pirateId) await this.endStation(room, st);
    }
    // The captain's fight goes with them: the ship breaks off.
    if (room.battle && this.puzzles.sessions.get(room.battle.sessionId)?.pirateId === pirateId) await this.cutBattleShort(room, "disengaged");
    const islandId = room.state.islandId ?? room.state.voyage?.leg.from ?? this.content.world.startIslandId;
    await this.db.update(schema.pirate).set({ islandId }).where(eq(schema.pirate.id, pirateId));
    if (room.voyageId) {
      await this.db
        .update(schema.voyageCrew)
        .set({ leftAt: new Date(this.now()) })
        .where(and(eq(schema.voyageCrew.voyageId, room.voyageId), eq(schema.voyageCrew.pirateId, pirateId)));
    }
    room.conns.send(pirateId, { type: "ship.left", shipId: room.shipId, reason });
    room.conns.leave(pirateId);
    this.onAshore?.(pirateId, islandId);
  }

  private async arrive(room: ShipRoom, islandId: string, turns: number): Promise<void> {
    for (const st of [...room.stations.keys()]) await this.endStation(room, st);
    const crewIds = room.state.crew.map((c) => c.pirateId);
    const voyageId = room.voyageId;
    room.voyageId = null;
    await this.db.transaction(async (tx) => {
      await tx.update(schema.ship).set({ islandId }).where(eq(schema.ship.id, room.shipId));
      if (crewIds.length) await tx.update(schema.pirate).set({ islandId }).where(inArray(schema.pirate.id, crewIds));
      if (voyageId) {
        await tx
          .update(schema.voyage)
          .set({ endedAt: new Date(this.now()), outcome: "arrived", turns, encounter: encounterOf(room) })
          .where(eq(schema.voyage.id, voyageId));
      }
      await recordEvent(tx, room.state.captainId, "voyage.completed", { shipId: room.shipId, voyageId, islandId, turns, crew: crewIds.length });
    });
    this.log.info({ shipId: room.shipId, islandId, turns, crew: crewIds.length }, "ship arrived");
    this.onSummaryChanged?.(crewIds.includes(room.ownerId) ? crewIds : [...crewIds, room.ownerId]);
  }

  private async abandon(room: ShipRoom, islandId: string): Promise<void> {
    for (const st of [...room.stations.keys()]) await this.endStation(room, st);
    if (room.battle) await this.cutBattleShort(room, "disengaged");
    const voyageId = room.voyageId;
    room.voyageId = null;
    await this.db.transaction(async (tx) => {
      await tx.update(schema.ship).set({ islandId }).where(eq(schema.ship.id, room.shipId));
      if (voyageId) {
        await tx.update(schema.voyage).set({ endedAt: new Date(this.now()), outcome: "abandoned", turns: room.state.turn, encounter: encounterOf(room) }).where(eq(schema.voyage.id, voyageId));
      }
      await recordEvent(tx, null, "voyage.abandoned", { shipId: room.shipId, voyageId, islandId });
    });
    this.onSummaryChanged?.([room.ownerId]);
  }

  private broadcast(room: ShipRoom, events: readonly ShipEvent[]): void {
    room.conns.broadcast(this.stateMessage(room, events));
  }

  stateMessage(room: ShipRoom, events: readonly ShipEvent[]): ServerMessage {
    return { type: "ship.state", ship: this.snapshot(room), events: events.map((e) => wireEvent(room, e)), serverNow: this.now() };
  }

  snapshot(room: ShipRoom): ShipSnapshot {
    const s = room.state;
    const crew: CrewView[] = s.crew.map((c) => ({
      pirateId: c.pirateId,
      name: room.names.get(c.pirateId) ?? c.pirateId,
      station: c.station,
      captain: c.pirateId === s.captainId,
      away: c.awaySinceTurn !== null,
    }));
    return {
      shipId: room.shipId,
      name: room.name,
      classId: room.shipClass.id,
      ownerId: room.ownerId,
      captainId: s.captainId,
      crew,
      maxCrew: room.shipClass.maxCrew,
      inviteOnly: s.inviteOnly,
      location: location(s),
      turn: s.turn,
      water: s.water,
      damage: s.damage,
      loaded: s.loaded,
      cannons: room.shipClass.cannons,
      lastTurn: s.lastTurn ? { turn: s.lastTurn.turn, outputs: { ...s.lastTurn.outputs }, held: s.lastTurn.held, speed: s.lastTurn.speed, tokens: s.lastTurn.tokens } : null,
      nextTurnAt: room.nextTurnAt,
      turnMs: this.turnMs,
      voyagesCompleted: s.voyagesCompleted,
    };
  }
}

/** Derive the engine's config for a class: par per station is the puzzle's par scaled to one turn. */
export function shipConfigFor(content: Content, shipClass: ShipClass): ShipConfig {
  const rules = content.world.ship;
  const par = {} as Record<Station, number>;
  for (const st of STATIONS) {
    const p = content.puzzles[st];
    par[st] = Math.max(1, Math.round((p.parScore * rules.turnSeconds) / p.roundSeconds));
  }
  return {
    shipClass: { id: shipClass.id, stations: shipClass.stations, maxCrew: shipClass.maxCrew, cannons: shipClass.cannons, baseTokens: shipClass.baseTokens },
    rules,
    par,
  };
}

export function legPlan(route: RouteLeg) {
  return {
    routeId: route.id,
    from: route.from,
    to: route.to,
    lengthUnits: legUnits(route.durationSeconds),
    encounterChancePercent: Math.round(route.encounterChance * 100),
    brigands: route.brigands,
  };
}

function location(s: ShipState): ShipLocation {
  if (s.voyage) {
    const v = s.voyage;
    return { kind: "at-sea", routeId: v.leg.routeId, from: v.leg.from, to: v.leg.to, progress: progressPermille(s), hail: v.hail, battle: v.battle };
  }
  return { kind: "docked", islandId: s.islandId ?? "" };
}

function encounterOf(room: ShipRoom): { tierId: string; evaded: boolean } | null {
  const e = room.state.voyage?.encounter;
  return e ? { tierId: e.tierId, evaded: e.resolved } : null;
}

/** The ship's movement tokens as the battle board's kinds: half forward, the rest split between the turns. */
export function splitTokens(n: number): { left: number; forward: number; right: number } {
  const forward = Math.ceil(n / 2);
  const rest = n - forward;
  const left = Math.ceil(rest / 2);
  return { left, forward, right: rest - left };
}

/**
 * Booty split among everyone aboard, weighted by duty performance during the fight, with an extra
 * share for the captain (DESIGN.md 3.4): a base of two shares for the captain and one for everyone
 * else, each scaled between half and full by the pirate's points against the best aboard. What the
 * floors leave over goes to the captain. Integer arithmetic throughout.
 */
export function splitBooty(total: number, crew: ReadonlyArray<{ pirateId: string; captain: boolean; points: number }>): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || crew.length === 0) return out;
  const top = Math.max(0, ...crew.map((c) => c.points));
  const weights = crew.map((c) => (c.captain ? 2 : 1) * (top > 0 ? 50 + Math.floor((50 * c.points) / top) : 100));
  const sum = weights.reduce((a, b) => a + b, 0);
  let paid = 0;
  crew.forEach((c, i) => {
    const coins = Math.floor((total * weights[i]!) / sum);
    out.set(c.pirateId, coins);
    paid += coins;
  });
  const captain = crew.find((c) => c.captain) ?? crew[0]!;
  out.set(captain.pirateId, (out.get(captain.pirateId) ?? 0) + (total - paid));
  return out;
}

function wireEvent(room: ShipRoom, e: ShipEvent): ShipEventWire {
  const name = (id: string): string => room.names.get(id) ?? id;
  switch (e.type) {
    case "boarded":
      return { type: "boarded", pirateId: e.pirateId, name: name(e.pirateId) };
    case "left":
      return { type: "left", pirateId: e.pirateId, name: name(e.pirateId), reason: e.reason };
    case "station":
      return { type: "station", pirateId: e.pirateId, name: name(e.pirateId), station: e.station };
    case "wheel":
      return { type: "wheel", pirateId: e.pirateId, name: name(e.pirateId) };
    default:
      return e;
  }
}
