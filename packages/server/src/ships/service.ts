import { and, eq, inArray } from "drizzle-orm";
import type { BrigandTier, Content, RouteLeg, ShipClass } from "@openseas/content";
import {
  InvalidMoveError,
  STATIONS,
  battleIsWin,
  createShip,
  createSwordfightGame,
  crewAtStation,
  crewMember,
  legUnits,
  pirates,
  progressPermille,
  reduceShip,
  reduceSwordfight,
  summarizeSwordfight,
  swordfightBoardLoad,
  swordfightBoardString,
  type BattleConfig,
  type BattleState,
  type ShipBattleOutcome,
  type SwordfightConfig,
  type SwordfightState,
  type ShipConfig,
  type ShipEvent,
  type ShipMove,
  type ShipState,
  type Station,
} from "@openseas/engine";
import type { BoardShip, CrewView, ErrorCode, MeleeBoardWire, PuzzleStarted, ServerMessage, ShipEventWire, ShipLocation, ShipSnapshot } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import { recordEvent } from "../events.js";
import { appendLedger } from "../ledger.js";
import type { Logger } from "../log.js";
import { randomPirateName } from "../pirates.js";
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

/** The boarding melee in progress (M5, ADR 0022): every pirate's own fight, and the brigand crew's fight the server runs. */
export interface MeleeRun {
  tierId: string;
  seed: string;
  startedAt: number;
  deadlineAt: number;
  tickMs: number;
  /** The brigand crew's fight: one AI board per pirate at the rail, no player in it. */
  crew: SwordfightState;
  /** Each pirate's own fight, by pirate id: the session it runs in. */
  fights: Map<string, string>;
  /** Scores of fights already over, for the booty split. */
  scores: Map<string, number>;
  /** Duty points from the sea battle before the boarding, carried into the split. */
  dutyPoints: Map<string, number>;
  /** Sea battle turns fought before the boarding, for the log. */
  turns: number;
  settling: boolean;
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
  melee: MeleeRun | null = null;
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
    puzzles.onMeleeMove = (session) => void this.takeMeleeMove(session).catch((e) => log.error({ err: e, sessionId: session.id }, "melee move failed"));
    puzzles.onMeleeEnd = (session) => void this.meleeEnded(session).catch((e) => log.error({ err: e, sessionId: session.id }, "melee end failed"));
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
      const crew = pirates(room.state.crew);
      await tx.insert(schema.voyageCrew).values(crew.map((c) => ({ voyageId, pirateId: c.pirateId, boardedAt: new Date(this.now()) })));
      await recordEvent(tx, pirateId, "voyage.started", { shipId: room.shipId, voyageId, routeId, crew: crew.length, mates: room.state.crew.length - crew.length });
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
    this.apply(room, { type: "wheel", pirateId: toPirateId }, (e) => (e.message === "not a pirate" ? "is_deckhand" : "not_aboard"));
    await this.afterChange(room);
  }

  /** The captain sends a deckhand to a station it works, or stands it down. A pirate's station is never taken from them. */
  async assign(pirateId: string, mateId: string, station: Station | null): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    this.apply(room, { type: "assign", pirateId: mateId, station }, (e) =>
      e.message === "station taken" ? "station_taken" : e.message === "not a deckhand" ? "not_deckhand" : e.message === "not aboard" ? "not_aboard" : "not_mate_station",
    );
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
    // Either boarding opens the melee at the rail; the melee decides the booty (M5, ADR 0022).
    if ((outcome === "boarded" || outcome === "boarded_by") && tier && room.state.voyage?.battle && this.openMelee(room, tier, run.dutyPoints, turns)) return;
    await this.payBattle(room, run.tierId, run.dutyPoints, outcome, turns);
  }

  /** The fight is decided: pay out, tell the ship, log it. `points` weights the split per pirate. */
  private async payBattle(room: ShipRoom, tierId: string, points: ReadonlyMap<string, number>, outcome: ShipBattleOutcome, turns: number): Promise<void> {
    const tier = this.content.world.brigandTiers.find((t) => t.id === tierId);
    const won = battleIsWin(outcome);
    const booty = won && tier ? tier.booty : 0;
    // Deckhands work for their keep; the purse is the pirates'.
    const crew = pirates(room.state.crew).map((c) => ({ pirateId: c.pirateId, captain: c.pirateId === room.state.captainId, points: points.get(c.pirateId) ?? 0 }));
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
      if (voyageId) await tx.update(schema.voyage).set({ encounter: { tierId, evaded: false, outcome, booty } }).where(eq(schema.voyage.id, voyageId));
      await recordEvent(tx, room.state.captainId, "ship.battle_ended", { shipId: room.shipId, voyageId, tierId, outcome, booty, turns, shares: Object.fromEntries(shares) });
    });
    this.log.info({ shipId: room.shipId, tierId, outcome, booty, turns }, "battle ended");
    if (shares.size) this.onSummaryChanged?.([...shares.keys()]);
    await this.afterChange(room);
  }

  // ---- the boarding melee (M5, ADR 0022)

  /** The melee's config for a pirate's own board: content's rules with nobody else in the fight; the brigand crew is outside it. */
  private meleeConfigFor(): SwordfightConfig {
    const base = this.content.puzzles.swordfight.config;
    return { ...base, player: true, allies: [], foes: [] };
  }

  /**
   * Grappling hooks are over: everyone aboard and connected gets a board, the brigand crew gets one
   * board per pirate with the tier's hand, and the ship holds position until the rail is decided.
   * Returns false when nobody is there to fight, in which case the sea battle settles as it stood.
   */
  private openMelee(room: ShipRoom, tier: BrigandTier, dutyPoints: Map<string, number>, turns: number): boolean {
    // Deckhands hold no board and never fight; a pirate's seat may be held while they are away.
    const connected = room.state.crew.filter((c) => !c.mate && c.awaySinceTurn === null && room.conns.has(c.pirateId));
    if (connected.length === 0 || room.melee) return false;
    const base = this.content.puzzles.swordfight.config;
    const now = this.now();
    const seed = this.opts.randomSeed();
    const crewConfig: SwordfightConfig = { ...base, player: false, blade: 0, allies: connected.slice(0, 8).map(() => ({ ...tier.swordsmen })), foes: [] };
    room.melee = {
      tierId: tier.id,
      seed,
      startedAt: now,
      deadlineAt: now + base.maxTick * base.tickMs,
      tickMs: base.tickMs,
      crew: createSwordfightGame(seed, crewConfig),
      fights: new Map(),
      scores: new Map(),
      dutyPoints,
      turns,
      settling: false,
    };
    this.log.info({ shipId: room.shipId, tierId: tier.id, pirates: connected.length }, "melee opened");
    void (async () => {
      // Every station comes to the rail; a board cut short counts, unrated.
      for (const st of [...room.stations.keys()]) await this.endStation(room, st);
      for (const c of connected) this.dealMelee(room, c.pirateId);
      this.broadcast(room, [{ type: "boarding", tierId: tier.id }]);
      this.pushBoards(room);
    })().catch((e) => this.log.error({ err: e, shipId: room.shipId }, "melee open failed"));
    return true;
  }

  /** A pirate's own fight in the melee: dealt and sent. */
  private dealMelee(room: ShipRoom, pirateId: string): PuzzleStarted | null {
    const run = room.melee;
    if (!run || !room.voyageId) return null;
    const roundMs = Math.max(10_000, run.deadlineAt - this.now());
    const started = this.puzzles.startMelee(pirateId, { shipId: room.shipId, voyageId: room.voyageId, tierId: run.tierId }, { config: this.meleeConfigFor(), roundMs });
    run.fights.set(pirateId, started.sessionId);
    room.conns.send(pirateId, started);
    return started;
  }

  /** A pirate aboard without a board in the melee (came aboard, or back, mid-fight) asks for one; one they still hold is handed back. */
  async meleeJoin(pirateId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    const run = room.melee;
    if (!run) throw new ShipError("not_in_melee");
    const sessionId = run.fights.get(pirateId);
    const session = sessionId ? this.puzzles.sessions.get(sessionId) : undefined;
    if (session && !session.closed) {
      room.conns.send(pirateId, this.puzzles.startedMessage(session, true));
      for (const p of session.meleeIncoming) room.conns.send(pirateId, { type: "melee.incoming", sessionId: session.id, wrack: p.wrack, blade: p.blade, from: run.tierId });
    } else if (run.scores.has(pirateId) || !this.dealMelee(room, pirateId)) {
      // A board already fought in this melee is the pirate's one board in it.
      throw new ShipError("not_in_melee");
    }
    this.pushBoards(room);
  }

  /** The brigand crew's clock: ticks since the melee opened, on the fight's tick. */
  private crewTick(run: MeleeRun): number {
    return Math.min(run.crew.config.maxTick, Math.floor((this.now() - run.startedAt) / run.tickMs));
  }

  /** The brigand crew's fight catches up with the clock; what it sends goes to the pirate with the least on their board. */
  private async advanceMelee(room: ShipRoom): Promise<void> {
    const run = room.melee;
    if (!run || run.settling) return;
    if (this.now() >= run.deadlineAt) {
      await this.settleMelee(room, "broke_off");
      return;
    }
    const tick = this.crewTick(run);
    if (tick > run.crew.tick && !run.crew.finished) {
      run.crew = reduceSwordfight(run.crew, { type: "wait", tick });
      const events = run.crew.lastMove?.events ?? [];
      for (const e of events) if (e.type === "attack" && e.to === -1 && e.wrack > 0) this.sendToPirate(room, e.wrack, e.blade);
      if (events.length) this.pushBoards(room);
    }
    await this.checkMelee(room);
  }

  /** Wrack from the brigand crew: announced to the connected pirate with the least on their board, to be logged by them. */
  private sendToPirate(room: ShipRoom, wrack: number, blade: number): void {
    const run = room.melee;
    if (!run) return;
    let best: PuzzleSession | null = null;
    let bestLoad = Infinity;
    for (const [pirateId, sessionId] of run.fights) {
      if (!room.conns.has(pirateId)) continue;
      const session = this.puzzles.sessions.get(sessionId);
      if (!session || session.closed) continue;
      const state = session.state as SwordfightState;
      const board = state.boards[0]!;
      if (board.out || state.finished) continue;
      const load = swordfightBoardLoad(board) + session.meleeIncoming.reduce((n, p) => n + p.wrack, 0);
      if (load < bestLoad) {
        best = session;
        bestLoad = load;
      }
    }
    if (!best) return;
    best.meleeIncoming.push({ wrack, blade });
    room.conns.send(best.pirateId, { type: "melee.incoming", sessionId: best.id, wrack, blade, from: run.tierId });
  }

  /** Wrack from a pirate's board: lands on the brigand with the least on their board. */
  private sendToCrew(room: ShipRoom, wrack: number, blade: number): void {
    const run = room.melee;
    if (!run || run.crew.finished) return;
    let target = -1;
    let bestLoad = Infinity;
    run.crew.boards.forEach((b, i) => {
      if (b.out) return;
      const load = swordfightBoardLoad(b);
      if (load < bestLoad) {
        target = i;
        bestLoad = load;
      }
    });
    if (target < 0) return;
    const tick = Math.max(run.crew.tick, this.crewTick(run));
    try {
      run.crew = reduceSwordfight(run.crew, { type: "incoming", board: target, wrack: Math.min(999, wrack), blade, tick });
    } catch (e) {
      if (!(e instanceof InvalidMoveError)) throw e;
    }
  }

  /** A pirate's board took a move: route what it sent, score it if it is over, and see whether the rail is decided. */
  private async takeMeleeMove(session: PuzzleSession): Promise<void> {
    const binding = session.melee;
    if (!binding) return;
    const room = this.rooms.get(binding.shipId);
    const run = room?.melee;
    if (!room || !run || run.fights.get(session.pirateId) !== session.id) return;
    const state = session.state as SwordfightState;
    const events = state.lastMove?.events ?? [];
    for (const e of events) if (e.type === "attack" && e.board === 0 && e.to === -1 && e.wrack > 0) this.sendToCrew(room, e.wrack, e.blade);
    if (state.finished && !session.closed) {
      // The board filled: the engine has the outcome and the pirate is owed the result.
      const result = await this.puzzles.finish(session, null, null);
      room.conns.send(session.pirateId, result);
    }
    if (events.length) this.pushBoards(room);
    await this.checkMelee(room);
  }

  /** A pirate's melee session closed, however it closed: keep its score for the split. */
  private async meleeEnded(session: PuzzleSession): Promise<void> {
    const binding = session.melee;
    if (!binding) return;
    const room = this.rooms.get(binding.shipId);
    const run = room?.melee;
    if (!room || !run || run.fights.get(session.pirateId) !== session.id) return;
    run.scores.set(session.pirateId, summarizeSwordfight(session.state as SwordfightState).score);
    run.fights.delete(session.pirateId);
    this.pushBoards(room);
    await this.checkMelee(room);
  }

  /** The rail is decided when every brigand board is out, or every pirate's. */
  private async checkMelee(room: ShipRoom): Promise<void> {
    const run = room.melee;
    if (!run || run.settling) return;
    if (run.crew.finished) {
      await this.settleMelee(room, "boarded");
      return;
    }
    let standing = 0;
    for (const sessionId of run.fights.values()) {
      const session = this.puzzles.sessions.get(sessionId);
      if (session && !session.closed && !(session.state as SwordfightState).boards[0]!.out) standing += 1;
    }
    if (standing === 0) await this.settleMelee(room, "boarded_by");
  }

  /**
   * The melee is over: the ship's word on every board still open, the booty by the sea battle's
   * split weighted by duty points and the fight's own scores, the voyage resumes.
   */
  private async settleMelee(room: ShipRoom, outcome: ShipBattleOutcome): Promise<void> {
    const run = room.melee;
    if (!run || run.settling) return;
    run.settling = true;
    const won = outcome === "boarded";
    const tick = Math.max(0, this.crewTick(run));
    for (const [pirateId, sessionId] of run.fights) {
      const session = this.puzzles.sessions.get(sessionId);
      if (!session || session.closed) continue;
      let result: ServerMessage | null;
      if (won) {
        const at = Math.max(tick, (session.state as SwordfightState).tick);
        room.conns.send(pirateId, { type: "melee.over", sessionId, won: true, tick: at });
        result = await this.puzzles.endMelee(session, true, at);
      } else result = await this.puzzles.cutShort(session);
      if (result) room.conns.send(pirateId, result);
      run.scores.set(pirateId, summarizeSwordfight(session.state as SwordfightState).score);
    }
    room.melee = null;
    const points = new Map<string, number>();
    for (const c of room.state.crew) points.set(c.pirateId, (run.dutyPoints.get(c.pirateId) ?? 0) + (run.scores.get(c.pirateId) ?? 0));
    this.log.info({ shipId: room.shipId, tierId: run.tierId, outcome }, "melee ended");
    await this.payBattle(room, run.tierId, points, outcome, run.turns);
  }

  /** Every board in the melee, to everyone aboard. */
  private pushBoards(room: ShipRoom): void {
    const run = room.melee;
    if (!run) return;
    const boards: MeleeBoardWire[] = [];
    for (const [pirateId, sessionId] of run.fights) {
      const session = this.puzzles.sessions.get(sessionId);
      if (!session || session.closed) continue;
      const state = session.state as SwordfightState;
      const b = state.boards[0]!;
      boards.push({
        pirateId,
        name: room.names.get(pirateId) ?? pirateId,
        side: 0,
        cells: swordfightBoardString(state.config, b.cells),
        pending: b.pending.reduce((n, p) => n + p.wrack, 0) + session.meleeIncoming.reduce((n, p) => n + p.wrack, 0),
        out: b.out,
        points: b.points,
      });
    }
    run.crew.boards.forEach((b) => {
      boards.push({ pirateId: null, name: "", side: 1, cells: swordfightBoardString(run.crew.config, b.cells), pending: b.pending.reduce((n, p) => n + p.wrack, 0), out: b.out, points: b.points });
    });
    room.conns.broadcast({ type: "melee.boards", shipId: room.shipId, boards, serverNow: this.now() });
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
    // Their board at the rail waited too: the fight so far, and the wrack announced while they were away.
    const melee = room.melee;
    const fight = melee?.fights.get(pirateId);
    if (melee && fight) {
      const session = this.puzzles.sessions.get(fight);
      if (session && !session.closed) {
        conn.send(this.puzzles.startedMessage(session, true));
        for (const p of session.meleeIncoming) conn.send({ type: "melee.incoming", sessionId: session.id, wrack: p.wrack, blade: p.blade, from: melee.tierId });
      }
      this.pushBoards(room);
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
          if (room.melee) await this.advanceMelee(room);
          let turns = 0;
          const events: ShipEvent[] = [];
          while (this.now() >= room.nextTurnAt && turns < 1000) {
            this.takeTurnPoints(room);
            room.state = reduceShip(room.state, { type: "turn" });
            room.nextTurnAt += this.turnMs;
            turns += 1;
            events.push(...room.state.events);
            await this.settle(room);
            if (this.rooms.has(room.shipId)) {
              this.pushBilge(room);
              this.pushSupply(room);
            }
          }
          if (turns > 0 && this.rooms.has(room.shipId)) this.broadcast(room, events);
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
        crew: pirates(s.crew).length,
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
        case "hired":
          room.names.set(e.pirateId, this.mateName(room));
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
    // A pirate who leaves the rail leaves their board; it counts, unrated, and the melee goes on without them.
    const fight = room.melee?.fights.get(pirateId);
    if (fight) {
      const session = this.puzzles.sessions.get(fight);
      if (session && !session.closed) {
        const result = await this.puzzles.cutShort(session);
        if (result) room.conns.send(pirateId, result);
      }
    }
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
    const crewIds = pirates(room.state.crew).map((c) => c.pirateId);
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
    if (room.melee) await this.settleMelee(room, "broke_off");
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

  /**
   * A deckhand looks like any pirate: a name from the same lists, unlike anyone's aboard. The
   * snapshot's `mate` flag, not the name, is what tells players it is not one of them.
   */
  private mateName(room: ShipRoom): string {
    const taken = new Set(room.names.values());
    for (let attempt = 0; attempt < 20; attempt++) {
      const name = randomPirateName(this.content);
      if (!taken.has(name)) return name;
    }
    return `${randomPirateName(this.content)} ${room.names.size + 1}`;
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
      mate: c.mate,
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
      melee: room.melee ? { tierId: room.melee.tierId } : null,
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
    shipClass: { id: shipClass.id, stations: shipClass.stations, maxCrew: shipClass.maxCrew, minCrew: shipClass.minCrew, mateStations: shipClass.mateStations, cannons: shipClass.cannons, baseTokens: shipClass.baseTokens },
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
    case "hired":
      return { type: "hired", pirateId: e.pirateId, name: name(e.pirateId), station: e.station };
    case "paid_off":
      return { type: "paid_off", names: e.pirateIds.map(name) };
    default:
      return e;
  }
}
