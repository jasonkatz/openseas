import { and, eq, inArray } from "drizzle-orm";
import { defaultLook, type RaiderTier, type Content, type PirateLook, type ShipClass } from "@openseas/content";
import {
  InvalidMoveError,
  battleConfigAboard,
  battlePurse,
  fightGoesToMelee,
  raiderSpecFor,
  createShip,
  crewAtStation,
  crewMember,
  legPlan,
  pirates,
  progressPermille,
  reduceShip,
  heatRowsFor,
  shipConfigFor as engineShipConfigFor,
  shipSupply,
  turnPlunderOutputs,
  summarizeSwordfight,
  type BattleConfig,
  type BattleState,
  type ShipBattleOutcome,
  type SwordfightState,
  type ShipConfig,
  type ShipEvent,
  type ShipMove,
  type ShipState,
  type Station,
  type SwordfightMove,
} from "@openseas/engine";
import type { BoardShip, CrewTag, CrewView, ErrorCode, PuzzleStarted, ServerMessage, ShipEventWire, ShipLocation, ShipSnapshot } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import { recordEvent } from "../events.js";
import { appendLedger } from "../ledger.js";
import type { Logger } from "../log.js";
import { randomBotName } from "../pirates.js";
import type { BoardEnd, BoardHost, PuzzleService } from "../puzzles/service.js";
import type { PuzzleSession } from "../puzzles/sessions.js";
import { Room, type RoomMember } from "../rooms.js";
import { Melee, type PirateBoards } from "./melee.js";

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
  /** What each pirate's station gave the ship since the fight began, in percent of par summed over turns, for the plunder (ADR 0030). */
  dutyOutput: Map<string, number>;
  /** The last battle turn the ship has taken hits and shots from. */
  turnsSeen: number;
  /** The ship's hull as the board last learned it, to read what a turn took off it. */
  hullSent: number;
}

