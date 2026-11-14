/**
 * Drafts kept by the service (ADR 0045), driven over HTTP against a real Postgres. Runs only when
 * TEST_DATABASE_URL is set, as test/links.test.ts does, and signs in through the off-production
 * dev login, which that file leaves unproven.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DraftListSchema, DraftSchema, type Draft, type DraftNumbers } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import { seal } from "../src/session.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const STUDIO = "http://localhost:5174";
const ELSEWHERE = "https://preview.example";
const SECRET = "test-secret-test-secret";

describeDb("drafts", () => {
  let app: App;
  let base: string;
  let octo = "";
  /** A second owner on the allowlist, signed in with a cookie sealed as the service seals one. */
  const hexa = `studio_session=${encodeURIComponent(seal(SECRET, { login: "Hexa" }, 600))}`;

  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: SECRET, STUDIO_ORIGINS: STUDIO, STUDIO_OWNERS: "hexa", STUDIO_DEV_LOGIN: "Octo", STUDIO_PUBLIC_URL: "http://service.test", LOG_LEVEL: "silent" });
    app = await createApp(env, createLogger("silent", false), null);
    await app.db.delete(schema.draft);
    base = `http://localhost:${await app.listen(0)}`;
    const dev = await fetch(`${base}/auth/dev?return=${encodeURIComponent(`${STUDIO}/cooling`)}`, { redirect: "manual" });
    expect(dev.headers.get("location")).toBe(`${STUDIO}/cooling`);
    octo = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
  });
  afterAll(async () => {
    await app?.close();
  });

  const numbers: DraftNumbers = { seed: "keg-3", overrides: { pieceKinds: 5, "specialChancePerMille.charge": 40 }, roundSeconds: 90, paceSeconds: null, thresholds: null };
  const send = (method: string, path: string, session: string, body?: unknown, origin: string | null = STUDIO): Promise<Response> =>
    fetch(`${base}${path}`, { method, headers: { ...(origin ? { origin } : {}), cookie: session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const list = async (session: string, query = ""): Promise<Draft[]> => DraftListSchema.parse(await (await send("GET", `/drafts${query}`, session)).json()).drafts;

  it("opens one draft a puzzle, saves it over the revision named, and discards it", async () => {
    expect(await list(octo)).toEqual([]);
    const made = await send("POST", "/drafts", octo, { puzzle: "cooling", numbers });
    expect(made.status).toBe(201);
    const draft = DraftSchema.parse(await made.json());
    expect(draft).toMatchObject({ puzzle: "cooling", owner: "octo", numbers, revision: 1 });

    // One a puzzle: a second is refused and the first stands.
    const again = await send("POST", "/drafts", octo, { puzzle: "cooling", numbers: { ...numbers, seed: null } });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "conflict" });
    expect(await list(octo, "?puzzle=cooling")).toEqual([draft]);
    expect(await list(octo, "?puzzle=engines")).toEqual([]);

    const next: DraftNumbers = { ...numbers, overrides: {}, roundSeconds: null };
    const saved = DraftSchema.parse(await (await send("PUT", `/drafts/${draft.id}`, octo, { numbers: next, revision: 1 })).json());
    expect(saved).toMatchObject({ id: draft.id, numbers: next, revision: 2 });

    // A page still on revision 1 is told, and what was saved since is kept.
    const stale = await send("PUT", `/drafts/${draft.id}`, octo, { numbers, revision: 1 });
    expect(stale.status).toBe(409);
    expect(await list(octo)).toEqual([saved]);

    expect((await send("DELETE", `/drafts/${draft.id}`, octo)).status).toBe(200);
    expect(await list(octo)).toEqual([]);
    expect((await send("DELETE", `/drafts/${draft.id}`, octo)).status).toBe(404);
    expect((await send("PUT", `/drafts/${draft.id}`, octo, { numbers, revision: 2 })).status).toBe(404);
    // Discarded, the puzzle can have a draft again.
    const fresh = DraftSchema.parse(await (await send("POST", "/drafts", octo, { puzzle: "cooling", numbers })).json());
    expect(fresh.id).not.toBe(draft.id);
    await send("DELETE", `/drafts/${fresh.id}`, octo);
  });

  it("keeps each owner's drafts apart", async () => {
    const mine = DraftSchema.parse(await (await send("POST", "/drafts", octo, { puzzle: "salvage", numbers })).json());
    const theirs = DraftSchema.parse(await (await send("POST", "/drafts", hexa, { puzzle: "salvage", numbers: { ...numbers, seed: null } })).json());
    expect(theirs.owner).toBe("hexa");
    expect((await list(octo)).map((d) => d.id)).toEqual([mine.id]);
    expect((await list(hexa)).map((d) => d.id)).toEqual([theirs.id]);
    expect((await send("PUT", `/drafts/${mine.id}`, hexa, { numbers, revision: 1 })).status).toBe(404);
    expect((await send("DELETE", `/drafts/${mine.id}`, hexa)).status).toBe(404);
    expect((await list(octo))[0]).toEqual(mine);
  });

  it("changes nothing without the owner's session, or from a page that is not the studio's", async () => {
    const [mine] = await list(octo, "?puzzle=salvage");
    expect((await send("GET", "/drafts", "")).status).toBe(401);
    expect((await send("POST", "/drafts", "", { puzzle: "engines", numbers })).status).toBe(401);
    expect((await send("POST", "/drafts", octo, { puzzle: "engines", numbers }, ELSEWHERE)).status).toBe(403);
    expect((await send("PUT", `/drafts/${mine!.id}`, octo, { numbers, revision: 1 }, null)).status).toBe(403);
    expect((await send("DELETE", `/drafts/${mine!.id}`, octo, undefined, ELSEWHERE)).status).toBe(403);
    expect(await list(octo)).toEqual([mine]);
    // The studio's own pages may send a PUT; no other origin is told it may send anything.
    const pre = await fetch(`${base}/drafts/${mine!.id}`, { method: "OPTIONS", headers: { origin: STUDIO } });
    expect(pre.headers.get("access-control-allow-methods")).toContain("PUT");
    expect((await fetch(`${base}/drafts`, { method: "OPTIONS", headers: { origin: ELSEWHERE } })).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses what is not a draft", async () => {
    const [mine] = await list(octo, "?puzzle=salvage");
    expect((await send("POST", "/drafts", octo, { puzzle: "chess", numbers })).status).toBe(400);
    expect((await send("POST", "/drafts", octo, { puzzle: "engines" })).status).toBe(400);
    expect((await send("POST", "/drafts", octo, { puzzle: "engines", numbers: { ...numbers, thresholds: [] } })).status).toBe(400);
    expect((await send("PUT", `/drafts/${mine!.id}`, octo, { numbers })).status).toBe(400);
    expect((await send("PUT", `/drafts/${mine!.id}`, octo, { numbers: { ...numbers, roundSeconds: 0 }, revision: 1 })).status).toBe(400);
    expect((await send("GET", "/drafts?puzzle=chess", octo)).status).toBe(400);
    expect((await send("PUT", "/drafts/not-an-id", octo, { numbers, revision: 1 })).status).toBe(404);
    expect((await fetch(`${base}/drafts`, { method: "POST", headers: { origin: STUDIO, cookie: octo }, body: "{not json" })).status).toBe(400);
  });
});
