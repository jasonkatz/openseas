/**
 * A crew boards a sloop, sets sail, works a station, and arrives. Runs against a real Postgres
 * when TEST_DATABASE_URL is set, like the integration test; the config maths need no database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { loadContent } from "@openseas/content";
import {
  createBattleGame,
  createBilgingGame,
  hashBattleState,
  hashBilgingState,
  reduceBattle,
  reduceBilging,
  reduceShip,
  swapIllegalReason,
  type BattleMove,
  type BattlePlan,
  type BattleSegment,
  type BattleState,
  type BilgingMove,
  type BilgingState,
  type MoveToken,
} from "@openseas/engine";
import { parseServerMessage, type MeResponse, type PirateSummary, type ServerMessage } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { appendLedger } from "../src/ledger.js";
import { createLogger } from "../src/log.js";
import { legPlan, shipConfigFor, splitBooty, splitTokens } from "../src/ships/service.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describe("ship config from content", () => {
  const content = loadContent();

  it("scales each puzzle's par to one turn", () => {
    const cfg = shipConfigFor(content, content.world.shipClasses[0]!);
    const b = content.puzzles.bilging;
    expect(cfg.par.bilging).toBe(Math.round((b.parScore * content.world.ship.turnSeconds) / b.roundSeconds));
    expect(cfg.par.bilging).toBeGreaterThan(0);
    expect(cfg.shipClass.stations).toEqual(content.world.shipClasses[0]!.stations);
    expect(cfg.rules).toBe(content.world.ship);
  });

  it("turns a route into a leg the engine can roll", () => {
    const r = content.world.routes[0]!;
    const leg = legPlan(r);
    expect(leg.lengthUnits).toBe(r.durationSeconds * 1000);
    expect(leg.encounterChancePercent).toBe(Math.round(r.encounterChance * 100));
    expect(leg.from).toBe(r.from);
  });
});

describe("booty and tokens", () => {
  it("splits the ship's tokens half forward and the rest between the turns", () => {
    expect(splitTokens(0)).toEqual({ left: 0, forward: 0, right: 0 });
    expect(splitTokens(1)).toEqual({ left: 0, forward: 1, right: 0 });
    expect(splitTokens(4)).toEqual({ left: 1, forward: 2, right: 1 });
    expect(splitTokens(5)).toEqual({ left: 1, forward: 3, right: 1 });
    expect(splitTokens(6)).toEqual({ left: 2, forward: 3, right: 1 });
  });

  it("splits booty by shares weighted by duty points, with the captain's extra share and the remainder", () => {
    const crew = [
      { pirateId: "cap", captain: true, points: 0 },
      { pirateId: "ace", captain: false, points: 100 },
      { pirateId: "idle", captain: false, points: 0 },
    ];
    const shares = splitBooty(1000, crew);
    // Weights: captain 2 * 50 = 100, ace 1 * 100 = 100, idle 1 * 50 = 50.
    expect(shares.get("ace")).toBe(400);
    expect(shares.get("idle")).toBe(200);
    expect(shares.get("cap")).toBe(400);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(1000);
    // Nobody worked: base shares only, the captain two to one.
    const flat = splitBooty(300, crew.map((c) => ({ ...c, points: 0 })));
    expect(flat.get("cap")).toBe(150);
    expect(flat.get("ace")).toBe(75);
    expect(splitBooty(0, crew).size).toBe(0);
    expect(splitBooty(500, []).size).toBe(0);
    const solo = splitBooty(601, [{ pirateId: "cap", captain: true, points: 0 }]);
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
function scoringMove(state: BilgingState): BilgingMove {
  let fallback: BilgingMove | null = null;
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) !== null) continue;
      const move: BilgingMove = { type: "swap", col: c, row: r };
      if (reduceBilging(state, move).score > state.score) return move;
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

  it("a crew boards, sails, works a station, arrives and goes ashore", async () => {
    const start = content.world.startIslandId;
    const owner = await pirate();
    const mate = await pirate();
    expect(owner.me.islandId).toBe(start);
    const shipId = owner.me.ships[0]!.id;

    const a = await connect(owner.cookie);
    const b = await connect(mate.cookie);

    // Nobody is aboard yet, so the notice board is empty.
    b.send({ type: "board.list" });
    expect(await b.until("board.ships")).toMatchObject({ islandId: start, ships: [] });

    a.send({ type: "ship.board", shipId });
    const docked = await a.until("ship.state");
    expect(docked.ship).toMatchObject({ shipId, captainId: owner.me.id, location: { kind: "docked", islandId: start }, turn: 0 });
    expect(docked.events.map((e) => e.type)).toEqual(["boarded", "wheel"]);

    // The ship is now on the notice board, and the mate boards from it.
    b.send({ type: "board.list" });
    const board = await b.until("board.ships");
    expect(board.ships).toHaveLength(1);
    expect(board.ships[0]).toMatchObject({ shipId, crew: 1, captainName: owner.me.name, yours: false });
    b.send({ type: "ship.board", shipId });
    const joined = await b.until("ship.state");
    expect(joined.ship.crew.map((c) => c.name).sort()).toEqual([owner.me.name, mate.me.name].sort());
    await a.until("ship.state", (m) => m.ship.crew.length === 2);

    // Only the captain sails; the mate is refused.
    b.send({ type: "ship.sail", routeId: "saltwick-gullhaven" });
    expect(await b.until("error")).toMatchObject({ code: "not_captain" });
    b.send({ type: "duty.start" });
    expect(await b.until("error")).toMatchObject({ code: "no_station" });

    b.send({ type: "ship.station", station: "bilging" });
    await b.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === mate.me.id && c.station === "bilging"));
    a.send({ type: "ship.station", station: "bilging" });
    expect(await a.until("error")).toMatchObject({ code: "station_taken" });
    a.send({ type: "ship.station", station: "sailing" });
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === owner.me.id && c.station === "sailing"));

    b.send({ type: "duty.start" });
    expect(await b.until("error")).toMatchObject({ code: "not_at_sea" });

    a.send({ type: "ship.sail", routeId: "gullhaven-saltwick" });
    expect(await a.until("error")).toMatchObject({ code: "bad_route" });
    a.send({ type: "ship.sail", routeId: "saltwick-gullhaven" });
    const sailed = await a.until("ship.state", (m) => m.ship.location.kind === "at-sea");
    expect(sailed.ship.location).toMatchObject({ kind: "at-sea", routeId: "saltwick-gullhaven", from: start, to: "gullhaven", progress: 0 });
    await b.until("ship.state", (m) => m.ship.location.kind === "at-sea");
    const voyages = await app.db.select().from(schema.voyage).where(eq(schema.voyage.shipId, shipId));
    expect(voyages).toHaveLength(1);
    expect(voyages[0]).toMatchObject({ routeId: "saltwick-gullhaven", captainId: owner.me.id, outcome: null });
    const crewRows = await app.db.select().from(schema.voyageCrew).where(eq(schema.voyageCrew.voyageId, voyages[0]!.id));
    expect(crewRows.map((r) => r.pirateId).sort()).toEqual([owner.me.id, mate.me.id].sort());

    // The mate's bilging board is dealt bound to the ship, with the ship's bilge as its water
    // (DESIGN.md 3.3): the board's first move is the water event the deal carries.
    b.send({ type: "duty.start" });
    const started = await b.until("puzzle.started");
    if (started.puzzle !== "bilging") throw new Error("expected a bilging board");
    expect(started.duty).toEqual({ shipId, station: "bilging", water: 0 });
    expect(started.config.shipWater).toBe(true);
    let state = createBilgingGame(started.seed, started.config);
    let seq = 0;
    const log = (move: BilgingMove): void => {
      state = reduceBilging(state, move);
      b.send({ type: "puzzle.move", sessionId: started.sessionId, seq: seq++, move, hash: hashBilgingState(state) });
    };
    log({ type: "water", row: 0 });
    expect(state.waterRow).toBe(0);
    for (let i = 0; i < 12; i++) log(scoringMove(state));
    expect(state.score).toBeGreaterThan(0);
    expect(state.waterRow).toBe(0);
    await new Promise((r) => setTimeout(r, 100));

    // The turn takes the board's points, and water comes in: the pump hears the new depth.
    await turn();
    const t1 = await a.until("ship.state", (m) => m.ship.turn === 1);
    expect(t1.ship.lastTurn).toMatchObject({ turn: 1, held: false });
    expect(t1.ship.lastTurn!.outputs.bilging).toBeGreaterThan(0);
    expect(t1.ship.lastTurn!.outputs.sailing).toBe(0);
    expect(t1.ship.location.kind === "at-sea" && t1.ship.location.progress).toBeGreaterThan(0);
    expect(t1.ship.nextTurnAt).toBeGreaterThan(clock.t);
    // Nobody is at the sails, so the bilge fills faster than one pirate pumps it over a few turns.
    for (let i = 0; i < 6; i++) await turn();
    const water = await b.until("duty.water", (m) => m.sessionId === started.sessionId);
    expect(water.row).toBeGreaterThan(0);
    // The ship may have spoken again since; what counts is its latest word. A water event that
    // says anything else is refused as an illegal move.
    const current = app.ships.bilgeRows(app.ships.room(shipId)!);
    expect(current).toBeGreaterThanOrEqual(water.row);
    const wrong = reduceBilging(state, { type: "water", row: current + 1 });
    b.send({ type: "puzzle.move", sessionId: started.sessionId, seq, move: { type: "water", row: current + 1 }, hash: hashBilgingState(wrong) });
    const rejected = await b.until("puzzle.rejected", (m) => m.sessionId === started.sessionId);
    expect(rejected).toMatchObject({ reason: "illegal_move", atSeq: seq });

    // A fresh board picks the ship's bilge up where it is now and takes the ship's word for the depth.
    b.send({ type: "duty.start" });
    const again = await b.until("puzzle.started");
    if (again.puzzle !== "bilging") throw new Error("expected a bilging board");
    expect(again.duty?.water).toBe(app.ships.bilgeRows(app.ships.room(shipId)!));
    state = createBilgingGame(again.seed, again.config);
    seq = 0;
    const log2 = (move: BilgingMove): void => {
      state = reduceBilging(state, move);
      b.send({ type: "puzzle.move", sessionId: again.sessionId, seq: seq++, move, hash: hashBilgingState(state) });
    };
    log2({ type: "water", row: again.duty!.water! });
    for (let i = 0; i < 12; i++) log2(scoringMove(state));
    await new Promise((r) => setTimeout(r, 100));

    // Standing down cuts the board short: it counts, unrated. The water event is in the log but is no move.
    b.send({ type: "ship.station", station: null });
    const cut = await b.until("puzzle.result", (m) => m.sessionId === again.sessionId);
    expect(cut).toMatchObject({ sessionId: again.sessionId, score: state.score, moves: 12, verified: true, rating: null, tierChange: null });
    const started2 = { sessionId: again.sessionId };
    void started2;
    const round = await app.db.select().from(schema.puzzleRound).where(eq(schema.puzzleRound.id, again.sessionId));
    expect(round[0]).toMatchObject({ rated: false, voyageId: voyages[0]!.id, rejectedReason: null });
    const ratings = await app.db.select().from(schema.rating).where(eq(schema.rating.pirateId, mate.me.id));
    expect(ratings).toHaveLength(0);

    // Sail the rest of the way. Unstaffed, with the bilge filling, the sloop crawls, but it gets there.
    for (let i = 0; i < 600 && app.ships.room(shipId)?.state.voyage; i++) await turn();
    expect(app.ships.room(shipId)?.state.voyage).toBeNull();
    const atGullhaven = (m: Extract<ServerMessage, { type: "ship.state" }>): boolean => m.ship.location.kind === "docked" && m.ship.location.islandId === "gullhaven";
    const arrived = await a.until("ship.state", atGullhaven);
    expect(arrived.ship.water).toBe(0);
    expect(arrived.ship.voyagesCompleted).toBe(1);
    await b.until("ship.state", atGullhaven);
    const [v] = await app.db.select().from(schema.voyage).where(eq(schema.voyage.id, voyages[0]!.id));
    expect(v).toMatchObject({ outcome: "arrived" });
    expect(v!.turns).toBeGreaterThan(1);
    const [shipRow] = await app.db.select().from(schema.ship).where(eq(schema.ship.id, shipId));
    expect(shipRow?.islandId).toBe("gullhaven");
    const [mateRow] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, mate.me.id));
    expect(mateRow?.islandId).toBe("gullhaven");

    // Everyone goes ashore; the room empties.
    b.send({ type: "ship.leave" });
    expect(await b.until("ship.left")).toMatchObject({ shipId, reason: "left" });
    await a.until("ship.state", (m) => m.ship.crew.length === 1);
    a.send({ type: "ship.leave" });
    expect(await a.until("ship.left")).toMatchObject({ shipId, reason: "left" });
    expect(app.ships.size).toBe(0);
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie: owner.cookie } })).json()) as MeResponse;
    expect(me.pirate?.islandId).toBe("gullhaven");
    expect(me.pirate?.ships[0]?.islandId).toBe("gullhaven");

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
    const mate = await pirate();
    const shipId = owner.me.ships[0]!.id;
    const a = await connect(owner.cookie);
    let b = await connect(mate.cookie);
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    b.send({ type: "ship.board", shipId });
    await b.until("ship.state");
    b.send({ type: "ship.station", station: "carpentry" });
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.station === "carpentry"));
    a.send({ type: "ship.sail", routeId: "saltwick-emberreef" });
    await a.until("ship.state", (m) => m.ship.location.kind === "at-sea");
    await b.until("ship.state", (m) => m.ship.location.kind === "at-sea");

    b.ws.close();
    const away = await a.until("ship.state", (m) => m.ship.crew.some((c) => c.pirateId === mate.me.id && c.away));
    expect(away.ship.crew.find((c) => c.pirateId === mate.me.id)?.station).toBe("carpentry");

    // Reconnecting inside the grace period takes the seat back, station and all.
    b = await connect(mate.cookie);
    const back = await b.until("ship.state");
    expect(back.ship.crew.find((c) => c.pirateId === mate.me.id)).toMatchObject({ away: false, station: "carpentry" });
    await a.until("ship.state", (m) => m.ship.crew.every((c) => !c.away));

    // Drop again and stay away past the grace: put ashore at the island the ship left.
    b.ws.close();
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.away));
    await turn(content.world.ship.graceTurns + 1);
    const alone = await a.until("ship.state", (m) => m.ship.crew.length === 1);
    expect(alone.ship.location.kind).toBe("at-sea");
    const [mateRow] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, mate.me.id));
    expect(mateRow?.islandId).toBe(content.world.startIslandId);

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
    expect(shipRow?.islandId).toBe(content.world.startIslandId);
    const voyages = await app.db.select().from(schema.voyage).where(eq(schema.voyage.shipId, shipId));
    expect(voyages[0]).toMatchObject({ outcome: "abandoned" });
  });

  it("the owner can lock the ship; a locked ship refuses other pirates", async () => {
    const owner = await pirate();
    const mate = await pirate();
    const shipId = owner.me.ships[0]!.id;
    const a = await connect(owner.cookie);
    const b = await connect(mate.cookie);
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

  it("pirates ashore see each other at the tavern; chat reaches the island or the ship", async () => {
    const start = content.world.startIslandId;
    const p1 = await pirate();
    const p2 = await pirate();
    const a = await connect(p1.cookie);
    const b = await connect(p2.cookie);

    // Both are ashore at the start island; the presence list names them both.
    const who = await a.until("island.presence", (m) => m.pirates.some((p) => p.pirateId === p2.me.id));
    expect(who.islandId).toBe(start);
    expect(who.pirates.map((p) => p.pirateId)).toEqual(expect.arrayContaining([p1.me.id, p2.me.id]));
    b.send({ type: "island.who" });
    expect((await b.until("island.presence")).pirates.length).toBeGreaterThanOrEqual(2);

    // Island chat reaches everyone ashore there, with the speaker's name.
    a.send({ type: "chat.send", channel: "island", text: "ahoy the tavern" });
    expect(await b.until("chat.message")).toMatchObject({ channel: "island", pirateId: p1.me.id, name: p1.me.name, text: "ahoy the tavern" });
    expect(await a.until("chat.message")).toMatchObject({ text: "ahoy the tavern" });

    // Ship chat needs a ship; aboard, the speaker leaves the island.
    a.send({ type: "chat.send", channel: "ship", text: "nobody hears this" });
    expect(await a.until("error")).toMatchObject({ code: "not_aboard" });
    a.send({ type: "ship.board", shipId: p1.me.ships[0]!.id });
    await a.until("ship.state");
    const gone = await b.until("island.presence", (m) => !m.pirates.some((p) => p.pirateId === p1.me.id));
    expect(gone.pirates.map((p) => p.pirateId)).toContain(p2.me.id);
    a.send({ type: "chat.send", channel: "island", text: "from the deck" });
    expect(await a.until("error")).toMatchObject({ code: "aboard_a_ship" });
    a.send({ type: "chat.send", channel: "ship", text: "all hands" });
    expect(await a.until("chat.message")).toMatchObject({ channel: "ship", text: "all hands" });

    // Going ashore puts the pirate back among those at the island and re-sends their summary.
    a.send({ type: "ship.leave" });
    await a.until("ship.left");
    await a.until("pirate.updated", (m) => m.pirate.islandId === start);
    await b.until("island.presence", (m) => m.pirates.some((p) => p.pirateId === p1.me.id));
  });

  it("the captain engages a brigand, the ship holds and supplies the board every turn, and the fight pays out", async () => {
    const owner = await pirate();
    const mate = await pirate();
    const shipId = owner.me.ships[0]!.id;
    const a = await connect(owner.cookie);
    const b = await connect(mate.cookie);
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    b.send({ type: "ship.board", shipId });
    await b.until("ship.state");
    b.send({ type: "ship.station", station: "sailing" });
    await a.until("ship.state", (m) => m.ship.crew.some((c) => c.station === "sailing"));
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
    /** Legs roll their brigands; sail leg after leg until one hails the ship. */
    const huntHail = async (): Promise<string> => {
      for (let leg = 0; leg < 12; leg++) {
        if (!room().state.voyage) {
          const route = content.world.routes.find((r) => r.from === room().state.islandId)!;
          a.send({ type: "ship.sail", routeId: route.id });
          await waitRoom((r) => r.state.voyage !== null);
        }
        for (let i = 0; i < 600; i++) {
          const v = room().state.voyage;
          if (!v) break;
          if (v.hail) return v.hail.tierId;
          await turn();
        }
      }
      throw new Error("no brigand hailed the ship in a dozen legs");
    };

    const tierId = await huntHail();
    const tier = content.world.brigandTiers.find((t) => t.id === tierId)!;
    const turnAtHail = room().state.turn;

    // Only the captain engages. The deal comes bound to the ship with the tier's brigand and no practice supply.
    b.send({ type: "ship.engage" });
    expect(await b.until("error")).toMatchObject({ code: "not_captain" });
    a.send({ type: "ship.engage" });
    const started = await a.until("puzzle.started");
    if (started.puzzle !== "battle") throw new Error("expected a battle board");
    expect(started.battle).toEqual({ shipId, tierId });
    expect(started.config.supply).toBeNull();
    expect(started.config.brigand.tokensPerTurn).toBe(tier.movesPerTurn);
    expect(started.config.turnSeconds).toBe(content.world.ship.turnSeconds);
    const engaged = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail && m.events.some((e) => e.type === "engaged"));
    expect(engaged.events).toContainEqual({ type: "engaged", tierId });
    expect((engaged.ship.location as { battle: unknown }).battle).toEqual({ tierId, sinceTurn: turnAtHail });
    const progressAtEngage = room().state.voyage!.progress;
    a.send({ type: "ship.wheel", pirateId: mate.me.id });
    expect(await a.until("error")).toMatchObject({ code: "in_battle" });

    // The ship's first deal comes right after the board; a supply the ship did not announce is refused.
    let state = createBattleGame(started.seed, started.config);
    const first = await a.until("battle.supply", (m) => m.sessionId === started.sessionId);
    expect(first.hull).toBe(room().state.damage);
    const bogus = reduceBattle(state, { type: "supply", left: first.left + 1, forward: first.forward, right: first.right, cannons: first.cannons, hull: first.hull });
    a.send({ type: "puzzle.move", sessionId: started.sessionId, seq: 0, move: { type: "supply", left: first.left + 1, forward: first.forward, right: first.right, cannons: first.cannons, hull: first.hull }, hash: hashBattleState(bogus) });
    expect(await a.until("puzzle.rejected", (m) => m.sessionId === started.sessionId)).toMatchObject({ reason: "illegal_move" });
    // The rejected board ends the fight as a stalemate; the ship is free again and sails on.
    const stale = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail && m.events.some((e) => e.type === "battle_ended"));
    expect(stale.events).toContainEqual({ type: "battle_ended", tierId, outcome: "broke_off", booty: 0, turns: 0 });
    expect((stale.ship.location as { battle: unknown }).battle).toBeNull();
    await waitRoom((r) => r.battle === null);
    await turn();
    expect(room().state.voyage!.progress).toBeGreaterThan(progressAtEngage);

    // No second hail on this leg, so the next fight needs the next brigand. Fight it out: every
    // ship turn brings a deal, every deal a plot, until the engine ends it.
    const tierId2 = await huntHail();
    const tierTwo = content.world.brigandTiers.find((t) => t.id === tierId2)!;
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
    log({ type: "supply", left: deal.left, forward: deal.forward, right: deal.right, cannons: deal.cannons, hull: deal.hull });
    for (let i = 0; i < fight.config.maxTurns + 2 && !state.finished; i++) {
      log({ type: "commit", ...plainPlan(state) });
      if (state.finished) break;
      // The ship takes the turn's hits and shots before its next turn deals again. A deal that
      // reports a wrecked hull ends the fight by itself, so the loop checks again before plotting.
      await waitRoom((r) => r.battle !== null && r.battle.turnsSeen === state.turn);
      expect(room().state.loaded).toBeLessThanOrEqual(fight.config.cannons);
      await turn();
      const supply = await a.until("battle.supply", (m) => m.sessionId === fight.sessionId);
      expect(supply.cannons).toBeLessThanOrEqual(fight.config.cannons);
      log({ type: "supply", left: supply.left, forward: supply.forward, right: supply.right, cannons: supply.cannons, hull: supply.hull });
    }
    expect(state.finished).toBe(true);
    const result = await a.until("puzzle.result", (m) => m.sessionId === fight.sessionId);
    expect(result.score).toBe(state.score);
    const ended = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail2 && m.events.some((e) => e.type === "battle_ended"));
    const event = ended.events.find((e) => e.type === "battle_ended");
    if (!event || event.type !== "battle_ended") throw new Error("no battle_ended event");
    expect(event.outcome).toBe(state.outcome);
    expect(event.turns).toBe(state.turn);
    const won = state.outcome === "boarded" || state.outcome === "crippled";
    expect(event.booty).toBe(won ? tierTwo.booty : 0);
    expect((ended.ship.location as { battle: unknown }).battle).toBeNull();
    const voyages = await app.db.select().from(schema.voyage).where(eq(schema.voyage.shipId, shipId));
    const fought = voyages.find((x) => x.encounter?.outcome === state.outcome && x.encounter?.tierId === tierTwo.id);
    expect(fought?.encounter).toMatchObject({ tierId: tierTwo.id, evaded: false, outcome: state.outcome, booty: event.booty });
    const ledger = await app.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.pirateId, owner.me.id));
    const paid = ledger.filter((e) => e.reason === "booty").reduce((n, e) => n + e.delta, 0);
    const mateLedger = await app.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.pirateId, mate.me.id));
    const matePaid = mateLedger.filter((e) => e.reason === "booty").reduce((n, e) => n + e.delta, 0);
    expect(paid + matePaid).toBe(event.booty);
    if (won) {
      expect(paid).toBeGreaterThan(matePaid);
      await a.until("pirate.updated", (m) => m.pirate.balance === paid);
    }

    // A deal can end the fight by itself: a hull the ship reports as wrecked is a loss the moment
    // the board logs it, with no turn plotted, and the server owes the captain the result.
    const tierId3 = await huntHail();
    const turnAtHail3 = room().state.turn;
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
    state = reduceBattle(state, { type: "supply", left: wrecked.left, forward: wrecked.forward, right: wrecked.right, cannons: wrecked.cannons, hull: wrecked.hull });
    expect(state.finished).toBe(true);
    a.send({ type: "puzzle.move", sessionId: last.sessionId, seq: 0, move: { type: "supply", left: wrecked.left, forward: wrecked.forward, right: wrecked.right, cannons: wrecked.cannons, hull: wrecked.hull }, hash: hashBattleState(state) });
    expect((await a.until("puzzle.result", (m) => m.sessionId === last.sessionId)).score).toBe(state.score);
    const lost = await a.until("ship.state", (m) => m.ship.turn >= turnAtHail3 && m.events.some((e) => e.type === "battle_ended"));
    expect(lost.events).toContainEqual({ type: "battle_ended", tierId: tierId3, outcome: state.outcome, booty: 0, turns: 0 });
    expect((lost.ship.location as { battle: unknown }).battle).toBeNull();
    a.ws.close();
    b.ws.close();
  });

  it("the shipyard sells a ship at the class price and refuses a pirate who is short or aboard", async () => {
    const p1 = await pirate();
    const a = await connect(p1.cookie);
    const sloop = content.world.shipClasses[0]!;

    a.send({ type: "shipyard.buy", classId: "galleon" });
    expect(await a.until("error")).toMatchObject({ code: "no_such_class" });
    a.send({ type: "shipyard.buy", classId: sloop.id });
    expect(await a.until("error")).toMatchObject({ code: "short_of_coins" });

    // Pay the pirate and buy: the ledger is charged, the ship is delivered to the dock they stand on.
    await app.db.transaction((tx) => appendLedger(tx, p1.me.id, sloop.price, "test.grant", null));
    a.send({ type: "shipyard.buy", classId: sloop.id });
    const updated = await a.until("pirate.updated");
    expect(updated.pirate.ships).toHaveLength(2);
    expect(updated.pirate.balance).toBe(0);
    expect(updated.pirate.ships.every((s) => s.islandId === content.world.startIslandId)).toBe(true);

    a.send({ type: "ship.board", shipId: updated.pirate.ships[1]!.id });
    await a.until("ship.state");
    a.send({ type: "shipyard.buy", classId: sloop.id });
    expect(await a.until("error")).toMatchObject({ code: "aboard_a_ship" });
  });
});
