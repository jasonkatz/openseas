/**
 * A crew boards a sloop, sets sail, works a station, and arrives. Runs against a real Postgres
 * when TEST_DATABASE_URL is set, like the integration test; the config maths need no database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { loadContent } from "@openseas/content";
import { createBilgingGame, hashBilgingState, reduceBilging, swapIllegalReason, type BilgingMove, type BilgingState } from "@openseas/engine";
import { parseServerMessage, type MeResponse, type PirateSummary, type ServerMessage } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import { legPlan, shipConfigFor } from "../src/ships/service.js";

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

    // The mate's bilging board is dealt bound to the ship, and its points count at the next turn.
    b.send({ type: "duty.start" });
    const started = await b.until("puzzle.started");
    if (started.puzzle !== "bilging") throw new Error("expected a bilging board");
    expect(started.duty).toEqual({ shipId, station: "bilging" });
    let state = createBilgingGame(started.seed, started.config);
    for (let i = 0; i < 12; i++) {
      const move = scoringMove(state);
      state = reduceBilging(state, move);
      b.send({ type: "puzzle.move", sessionId: started.sessionId, seq: i, move, hash: hashBilgingState(state) });
    }
    expect(state.score).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 100));

    await turn();
    const t1 = await a.until("ship.state", (m) => m.ship.turn === 1);
    expect(t1.ship.lastTurn).toMatchObject({ turn: 1, held: false });
    expect(t1.ship.lastTurn!.outputs.bilging).toBeGreaterThan(0);
    expect(t1.ship.lastTurn!.outputs.sailing).toBe(0);
    expect(t1.ship.location.kind === "at-sea" && t1.ship.location.progress).toBeGreaterThan(0);
    expect(t1.ship.nextTurnAt).toBeGreaterThan(clock.t);

    // Standing down cuts the board short: it counts, unrated.
    b.send({ type: "ship.station", station: null });
    const cut = await b.until("puzzle.result");
    expect(cut).toMatchObject({ sessionId: started.sessionId, score: state.score, moves: 12, verified: true, rating: null, tierChange: null });
    const round = await app.db.select().from(schema.puzzleRound).where(eq(schema.puzzleRound.id, started.sessionId));
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
});
