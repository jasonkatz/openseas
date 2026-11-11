/**
 * Boots the whole server against a real Postgres and plays a Cooling round over the wire. Runs only
 * when TEST_DATABASE_URL is set (CI provides a Postgres service; locally use docker compose).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { PUZZLES, PUZZLE_IDS, createCoolingGame, hashCoolingState, reduceCooling, swapIllegalReason, type CoolingMove, type CoolingState } from "@openseas/engine";
import { parseServerMessage, type MeResponse, type ServerMessage } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { mergeGuestIntoAccount } from "../src/auth.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { appendLedger, balance, InsufficientFundsError } from "../src/ledger.js";
import { createLogger } from "../src/log.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("server integration", () => {
  let app: App;
  let base: string;
  const clock = { t: Date.now() };

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

  async function guestSignIn(): Promise<string> {
    const res = await fetch(`${base}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.includes("session_token"));
    expect(session).toBeDefined();
    return session!.split(";")[0]!;
  }

  it("serves health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("guest signs in, is gated by the invite code, then gets a pirate and a starter skiff", async () => {
    const cookie = await guestSignIn();

    const me0 = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as MeResponse;
    expect(me0).toEqual({ pirate: null, inviteRequired: true, providers: [], linked: [] });

    const noInvite = await fetch(`${base}/api/pirate`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
    expect(noInvite.status).toBe(403);
    expect(await noInvite.json()).toEqual({ error: "invite_required" });

    const badInvite = await fetch(`${base}/api/pirate`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: "wrong" }),
    });
    expect(badInvite.status).toBe(403);

    const created = await fetch(`${base}/api/pirate`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: "letmein" }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { pirate: MeResponse["pirate"] };
    expect(body.pirate?.guest).toBe(true);
    expect(body.pirate?.name).toMatch(/^\w+ \w+$/);
    expect(body.pirate?.ships).toHaveLength(1);
    expect(body.pirate?.ships[0]?.classId).toBe("skiff");
    expect(body.pirate?.balance).toBe(0);

    // The grant went through the ledger as a zero-cost purchase (ADR 0010).
    const entries = await app.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.pirateId, body.pirate!.id));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ delta: 0, balanceAfter: 0, reason: "ship.purchase", ref: "starter-skiff" });

    const again = await fetch(`${base}/api/pirate`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: "letmein" }),
    });
    expect(again.status).toBe(409);
  });

  it("refuses the websocket without a pirate", async () => {
    const cookie = await guestSignIn();
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie } });
    const code = await new Promise<number | string>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", (e) => resolve(e.message));
    });
    expect(code).toBe(401);
  });

  it("plays a verified round over the websocket and rates it", async () => {
    const cookie = await guestSignIn();
    await fetch(`${base}/api/pirate`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: "letmein" }),
    });
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie } });
    const inbox: ServerMessage[] = [];
    const waiters: Array<(m: ServerMessage) => void> = [];
    ws.on("message", (d) => {
      const m = parseServerMessage(JSON.parse(d.toString()));
      expect(m).not.toBeNull();
      // Who is on the outpost and the pirate's crew are pushed whenever they change; this test is about the round.
      if (m!.type === "outpost.presence" || m!.type === "crew.state") return;
      const w = waiters.shift();
      if (w) w(m!);
      else inbox.push(m!);
    });
    const next = (): Promise<ServerMessage> =>
      inbox.length ? Promise.resolve(inbox.shift()!) : new Promise((resolve) => waiters.push(resolve));
    await new Promise((resolve) => ws.on("open", resolve));

    const welcome = await next();
    expect(welcome.type).toBe("welcome");

    ws.send(JSON.stringify({ type: "puzzle.start", puzzle: "cooling" }));
    const started = await next();
    expect(started.type).toBe("puzzle.started");
    if (started.type !== "puzzle.started" || started.puzzle !== "cooling") return;

    let state: CoolingState = createCoolingGame(started.seed, started.config);
    const moves: CoolingMove[] = [];
    for (let i = 0; i < 25; i++) {
      const move = firstLegal(state);
      state = reduceCooling(state, move);
      moves.push(move);
      ws.send(JSON.stringify({ type: "puzzle.move", sessionId: started.sessionId, seq: i, move, hash: hashCoolingState(state) }));
    }
    ws.send(
      JSON.stringify({
        type: "puzzle.finish",
        sessionId: started.sessionId,
        hash: hashCoolingState(state),
        metrics: { inputToRenderP50: 12, inputToRenderP95: 30, samples: 25 },
      }),
    );
    const result = await next();
    expect(result.type).toBe("puzzle.result");
    if (result.type !== "puzzle.result") return;
    expect(result.score).toBe(state.score);
    expect(result.moves).toBe(25);
    expect(result.verified).toBe(true);
    // A harness round moves no standing (ADR 0028) but rates its own performance.
    expect(result.rating).toBeNull();
    expect(result.tierChange).toBeNull();
    expect(result.performance.rating).toBeGreaterThanOrEqual(0);
    expect(typeof result.performance.tier).toBe("string");

    // A cheater who sends a different hash is rejected on the spot.
    ws.send(JSON.stringify({ type: "puzzle.start", puzzle: "cooling" }));
    const started2 = await next();
    if (started2.type !== "puzzle.started" || started2.puzzle !== "cooling") throw new Error("expected start");
    const s2 = createCoolingGame(started2.seed, started2.config);
    ws.send(JSON.stringify({ type: "puzzle.move", sessionId: started2.sessionId, seq: 0, move: firstLegal(s2), hash: "00000000" }));
    const rejected = await next();
    expect(rejected).toMatchObject({ type: "puzzle.rejected", reason: "divergence", atSeq: 0 });

    const rows = await app.db.select().from(schema.puzzleRound).where(eq(schema.puzzleRound.id, started.sessionId));
    expect(rows[0]).toMatchObject({ score: state.score, moves: 25, rejectedReason: null, rated: false, performance: result.performance.rating });
    expect((rows[0]!.moveLog as unknown[]).length).toBe(25);

    // Every other registered puzzle plays a short honest round over the same wire, each with its own performance.
    for (const id of PUZZLE_IDS.filter((p) => p !== "cooling")) {
      // Stay under the connection's message rate limit across five puzzles.
      await new Promise((resolve) => setTimeout(resolve, 250));
      ws.send(JSON.stringify({ type: "puzzle.start", puzzle: id }));
      const st = await next();
      if (st.type !== "puzzle.started") throw new Error("expected start");
      expect(st.puzzle).toBe(id);
      const def = PUZZLES[id];
      const final = def.reduce(def.create(st.seed, st.config), { type: "end", tick: 0 });
      ws.send(JSON.stringify({ type: "puzzle.move", sessionId: st.sessionId, seq: 0, move: { type: "end", tick: 0 }, hash: def.hash(final) }));
      ws.send(JSON.stringify({ type: "puzzle.finish", sessionId: st.sessionId, hash: def.hash(final) }));
      const res = await next();
      expect(res).toMatchObject({ type: "puzzle.result", verified: true, rating: null, performance: { tier: expect.any(String) } });
    }
    // A Cooling move sent to an Engines round is an illegal move, not a crash.
    ws.send(JSON.stringify({ type: "puzzle.start", puzzle: "engines" }));
    const st3 = await next();
    if (st3.type !== "puzzle.started") throw new Error("expected start");
    ws.send(JSON.stringify({ type: "puzzle.move", sessionId: st3.sessionId, seq: 0, move: { type: "swap", col: 0, row: 0 }, hash: "00000000" }));
    expect(await next()).toMatchObject({ type: "puzzle.rejected", reason: "illegal_move" });
    // A refusal names the request it refuses (ADR 0043); a message that is no request names none.
    ws.send(JSON.stringify({ type: "puzzle.finish", sessionId: "no-such-round", hash: "00000000" }));
    expect(await next()).toEqual({ type: "error", code: "unknown_session", for: "puzzle.finish" });
    ws.send(JSON.stringify({ type: "puzzle.wave" }));
    expect(await next()).toEqual({ type: "error", code: "bad_message" });

    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as MeResponse;
    // None of it moved the pirate's standing: that is earned in the game.
    expect(me.pirate?.ratings).toEqual([]);
    ws.close();
  });

  it("the ledger refuses to go negative and the guest merge is idempotent", async () => {
    const cookie = await guestSignIn();
    const created = await fetch(`${base}/api/pirate`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: "letmein" }),
    });
    const { pirate } = (await created.json()) as { pirate: NonNullable<MeResponse["pirate"]> };

    await app.db.transaction(async (tx) => {
      await appendLedger(tx, pirate.id, 100, "test.grant", null);
    });
    expect(await balance(app.db, pirate.id)).toBe(100);
    await expect(
      app.db.transaction(async (tx) => {
        await appendLedger(tx, pirate.id, -101, "test.spend", null);
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await balance(app.db, pirate.id)).toBe(100);

    // Simulate linking: a fresh "real" user, then move the pirate across. Twice.
    const [guestUser] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, pirate.id));
    const realUserId = `real-${pirate.id}`;
    await app.db.insert(schema.user).values({ id: realUserId, name: "Real", email: `${realUserId}@example.com`, isAnonymous: false });
    await mergeGuestIntoAccount(app.db, guestUser!.userId, realUserId);
    await mergeGuestIntoAccount(app.db, guestUser!.userId, realUserId);
    const [moved] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, pirate.id));
    expect(moved?.userId).toBe(realUserId);
    expect(await balance(app.db, pirate.id)).toBe(100);
  });
});

function firstLegal(state: CoolingState): CoolingMove {
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) === null) return { type: "swap", col: c, row: r };
    }
  }
  throw new Error("no legal move");
}
