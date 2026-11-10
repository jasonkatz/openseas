/**
 * The pirate's own sheet (DESIGN.md 3.6, ADR 0033) over the wire: the record read off the voyage
 * tables and the ledger, titles earned from it and kept once earned, the look worn on deck and the
 * title shown on the card. Runs against a real Postgres when TEST_DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { defaultLook, loadContent } from "@openseas/content";
import type { PirateSummary } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { appendLedger } from "../src/ledger.js";
import { createLogger } from "../src/log.js";
import { randomBotName, randomPirateName, titleProgress } from "../src/pirates.js";
import { Client } from "./client.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describe("names", () => {
  it("a pirate is an adjective and a noun; a bot is a bot's name and a unit number", () => {
    const content = loadContent();
    const first = (): number => 0;
    expect(randomPirateName(content, first)).toBe(`${content.names.adjectives[0]} ${content.names.nouns[0]}`);
    expect(randomBotName(content, first)).toBe(`${content.names.bots[0]}-1`);
    const last = (n: number): number => n - 1;
    expect(randomBotName(content, last)).toBe(`${content.names.bots.at(-1)}-99`);
  });
});

describe("title progress", () => {
  const content = loadContent();
  const title = (id: string) => content.world.pirates.titles.find((t) => t.id === id)!;
  const record = { since: 0, voyages: 9, captained: 1, victories: 0, plunder: 0, boards: 0 };

  it("counts a record against what a title asks", () => {
    expect(titleProgress(content, title("void-hound"), record, new Map())).toEqual({ have: 9, need: 10, met: false });
    expect(titleProgress(content, title("void-hound"), { ...record, voyages: 10 }, new Map())).toEqual({ have: 10, need: 10, met: true });
    expect(titleProgress(content, title("skipper"), record, new Map())).toMatchObject({ met: true });
    expect(titleProgress(content, title("dirtsider"), record, new Map())).toMatchObject({ met: true });
  });

  it("reads standing as tiers, unrated below the first", () => {
    const sharp = content.ratingTiers.findIndex((t) => t.key === "sharp");
    expect(titleProgress(content, title("coolhand"), record, new Map())).toEqual({ have: -1, need: sharp, met: false });
    expect(titleProgress(content, title("coolhand"), record, new Map([["cooling", 1500]]))).toEqual({ have: sharp - 1, need: sharp, met: false });
    expect(titleProgress(content, title("coolhand"), record, new Map([["cooling", 1700]]))).toEqual({ have: sharp, need: sharp, met: true });
    // Standing at another puzzle is no help.
    expect(titleProgress(content, title("coolhand"), record, new Map([["engines", 2400]]))).toMatchObject({ met: false });
  });
});

describeDb("the pirate's sheet over the wire", () => {
  let app: App;
  let base: string;
  const content = loadContent();

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

  async function pirate(): Promise<{ cookie: string; me: PirateSummary }> {
    const res = await fetch(`${base}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: "{}",
    });
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token"))!.split(";")[0]!;
    const created = await fetch(`${base}/api/pirate`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
    expect(created.status).toBe(201);
    const { pirate: me } = (await created.json()) as { pirate: PirateSummary };
    return { cookie, me };
  }

  /**
   * A look the pirate is not wearing, in jacket or in headgear. A new pirate's look is drawn from
   * their id, so a look named outright is now and then the one they already have, and a wait for
   * its jacket is then met by the message that came before the change.
   */
  function lookOtherThan(now: PirateSummary["look"]): { jacket: string; headgear: string } {
    const { jackets, headgear } = content.world.pirates;
    return { jacket: jackets.find((j) => j.id !== now?.jacket)!.id, headgear: headgear.find((h) => h.id !== now?.headgear)!.id };
  }

  async function connect(cookie: string): Promise<Client> {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie } });
    const c = new Client(ws);
    await new Promise((resolve) => ws.on("open", resolve));
    await c.until("welcome");
    return c;
  }

  /** A voyage that reached port with this pirate aboard as captain, as the ship service leaves it in the tables. */
  async function arrivedAsCaptain(pirateId: string, shipId: string): Promise<void> {
    const voyageId = randomUUID();
    await app.db.insert(schema.voyage).values({ id: voyageId, shipId, laneId: "tinwick-echo-rock", captainId: pirateId, outcome: "arrived", endedAt: new Date(), turns: 20 });
    await app.db.insert(schema.voyageCrew).values({ voyageId, pirateId });
  }

  it("a new pirate wears the look drawn from their id, shows no title, and has an empty record", async () => {
    const { cookie, me } = await pirate();
    expect(me.look).toEqual(defaultLook(content.world.pirates, me.id));
    expect(me.title).toBeNull();
    const c = await connect(cookie);
    c.send({ type: "pirate.sheet" });
    const { sheet } = await c.until("pirate.sheet");
    expect(sheet.record).toMatchObject({ voyages: 0, captained: 0, victories: 0, plunder: 0, boards: 0 });
    expect(Math.abs(sheet.record.since - Date.now())).toBeLessThan(60_000);
    expect(sheet.titles.map((t) => t.id)).toEqual(content.world.pirates.titles.map((t) => t.id));
    // Only the start title is theirs on the first day.
    expect(sheet.titles.filter((t) => t.earned).map((t) => t.id)).toEqual(["dirtsider"]);
    expect(sheet.titles.find((t) => t.id === "void-hound")).toEqual({ id: "void-hound", earned: false, have: 0, need: 10 });
    expect(c.inbox.some((m) => m.type === "pirate.titles")).toBe(false);
    c.ws.close();
  });

  it("picks a look content offers and refuses one it does not", async () => {
    const { cookie, me } = await pirate();
    const c = await connect(cookie);
    c.send({ type: "pirate.look", look: { jacket: "gold-lame", headgear: "bubble-helmet" } });
    expect(await c.until("error")).toMatchObject({ code: "look_bad" });
    c.send({ type: "pirate.look", look: { jacket: "teal", headgear: "beanie" } });
    const updated = await c.until("pirate.updated");
    expect(updated.pirate.look).toEqual({ jacket: "teal", headgear: "beanie" });
    const [row] = await app.db.select({ look: schema.pirate.look }).from(schema.pirate).where(eq(schema.pirate.id, me.id));
    expect(row!.look).toEqual({ jacket: "teal", headgear: "beanie" });
    c.ws.close();
  });

  it("a record earns titles, says so once, and a title can only be worn once earned", async () => {
    const { cookie, me } = await pirate();
    const c = await connect(cookie);
    c.send({ type: "pirate.title", title: "lane-rider" });
    expect(await c.until("error")).toMatchObject({ code: "title_locked" });
    c.send({ type: "pirate.title", title: "no-such-title" });
    expect(await c.until("error")).toMatchObject({ code: "title_locked" });
    c.send({ type: "pirate.title", title: "dirtsider" });
    expect((await c.until("pirate.updated")).pirate.title).toBe("dirtsider");

    // A voyage to port as captain, and a share of a purse from a raider beaten on the way.
    await arrivedAsCaptain(me.id, me.ships[0]!.id);
    await app.db.transaction((tx) => appendLedger(tx, me.id, 180, "plunder", null));
    c.send({ type: "pirate.sheet" });
    const { sheet } = await c.until("pirate.sheet");
    expect(sheet.record).toMatchObject({ voyages: 1, captained: 1, victories: 1, plunder: 180 });
    expect((await c.until("pirate.titles")).earned).toEqual(["lane-rider", "skipper", "boarder"]);
    expect(sheet.titles.filter((t) => t.earned).map((t) => t.id)).toEqual(["dirtsider", "lane-rider", "skipper", "boarder"]);
    expect(sheet.titles.find((t) => t.id === "plunderer")).toMatchObject({ earned: false, have: 180, need: 1000 });

    // Asking again earns nothing new and says nothing.
    c.send({ type: "pirate.sheet" });
    await c.until("pirate.sheet");
    c.send({ type: "pirate.title", title: "skipper" });
    expect((await c.until("pirate.updated")).pirate.title).toBe("skipper");
    expect(c.inbox.some((m) => m.type === "pirate.titles")).toBe(false);

    // Another pirate's card shows the title, the look and the raiders beaten.
    const other = await pirate();
    const o = await connect(other.cookie);
    o.send({ type: "pirate.profile", pirateId: me.id });
    const { profile } = await o.until("pirate.profile");
    expect(profile).toMatchObject({ title: "skipper", look: me.look, voyages: 1, victories: 1 });
    c.send({ type: "pirate.title", title: null });
    expect((await c.until("pirate.updated")).pirate.title).toBeNull();
    for (const x of [c, o]) x.ws.close();
  });

  it("a title earned on standing stays earned when the standing falls", async () => {
    const { cookie, me } = await pirate();
    await app.db.insert(schema.rating).values({ pirateId: me.id, puzzle: "cooling", rating: 1700, deviation: 80, volatility: 0.06, rounds: 14 });
    // Connecting catches a record up: the title earned while nobody looked is announced on arrival.
    const c = await connect(cookie);
    expect((await c.until("pirate.titles")).earned).toEqual(["coolhand"]);
    await app.db.update(schema.rating).set({ rating: 1300 }).where(eq(schema.rating.pirateId, me.id));
    c.send({ type: "pirate.sheet" });
    const { sheet } = await c.until("pirate.sheet");
    expect(sheet.record.boards).toBe(14);
    const sharp = content.ratingTiers.findIndex((t) => t.key === "sharp");
    expect(sheet.titles.find((t) => t.id === "coolhand")).toEqual({ id: "coolhand", earned: true, have: sharp - 2, need: sharp });
    c.send({ type: "pirate.title", title: "coolhand" });
    expect((await c.until("pirate.updated")).pirate.title).toBe("coolhand");
    c.ws.close();
  });

  it("pirates on the outpost together see each other's looks as they walk the outpost, and see them change", async () => {
    const a = await pirate();
    const b = await pirate();
    const ca = await connect(a.cookie);
    const cb = await connect(b.cookie);
    cb.send({ type: "outpost.who" });
    const seen = await cb.until("outpost.presence", (m) => m.pirates.some((p) => p.pirateId === a.me.id));
    expect(seen.pirates.find((p) => p.pirateId === a.me.id)!.look).toEqual(a.me.look);
    const next = lookOtherThan(a.me.look);
    ca.send({ type: "pirate.look", look: next });
    const changed = await cb.until("outpost.presence", (m) => m.pirates.find((p) => p.pirateId === a.me.id)?.look?.jacket === next.jacket);
    expect(changed.pirates.find((p) => p.pirateId === a.me.id)!.look).toEqual(next);
    for (const x of [ca, cb]) x.ws.close();
  });

  it("the crew aboard sees a pirate's look on deck, and sees it change", async () => {
    const owner = await pirate();
    const crewmate = await pirate();
    const a = await connect(owner.cookie);
    const b = await connect(crewmate.cookie);
    const shipId = owner.me.ships[0]!.id;
    a.send({ type: "ship.board", shipId });
    await a.until("ship.state");
    b.send({ type: "ship.board", shipId });
    const state = await b.until("ship.state", (m) => m.ship.crew.length === 2);
    expect(state.ship.crew.find((x) => x.pirateId === owner.me.id)!.look).toEqual(owner.me.look);
    expect(state.ship.crew.find((x) => x.pirateId === crewmate.me.id)!.look).toEqual(crewmate.me.look);

    const next = lookOtherThan(owner.me.look);
    a.send({ type: "pirate.look", look: next });
    const seen = await b.until("ship.state", (m) => m.ship.crew.find((x) => x.pirateId === owner.me.id)?.look?.jacket === next.jacket);
    expect(seen.ship.crew.find((x) => x.pirateId === owner.me.id)!.look).toEqual(next);
    b.send({ type: "ship.leave" });
    a.send({ type: "ship.leave" });
    await a.until("ship.left");
    for (const x of [a, b]) x.ws.close();
  });
});
