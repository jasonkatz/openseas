/**
 * A crew boards a skiff, launches, works a station, and arrives. Runs against a real Postgres
 * when TEST_DATABASE_URL is set, like the integration test; the config maths need no database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { loadContent } from "@openseas/content";
import {
  createBattleGame,
  createCoolingGame,
  createSwordfightGame,
  hashBattleState,
  hashCoolingState,
  hashSwordfightState,
  reduceBattle,
  reduceCooling,
  reduceShip,
  reduceSwordfight,
  swapIllegalReason,
  type BattleMove,
  type BattlePlan,
  type BattleSegment,
  type BattleState,
  type CoolingMove,
  type CoolingState,
  type MoveToken,
  type SwordfightMove,
} from "@openseas/engine";
import { parseServerMessage, type MeResponse, type PirateSummary, type ServerMessage } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { appendLedger } from "../src/ledger.js";
import { createLogger } from "../src/log.js";
import { legPlan, shipConfigFor, splitPlunder, splitTokens } from "../src/ships/service.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describe("ship config from content", () => {
  const content = loadContent();

  it("scales each puzzle's par to one turn", () => {
    const cfg = shipConfigFor(content, content.world.shipClasses[0]!);
    const b = content.puzzles.cooling;
    expect(cfg.par.cooling).toBe(Math.round((b.parScore * content.world.ship.turnSeconds) / b.roundSeconds));
    expect(cfg.par.cooling).toBeGreaterThan(0);
    expect(cfg.shipClass.stations).toEqual(content.world.shipClasses[0]!.stations);
    expect(cfg.shipClass.minCrew).toBe(content.world.shipClasses[0]!.minCrew);
    expect(cfg.shipClass.botStations).toEqual(content.world.shipClasses[0]!.botStations);
    expect(cfg.rules).toBe(content.world.ship);
  });

  it("turns a lane into a leg the engine can roll", () => {
    const r = content.world.lanes[0]!;
    const leg = legPlan(r);
    expect(leg.lengthUnits).toBe(r.durationSeconds * 1000);
    expect(leg.encounterChancePercent).toBe(Math.round(r.encounterChance * 100));
    expect(leg.from).toBe(r.from);
  });
});

describe("plunder and tokens", () => {
  it("splits the ship's tokens half forward and the rest between the turns", () => {
    expect(splitTokens(0)).toEqual({ left: 0, forward: 0, right: 0 });
    expect(splitTokens(1)).toEqual({ left: 0, forward: 1, right: 0 });
    expect(splitTokens(4)).toEqual({ left: 1, forward: 2, right: 1 });
    expect(splitTokens(5)).toEqual({ left: 1, forward: 3, right: 1 });
    expect(splitTokens(6)).toEqual({ left: 2, forward: 3, right: 1 });
  });

  it("splits plunder by shares weighted by duty points, with the captain's extra share and the remainder", () => {
    const crew = [
      { pirateId: "cap", captain: true, points: 0 },
      { pirateId: "ace", captain: false, points: 100 },
      { pirateId: "idle", captain: false, points: 0 },
    ];
    const shares = splitPlunder(1000, crew);
    // Weights: captain 2 * 50 = 100, ace 1 * 100 = 100, idle 1 * 50 = 50.
    expect(shares.get("ace")).toBe(400);
    expect(shares.get("idle")).toBe(200);
    expect(shares.get("cap")).toBe(400);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(1000);
    // Nobody worked: base shares only, the captain two to one.
    const flat = splitPlunder(300, crew.map((c) => ({ ...c, points: 0 })));
    expect(flat.get("cap")).toBe(150);
    expect(flat.get("ace")).toBe(75);
    expect(splitPlunder(0, crew).size).toBe(0);
    expect(splitPlunder(500, []).size).toBe(0);
    const solo = splitPlunder(601, [{ pirateId: "cap", captain: true, points: 0 }]);
    expect(solo.get("cap")).toBe(601);
  });
});

/** A plain captain's plot: straight ahead on the tokens in hand, every loaded gun firing both ways. */
function plainPlan(state: BattleState): BattlePlan {
  const me = state.ships[0];
  const segments: BattleSegment[] = [];
  let loaded = me.loaded;
  let fwd = me.tokens.forward;
  let left = me.tokens.left;
  for (let i = 0; i < state.config.segments; i++) {
    const move: MoveToken | null = fwd > 0 ? "forward" : left > 0 ? "left" : null;
    if (move === "forward") fwd -= 1;
    if (move === "left") left -= 1;
    const port = loaded > 0;
    if (port) loaded -= 1;
    const starboard = loaded > 0;
    if (starboard) loaded -= 1;
    segments.push({ move, port, starboard });
  }
  return { segments, grapple: true };
}

/** A swap that scores if one exists, else the first legal swap. */
function scoringMove(state: CoolingState): CoolingMove {
  let fallback: CoolingMove | null = null;
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) !== null) continue;
      const move: CoolingMove = { type: "swap", col: c, row: r };
      if (reduceCooling(state, move).score > state.score) return move;
      fallback ??= move;
    }
  }
  if (!fallback) throw new Error("no legal move");
  return fallback;
}

