/**
 * Crews (M6, ADR 0025) over the wire: founding, invitations, ranks, crew chat, crew-only ships, and
 * the tallies voyages and victories leave on a crew. Runs against a real Postgres when
 * TEST_DATABASE_URL is set, like the other server tests. Also covers the guest-to-account merge.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { loadContent } from "@openseas/content";
import type { PirateSummary } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { configuredProviders, mergeGuestIntoAccount, retireGuest } from "../src/auth.js";
import { crewNameKey } from "../src/crews.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { appendLedger, balance } from "../src/ledger.js";
import { createLogger } from "../src/log.js";
import { Client } from "./client.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describe("social providers", () => {
  const base = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret" };
  it("are offered only with both keys, and never where social sign-in is switched off", () => {
    expect(configuredProviders(loadEnv(base))).toEqual([]);
    expect(configuredProviders(loadEnv({ ...base, DISCORD_CLIENT_ID: "a", DISCORD_CLIENT_SECRET: "b" }))).toEqual(["discord"]);
    expect(configuredProviders(loadEnv({ ...base, GOOGLE_CLIENT_ID: "a" }))).toEqual([]);
    const both = { ...base, DISCORD_CLIENT_ID: "a", DISCORD_CLIENT_SECRET: "b", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "d" };
    expect(configuredProviders(loadEnv(both))).toEqual(["discord", "google"]);
    expect(configuredProviders(loadEnv({ ...both, DISABLE_SOCIAL_SIGN_IN: "true" }))).toEqual([]);
  });
});

describe("crew names", () => {
  it("fold to one key whatever the case and spacing", () => {
    expect(crewNameKey("  The  Salt Dogs ")).toBe("the salt dogs");
    expect(crewNameKey("THE SALT DOGS")).toBe(crewNameKey("the salt dogs"));
  });
});

describeDb("crews over the wire", () => {
  let app: App;
  let base: string;
  const content = loadContent();
  const fee = content.world.crews.foundingFee;
  const flag = { field: "deep", accent: "gold", pattern: "cross", emblem: "rocket" };
  /** Crew names are unique for good, and the test database outlives a run. */
  const unique = (name: string): string => `${name} ${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: url!,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      BETTER_AUTH_URL: "http://localhost:0",
      CLIENT_ORIGINS: "http://localhost:5173",
      LOG_LEVEL: "silent",
    });
    app = await createApp(env, createLogger("silent", false));
    const port = await app.listen(0);
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function pirate(credits = 0): Promise<{ cookie: string; me: PirateSummary }> {
    const res = await fetch(`${base}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: "{}",
    });
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token"))!.split(";")[0]!;
    const created = await fetch(`${base}/api/pirate`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
    expect(created.status).toBe(201);
    const { pirate: me } = (await created.json()) as { pirate: PirateSummary };
    if (credits > 0) await app.db.transaction((tx) => appendLedger(tx, me.id, credits, "test", null));
    return { cookie, me };
  }

  async function connect(cookie: string): Promise<Client> {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie } });
    const c = new Client(ws);
    await new Promise((resolve) => ws.on("open", resolve));
    await c.until("welcome");
    // Every connection is told its crew and its invitations at once.
    await c.until("crew.state");
    return c;
  }

  it("founding a crew costs the fee, makes the founder commodore and flies on their summary", async () => {
    const poor = await pirate();
    const p = await connect(poor.cookie);
    p.send({ type: "crew.found", name: unique("Paupers"), flag });
    expect(await p.until("error")).toMatchObject({ code: "short_of_credits" });

    const rich = await pirate(fee + 100);
    const a = await connect(rich.cookie);
    const name = unique("The Salt Dogs");
    a.send({ type: "crew.found", name: "x", flag });
    expect(await a.until("error")).toMatchObject({ code: "crew_name_bad" });
    a.send({ type: "crew.found", name, flag: { ...flag, accent: "deep" } });
    expect(await a.until("error")).toMatchObject({ code: "crew_flag_bad" });
    a.send({ type: "crew.found", name, flag: { ...flag, emblem: "teapot" } });
    expect(await a.until("error")).toMatchObject({ code: "crew_flag_bad" });

    a.send({ type: "crew.found", name: `  ${name.replace(" ", "   ")} `, flag });
    const notice = await a.until("crew.notice");
    expect(notice.notice).toMatchObject({ type: "founded", crew: { name, flag } });
    const state = await a.until("crew.state", (m) => m.crew !== null);
    expect(state.crew).toMatchObject({ name, flag, stats: { voyages: 0, victories: 0, plunder: 0 } });
    expect(state.crew!.members).toEqual([expect.objectContaining({ pirateId: rich.me.id, rank: "commodore", where: { kind: "on-outpost", outpostId: content.world.startOutpostId } })]);
    const updated = await a.until("pirate.updated", (m) => m.pirate.crew !== null);
    expect(updated.pirate.crew).toMatchObject({ name, rank: "commodore", flag });
    expect(updated.pirate.balance).toBe(100);
    expect(await balance(app.db, rich.me.id)).toBe(100);

    // A second crew of the same name, in any case, is refused; so is founding while in one.
    const other = await pirate(fee);
    const b = await connect(other.cookie);
    b.send({ type: "crew.found", name: name.toUpperCase(), flag });
    expect(await b.until("error")).toMatchObject({ code: "crew_name_taken" });
    a.send({ type: "crew.found", name: unique("Again"), flag });
    expect(await a.until("error")).toMatchObject({ code: "already_in_crew" });

    // The board of crews lists it; the /api/me summary carries it too.
    a.send({ type: "crew.list" });
    const list = await a.until("crew.list");
    expect(list.crews.find((c) => c.name === name)).toMatchObject({ members: 1, flag });
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie: rich.cookie } })).json()) as { pirate: PirateSummary; providers: string[]; linked: string[] };
    expect(me.pirate.crew).toMatchObject({ name, rank: "commodore" });
    expect(me.providers).toEqual([]);
    expect(me.linked).toEqual([]);
    for (const c of [p, a, b]) c.ws.close();
  });

  it("invitations by name are answered, ranks are the commodore's, and the crew chats wherever it is", async () => {
    const cap = await pirate(fee);
    const hand = await pirate();
    const third = await pirate();
    const a = await connect(cap.cookie);
    const b = await connect(hand.cookie);
    const c = await connect(third.cookie);
    const name = unique("Brine Hounds");
    a.send({ type: "crew.found", name, flag });
    const founded = await a.until("crew.state", (m) => m.crew !== null);
    const crewId = founded.crew!.id;

    // Nobody outside a crew may invite; an unknown name is refused; the name is matched in any case.
    b.send({ type: "crew.invite", name: third.me.name });
    expect(await b.until("error")).toMatchObject({ code: "not_in_crew" });
    a.send({ type: "crew.invite", name: "Nobody At All 0000" });
    expect(await a.until("error")).toMatchObject({ code: "no_such_pirate" });
    a.send({ type: "crew.invite", name: hand.me.name.toLowerCase() });
    const invited = await b.until("crew.notice", (m) => m.notice.type === "invited");
    expect(invited.notice).toMatchObject({ type: "invited", crew: { id: crewId, name }, by: cap.me.name });
    const waiting = await b.until("crew.state", (m) => m.invites.length > 0);
    expect(waiting.invites[0]).toMatchObject({ crew: { id: crewId }, members: 1, by: cap.me.name });
    // The commodore sees who is invited; inviting twice is refused.
    expect((await a.until("crew.state", (m) => (m.crew?.invited.length ?? 0) > 0)).crew!.invited).toEqual([{ pirateId: hand.me.id, name: hand.me.name }]);
    a.send({ type: "crew.invite", name: hand.me.name });
    expect(await a.until("error")).toMatchObject({ code: "already_invited" });

    // Accepting joins as a spacer; the commodore hears it; the joiner's summary flies the crew.
    b.send({ type: "crew.answer", crewId, accept: true });
    expect((await a.until("crew.notice", (m) => m.notice.type === "joined")).notice).toEqual({ type: "joined", name: hand.me.name });
    const joined = await b.until("crew.state", (m) => m.crew !== null);
    expect(joined.crew!.members.map((m) => [m.name, m.rank])).toEqual([
      [cap.me.name, "commodore"],
      [hand.me.name, "spacer"],
    ]);
    expect(joined.crew!.invited).toEqual([]); // a spacer does not see the invitation list
    expect((await b.until("pirate.updated", (m) => m.pirate.crew !== null)).pirate.crew).toMatchObject({ id: crewId, rank: "spacer" });
    b.send({ type: "crew.answer", crewId, accept: true });
    expect(await b.until("error")).toMatchObject({ code: "no_invite" });

    // Crew chat reaches crewmates and nobody else; outside a crew it is refused.
    b.send({ type: "chat.send", channel: "crew", text: "ahoy, commodore" });
    expect(await a.until("chat.message", (m) => m.channel === "crew")).toMatchObject({ channel: "crew", name: hand.me.name, text: "ahoy, commodore" });
    expect(await b.until("chat.message", (m) => m.channel === "crew")).toMatchObject({ text: "ahoy, commodore" });
    c.send({ type: "chat.send", channel: "crew", text: "let me in" });
    expect(await c.until("error")).toMatchObject({ code: "not_in_crew" });

    // A spacer may not invite or rank; the commodore makes them an officer, and then they can invite.
    b.send({ type: "crew.invite", name: third.me.name });
    expect(await b.until("error")).toMatchObject({ code: "crew_rank_low" });
    b.send({ type: "crew.rank", pirateId: cap.me.id, rank: "spacer" });
    expect(await b.until("error")).toMatchObject({ code: "crew_rank_low" });
    a.send({ type: "crew.rank", pirateId: hand.me.id, rank: "officer" });
    expect((await b.until("crew.notice", (m) => m.notice.type === "rank")).notice).toEqual({ type: "rank", name: hand.me.name, rank: "officer" });
    b.send({ type: "crew.invite", name: third.me.name });
    await c.until("crew.notice", (m) => m.notice.type === "invited");
    // Declining tells the officers, and the invitation is gone.
    c.send({ type: "crew.answer", crewId, accept: false });
    expect((await a.until("crew.notice", (m) => m.notice.type === "declined")).notice).toEqual({ type: "declined", name: third.me.name });
    expect((await c.until("crew.state", (m) => m.invites.length === 0)).invites).toEqual([]);

    // A profile shows the crew and rank; the officer's invitation shows as waiting for the viewer.
    b.send({ type: "crew.invite", name: third.me.name });
    await c.until("crew.notice", (m) => m.notice.type === "invited");
    a.send({ type: "pirate.profile", name: hand.me.name });
    const profile = await a.until("pirate.profile");
    expect(profile.profile).toMatchObject({ pirateId: hand.me.id, name: hand.me.name, crew: { id: crewId, rank: "officer" }, online: true, invited: false, voyages: 0 });
    a.send({ type: "pirate.profile", pirateId: third.me.id });
    expect((await a.until("pirate.profile")).profile).toMatchObject({ crew: null, invited: true });
    a.send({ type: "crew.uninvite", pirateId: third.me.id });
    expect((await c.until("crew.state", (m) => m.invites.length === 0)).invites).toEqual([]);

    // An officer may not put out an officer; the commodore may. The one put out is told.
    c.send({ type: "crew.answer", crewId, accept: true });
    expect(await c.until("error")).toMatchObject({ code: "no_invite" });
    a.send({ type: "crew.invite", name: third.me.name });
    await c.until("crew.notice", (m) => m.notice.type === "invited");
    c.send({ type: "crew.answer", crewId, accept: true });
    await c.until("crew.state", (m) => m.crew !== null);
    a.send({ type: "crew.rank", pirateId: third.me.id, rank: "officer" });
    await c.until("crew.notice", (m) => m.notice.type === "rank");
    b.send({ type: "crew.remove", pirateId: third.me.id });
    expect(await b.until("error")).toMatchObject({ code: "crew_rank_low" });
    a.send({ type: "crew.remove", pirateId: third.me.id });
    expect((await c.until("crew.notice", (m) => m.notice.type === "dismissed")).notice).toEqual({ type: "dismissed", crewName: name, by: cap.me.name });
    expect((await c.until("crew.state", (m) => m.crew === null)).crew).toBeNull();
    expect((await b.until("crew.notice", (m) => m.notice.type === "removed")).notice).toEqual({ type: "removed", name: third.me.name, by: cap.me.name });

    // The commodore hands over the crew and stays on as an officer.
    a.send({ type: "crew.rank", pirateId: hand.me.id, rank: "commodore" });
    const handed = await a.until("crew.state", (m) => m.crew?.members[0]?.pirateId === hand.me.id);
    expect(handed.crew!.members.map((m) => m.rank)).toEqual(["commodore", "officer"]);

    // The commodore leaving hands the crew to the next in rank; the last one out disbands it.
    a.clear();
    b.send({ type: "crew.leave" });
    expect((await a.until("crew.notice", (m) => m.notice.type === "rank")).notice).toEqual({ type: "rank", name: cap.me.name, rank: "commodore" });
    a.send({ type: "crew.leave" });
    expect((await a.until("crew.state", (m) => m.crew === null)).crew).toBeNull();
    const [row] = await app.db.select().from(schema.crew).where(eq(schema.crew.id, crewId));
    expect(row).toBeUndefined();
    for (const x of [a, b, c]) x.ws.close();
  });

  it("a crew-only ship takes the owner's crew and nobody else, flies the crew's colors, and voyages and victories count for the crew", async () => {
    const owner = await pirate(fee);
    const crewmate = await pirate();
    const stranger = await pirate();
    const a = await connect(owner.cookie);
    const b = await connect(crewmate.cookie);
    const c = await connect(stranger.cookie);
    const name = unique("Moon Wing");
    a.send({ type: "crew.found", name, flag });
    const crewId = (await a.until("crew.state", (m) => m.crew !== null)).crew!.id;
    a.send({ type: "crew.invite", name: crewmate.me.name });
    await b.until("crew.notice", (m) => m.notice.type === "invited");
    b.send({ type: "crew.answer", crewId, accept: true });
    await b.until("crew.state", (m) => m.crew !== null);

    const shipId = owner.me.ships[0]!.id;
    a.send({ type: "ship.board", shipId });
    const aboard = await a.until("ship.state");
    expect(aboard.ship.colors).toMatchObject({ id: crewId, name, flag });
    expect(aboard.ship.crew[0]).toMatchObject({ pirateId: owner.me.id, crewId });
    a.send({ type: "ship.lock", inviteOnly: true });
    await a.until("ship.state", (m) => m.ship.inviteOnly);

    // The notice board shows whose colors she flies, and that she is open to the crew.
    b.send({ type: "board.list" });
    expect((await b.until("board.ships")).ships.find((s) => s.shipId === shipId)).toMatchObject({ inviteOnly: true, crewmate: true, colors: { id: crewId } });
    c.send({ type: "board.list" });
    expect((await c.until("board.ships")).ships.find((s) => s.shipId === shipId)).toMatchObject({ inviteOnly: true, crewmate: false });

    // Aboard and on the outpost, the crew view says where everyone is and whether their ship can be joined.
    b.send({ type: "crew.info" });
    const view = await b.until("crew.state", (m) => m.crew?.members.some((x) => x.where.kind === "aboard") ?? false);
    expect(view.crew!.members.find((x) => x.pirateId === owner.me.id)!.where).toMatchObject({ kind: "aboard", shipId, outpostId: content.world.startOutpostId, joinable: true });

    c.send({ type: "ship.board", shipId });
    expect(await c.until("error")).toMatchObject({ code: "ship_locked" });
    b.send({ type: "ship.board", shipId });
    expect((await b.until("ship.state")).ship.crew.map((x) => x.crewId)).toEqual([crewId, crewId]);
    await a.until("ship.state", (m) => m.ship.crew.length === 2);
    b.send({ type: "ship.leave" });
    await b.until("ship.left");

    // Launching tells crewmates on the outpost who went and that they can still catch her.
    a.send({ type: "ship.launch", laneId: "tinwick-echo-rock" });
    const launched = await b.until("crew.notice", (m) => m.notice.type === "launched");
    expect(launched.notice).toMatchObject({ type: "launched", names: [owner.me.name], shipId, to: "echo-rock", joinable: true });

    // The ship's tallies land on the crew: a voyage, then a victory with what the members were paid.
    const room = app.ships.room(shipId)!;
    await app.crews.tallyVoyage([owner.me.id, stranger.me.id]);
    await app.crews.tallyVictory(room, "junker", new Map([[owner.me.id, 250], [stranger.me.id, 50]]));
    const won = await b.until("crew.notice", (m) => m.notice.type === "victory");
    expect(won.notice).toMatchObject({ type: "victory", names: [owner.me.name], tierId: "junker", plunder: 250 });
    b.send({ type: "crew.list" });
    expect((await b.until("crew.list")).crews.find((x) => x.id === crewId)!.stats).toEqual({ voyages: 1, victories: 1, plunder: 250 });
    const [row] = await app.db.select().from(schema.crew).where(eq(schema.crew.id, crewId));
    expect(row).toMatchObject({ voyages: 1, victories: 1, plunder: 250 });

    // Changing the flag is the commodore's, and the ship flies the new one at once.
    const flag2 = { field: "crimson", accent: "bone", pattern: "saltire", emblem: "satellite" };
    b.send({ type: "crew.flag", flag: flag2 });
    expect(await b.until("error")).toMatchObject({ code: "crew_rank_low" });
    a.send({ type: "crew.flag", flag: flag2 });
    expect((await a.until("ship.state", (m) => m.ship.colors?.flag.emblem === "satellite")).ship.colors!.flag).toEqual(flag2);
    expect((await b.until("crew.notice", (m) => m.notice.type === "flag")).notice).toEqual({ type: "flag", by: owner.me.name });
    a.send({ type: "ship.leave" });
    for (const x of [a, b, c]) x.ws.close();
  });

  it("the crew survives a restart: crews, members and invitations are loaded back", async () => {
    const cap = await pirate(fee);
    const guest = await pirate();
    const a = await connect(cap.cookie);
    const name = unique("Old Salts");
    a.send({ type: "crew.found", name, flag });
    const crewId = (await a.until("crew.state", (m) => m.crew !== null)).crew!.id;
    a.send({ type: "crew.invite", name: guest.me.name });
    await a.until("crew.state", (m) => (m.crew?.invited.length ?? 0) > 0);
    await app.crews.load();
    expect(app.crews.tagOf(cap.me.id)).toMatchObject({ id: crewId, name, flag });
    const b = await connect(guest.cookie);
    b.send({ type: "crew.info" });
    expect((await b.until("crew.state", (m) => m.invites.length > 0)).invites[0]).toMatchObject({ crew: { id: crewId }, by: cap.me.name });
    a.ws.close();
    b.ws.close();
  });
});