/** One ship with people aboard. Exists from the first boarding until the last pirate disembarks. */
export class ShipRoom {
  /** Connections of the crew, keyed by pirate id. A dropped pirate is not in here but is still aboard. */
  readonly conns: Room<ServerMessage>;
  /** Every name seen aboard, kept after leaving so events can still say who. */
  readonly names = new Map<string, string>();
  readonly stations = new Map<Station, StationSession>();
  voyageId: string | null = null;
  battle: BattleRun | null = null;
  /** The boarding melee in progress (M5, ADR 0022). */
  melee: Melee | null = null;
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

/** What the ship service asks of crews (M6, ADR 0025): who flies with whom, and whose colors a ship flies. */
export interface CrewLookup {
  crewIdOf(pirateId: string): string | null;
  tagOf(pirateId: string): CrewTag | null;
  sameCrew(a: string, b: string): boolean;
}

/** What the ship service asks of pirates: what each wears on deck (DESIGN.md 3.6). */
export interface LookLookup {
  lookOf(pirateId: string): PirateLook;
}

export interface ShipServiceOptions {
  now?: () => number;
  randomSeed: () => string;
  randomId: () => string;
}

/**
 * Ships as rooms (ADR 0005): runs the engine's ship reducer on a turn clock, binds duty boards to
 * stations, and persists what must outlive the process (where ships and pirates are, voyages).
 * Everything else about a ship in flight is in memory; a restart puts every ship back in port.
 */
export class ShipService {
  /** A pirate stepped (or was put) at an outpost. The connection layer rejoins them to the outpost. */
  onDisembark: ((pirateId: string, outpostId: string) => void) | null = null;
  /** A pirate went aboard; they are no longer on the outpost anywhere. */
  onBoarded: ((pirateId: string) => void) | null = null;
  /** These pirates' summaries changed (a ship or a pirate moved outposts); the connection layer re-sends them. */
  onSummaryChanged: ((pirateIds: readonly string[]) => void) | null = null;
  /** A ship launched with these pirates aboard, bound for `to`. Crews tell their members on the outpost. */
  onLaunched: ((room: ShipRoom, to: string, pirateIds: readonly string[]) => void) | null = null;
  /** A voyage reached port with these pirates aboard. Crews count it. */
  onArrived: ((pirateIds: readonly string[]) => void) | null = null;
  /** A raider was beaten and the purse paid, pirate by pirate. Crews count it. */
  onVictory: ((room: ShipRoom, tierId: string, shares: ReadonlyMap<string, number>) => void) | null = null;
  /** Crews, once the crew service exists; without it nobody shares a crew and no ship flies colors. */
  crews: CrewLookup | null = null;
  /** Looks, once the connection layer has them; without it every pirate wears the default for their id. */
  looks: LookLookup | null = null;
  private readonly rooms = new Map<string, ShipRoom>();
  private readonly byPirate = new Map<string, string>();
  private readonly configs = new Map<string, ShipConfig>();
  /** Melees the ship is settling: it awaits each board's end in turn, and meanwhile nothing advances or decides them. */
  private readonly settling = new WeakSet<Melee>();
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
      const outpostId = ship.outpostId ?? this.content.world.startOutpostId;
      if (outpostId !== (await this.pirateOutpost(pirateId))) throw new ShipError("ship_elsewhere");
      const state = createShip(this.opts.randomSeed(), this.configFor(ship.classId), outpostId);
      room = new ShipRoom(ship.id, ship.name, shipClass, ship.ownerId, state, this.now() + this.turnMs);
      this.rooms.set(shipId, room);
    } else if (room.state.outpostId !== null && room.state.outpostId !== (await this.pirateOutpost(pirateId))) {
      throw new ShipError("ship_elsewhere");
    }
    if (room.state.inviteOnly && !this.mayBoardLocked(room, pirateId)) throw new ShipError("ship_locked");
    this.apply(room, { type: "board", pirateId }, (e) => (e.message === "ship is full" ? "ship_full" : "already_aboard"));
    room.names.set(pirateId, name);
    room.conns.join(conn);
    this.byPirate.set(pirateId, shipId);
    if (room.voyageId) {
      await this.db.insert(schema.voyageCrew).values({ voyageId: room.voyageId, pirateId }).onConflictDoNothing();
    }
    void recordEvent(this.db, pirateId, "ship.boarded", { shipId, inFlight: room.state.voyage !== null }).catch((e) => this.log.warn({ err: e }, "event write failed"));
    this.onBoarded?.(pirateId);
    await this.afterChange(room);
  }

  /** A crew-only ship (M6) takes its owner and the owner's crew. */
  private mayBoardLocked(room: ShipRoom, pirateId: string): boolean {
    return pirateId === room.ownerId || Boolean(this.crews?.sameCrew(room.ownerId, pirateId));
  }

  /**
   * Whether a pirate standing at `outpostId` (null when aboard somewhere) could board this ship right
   * now: not aboard another, a berth free, the ship open to them, and either in flight or at their dock.
   */
  canJoin(room: ShipRoom, pirateId: string, outpostId: string | null): boolean {
    if (this.byPirate.has(pirateId)) return false;
    if (pirates(room.state.crew).length >= room.shipClass.maxCrew) return false;
    if (room.state.inviteOnly && !this.mayBoardLocked(room, pirateId)) return false;
    return room.state.outpostId === null || room.state.outpostId === outpostId;
  }

  /** Where a ship is, as the wire says it. */
  where(room: ShipRoom): ShipLocation {
    return location(room.state);
  }

  /** Crews changed for these pirates: every ship they are aboard or own shows the new colors. */
  refreshColors(pirateIds: readonly string[]): void {
    const ids = new Set(pirateIds);
    for (const room of this.rooms.values()) {
      if (ids.has(room.ownerId) || room.state.crew.some((c) => ids.has(c.pirateId))) this.broadcast(room, []);
    }
  }

  /** These pirates changed what they wear: every ship they are aboard shows it. */
  refreshLooks(pirateIds: readonly string[]): void {
    const ids = new Set(pirateIds);
    for (const room of this.rooms.values()) if (room.state.crew.some((c) => ids.has(c.pirateId))) this.broadcast(room, []);
  }

  /** The ships in flight right now, for the chart of a pirate who is on the outpost. */
  shipsInFlight(): ShipRoom[] {
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

  async launch(pirateId: string, laneId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    if (room.state.outpostId === null) throw new ShipError("not_docked");
    const lane = this.content.world.lanes.find((r) => r.id === laneId);
    if (!lane || lane.from !== room.state.outpostId) throw new ShipError("bad_lane");
    this.apply(room, { type: "launch", leg: legPlan(lane) }, () => "bad_lane");
    const voyageId = this.opts.randomId();
    room.voyageId = voyageId;
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.voyage).values({ id: voyageId, shipId: room.shipId, laneId, captainId: pirateId, startedAt: new Date(this.now()) });
      const crew = pirates(room.state.crew);
      await tx.insert(schema.voyageCrew).values(crew.map((c) => ({ voyageId, pirateId: c.pirateId, boardedAt: new Date(this.now()) })));
      await recordEvent(tx, pirateId, "voyage.started", { shipId: room.shipId, voyageId, laneId, crew: crew.length, bots: room.state.crew.length - crew.length });
    });
    await this.afterChange(room);
    this.onLaunched?.(room, lane.to, pirates(room.state.crew).map((c) => c.pirateId));
  }

  async evade(pirateId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    this.apply(room, { type: "evade" }, () => "not_hailed");
    await this.afterChange(room);
  }

  async helm(pirateId: string, toPirateId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    // The battle board is the captain's own; the helm changes hands once the fight is over.
    if (room.battle) throw new ShipError("in_battle");
    this.apply(room, { type: "helm", pirateId: toPirateId }, (e) => (e.message === "not a pirate" ? "is_bot" : "not_aboard"));
    await this.afterChange(room);
  }

  /** The captain sends a bot to a station it works, or stands it down. A pirate's station is never taken from them. */
  async assign(pirateId: string, botId: string, station: Station | null): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    if (room.state.captainId !== pirateId) throw new ShipError("not_captain");
    this.apply(room, { type: "assign", pirateId: botId, station }, (e) =>
      e.message === "station taken" ? "station_taken" : e.message === "not a bot" ? "not_bot" : e.message === "not aboard" ? "not_aboard" : "not_bot_station",
    );
    await this.afterChange(room);
  }

  // ---- the space battle (M4)

  /**
   * The captain fights the raider that hailed. The ship holds position; the battle board is a
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
    const tier = this.content.world.raiderTiers.find((t) => t.id === hail.tierId);
    if (!tier) throw new ShipError("not_hailed");
    this.apply(room, { type: "engage" }, () => "not_hailed");
    const config = this.battleConfigFor(room, tier);
    const rules = this.content.world.ship;
    // Room for every turn, the captain's grace period if they drop, and a minute to spare.
    const roundMs = (config.maxTurns + rules.graceTurns) * this.turnMs + 60_000;
    const started = this.puzzles.start(pirateId, "battle", {
      binding: { kind: "battle", shipId: room.shipId, voyageId: room.voyageId, tierId: tier.id },
      override: { config, roundMs },
      host: this.battleHost(room, pirateId),
    });
    room.battle = { sessionId: started.sessionId, tierId: tier.id, dutyOutput: new Map(), turnsSeen: 0, hullSent: room.state.damage };
    this.log.info({ shipId: room.shipId, tierId: tier.id, sessionId: started.sessionId }, "battle engaged");
    await this.afterChange(room);
    return started;
  }

  /** The battle board's config aboard: content's rules with the ship's guns and hull, the tier's raider, the ship's turn. */
  battleConfigFor(room: ShipRoom, tier: RaiderTier): BattleConfig {
    const theirClass = this.content.world.shipClasses.find((c) => c.id === tier.shipClassId) ?? room.shipClass;
    return battleConfigAboard(this.content.puzzles.battle.config, room.state, raiderSpecFor(tier, theirClass.turrets), tier.scorePercent);
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
    const told = this.puzzles.vouch(session, { type: "supply", ...shipSupply(s) });
    run.hullSent = s.damage;
    if (told) room.conns.send(session.pirateId, told);
  }

  /**
   * The captain's board reports to the ship's fight: each turn's hits and shots, and its end, which
   * settles the fight. The ship detaches the board before it settles a fight on its own terms, so
   * while the board is attached, the fight in `room.battle` is this board's.
   */
  private battleHost(room: ShipRoom, pirateId: string): BoardHost {
    return {
      send: (m) => room.conns.send(pirateId, m),
      moved: (session) => this.takeBattleTurn(room, session),
      ended: (session, how) => void this.battleEnded(room, session, how).catch((e) => this.log.error({ err: e, sessionId: session.id }, "battle end failed")),
    };
  }

  /** A battle turn resolved on the captain's board: the ship takes the hits and spends the shots. */
  private takeBattleTurn(room: ShipRoom, session: PuzzleSession): void {
    const run = room.battle;
    const state = session.state as BattleState;
    const report = state.lastTurn;
    if (run && report && report.turn > run.turnsSeen) {
      run.turnsSeen = report.turn;
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

  /** The captain's board closed, however it closed: the fight settles on the board's outcome. Pay out, tell the ship, log it. */
  private async battleEnded(room: ShipRoom, session: PuzzleSession, how: BoardEnd): Promise<void> {
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
    // The ship settles this fight itself, as `outcome`. It lets go of the board first, so the board's
    // own end, when it is cut short below, settles nothing.
    if (session) this.puzzles.detach(session);
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
    const tier = this.content.world.raiderTiers.find((t) => t.id === run.tierId);
    // Either boarding opens the melee at the airlock; the melee decides the plunder (M5, ADR 0022).
    if (fightGoesToMelee(outcome) && tier && room.state.voyage?.battle && this.openMelee(room, tier, run.dutyOutput, turns)) return;
    await this.payBattle(room, run.tierId, run.dutyOutput, outcome, turns);
  }

  /** The fight is decided: pay out, tell the ship, log it. `points` weights the split per pirate. */
  private async payBattle(room: ShipRoom, tierId: string, points: ReadonlyMap<string, number>, outcome: ShipBattleOutcome, turns: number): Promise<void> {
    const tier = this.content.world.raiderTiers.find((t) => t.id === tierId);
    const { won, plunder, shares, end } = battlePurse(room.state, outcome, tier?.plunder ?? 0, points, turns);
    if (end) {
      try {
        room.state = reduceShip(room.state, end);
      } catch (e) {
        if (!(e instanceof InvalidMoveError)) throw e;
      }
    }
    const voyageId = room.voyageId;
    await this.db.transaction(async (tx) => {
      for (const [pirateId, credits] of shares) if (credits > 0) await appendLedger(tx, pirateId, credits, "plunder", voyageId);
      if (voyageId) await tx.update(schema.voyage).set({ encounter: { tierId, evaded: false, outcome, plunder } }).where(eq(schema.voyage.id, voyageId));
      await recordEvent(tx, room.state.captainId, "ship.battle_ended", { shipId: room.shipId, voyageId, tierId, outcome, plunder, turns, shares: Object.fromEntries(shares) });
    });
    this.log.info({ shipId: room.shipId, tierId, outcome, plunder, turns }, "battle ended");
    if (shares.size) this.onSummaryChanged?.([...shares.keys()]);
    if (won && shares.size) this.onVictory?.(room, tierId, shares);
    await this.afterChange(room);
  }

  // ---- the boarding melee (M5, ADR 0022)

  /**
   * Grappling hooks are over: everyone aboard and connected gets a board, the raider crew gets one
   * board per pirate with the tier's hand, and the ship holds position until the airlock is decided.
   * Returns false when nobody is there to fight, in which case the space battle settles as it stood.
   */
  private openMelee(room: ShipRoom, tier: RaiderTier, dutyOutput: Map<string, number>, turns: number): boolean {
    // Bots hold no board and never fight; a pirate's seat may be held while they are away.
    const connected = room.state.crew.filter((c) => !c.bot && c.awaySinceTurn === null && room.conns.has(c.pirateId));
    if (connected.length === 0 || room.melee) return false;
    const now = this.now();
    const seed = this.opts.randomSeed();
    room.melee = Melee.open({ rules: this.content.puzzles.swordfight.config, tier, pirates: connected.length, seed, now, dutyOutput, turns });
    this.log.info({ shipId: room.shipId, tierId: tier.id, pirates: connected.length }, "melee opened");
    void (async () => {
      // Every station comes to the airlock; a board cut short counts, unrated.
      for (const st of [...room.stations.keys()]) await this.endStation(room, st);
      for (const c of connected) this.dealMelee(room, c.pirateId);
      this.broadcast(room, [{ type: "boarding", tierId: tier.id }]);
      this.pushBoards(room);
    })().catch((e) => this.log.error({ err: e, shipId: room.shipId }, "melee open failed"));
    return true;
  }

  /** A pirate's own fight in the melee: dealt and sent. */
  private dealMelee(room: ShipRoom, pirateId: string): PuzzleStarted | null {
    const melee = room.melee;
    if (!melee || !room.voyageId) return null;
    const started = this.puzzles.start(pirateId, "swordfight", {
      binding: { kind: "melee", shipId: room.shipId, voyageId: room.voyageId, tierId: melee.tierId },
      override: { config: melee.boardConfig, roundMs: melee.roundMs(this.now()) },
      host: this.meleeHost(room, melee, pirateId),
    });
    melee.dealt(pirateId, started.sessionId);
    room.conns.send(pirateId, started);
    return started;
  }

  /** A pirate aboard without a board in the melee (came aboard, or back, mid-fight) asks for one; one they still hold is handed back. */
  async meleeJoin(pirateId: string): Promise<void> {
    const room = this.roomOf(pirateId);
    if (!room) throw new ShipError("not_aboard");
    const melee = room.melee;
    if (!melee) throw new ShipError("not_in_melee");
    const session = this.meleeSession(melee, pirateId);
    if (session) {
      for (const m of this.puzzles.handBack(session)) room.conns.send(pirateId, m);
    } else if (!melee.mayDeal(pirateId) || !this.dealMelee(room, pirateId)) {
      throw new ShipError("not_in_melee");
    }
    this.pushBoards(room);
  }

  /** The raider crew's fight catches up with the clock: the ship vouches for the scrap it sent, shows the boards, and settles a decided airlock. */
  private async advanceMelee(room: ShipRoom): Promise<void> {
    const melee = room.melee;
    if (!melee || this.settling.has(melee)) return;
    const step = melee.advance(this.now(), this.pirateBoards(room, melee));
    for (const { pirateId, move } of step.announce) {
      const told = this.puzzles.vouch(this.meleeSession(melee, pirateId)!, move);
      if (told) room.conns.send(pirateId, told);
    }
    if (step.changed) this.pushBoards(room);
    if (step.decided) await this.settleMelee(room, step.decided);
  }

  /**
   * A pirate's board in the melee reports to its fight: what it sends the raider crew, and its end,
   * which keeps its score for the split. The ship does not detach these: settling the melee ends each
   * board through its own end, so its score is kept, before the fight is dropped.
   */
  private meleeHost(room: ShipRoom, melee: Melee, pirateId: string): BoardHost {
    return {
      send: (m) => room.conns.send(pirateId, m),
      moved: (session) => void this.takeMeleeMove(room, session).catch((e) => this.log.error({ err: e, sessionId: session.id }, "melee move failed")),
      ended: (session) => void this.meleeEnded(room, melee, session).catch((e) => this.log.error({ err: e, sessionId: session.id }, "melee end failed")),
    };
  }

  /** A pirate's board took a move: the raider crew takes what it sent, the board is scored if it is over, and the airlock may be decided. */
  private async takeMeleeMove(room: ShipRoom, session: PuzzleSession): Promise<void> {
    const state = session.state as SwordfightState;
    const changed = room.melee?.pirateMoved(this.now(), state) ?? false;
    if (state.finished && !session.closed) {
      // The board filled: the engine has the outcome and the pirate is owed the result.
      const result = await this.puzzles.finish(session, null, null);
      room.conns.send(session.pirateId, result);
    }
    if (changed) this.pushBoards(room);
    await this.checkMelee(room);
  }

  /** A pirate's melee board closed, however it closed: keep its score for the split. */
  private async meleeEnded(room: ShipRoom, melee: Melee, session: PuzzleSession): Promise<void> {
    melee.pirateEnded(session.pirateId, summarizeSwordfight(session.state as SwordfightState).score);
    this.pushBoards(room);
    await this.checkMelee(room);
  }

  /** Settle the airlock if it is decided. */
  private async checkMelee(room: ShipRoom): Promise<void> {
    const melee = room.melee;
    if (!melee || this.settling.has(melee)) return;
    const decided = melee.decide(this.pirateBoards(room, melee));
    if (decided) await this.settleMelee(room, decided);
  }

  /**
   * The melee is over: the ship's word on every board still open, the plunder by the space battle's
   * split weighted by duty points and the fight's own scores, the voyage resumes.
   */
  private async settleMelee(room: ShipRoom, outcome: ShipBattleOutcome): Promise<void> {
    const melee = room.melee;
    if (!melee || this.settling.has(melee)) return;
    this.settling.add(melee);
    const won = outcome === "boarded";
    const now = this.now();
    // A board dealt while this awaits joins the melee's boards and is ended in its turn.
    for (const [pirateId, sessionId] of melee.fights) {
      const session = this.puzzles.sessions.get(sessionId);
      if (!session || session.closed) continue;
      let result: ServerMessage | null;
      if (won) {
        const at = melee.overTick(now, session.state as SwordfightState);
        room.conns.send(pirateId, { type: "melee.over", sessionId, won: true, tick: at });
        result = await this.puzzles.endMelee(session, true, at);
      } else result = await this.puzzles.cutShort(session);
      if (result) room.conns.send(pirateId, result);
      melee.pirateEnded(pirateId, summarizeSwordfight(session.state as SwordfightState).score);
    }
    room.melee = null;
    // The melee counts as duty turns at each pirate's attack a minute against Swordfight's par (ADR 0030).
    const par = { parRatePerMinute: this.content.puzzles.swordfight.parRatePerMinute, turnSeconds: this.content.world.ship.turnSeconds };
    const points = melee.points(room.state.crew.map((c) => c.pirateId), this.now(), par);
    this.log.info({ shipId: room.shipId, tierId: melee.tierId, outcome }, "melee ended");
    await this.payBattle(room, melee.tierId, points, outcome, melee.turns);
  }

  /** Every board in the melee, to everyone aboard. */
  private pushBoards(room: ShipRoom): void {
    const melee = room.melee;
    if (!melee) return;
    const boards = melee.wire(this.pirateBoards(room, melee), (pirateId) => room.names.get(pirateId) ?? pirateId);
    room.conns.broadcast({ type: "melee.boards", shipId: room.shipId, boards, serverNow: this.now() });
  }

  /** The melee's view of the pirates' boards: each open board as the server replayed it, the scrap announced to it, and whether its pirate is connected. */
  private pirateBoards(room: ShipRoom, melee: Melee): PirateBoards {
    return (pirateId) => {
      const session = this.meleeSession(melee, pirateId);
      return session ? { state: session.state as SwordfightState, announced: announcedScrap(session), connected: room.conns.has(pirateId) } : null;
    };
  }

  /** A pirate's board in the melee, while it is open. */
  private meleeSession(melee: Melee, pirateId: string): PuzzleSession | null {
    const sessionId = melee.fights.get(pirateId);
    const session = sessionId ? this.puzzles.sessions.get(sessionId) : undefined;
    return session && !session.closed ? session : null;
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
    if (!room.state.voyage || !room.voyageId) throw new ShipError("not_in_flight");
    await this.endStation(room, me.station);
    const heat = me.station === "cooling" ? this.heatRows(room) : undefined;
    const started = this.puzzles.start(pirateId, me.station, {
      binding: { kind: "duty", shipId: room.shipId, station: me.station, voyageId: room.voyageId, ...(heat !== undefined ? { heat } : {}) },
      host: this.dutyHost(room, me.station, pirateId),
    });
    room.stations.set(me.station, { sessionId: started.sessionId, lastScore: 0 });
    return started;
  }

  /**
   * A duty board reports to its station: as it closes, the ship takes what it earned since the last
   * turn. The ship detaches the board before it ends the station itself, so while the board is
   * attached, the station's board is this one.
   */
  private dutyHost(room: ShipRoom, station: Station, pirateId: string): BoardHost {
    return {
      send: (m) => room.conns.send(pirateId, m),
      closing: (session) => this.takeFinalPoints(room, station, session),
    };
  }

  /** The ship's heat as rows of the Cooling board, never below its floor: the board's heat is the ship's (DESIGN.md 3.3). */
  heatRows(room: ShipRoom): number {
    return heatRowsFor(room.state.heat, this.content.puzzles.cooling.config);
  }

  /** After a turn, tell the pirate at the heat sinks how deep the heat is now; their board logs it as a heat event. */
  private pushHeat(room: ShipRoom): void {
    const ss = room.stations.get("cooling");
    if (!ss) return;
    const session = this.puzzles.sessions.get(ss.sessionId);
    if (!session || session.closed) return;
    const told = this.puzzles.vouch(session, { type: "heat", row: this.heatRows(room) });
    if (told) room.conns.send(session.pirateId, told);
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
      if (session && !session.closed && session.pirateId === pirateId) for (const m of this.puzzles.handBack(session)) conn.send(m);
    }
    // Their board at the airlock waited too: the fight so far, and the scrap announced while they were away.
    const melee = room.melee;
    const fight = melee?.fights.get(pirateId);
    if (melee && fight) {
      const session = this.puzzles.sessions.get(fight);
      if (session && !session.closed) for (const m of this.puzzles.handBack(session)) conn.send(m);
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
            // In a fight, the plunder weighs what each pirate's station gave the ship this turn (ADR 0030).
            if (room.battle) for (const { pirateId, output } of turnPlunderOutputs(room.state)) room.battle.dutyOutput.set(pirateId, (room.battle.dutyOutput.get(pirateId) ?? 0) + output);
            room.nextTurnAt += this.turnMs;
            turns += 1;
            events.push(...room.state.events);
            await this.settle(room);
            if (this.rooms.has(room.shipId)) {
              this.pushHeat(room);
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
    const outpostId = await this.pirateOutpost(pirateId);
    const ships: BoardShip[] = [];
    for (const room of this.rooms.values()) {
      const s = room.state;
      if (s.crew.length === 0) continue;
      if (s.outpostId !== null && s.outpostId !== outpostId) continue;
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
        colors: this.crews?.tagOf(room.ownerId) ?? null,
        crewmate: room.ownerId !== pirateId && Boolean(this.crews?.sameCrew(room.ownerId, pirateId)),
      });
    }
    return { type: "board.ships", outpostId, ships, serverNow: this.now() };
  }

  async pirateOutpost(pirateId: string): Promise<string> {
    const [p] = await this.db.select({ outpostId: schema.pirate.outpostId }).from(schema.pirate).where(eq(schema.pirate.id, pirateId));
    return p?.outpostId ?? this.content.world.startOutpostId;
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

  /**
   * The station's board is closing: take what it earned since the last turn, and free the station.
   * It must come before the board closes, or the next turn would find it closed and drop it unpaid.
   */
  private takeFinalPoints(room: ShipRoom, station: Station, session: PuzzleSession): void {
    const lastScore = room.stations.get(station)?.lastScore ?? 0;
    this.report(room, station, this.puzzles.sessions.score(session) - lastScore);
    room.stations.delete(station);
  }

  private report(room: ShipRoom, station: Station, points: number): void {
    if (points <= 0 || !room.state.voyage || !crewAtStation(room.state, station)) return;
    room.state = reduceShip(room.state, { type: "duty", station, points });
  }

  /**
   * Cut short whatever board is running at a station. The ship ends the station itself and lets go of
   * the board first, so the board takes nothing more to the ship as it closes.
   */
  private async endStation(room: ShipRoom, station: Station): Promise<void> {
    const ss = room.stations.get(station);
    if (!ss) return;
    const session = this.puzzles.sessions.get(ss.sessionId);
    room.stations.delete(station);
    if (!session) return;
    this.puzzles.detach(session);
    const result = await this.puzzles.cutShort(session);
    if (result) room.conns.send(session.pirateId, result);
  }

  /** After a crew action: persist its consequences, broadcast, and drop the room if empty. */
  private async afterChange(room: ShipRoom): Promise<void> {
    const events = room.state.events;
    await this.settle(room);
    if (this.rooms.has(room.shipId)) this.broadcast(room, events);
  }

  /** Act on the engine's events: people put on the outpost, arrivals, abandonments. May delete the room. */
  private async settle(room: ShipRoom): Promise<void> {
    const events = room.state.events;
    for (const e of events) {
      switch (e.type) {
        case "left":
          await this.putOnOutpost(room, e.pirateId, e.reason);
          break;
        case "booted_up":
          room.names.set(e.pirateId, this.botName(room));
          break;
        case "arrived":
          await this.arrive(room, e.outpostId, e.turns);
          break;
        case "abandoned":
          await this.abandon(room, e.outpostId);
          break;
        case "launched":
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

  private async putOnOutpost(room: ShipRoom, pirateId: string, reason: "left" | "timed_out"): Promise<void> {
    this.byPirate.delete(pirateId);
    for (const [st, ss] of room.stations) {
      const session = this.puzzles.sessions.get(ss.sessionId);
      if (session?.pirateId === pirateId) await this.endStation(room, st);
    }
    // The captain's fight goes with them: the ship breaks off.
    if (room.battle && this.puzzles.sessions.get(room.battle.sessionId)?.pirateId === pirateId) await this.cutBattleShort(room, "disengaged");
    // A pirate who leaves the airlock leaves their board; it counts, unrated, and the melee goes on without them.
    const fight = room.melee?.fights.get(pirateId);
    if (fight) {
      const session = this.puzzles.sessions.get(fight);
      if (session && !session.closed) {
        const result = await this.puzzles.cutShort(session);
        if (result) room.conns.send(pirateId, result);
      }
    }
    const outpostId = room.state.outpostId ?? room.state.voyage?.leg.from ?? this.content.world.startOutpostId;
    await this.db.update(schema.pirate).set({ outpostId }).where(eq(schema.pirate.id, pirateId));
    if (room.voyageId) {
      await this.db
        .update(schema.voyageCrew)
        .set({ leftAt: new Date(this.now()) })
        .where(and(eq(schema.voyageCrew.voyageId, room.voyageId), eq(schema.voyageCrew.pirateId, pirateId)));
    }
    room.conns.send(pirateId, { type: "ship.left", shipId: room.shipId, reason });
    room.conns.leave(pirateId);
    this.onDisembark?.(pirateId, outpostId);
  }

  private async arrive(room: ShipRoom, outpostId: string, turns: number): Promise<void> {
    for (const st of [...room.stations.keys()]) await this.endStation(room, st);
    const crewIds = pirates(room.state.crew).map((c) => c.pirateId);
    const voyageId = room.voyageId;
    room.voyageId = null;
    await this.db.transaction(async (tx) => {
      await tx.update(schema.ship).set({ outpostId }).where(eq(schema.ship.id, room.shipId));
      if (crewIds.length) await tx.update(schema.pirate).set({ outpostId }).where(inArray(schema.pirate.id, crewIds));
      if (voyageId) {
        await tx
          .update(schema.voyage)
          .set({ endedAt: new Date(this.now()), outcome: "arrived", turns, encounter: encounterOf(room) })
          .where(eq(schema.voyage.id, voyageId));
      }
      await recordEvent(tx, room.state.captainId, "voyage.completed", { shipId: room.shipId, voyageId, outpostId, turns, crew: crewIds.length });
    });
    this.log.info({ shipId: room.shipId, outpostId, turns, crew: crewIds.length }, "ship arrived");
    if (crewIds.length) this.onArrived?.(crewIds);
    this.onSummaryChanged?.(crewIds.includes(room.ownerId) ? crewIds : [...crewIds, room.ownerId]);
  }

  private async abandon(room: ShipRoom, outpostId: string): Promise<void> {
    for (const st of [...room.stations.keys()]) await this.endStation(room, st);
    if (room.battle) await this.cutBattleShort(room, "disengaged");
    if (room.melee) await this.settleMelee(room, "broke_off");
    const voyageId = room.voyageId;
    room.voyageId = null;
    await this.db.transaction(async (tx) => {
      await tx.update(schema.ship).set({ outpostId }).where(eq(schema.ship.id, room.shipId));
      if (voyageId) {
        await tx.update(schema.voyage).set({ endedAt: new Date(this.now()), outcome: "abandoned", turns: room.state.turn, encounter: encounterOf(room) }).where(eq(schema.voyage.id, voyageId));
      }
      await recordEvent(tx, null, "voyage.abandoned", { shipId: room.shipId, voyageId, outpostId });
    });
    this.onSummaryChanged?.([room.ownerId]);
  }

  private broadcast(room: ShipRoom, events: readonly ShipEvent[]): void {
    room.conns.broadcast(this.stateMessage(room, events));
  }

  /**
   * A bot has a bot's name and a unit number ("Gasket-7"), unlike anyone's aboard. No pirate's name
   * looks like it; the snapshot's `bot` flag is still what the client goes by.
   */
  private botName(room: ShipRoom): string {
    const taken = new Set(room.names.values());
    for (let attempt = 0; attempt < 20; attempt++) {
      const name = randomBotName(this.content);
      if (!taken.has(name)) return name;
    }
    return `${randomBotName(this.content)}${room.names.size + 1}`;
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
      bot: c.bot,
      crewId: c.bot ? null : (this.crews?.crewIdOf(c.pirateId) ?? null),
      look: c.bot ? null : (this.looks?.lookOf(c.pirateId) ?? defaultLook(this.content.world.pirates, c.pirateId)),
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
      heat: s.heat,
      damage: s.damage,
      loaded: s.loaded,
      turrets: room.shipClass.turrets,
      lastTurn: s.lastTurn ? { turn: s.lastTurn.turn, outputs: { ...s.lastTurn.outputs }, held: s.lastTurn.held, speed: s.lastTurn.speed, tokens: s.lastTurn.tokens } : null,
      nextTurnAt: room.nextTurnAt,
      turnMs: this.turnMs,
      voyagesCompleted: s.voyagesCompleted,
      melee: room.melee ? { tierId: room.melee.tierId } : null,
      colors: this.crews?.tagOf(room.ownerId) ?? null,
    };
  }
}

/** Derive the engine's config for a class from content (the derivation itself is the engine's, ADR 0027). */
export function shipConfigFor(content: Content, shipClass: ShipClass): ShipConfig {
  return engineShipConfigFor(shipClass, content.world.ship, content.puzzles);
}

export { legPlan, splitPlunder, splitTokens } from "@openseas/engine";

function location(s: ShipState): ShipLocation {
  if (s.voyage) {
    const v = s.voyage;
    return { kind: "in-flight", laneId: v.leg.laneId, from: v.leg.from, to: v.leg.to, progress: progressPermille(s), hail: v.hail, battle: v.battle };
  }
  return { kind: "docked", outpostId: s.outpostId ?? "" };
}

function encounterOf(room: ShipRoom): { tierId: string; evaded: boolean } | null {
  const e = room.state.voyage?.encounter;
  return e ? { tierId: e.tierId, evaded: e.resolved } : null;
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
    case "helm":
      return { type: "helm", pirateId: e.pirateId, name: name(e.pirateId) };
    case "booted_up":
      return { type: "booted_up", pirateId: e.pirateId, name: name(e.pirateId), station: e.station };
    case "powered_down":
      return { type: "powered_down", names: e.pirateIds.map(name) };
    default:
      return e;
  }
}

/** Scrap the server announced to a melee board that the board has not logged yet. */
function announcedScrap(session: PuzzleSession): number {
  let scrap = 0;
  for (const m of session.vouched.pending() as SwordfightMove[]) if (m.type === "incoming") scrap += m.scrap;
  return scrap;
}
