/**
 * Where a pirate is: aboard a ship, connected or not; on an outpost while connected; offline
 * otherwise. The outpost each pirate is at is Postgres's, and only the ship moves them. Runs against
 * a real Postgres when TEST_DATABASE_URL is set, like the other server tests.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadContent } from "@openseas/content";
import { createShip } from "@openseas/engine";
import { createDb, schema, type Db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { Presence } from "../src/presence.js";
import { ShipRoom, shipConfigFor } from "../src/ships/service.js";
import { Whereabouts } from "../src/whereabouts.js";
import { Inbox } from "./inbox.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("whereabouts", () => {
  const content = loadContent();
  const start = content.world.startOutpostId;
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = createDb(url!));
    await runMigrations(db);
  });

  afterAll(async () => {
    await close?.();
  });

  /** A pirate as Postgres holds them, at `outpostId` (null: the start outpost). */
  async function pirate(outpostId: string | null = null): Promise<string> {
    const userId = randomUUID();
    const id = randomUUID();
    await db.insert(schema.user).values({ id: userId, name: "u", email: `${userId}@test.invalid`, isAnonymous: true });
    await db.insert(schema.pirate).values({ id, userId, name: `Test ${id.slice(0, 8)}`, outpostId });
    return id;
  }

  async function stored(pirateId: string): Promise<string | null | undefined> {
    const [row] = await db.select({ outpostId: schema.pirate.outpostId }).from(schema.pirate).where(eq(schema.pirate.id, pirateId));
    return row?.outpostId;
  }

  function world() {
    const presence = new Presence();
    const skiff = content.world.shipClasses[0]!;
    return {
      whereabouts: new Whereabouts(db, content, presence),
      /** A ship lying at `outpostId`. */
      ship: (outpostId: string) => new ShipRoom(randomUUID(), "Static Comet", skiff, "p-owner", createShip("whereabouts", shipConfigFor(content, skiff), outpostId), 0, presence),
      /** The pirate's socket opens; the call it returns closes it. */
      connect: (pirateId: string) => presence.attach(pirateId, new Inbox(pirateId)),
    };
  }

  it("a pirate is at the outpost Postgres holds, or the start outpost when it holds none", async () => {
    const { whereabouts } = world();
    const there = await pirate("echo-rock");
    const fresh = await pirate(null);
    expect(await whereabouts.outpost(there)).toBe("echo-rock");
    expect(await whereabouts.outpost(fresh)).toBe(start);
  });

  it("a pirate is on their outpost while connected, once it is read, and offline otherwise", async () => {
    const { whereabouts, connect } = world();
    const id = await pirate("frostvent");
    expect(whereabouts.of(id)).toEqual({ kind: "offline" });
    const disconnect = connect(id);
    // Their connection reads the outpost as it opens; until then nobody knows where they stand.
    expect(whereabouts.of(id)).toEqual({ kind: "offline" });
    await whereabouts.outpost(id);
    expect(whereabouts.of(id)).toEqual({ kind: "on-outpost", outpostId: "frostvent" });
    disconnect();
    expect(whereabouts.of(id)).toEqual({ kind: "offline" });
  });

  it("aboard is where a pirate is, connected or not, and their outpost stays the one they boarded at", async () => {
    const { whereabouts, ship, connect } = world();
    const id = await pirate();
    const disconnect = connect(id);
    await whereabouts.outpost(id);
    const room = ship(start);
    whereabouts.board(id, room);
    expect(whereabouts.of(id)).toEqual({ kind: "aboard", room });
    // A dropped pirate's seat is held: they are still aboard.
    disconnect();
    expect(whereabouts.of(id)).toEqual({ kind: "aboard", room });
    expect(await whereabouts.outpost(id)).toBe(start);
  });

  it("a pirate put off a ship is nowhere until they reach the outpost, and then on it, in Postgres too", async () => {
    const { whereabouts, ship, connect } = world();
    const id = await pirate();
    connect(id);
    await whereabouts.outpost(id);
    whereabouts.board(id, ship(start));
    whereabouts.leaveShip(id);
    expect(whereabouts.of(id)).toEqual({ kind: "offline" });
    expect(await whereabouts.outpost(id)).toBe(start);
    await whereabouts.disembark(id, "echo-rock");
    expect(whereabouts.of(id)).toEqual({ kind: "on-outpost", outpostId: "echo-rock" });
    expect(await whereabouts.outpost(id)).toBe("echo-rock");
    expect(await stored(id)).toBe("echo-rock");
  });

  it("a pirate put on an outpost while away is there when they come back", async () => {
    const { whereabouts, ship, connect } = world();
    const id = await pirate();
    connect(id)();
    whereabouts.board(id, ship(start));
    whereabouts.leaveShip(id);
    await whereabouts.disembark(id, "frostvent");
    expect(whereabouts.of(id)).toEqual({ kind: "offline" });
    connect(id);
    expect(whereabouts.of(id)).toEqual({ kind: "on-outpost", outpostId: "frostvent" });
    // Another server process starting now would find them there too.
    expect(await world().whereabouts.outpost(id)).toBe("frostvent");
  });

  it("a ship docking takes her crew's outpost with her, in her own transaction, and they stay aboard", async () => {
    const { whereabouts, ship } = world();
    const a = await pirate();
    const b = await pirate();
    const room = ship(start);
    whereabouts.board(a, room);
    whereabouts.board(b, room);
    await db.transaction((tx) => whereabouts.arrive(tx, [a, b], "echo-rock"));
    expect(whereabouts.of(a)).toEqual({ kind: "aboard", room });
    expect(await whereabouts.outpost(a)).toBe("echo-rock");
    expect(await whereabouts.outpost(b)).toBe("echo-rock");
    expect(await stored(b)).toBe("echo-rock");
  });

  it("a read that was out while the pirate moved never puts them back, whichever finishes first", async () => {
    const { whereabouts } = world();
    const id = await pirate();
    const reading = whereabouts.outpost(id);
    await whereabouts.disembark(id, "echo-rock");
    await reading;
    expect(await whereabouts.outpost(id)).toBe("echo-rock");
  });
});
