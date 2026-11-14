/**
 * Boots the whole service against a real Postgres and drives it over HTTP. Runs only when
 * TEST_DATABASE_URL is set (CI provides a Postgres service; locally use docker compose). It shares
 * that database with the game server's tests: everything of this service's is in the `studio` schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TesterLinkSchema, type CreateTesterLink, type TesterLink } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import type { GitHub } from "../src/github.js";
import { createLogger } from "../src/log.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const STUDIO = "http://localhost:5174";
const ELSEWHERE = "https://preview.example";

describeDb("studio service", () => {
  let app: App;
  let base: string;
  /** What the stand-in GitHub says the next code belongs to. */
  let githubLogin: string | null = "Octo";

  const github: GitHub = {
    authorizeUrl: (state, redirectUri) => `https://github.test/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    loginFor: async (code) => (code === "good" ? githubLogin : null),
  };

  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_OWNERS: "octo", STUDIO_PUBLIC_URL: "http://service.test", LOG_LEVEL: "silent" });
    app = await createApp(env, createLogger("silent", false), github);
    await app.db.delete(schema.testerLink);
    base = `http://localhost:${await app.listen(0)}`;
  });
  afterAll(async () => {
    await app?.close();
  });

  const cookieOf = (res: Response, name: string): string => {
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
    return set ? set.split(";")[0]! : "";
  };
  /** Sign in through the stand-in GitHub, as the browser would: off, back with a code, and a session cookie. */
  async function signIn(): Promise<{ session: string; landed: string }> {
    const off = await fetch(`${base}/auth/github?return=${encodeURIComponent(`${STUDIO}/cooling`)}`, { redirect: "manual" });
    expect(off.status).toBe(302);
    const state = new URL(off.headers.get("location")!).searchParams.get("state")!;
    const back = await fetch(`${base}/auth/callback?code=good&state=${state}`, { redirect: "manual", headers: { cookie: cookieOf(off, "studio_oauth") } });
    expect(back.status).toBe(302);
    return { session: cookieOf(back, "studio_session"), landed: back.headers.get("location")! };
  }
  const draft: CreateTesterLink = { puzzle: "cooling", name: "Hotter start", draft: { seed: null, overrides: { initialHeatRow: 6, "specialChancePerMille.charge": 40 }, roundSeconds: 90, paceSeconds: null, thresholds: null } };
  const post = (session: string, body: unknown, origin = STUDIO): Promise<Response> => fetch(`${base}/links`, { method: "POST", headers: { "Content-Type": "application/json", origin, cookie: session }, body: JSON.stringify(body) });

  it("says which commit is live", async () => {
    const r = await fetch(`${base}/health`);
    expect(await r.json()).toMatchObject({ ok: true });
  });

  it("signs an allowlisted GitHub login in and sends it back to the studio page it left", async () => {
    githubLogin = "Octo";
    const { session, landed } = await signIn();
    expect(landed).toBe(`${STUDIO}/cooling`);
    expect(session).toMatch(/^studio_session=.+/);
    const me = await fetch(`${base}/auth/me`, { headers: { cookie: session } });
    expect(await me.json()).toEqual({ login: "Octo", signIn: true, dev: false });
    expect(await (await fetch(`${base}/auth/me`)).json()).toMatchObject({ login: null });
  });

  it("refuses a login that is not on the allowlist, a wrong state, and a return address that is not the studio's", async () => {
    githubLogin = "mallory";
    const { session, landed } = await signIn();
    expect(session).toBe("");
    expect(new URL(landed).searchParams.get("studio_sign_in")).toBe("refused");

    const off = await fetch(`${base}/auth/github`, { redirect: "manual" });
    const wrong = await fetch(`${base}/auth/callback?code=good&state=not-it`, { redirect: "manual", headers: { cookie: cookieOf(off, "studio_oauth") } });
    expect(wrong.status).toBe(400);
    expect((await fetch(`${base}/auth/callback?code=good&state=x`, { redirect: "manual" })).status).toBe(400);

    githubLogin = "Octo";
    const away = await fetch(`${base}/auth/github?return=${encodeURIComponent("https://evil.example/x")}`, { redirect: "manual" });
    const state = new URL(away.headers.get("location")!).searchParams.get("state")!;
    const back = await fetch(`${base}/auth/callback?code=good&state=${state}`, { redirect: "manual", headers: { cookie: cookieOf(away, "studio_oauth") } });
    expect(back.headers.get("location")).toBe(`${STUDIO}/`);
    // No dev sign-in unless it was configured.
    expect((await fetch(`${base}/auth/dev`, { redirect: "manual" })).status).toBe(404);
  });

  it("freezes a draft as a link anyone can read, lists it for the owner, and withdraws it", async () => {
    githubLogin = "Octo";
    const { session } = await signIn();
    const made = await post(session, draft);
    expect(made.status).toBe(201);
    const link = TesterLinkSchema.parse(await made.json());
    expect(link).toMatchObject({ puzzle: "cooling", name: "Hotter start", author: "Octo", withdrawn: false, draft: draft.draft });

    // Anyone, from any origin, with no cookie.
    const read = await fetch(`${base}/links/${link.id}`, { headers: { origin: ELSEWHERE } });
    expect(read.status).toBe(200);
    expect(read.headers.get("access-control-allow-origin")).toBe("*");
    expect(TesterLinkSchema.parse(await read.json())).toEqual(link);

    const listed = await fetch(`${base}/links?puzzle=cooling`, { headers: { cookie: session, origin: STUDIO } });
    expect(((await listed.json()) as { links: TesterLink[] }).links.map((l) => l.id)).toContain(link.id);
    expect(((await (await fetch(`${base}/links?puzzle=engines`, { headers: { cookie: session } })).json()) as { links: TesterLink[] }).links).toEqual([]);

    const gone = await fetch(`${base}/links/${link.id}`, { method: "DELETE", headers: { cookie: session, origin: STUDIO } });
    expect(await gone.json()).toMatchObject({ id: link.id, withdrawn: true });
    const after = await fetch(`${base}/links/${link.id}`);
    expect(after.status).toBe(410);
    expect(await after.json()).toEqual({ error: "withdrawn" });
    const relisted = await fetch(`${base}/links?puzzle=cooling`, { headers: { cookie: session } });
    expect(((await relisted.json()) as { links: TesterLink[] }).links.map((l) => l.id)).not.toContain(link.id);
    // Withdrawing twice changes nothing.
    expect((await fetch(`${base}/links/${link.id}`, { method: "DELETE", headers: { cookie: session, origin: STUDIO } })).status).toBe(200);
  });

  it("makes and withdraws nothing without the owner's session, or from a page that is not the studio's", async () => {
    githubLogin = "Octo";
    const { session } = await signIn();
    expect((await post("", draft)).status).toBe(401);
    expect((await post("studio_session=forged.forged", draft)).status).toBe(401);
    expect((await post(session, draft, ELSEWHERE)).status).toBe(403);
    expect((await fetch(`${base}/links?puzzle=cooling`)).status).toBe(401);
    const link = TesterLinkSchema.parse(await (await post(session, draft)).json());
    expect((await fetch(`${base}/links/${link.id}`, { method: "DELETE" })).status).toBe(401);
    expect((await fetch(`${base}/links/${link.id}`, { method: "DELETE", headers: { cookie: session, origin: ELSEWHERE } })).status).toBe(403);
    expect((await fetch(`${base}/links/${link.id}`)).status).toBe(200);
    // A cross-origin page is never told it may send the cookie.
    const pre = await fetch(`${base}/links`, { method: "OPTIONS", headers: { origin: ELSEWHERE } });
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a draft that is not one, and knows no link it did not make", async () => {
    githubLogin = "Octo";
    const { session } = await signIn();
    expect((await post(session, { ...draft, puzzle: "chess" })).status).toBe(400);
    expect((await post(session, { ...draft, name: "  " })).status).toBe(400);
    expect((await post(session, { ...draft, draft: { ...draft.draft, thresholds: [] } })).status).toBe(400);
    expect((await post(session, { puzzle: "cooling", name: "x" })).status).toBe(400);
    expect((await fetch(`${base}/links`, { method: "POST", headers: { origin: STUDIO, cookie: session }, body: "{not json" })).status).toBe(400);
    expect((await fetch(`${base}/links/abcdefghij`)).status).toBe(404);
    expect((await fetch(`${base}/links/cooling`)).status).toBe(404);
    expect((await fetch(`${base}/nothing`)).status).toBe(404);
  });

  it("signs out", async () => {
    githubLogin = "Octo";
    const { session } = await signIn();
    expect((await fetch(`${base}/auth/sign-out`, { method: "POST", headers: { cookie: session } })).status).toBe(403);
    const out = await fetch(`${base}/auth/sign-out`, { method: "POST", headers: { cookie: session, origin: STUDIO } });
    expect(out.headers.getSetCookie().some((c) => c.startsWith("studio_session=;") && c.includes("Max-Age=0"))).toBe(true);
  });
});