describeDb("guest to account", () => {
  let app: App;
  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret", LOG_LEVEL: "silent" });
    app = await createApp(env, createLogger("silent", false));
  });
  afterAll(async () => {
    await app?.close();
  });

  async function user(anonymous: boolean): Promise<string> {
    const id = randomUUID();
    await app.db.insert(schema.user).values({ id, name: "u", email: `${id}@test.invalid`, isAnonymous: anonymous });
    return id;
  }
  async function pirateFor(userId: string): Promise<string> {
    const id = randomUUID();
    await app.db.insert(schema.pirate).values({ id, userId, name: `Test ${id.slice(0, 8)}`, outpostId: null });
    return id;
  }

  it("carries the guest's pirate onto a new account and retires the guest", async () => {
    const guest = await user(true);
    const account = await user(false);
    const p = await pirateFor(guest);
    expect(await mergeGuestIntoAccount(app.db, guest, account)).toBe("moved");
    const [row] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, p));
    expect(row!.userId).toBe(account);
    expect(await retireGuest(app.db, guest)).toBe(true);
    expect(await app.db.select().from(schema.user).where(eq(schema.user.id, guest))).toEqual([]);
    // Idempotent: nothing is left to move.
    expect(await mergeGuestIntoAccount(app.db, guest, account)).toBe("none");
  });

  it("keeps a returning account's own pirate and leaves the guest's where it is", async () => {
    const guest = await user(true);
    const account = await user(false);
    const guestPirate = await pirateFor(guest);
    const own = await pirateFor(account);
    expect(await mergeGuestIntoAccount(app.db, guest, account)).toBe("kept");
    const rows = await app.db.select().from(schema.pirate).where(eq(schema.pirate.userId, account));
    expect(rows.map((r) => r.id)).toEqual([own]);
    // The guest's pirate is never deleted with its user, so the guest stays.
    expect(await retireGuest(app.db, guest)).toBe(false);
    const [kept] = await app.db.select().from(schema.pirate).where(eq(schema.pirate.id, guestPirate));
    expect(kept!.userId).toBe(guest);
  });

  it("never retires an account that is not a guest", async () => {
    const account = await user(false);
    expect(await retireGuest(app.db, account)).toBe(false);
    expect(await app.db.select().from(schema.user).where(eq(schema.user.id, account))).toHaveLength(1);
  });
});