/** A socket with an inbox, so a test can wait for the next message of a kind. */
class Client {
  readonly inbox: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      const m = parseServerMessage(JSON.parse(d.toString()));
      if (!m) throw new Error(`unparseable server message: ${d.toString()}`);
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
      else this.inbox.push(m);
    });
  }
  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
  /** The next message satisfying `pred`, from the inbox or the wire. */
  until<T extends ServerMessage["type"]>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    const test = (m: ServerMessage): boolean => m.type === type && pred(m as Extract<ServerMessage, { type: T }>);
    const i = this.inbox.findIndex(test);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}; inbox: ${this.inbox.map((m) => m.type).join(",")}`)), 8000);
      this.waiters.push({
        pred: test,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }
}

describeDb("ships over the wire", () => {
  let app: App;
  let base: string;
  const clock = { t: Date.now() };
  const content = loadContent();
  const turnMs = content.world.ship.turnSeconds * 1000;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: url!,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      BETTER_AUTH_URL: "http://localhost:0",
      CLIENT_ORIGINS: "http://localhost:5173",
      ALPHA_INVITE_CODE: "letmein",
      LOG_LEVEL: "silent",
    });
    app = await createApp(env, createLogger("silent", false), { now: () => clock.t });
    const port = await app.listen(0);
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function pirate(): Promise<{ cookie: string; me: PirateSummary }> {
    const res = await fetch(`${base}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: "{}",
    });
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token"))!.split(";")[0]!;
    const created = await fetch(`${base}/api/pirate`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: "letmein" }),
    });
    expect(created.status).toBe(201);
    const { pirate: me } = (await created.json()) as { pirate: PirateSummary };
    return { cookie, me };
  }

  async function connect(cookie: string): Promise<Client> {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie } });
    const c = new Client(ws);
    await new Promise((resolve) => ws.on("open", resolve));
    await c.until("welcome");
    return c;
  }

  /** Advance the clock one turn and let the ship service apply it. */
  async function turn(n = 1): Promise<void> {
    for (let i = 0; i < n; i++) {
      clock.t += turnMs;
      await app.ships.tick();
    }
  }

  it("a crew boards, flies, works a station, arrives and disembarks", async () => {
    const start = content.world.startOutpostId;
    const owner = await pirate();
    const crewmate = await pirate();
    expect(owner.me.outpostId).toBe(start);
    const shipId = owner.me.ships[0]!.id;

    const a = await connect(owner.cookie);
    const b = await connect(crewmate.cookie);

    // Nobody is aboard yet, so the notice board is empty.
    b.send({ type: "board.list" });
    expect(await b.until("board.ships")).toMatchObject({ outpostId: start, ships: [] });

    a.send({ type: "ship.board", shipId });
    const docked = await a.until("ship.state");
    expect(docked.ship).toMatchObject({ shipId, captainId: owner.me.id, location: { kind: "docked", outpostId: start }, turn: 0 });
    expect(docked.events.map((e) => e.type)).toEqual(["boarded", "helm"]);

    // The ship is now on the notice board, and the crewmate boards from it.
    b.send({ type: "board.list" });
    const board = await b.until("board.ships");
    expect(board.ships).toHaveLength(1);
    expect(board.ships[0]).toMatchObject({ shipId, crew: 1, captainName: owner.me.name, yours: false });
    b.send({ type: "ship.board", shipId });
    const joined = await b.until("ship.state");
    expect(joined.ship.crew.map((c) => c.name).sort()).toEqual([owner.me.name, crewmate.me.name].sort());
    await a.until("ship.state", (m) => m.ship.crew.length === 2);

    // Only the captain flies or orders the bots about; the crewmate is refused.
    b.send({ type: "ship.launch", laneId: "tinwick-echo-rock" });
    expect(await b.until("error")).toMatchObject({ code: "not_captain" });
    b.send({ type: "ship.assign", pirateId: "bot:9", station: "gunnery" });
    expect(await b.until("error")).toMatchObject({ code: "not_captain" });
    b.send({ type: "duty.start" });
    expect(await b.until("error")).toMatchObject({ code: "no_station" });

    b.send({ type: "ship.station", station: "cooling" });
    await b.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === crewmate.me.id && c.station === "cooling"));
    a.send({ type: "ship.station", station: "cooling" });
    expect(await a.until("error")).toMatchObject({ code: "station_taken" });
    a.send({ type: "ship.station", station: "engines" });
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === owner.me.id && c.station === "engines"));

    b.send({ type: "duty.start" });
    expect(await b.until("error")).toMatchObject({ code: "not_in_flight" });

    a.send({ type: "ship.launch", laneId: "echo-rock-tinwick" });
    expect(await a.until("error")).toMatchObject({ code: "bad_lane" });
    a.send({ type: "ship.launch", laneId: "tinwick-echo-rock" });
    const launched = await a.until("ship.state", (m) => m.ship.location.kind === "in-flight");
    expect(launched.ship.location).toMatchObject({ kind: "in-flight", laneId: "tinwick-echo-rock", from: start, to: "echo-rock", progress: 0 });
    await b.until("ship.state", (m) => m.ship.location.kind === "in-flight");
    // Two pirates short of the skiff's four, so two bots booted up at the open stations the
    // class lists first (DESIGN.md 3.4), named as bots are and flagged, and never in the database.
    const skiff = content.world.shipClasses.find((c) => c.id === "skiff")!;
    const hands = launched.ship.crew.filter((c) => c.bot);
    expect(hands).toHaveLength(skiff.minCrew - 2);
    expect(hands.map((h) => h.station)).toEqual(skiff.botStations.filter((st) => st !== "cooling" && st !== "engines").slice(0, hands.length));
    for (const h of hands) {
      expect(h.name).toMatch(/^[A-Z][a-z]+-\d+$/);
      expect(h.captain).toBe(false);
      expect([owner.me.name, crewmate.me.name]).not.toContain(h.name);
    }
    expect(launched.events.filter((e) => e.type === "booted_up")).toHaveLength(hands.length);
    expect(launched.events).toContainEqual({ type: "booted_up", pirateId: hands[0]!.pirateId, name: hands[0]!.name, station: hands[0]!.station });
    const voyages = await app.db.select().from(schema.voyage).where(eq(schema.voyage.shipId, shipId));
    expect(voyages).toHaveLength(1);
    expect(voyages[0]).toMatchObject({ laneId: "tinwick-echo-rock", captainId: owner.me.id, outcome: null });
    const crewRows = await app.db.select().from(schema.voyageCrew).where(eq(schema.voyageCrew.voyageId, voyages[0]!.id));
    expect(crewRows.map((r) => r.pirateId).sort()).toEqual([owner.me.id, crewmate.me.id].sort());
    // The helm can go to a pirate, never to a bot.
    a.send({ type: "ship.helm", pirateId: hands[0]!.pirateId });
    expect(await a.until("error")).toMatchObject({ code: "is_bot" });

    // The crewmate's cooling board is dealt bound to the ship, with the ship's heat as its heat
    // (DESIGN.md 3.3): the board's first move is the heat event the deal carries. A dry ship's
    // heat reads as the board's floor: a heat never runs dry.
    b.send({ type: "duty.start" });
    const started = await b.until("puzzle.started");
    if (started.puzzle !== "cooling") throw new Error("expected a cooling board");
    const floor = content.puzzles.cooling.config.minHeatRow;
    expect(started.duty).toEqual({ shipId, station: "cooling", heat: floor });
    expect(started.config.shipHeat).toBe(true);
    let state = createCoolingGame(started.seed, started.config);
    let seq = 0;
    const log = (move: CoolingMove): void => {
      state = reduceCooling(state, move);
      b.send({ type: "puzzle.move", sessionId: started.sessionId, seq: seq++, move, hash: hashCoolingState(state) });
    };
    log({ type: "heat", row: floor });
    expect(state.heatRow).toBe(floor);
    for (let i = 0; i < 12; i++) log(scoringMove(state));
    expect(state.score).toBeGreaterThan(0);
    expect(state.heatRow).toBe(floor);
    await new Promise((r) => setTimeout(r, 100));

    // The turn takes the board's points, and heat comes in: the vent hears the new depth.
    await turn();
    const t1 = await a.until("ship.state", (m) => m.ship.turn === 1);
    expect(t1.ship.lastTurn).toMatchObject({ turn: 1, held: false });
    expect(t1.ship.lastTurn!.outputs.cooling).toBeGreaterThan(0);
    expect(t1.ship.lastTurn!.outputs.engines).toBe(0);
    // The bots turned in a passable job at their stations without a board.
    for (const h of hands) {
      expect(t1.ship.lastTurn!.outputs[h.station!]).toBeGreaterThanOrEqual(content.world.ship.botOutput.min);
      expect(t1.ship.lastTurn!.outputs[h.station!]).toBeLessThanOrEqual(content.world.ship.botOutput.max);
    }
    expect(t1.ship.location.kind === "in-flight" && t1.ship.location.progress).toBeGreaterThan(0);
    expect(t1.ship.nextTurnAt).toBeGreaterThan(clock.t);
    // Nobody vents after the first turn, so the heat fills until it rises over the board's floor.
    for (let i = 0; i < 13; i++) await turn();
    const heat = await b.until("duty.heat", (m) => m.sessionId === started.sessionId);
    expect(heat.row).toBeGreaterThan(floor);
    // The ship may have spoken again since; what counts is its latest word. A heat event that
    // says anything else is refused as an illegal move.
    const current = app.ships.heatRows(app.ships.room(shipId)!);
    expect(current).toBeGreaterThanOrEqual(heat.row);
    const wrong = reduceCooling(state, { type: "heat", row: current + 1 });
    b.send({ type: "puzzle.move", sessionId: started.sessionId, seq, move: { type: "heat", row: current + 1 }, hash: hashCoolingState(wrong) });
    const rejected = await b.until("puzzle.rejected", (m) => m.sessionId === started.sessionId);
    expect(rejected).toMatchObject({ reason: "illegal_move", atSeq: seq });

    // A fresh board picks the ship's heat up where it is now and takes the ship's word for the depth.
    b.send({ type: "duty.start" });
    const again = await b.until("puzzle.started");
    if (again.puzzle !== "cooling") throw new Error("expected a cooling board");
    expect(again.duty?.heat).toBe(app.ships.heatRows(app.ships.room(shipId)!));
    state = createCoolingGame(again.seed, again.config);
    seq = 0;
    const log2 = (move: CoolingMove): void => {
      state = reduceCooling(state, move);
      b.send({ type: "puzzle.move", sessionId: again.sessionId, seq: seq++, move, hash: hashCoolingState(state) });
    };
    log2({ type: "heat", row: again.duty!.heat! });
    for (let i = 0; i < 12; i++) log2(scoringMove(state));
    await new Promise((r) => setTimeout(r, 100));

    // Standing down cuts the board short: it counts, unrated. The heat event is in the log but is no move.
    b.send({ type: "ship.station", station: null });
    const cut = await b.until("puzzle.result", (m) => m.sessionId === again.sessionId);
    expect(cut).toMatchObject({ sessionId: again.sessionId, score: state.score, moves: 12, verified: true, rating: null, tierChange: null });
    const started2 = { sessionId: again.sessionId };
    void started2;
    const round = await app.db.select().from(schema.puzzleRound).where(eq(schema.puzzleRound.id, again.sessionId));
    expect(round[0]).toMatchObject({ rated: false, voyageId: voyages[0]!.id, rejectedReason: null });
    const ratings = await app.db.select().from(schema.rating).where(eq(schema.rating.pirateId, crewmate.me.id));
    expect(ratings).toHaveLength(0);

    // Fly the rest of the way. Unstaffed, with the heat filling, the skiff crawls, but it gets there.
    for (let i = 0; i < 600 && app.ships.room(shipId)?.state.voyage; i++) await turn();
    expect(app.ships.room(shipId)?.state.voyage).toBeNull();
    const atEchoRock = (m: Extract<ServerMessage, { type: "ship.state" }>): boolean => m.ship.location.kind === "docked" && m.ship.location.outpostId === "echo-rock";
    const arrived = await a.until("ship.state", atEchoRock);
    expect(arrived.ship.heat).toBe(0);
    expect(arrived.ship.voyagesCompleted).toBe(1);
    // In port the bots are powered down, by name, and only the pirates remain aboard.
    expect(arrived.ship.crew.some((c) => c.bot)).toBe(false);
    expect(arrived.ship.crew).toHaveLength(2);
    expect(arrived.events).toContainEqual({ type: "powered_down", names: hands.map((h) => h.name) });
    expect(arrived.events.some((e) => e.type === "arrived")).toBe(true);
    await b.until("ship.state", atEchoRock);
    const [v] = await app.db.select().from(schema.voyage).where(eq(schema.voyage.id, voyages[0]!.id));
    expect(v).toMatchObject({ outcome: "arrived" });
    expect(v!.turns).toBeGreaterThan(1);
    const [shipRow] = await app.db.select().from(schema.ship).where(eq(schema.ship.id, shipId));
    expect(shipRow?.outpostId).toBe("echo-rock");
    const [crewmateRow] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, crewmate.me.id));
    expect(crewmateRow?.outpostId).toBe("echo-rock");

    // Everyone disembarks; the room empties.
    b.send({ type: "ship.leave" });
    expect(await b.until("ship.left")).toMatchObject({ shipId, reason: "left" });
    await a.until("ship.state", (m) => m.ship.crew.length === 1);
    a.send({ type: "ship.leave" });
    expect(await a.until("ship.left")).toMatchObject({ shipId, reason: "left" });
    expect(app.ships.size).toBe(0);
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie: owner.cookie } })).json()) as MeResponse;
    expect(me.pirate?.outpostId).toBe("echo-rock");
    expect(me.pirate?.ships[0]?.outpostId).toBe("echo-rock");

    // Back home, the ship is elsewhere.
    const third = await pirate();
    const c = await connect(third.cookie);
    c.send({ type: "ship.board", shipId });
    expect(await c.until("error")).toMatchObject({ code: "ship_elsewhere" });
    a.ws.close();
    b.ws.close();
    c.ws.close();
  });

  it("a dropped pirate's seat is held, then given up; a dropped captain holds the ship", async () => {
    const owner = await pirate();
    const crewmate = await pirate();
    const shipId = owner.me.ships[0]!.id;
    const a = await connect(owner.cookie);
    let b = await connect(crewmate.cookie);
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    b.send({ type: "ship.board", shipId });
    await b.until("ship.state");
    b.send({ type: "ship.station", station: "plating" });
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.station === "plating"));
    a.send({ type: "ship.launch", laneId: "tinwick-frostvent" });
    await a.until("ship.state", (m) => m.ship.location.kind === "in-flight");
    await b.until("ship.state", (m) => m.ship.location.kind === "in-flight");

    b.ws.close();
    const away = await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === crewmate.me.id && c.away));
    expect(away.ship.crew.find((c) => c.pirateId === crewmate.me.id)?.station).toBe("plating");

    // Reconnecting inside the grace period takes the seat back, station and all.
    b = await connect(crewmate.cookie);
    const back = await b.until("ship.state");
    expect(back.ship.crew.find((c) => c.pirateId === crewmate.me.id)).toMatchObject({ away: false, station: "plating" });
    await a.until("ship.state", (m) => m.ship.crew.every((c) => !c.away));

    // Drop again and stay away past the grace: put at the outpost the ship left.
    b.ws.close();
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.away));
    await turn(content.world.ship.graceTurns + 1);
    const alone = await a.until("ship.state", (m) => m.ship.crew.filter((c) => !c.bot).length === 1);
    expect(alone.ship.location.kind).toBe("in-flight");
    const [crewmateRow] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, crewmate.me.id));
    expect(crewmateRow?.outpostId).toBe(content.world.startOutpostId);

    // The captain drops: the ship holds, and with nobody else aboard it is abandoned at the end of the grace.
    const progressBefore = app.ships.room(shipId)!.state.voyage!.progress;
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    await turn(2);
    const room = app.ships.room(shipId);
    expect(room?.state.lastTurn?.held).toBe(true);
    expect(room?.state.voyage?.progress).toBe(progressBefore);
    await turn(content.world.ship.graceTurns);
    expect(app.ships.room(shipId)).toBeNull();
    const [shipRow] = await app.db.select().from(schema.ship).where(eq(schema.ship.id, shipId));
    expect(shipRow?.outpostId).toBe(content.world.startOutpostId);
    const voyages = await app.db.select().from(schema.voyage).where(eq(schema.voyage.shipId, shipId));
    expect(voyages[0]).toMatchObject({ outcome: "abandoned" });
  });

  it("a pirate takes a bot's station and gets a board; the hand finds another after its rest", async () => {
    const owner = await pirate();
    const shipId = owner.me.ships[0]!.id;
    const a = await connect(owner.cookie);
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    a.send({ type: "ship.launch", laneId: "tinwick-echo-rock" });
    const launched = await a.until("ship.state", (m) => m.ship.location.kind === "in-flight");
    const skiff = content.world.shipClasses.find((c) => c.id === "skiff")!;
    const hands = launched.ship.crew.filter((c) => c.bot);
    expect(hands).toHaveLength(skiff.minCrew - 1);
    expect(hands.map((h) => h.station)).toEqual(skiff.botStations.slice(0, hands.length));
    const atDrive = hands.find((h) => h.station === "engines")!;

    // Taking the drive from the hand is allowed where another pirate's station is refused; the hand steps aside.
    a.send({ type: "ship.station", station: "engines" });
    const took = await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === owner.me.id && c.station === "engines"));
    expect(took.ship.crew.find((c) => c.pirateId === atDrive.pirateId)).toMatchObject({ station: null, bot: true });
    expect(took.events).toEqual([{ type: "station", pirateId: owner.me.id, name: owner.me.name, station: "engines" }]);
    a.send({ type: "duty.start" });
    const started = await a.until("puzzle.started");
    expect(started.puzzle).toBe("engines");
    expect(started.duty).toMatchObject({ shipId, station: "engines" });

    // The nav console is a pirate's job: the order is refused. The captain can order the hand
    // straight to the open station, with no rest; a turn later it is working there.
    a.send({ type: "ship.assign", pirateId: atDrive.pirateId, station: "navigation" });
    expect(await a.until("error")).toMatchObject({ code: "not_bot_station" });
    const spare = skiff.botStations.find((st) => !took.ship.crew.some((c) => c.station === st))!;
    a.send({ type: "ship.assign", pirateId: atDrive.pirateId, station: spare });
    const ordered = await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === atDrive.pirateId && c.station === spare));
    expect(ordered.events).toEqual([{ type: "station", pirateId: atDrive.pirateId, name: atDrive.name, station: spare }]);
    await turn();
    const worked = await a.until("ship.state", (m) => m.ship.lastTurn !== null && m.ship.lastTurn.turn >= ordered.ship.turn + 1);
    expect(worked.ship.lastTurn!.outputs[spare]).toBeGreaterThan(0);
    // Orders go to bots only, and never onto a pirate's station.
    a.send({ type: "ship.assign", pirateId: owner.me.id, station: "cooling" });
    expect(await a.until("error")).toMatchObject({ code: "not_bot" });
    a.send({ type: "ship.assign", pirateId: atDrive.pirateId, station: "engines" });
    expect(await a.until("error")).toMatchObject({ code: "station_taken" });
    // Stood down, the hand rests, then takes the next open station it works, and the log says so.
    a.send({ type: "ship.assign", pirateId: atDrive.pirateId, station: null });
    const stood = await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === atDrive.pirateId && c.station === null));
    const open = skiff.botStations.find((st) => !stood.ship.crew.some((c) => c.station === st))!;
    await turn(content.world.ship.botRestTurns);
    const moved = await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === atDrive.pirateId && c.station === open));
    expect(moved.events).toContainEqual({ type: "station", pirateId: atDrive.pirateId, name: atDrive.name, station: open });
    expect(moved.ship.lastTurn!.outputs[open]).toBeGreaterThan(0);

    // The last pirate leaving takes the bots with them: the ship is abandoned and the room goes.
    a.send({ type: "ship.leave" });
    expect(await a.until("ship.left")).toMatchObject({ shipId, reason: "left" });
    await expect.poll(() => app.ships.size).toBe(0);
    const [shipRow] = await app.db.select().from(schema.ship).where(eq(schema.ship.id, shipId));
    expect(shipRow?.outpostId).toBe(content.world.startOutpostId);
    a.ws.close();
  });

  it("the owner can lock the ship; a locked ship refuses other pirates", async () => {
    const owner = await pirate();
    const crewmate = await pirate();
    const shipId = owner.me.ships[0]!.id;
    const a = await connect(owner.cookie);
    const b = await connect(crewmate.cookie);
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    b.send({ type: "ship.lock", inviteOnly: true });
    expect(await b.until("error")).toMatchObject({ code: "not_aboard" });
    a.send({ type: "ship.lock", inviteOnly: true });
    await a.until("ship.state", (m) => m.ship.inviteOnly);
    b.send({ type: "ship.board", shipId });
    expect(await b.until("error")).toMatchObject({ code: "ship_locked" });
    a.send({ type: "ship.leave" });
    await a.until("ship.left");
    a.ws.close();
    b.ws.close();
  });

  it("pirates on the outpost see each other at the cantina; chat reaches the outpost or the ship", async () => {
    const start = content.world.startOutpostId;
    const p1 = await pirate();
    const p2 = await pirate();
    const a = await connect(p1.cookie);
    const b = await connect(p2.cookie);

    // Both are at the start outpost; the presence list names them both.
    const who = await a.until("outpost.presence", (m) => m.pirates.some((p) => p.pirateId === p2.me.id));
    expect(who.outpostId).toBe(start);
    expect(who.pirates.map((p) => p.pirateId)).toEqual(expect.arrayContaining([p1.me.id, p2.me.id]));
    b.send({ type: "outpost.who" });
    expect((await b.until("outpost.presence")).pirates.length).toBeGreaterThanOrEqual(2);

    // Outpost chat reaches everyone on the outpost there, with the speaker's name.
    a.send({ type: "chat.send", channel: "outpost", text: "ahoy the cantina" });
    expect(await b.until("chat.message")).toMatchObject({ channel: "outpost", pirateId: p1.me.id, name: p1.me.name, text: "ahoy the cantina" });
    expect(await a.until("chat.message")).toMatchObject({ text: "ahoy the cantina" });

    // Walking on the outpost is heard by the others on the outpost, and a newcomer's presence says where people stand (ADR 0032).
    a.send({ type: "walk.to", x: 0.75, z: -0.2 });
    expect(await b.until("walk.moved")).toMatchObject({ scope: "outpost", pirateId: p1.me.id, x: 0.75, z: -0.2 });
    b.send({ type: "outpost.who" });
    const placed = await b.until("outpost.presence", (m) => m.pirates.some((p) => p.pirateId === p1.me.id && p.at !== null && p.at !== undefined));
    expect(placed.pirates.find((p) => p.pirateId === p1.me.id)?.at).toEqual({ x: 0.75, z: -0.2 });

    // Ship chat needs a ship; aboard, the speaker leaves the outpost.
    a.send({ type: "chat.send", channel: "ship", text: "nobody hears this" });
    expect(await a.until("error")).toMatchObject({ code: "not_aboard" });
    a.send({ type: "ship.board", shipId: p1.me.ships[0]!.id });
    await a.until("ship.state");
    const gone = await b.until("outpost.presence", (m) => !m.pirates.some((p) => p.pirateId === p1.me.id));
    expect(gone.pirates.map((p) => p.pirateId)).toContain(p2.me.id);
    a.send({ type: "chat.send", channel: "outpost", text: "from the deck" });
    expect(await a.until("error")).toMatchObject({ code: "aboard_a_ship" });
    a.send({ type: "chat.send", channel: "ship", text: "all hands" });
    expect(await a.until("chat.message")).toMatchObject({ channel: "ship", text: "all hands" });
    // Aboard, a pirate hears where the crew stands on deck; walking the deck is nothing to the outpost.
    expect(await a.until("walk.where")).toMatchObject({ scope: "ship", walkers: [] });

    // Disembarking puts the pirate back among those at the outpost and re-sends their summary.
    a.send({ type: "ship.leave" });
    await a.until("ship.left");
    await a.until("pirate.updated", (m) => m.pirate.outpostId === start);
    await b.until("outpost.presence", (m) => m.pirates.some((p) => p.pirateId === p1.me.id));
  });

  it("the captain engages a raider, the ship holds and supplies the board every turn, and the fight pays out", async () => {
    const owner = await pirate();
    const crewmate = await pirate();
    const shipId = owner.me.ships[0]!.id;
    const a = await connect(owner.cookie);
    const b = await connect(crewmate.cookie);
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    b.send({ type: "ship.board", shipId });
    await b.until("ship.state");
    b.send({ type: "ship.station", station: "engines" });
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.station === "engines"));
    a.send({ type: "ship.engage" });
    expect(await a.until("error")).toMatchObject({ code: "not_hailed" });

    const room = (): ReturnType<typeof app.ships.room> & object => app.ships.room(shipId)!;
    const waitRoom = async (pred: (r: ReturnType<typeof room>) => boolean): Promise<void> => {
      for (let i = 0; i < 300; i++) {
        if (pred(room())) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("the ship never got there");
    };
    /** Legs roll their raiders; fly leg after leg until one hails the ship. */
    const huntHail = async (): Promise<string> => {
      for (let leg = 0; leg < 12; leg++) {
        if (!room().state.voyage) {
          const lane = content.world.lanes.find((r) => r.from === room().state.outpostId)!;
          a.send({ type: "ship.launch", laneId: lane.id });
          await waitRoom((r) => r.state.voyage !== null);
        }
        for (let i = 0; i < 600; i++) {
          const v = room().state.voyage;
          if (!v) break;
          if (v.hail) return v.hail.tierId;
          await turn();
        }
      }
      throw new Error("no raider hailed the ship in a dozen legs");
    };

    const tierId = await huntHail();
    const tier = content.world.raiderTiers.find((t) => t.id === tierId)!;
    const turnAtHail = room().state.turn;

    // Only the captain engages. The deal comes bound to the ship with the tier's raider and no practice supply.
    b.send({ type: "ship.engage" });
    expect(await b.until("error")).toMatchObject({ code: "not_captain" });
    a.send({ type: "ship.engage" });
    const started = await a.until("puzzle.started");
    if (started.puzzle !== "battle") throw new Error("expected a battle board");
    expect(started.battle).toEqual({ shipId, tierId });
    expect(started.config.supply).toBeNull();
    expect(started.config.raider.tokensPerTurn).toBe(tier.movesPerTurn);
    expect(started.config.turnSeconds).toBe(content.world.ship.turnSeconds);
    const engaged = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail && m.events.some((e) => e.type === "engaged"));
    expect(engaged.events).toContainEqual({ type: "engaged", tierId });
    expect((engaged.ship.location as { battle: unknown }).battle).toEqual({ tierId, sinceTurn: turnAtHail });
    const progressAtEngage = room().state.voyage!.progress;
    a.send({ type: "ship.helm", pirateId: crewmate.me.id });
    expect(await a.until("error")).toMatchObject({ code: "in_battle" });

    // The ship's first deal comes right after the board; a supply the ship did not announce is refused.
    let state = createBattleGame(started.seed, started.config);
    const first = await a.until("battle.supply", (m) => m.sessionId === started.sessionId);
    expect(first.hull).toBe(room().state.damage);
    const bogus = reduceBattle(state, { type: "supply", left: first.left + 1, forward: first.forward, right: first.right, turrets: first.turrets, hull: first.hull });
    a.send({ type: "puzzle.move", sessionId: started.sessionId, seq: 0, move: { type: "supply", left: first.left + 1, forward: first.forward, right: first.right, turrets: first.turrets, hull: first.hull }, hash: hashBattleState(bogus) });
    expect(await a.until("puzzle.rejected", (m) => m.sessionId === started.sessionId)).toMatchObject({ reason: "illegal_move" });
    // The rejected board ends the fight as a stalemate; the ship is free again and flies on.
    const stale = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail && m.events.some((e) => e.type === "battle_ended"));
    expect(stale.events).toContainEqual({ type: "battle_ended", tierId, outcome: "broke_off", plunder: 0, turns: 0 });
    expect((stale.ship.location as { battle: unknown }).battle).toBeNull();
    await waitRoom((r) => r.battle === null);
    await turn();
    expect(room().state.voyage!.progress).toBeGreaterThan(progressAtEngage);

    // No second hail on this leg, so the next fight needs the next raider. Fight it out: every
    // ship turn brings a deal, every deal a plot, until the engine ends it.
    const tierId2 = await huntHail();
    const tierTwo = content.world.raiderTiers.find((t) => t.id === tierId2)!;
    const turnAtHail2 = room().state.turn;
    a.send({ type: "ship.engage" });
    const fight = await a.until("puzzle.started", (m) => m.sessionId !== started.sessionId);
    if (fight.puzzle !== "battle") throw new Error("expected a battle board");
    await a.until("ship.state", (m) => m.ship.turn >= turnAtHail2 && m.events.some((e) => e.type === "engaged"));
    state = createBattleGame(fight.seed, fight.config);
    let seq = 0;
    const log = (move: BattleMove): void => {
      state = reduceBattle(state, move);
      a.send({ type: "puzzle.move", sessionId: fight.sessionId, seq: seq++, move, hash: hashBattleState(state) });
    };
    const deal = await a.until("battle.supply", (m) => m.sessionId === fight.sessionId);
    log({ type: "supply", left: deal.left, forward: deal.forward, right: deal.right, turrets: deal.turrets, hull: deal.hull });
    for (let i = 0; i < fight.config.maxTurns + 2 && !state.finished; i++) {
      log({ type: "commit", ...plainPlan(state) });
      if (state.finished) break;
      // The ship takes the turn's hits and shots before its next turn deals again. A deal that
      // reports a wrecked hull ends the fight by itself, so the loop checks again before plotting.
      await waitRoom((r) => r.battle !== null && r.battle.turnsSeen === state.turn);
      expect(room().state.loaded).toBeLessThanOrEqual(fight.config.turrets);
      await turn();
      const supply = await a.until("battle.supply", (m) => m.sessionId === fight.sessionId);
      expect(supply.turrets).toBeLessThanOrEqual(fight.config.turrets);
      log({ type: "supply", left: supply.left, forward: supply.forward, right: supply.right, turrets: supply.turrets, hull: supply.hull });
    }
    expect(state.finished).toBe(true);
    const result = await a.until("puzzle.result", (m) => m.sessionId === fight.sessionId);
    expect(result.score).toBe(state.score);
    // Either boarding opens the melee instead of paying out (M5): everyone gets a board and the
    // ship holds. Bury the raider crew in scrap so the airlock is won and the purse comes through.
    const boarding = state.outcome === "boarded" || state.outcome === "boarded_by";
    if (boarding) {
      await a.until("ship.state", (m) => m.events.some((e) => e.type === "boarding"));
      await a.until("puzzle.started", (m) => m.puzzle === "swordfight");
      await b.until("puzzle.started", (m) => m.puzzle === "swordfight");
      const run = room().melee!;
      let crew = run.crew;
      crew.boards.forEach((_, i) => {
        crew = reduceSwordfight(crew, { type: "incoming", board: i, scrap: 200, blade: 0, tick: crew.tick });
      });
      for (let i = 0; i < 40 && !crew.finished; i++) crew = reduceSwordfight(crew, { type: "wait", tick: Math.min(crew.config.maxTick, crew.tick + 20) });
      expect(crew.finished).toBe(true);
      run.crew = crew;
      await turn();
    }
    const expectedOutcome = boarding ? "boarded" : state.outcome;
    const ended = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail2 && m.events.some((e) => e.type === "battle_ended"));
    const event = ended.events.find((e) => e.type === "battle_ended");
    if (!event || event.type !== "battle_ended") throw new Error("no battle_ended event");
    expect(event.outcome).toBe(expectedOutcome);
    expect(event.turns).toBe(state.turn);
    const won = expectedOutcome === "boarded" || expectedOutcome === "crippled";
    expect(event.plunder).toBe(won ? tierTwo.plunder : 0);
    expect((ended.ship.location as { battle: unknown }).battle).toBeNull();
    expect(ended.ship.melee).toBeNull();
    const voyages = await app.db.select().from(schema.voyage).where(eq(schema.voyage.shipId, shipId));
    const fought = voyages.find((x) => x.encounter?.outcome === expectedOutcome && x.encounter?.tierId === tierTwo.id);
    expect(fought?.encounter).toMatchObject({ tierId: tierTwo.id, evaded: false, outcome: expectedOutcome, plunder: event.plunder });
    const ledger = await app.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.pirateId, owner.me.id));
    const paid = ledger.filter((e) => e.reason === "plunder").reduce((n, e) => n + e.delta, 0);
    const crewmateLedger = await app.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.pirateId, crewmate.me.id));
    const crewmatePaid = crewmateLedger.filter((e) => e.reason === "plunder").reduce((n, e) => n + e.delta, 0);
    expect(paid + crewmatePaid).toBe(event.plunder);
    if (won) {
      expect(paid).toBeGreaterThan(crewmatePaid);
      await a.until("pirate.updated", (m) => m.pirate.balance === paid);
    }

    // A deal can end the fight by itself: a hull the ship reports as wrecked is a loss the moment
    // the board logs it, with no turn plotted, and the server owes the captain the result.
    const tierId3 = await huntHail();
    const turnAtHail3 = room().state.turn;
    // A bot at plating would patch the hull between turns; the crewmate takes it over (and,
    // with no board, patches nothing), so the wreck stays a wreck.
    b.send({ type: "ship.station", station: "plating" });
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === crewmate.me.id && c.station === "plating"));
    expect(room().state.crew.some((c) => c.bot && c.station === "plating")).toBe(false);
    a.send({ type: "ship.engage" });
    const last = await a.until("puzzle.started", (m) => m.sessionId !== fight.sessionId && m.sessionId !== started.sessionId);
    if (last.puzzle !== "battle") throw new Error("expected a battle board");
    await a.until("ship.state", (m) => m.ship.turn >= turnAtHail3 && m.events.some((e) => e.type === "engaged"));
    await a.until("battle.supply", (m) => m.sessionId === last.sessionId);
    room().state = reduceShip(room().state, { type: "hit", damage: 1000 });
    await turn();
    const wrecked = await a.until("battle.supply", (m) => m.sessionId === last.sessionId);
    expect(wrecked.hull).toBe(1000);
    state = createBattleGame(last.seed, last.config);
    state = reduceBattle(state, { type: "supply", left: wrecked.left, forward: wrecked.forward, right: wrecked.right, turrets: wrecked.turrets, hull: wrecked.hull });
    expect(state.finished).toBe(true);
    a.send({ type: "puzzle.move", sessionId: last.sessionId, seq: 0, move: { type: "supply", left: wrecked.left, forward: wrecked.forward, right: wrecked.right, turrets: wrecked.turrets, hull: wrecked.hull }, hash: hashBattleState(state) });
    expect((await a.until("puzzle.result", (m) => m.sessionId === last.sessionId)).score).toBe(state.score);
    const lost = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail3 && m.events.some((e) => e.type === "battle_ended"));
    expect(lost.events).toContainEqual({ type: "battle_ended", tierId: tierId3, outcome: state.outcome, plunder: 0, turns: 0 });
    expect((lost.ship.location as { battle: unknown }).battle).toBeNull();
    a.ws.close();
    b.ws.close();
  });

  it("a boarding opens the melee for everyone aboard, the server lanes the scrap, and the airlock decides the plunder", async () => {
    const owner = await pirate();
    const crewmate = await pirate();
    const a = await connect(owner.cookie);
    const b = await connect(crewmate.cookie);
    const shipId = owner.me.ships[0]!.id;
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    b.send({ type: "ship.board", shipId });
    await b.until("ship.state", (m) => m.ship.crew.length === 2);
    const room = (): ReturnType<typeof app.ships.room> & object => app.ships.room(shipId)!;
    const waitRoom = async (pred: (r: ReturnType<typeof room>) => boolean): Promise<void> => {
      for (let i = 0; i < 300; i++) {
        if (pred(room())) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("the ship never got there");
    };
    const huntHail = async (): Promise<string> => {
      for (let leg = 0; leg < 12; leg++) {
        if (!room().state.voyage) {
          const lane = content.world.lanes.find((r) => r.from === room().state.outpostId)!;
          a.send({ type: "ship.launch", laneId: lane.id });
          await waitRoom((r) => r.state.voyage !== null);
        }
        for (let i = 0; i < 600; i++) {
          const v = room().state.voyage;
          if (!v) break;
          if (v.hail) return v.hail.tierId;
          await turn();
        }
      }
      throw new Error("no raider hailed the ship in a dozen legs");
    };
    const tierId = await huntHail();
    const tier = content.world.raiderTiers.find((t) => t.id === tierId)!;
    const turnAtHail = room().state.turn;
    a.send({ type: "ship.engage" });
    const fight = await a.until("puzzle.started");
    if (fight.puzzle !== "battle") throw new Error("expected a battle board");
    await a.until("ship.state", (m) => m.ship.turn >= turnAtHail && m.events.some((e) => e.type === "engaged"));
    const deal = await a.until("battle.supply", (m) => m.sessionId === fight.sessionId);
    let state = createBattleGame(fight.seed, fight.config);
    state = reduceBattle(state, { type: "supply", left: deal.left, forward: deal.forward, right: deal.right, turrets: deal.turrets, hull: deal.hull });
    a.send({ type: "puzzle.move", sessionId: fight.sessionId, seq: 0, move: { type: "supply", left: deal.left, forward: deal.forward, right: deal.right, turrets: deal.turrets, hull: deal.hull }, hash: hashBattleState(state) });
    await waitRoom(() => app.puzzles.sessions.get(fight.sessionId)?.moves.length === 1);
    // Put the raider alongside and hurt: a grapple ends the space battle with a boarding. Both
    // copies of the board are set the same way, so the log still agrees.
    const session = app.puzzles.sessions.get(fight.sessionId)!;
    // Our hull sound (a long hunt wears it, and a hurt captain can be boarded first); the raider
    // alongside, hurt, and with nothing to fly or fire, so she can only wait for the hooks.
    const me = { ...state.ships[0], damage: 0 };
    state = { ...state, ships: [me, { ...state.ships[1], x: me.x, y: me.y - 1, damage: fight.config.grappleDamage, loaded: 0, tokens: { left: 0, forward: 0, right: 0 } }] };
    session.state = state;
    state = reduceBattle(state, { type: "commit", segments: [], grapple: true });
    expect(state.outcome).toBe("boarded");
    a.send({ type: "puzzle.move", sessionId: fight.sessionId, seq: 1, move: { type: "commit", segments: [], grapple: true }, hash: hashBattleState(state) });
    await a.until("puzzle.result", (m) => m.sessionId === fight.sessionId);

    // Everyone aboard gets a board at the airlock; the ship says so and holds.
    const boarding = await a.until("ship.state", (m) => m.events.some((e) => e.type === "boarding"));
    expect(boarding.ship.melee).toEqual({ tierId });
    expect((boarding.ship.location as { battle: unknown }).battle).not.toBeNull();
    const mineA = await a.until("puzzle.started", (m) => m.puzzle === "swordfight");
    const mineB = await b.until("puzzle.started", (m) => m.puzzle === "swordfight");
    if (mineA.puzzle !== "swordfight" || mineB.puzzle !== "swordfight") throw new Error("expected swordfight boards");
    expect(mineA.melee).toEqual({ shipId, tierId });
    expect(mineA.config.foes).toEqual([]);
    expect(mineA.config.player).toBe(true);
    const boards = await a.until("melee.boards", (m) => m.boards.length === 4);
    expect(boards.boards.filter((x) => x.side === 1)).toHaveLength(2);
    expect(boards.boards.filter((x) => x.side === 0).map((x) => x.pirateId).sort()).toEqual([owner.me.id, crewmate.me.id].sort());
    expect(room().melee?.crew.boards.every((x) => x.ai?.skill === tier.swordsmen.skill)).toBe(true);
    const progress = room().state.voyage!.progress;

    // The crewmate drops their board: that was their one board in this melee. A pirate who comes
    // aboard mid-fight gets one of their own.
    b.send({ type: "puzzle.abandon", sessionId: mineB.sessionId });
    await waitRoom((r) => r.melee !== null && !r.melee.fights.has(crewmate.me.id));
    b.send({ type: "melee.join" });
    expect(await b.until("error")).toMatchObject({ code: "not_in_melee" });
    const late = await pirate();
    const c = await connect(late.cookie);
    c.send({ type: "ship.board", shipId });
    await c.until("ship.state", (m) => m.ship.melee !== null);
    c.send({ type: "melee.join" });
    const lateBoard = await c.until("puzzle.started", (m) => m.puzzle === "swordfight");
    if (lateBoard.puzzle !== "swordfight") throw new Error("expected a swordfight board");
    expect(lateBoard.melee).toEqual({ shipId, tierId });
    await c.until("melee.boards", (m) => m.boards.some((x) => x.pirateId === late.me.id));

    // The owner's board logs time; the ship holds position while the airlock is fought over.
    let mine = createSwordfightGame(mineA.seed, mineA.config);
    let seq = 0;
    const log = (move: SwordfightMove): void => {
      mine = reduceSwordfight(mine, move);
      a.send({ type: "puzzle.move", sessionId: mineA.sessionId, seq: seq++, move, hash: hashSwordfightState(mine) });
    };
    log({ type: "wait", tick: 1 });
    await turn();
    expect(room().state.voyage!.progress).toBe(progress);
    await waitRoom(() => app.puzzles.sessions.get(mineA.sessionId)?.moves.length === 1);

    // A move lost on the way (ADR 0024): the next one carries the wrong number, and instead of the
    // round being thrown out the board is handed back as the server holds it. The rebuilt board goes on.
    const held = mine;
    mine = reduceSwordfight(mine, { type: "wait", tick: 2 });
    seq++;
    log({ type: "wait", tick: 3 });
    const back = await a.until("puzzle.started", (m) => m.sessionId === mineA.sessionId && m.resume !== undefined);
    expect(back.resume?.moves).toEqual([{ type: "wait", tick: 1 }]);
    expect(app.puzzles.sessions.get(mineA.sessionId)?.closed).toBe(false);
    mine = held;
    seq = 1;
    log({ type: "wait", tick: 4 });
    await waitRoom(() => app.puzzles.sessions.get(mineA.sessionId)?.moves.length === 2);

    // Bury the raider crew in scrap until every board of theirs is out: the airlock is won.
    const run = room().melee!;
    let crew = run.crew;
    crew.boards.forEach((_, i) => {
      crew = reduceSwordfight(crew, { type: "incoming", board: i, scrap: 200, blade: 0, tick: crew.tick });
    });
    for (let i = 0; i < 40 && !crew.finished; i++) crew = reduceSwordfight(crew, { type: "wait", tick: Math.min(crew.config.maxTick, crew.tick + 20) });
    expect(crew.finished).toBe(true);
    run.crew = crew;
    await turn();
    const over = await a.until("melee.over", (m) => m.sessionId === mineA.sessionId);
    expect(over.won).toBe(true);
    mine = reduceSwordfight(mine, { type: "end", won: true, tick: Math.max(mine.tick, over.tick) });
    const result = await a.until("puzzle.result", (m) => m.sessionId === mineA.sessionId);
    expect(result.score).toBe(mine.score);
    expect(result.score).toBe(mineA.config.winPoints);
    const ended = await a.until("ship.state", (m) => m.events.some((e) => e.type === "battle_ended"));
    const event = ended.events.find((e) => e.type === "battle_ended");
    if (!event || event.type !== "battle_ended") throw new Error("no battle_ended event");
    expect(event).toMatchObject({ tierId, outcome: "boarded", plunder: tier.plunder });
    expect(ended.ship.melee).toBeNull();
    expect((ended.ship.location as { battle: unknown }).battle).toBeNull();
    await waitRoom((r) => r.melee === null);
    await c.until("puzzle.result", (m) => m.sessionId === lateBoard.sessionId);
    let paid = 0;
    for (const id of [owner.me.id, crewmate.me.id, late.me.id]) {
      const ledger = await app.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.pirateId, id));
      paid += ledger.filter((e) => e.reason === "plunder").reduce((n, e) => n + e.delta, 0);
    }
    expect(paid).toBe(tier.plunder);
    await turn();
    expect(room().state.voyage === null || room().state.voyage!.progress > progress).toBe(true);
    a.ws.close();
    b.ws.close();
    c.ws.close();
  });

  it("the shipyard sells a ship at the class price and refuses a pirate who is short or aboard", async () => {
    const p1 = await pirate();
    const a = await connect(p1.cookie);
    const skiff = content.world.shipClasses[0]!;

    a.send({ type: "shipyard.buy", classId: "galleon" });
    expect(await a.until("error")).toMatchObject({ code: "no_such_class" });
    a.send({ type: "shipyard.buy", classId: skiff.id });
    expect(await a.until("error")).toMatchObject({ code: "short_of_credits" });

    // Pay the pirate and buy: the ledger is charged, the ship is delivered to the dock they stand on.
    await app.db.transaction((tx) => appendLedger(tx, p1.me.id, skiff.price, "test.grant", null));
    a.send({ type: "shipyard.buy", classId: skiff.id });
    const updated = await a.until("pirate.updated");
    expect(updated.pirate.ships).toHaveLength(2);
    expect(updated.pirate.balance).toBe(0);
    expect(updated.pirate.ships.every((s) => s.outpostId === content.world.startOutpostId)).toBe(true);

    a.send({ type: "ship.board", shipId: updated.pirate.ships[1]!.id });
    await a.until("ship.state");
    a.send({ type: "shipyard.buy", classId: skiff.id });
    expect(await a.until("error")).toMatchObject({ code: "aboard_a_ship" });
  });
});
