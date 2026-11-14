/**
 * Save for a draft's numbers (ADR 0046), over HTTP against a real Postgres, a real `git` and two
 * stand-ins: a bare repository on this disk for the remote, and a forge that records what GitHub
 * would have been asked. No network, no GitHub App. Runs only when TEST_DATABASE_URL is set.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DraftListSchema, DraftSchema, SaveStartedSchema, type Draft, type DraftNumbers } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import type { Forge, PullState } from "../src/save/forge.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const STUDIO = "http://localhost:5174";
const FILE = "packages/content/data/puzzles/cooling.json";
const shipped = readFileSync(join(fileURLToPath(import.meta.url), "../../../content/data/puzzles/cooling.json"), "utf8");

describeDb("save", () => {
  let app: App;
  let base: string;
  let session = "";
  const tmp = mkdtempSync(join(tmpdir(), "studio-save-"));
  const origin = join(tmp, "origin.git");
  const seed = join(tmp, "seed");
  const volume = join(tmp, "volume");

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  /** A file as a branch of the remote holds it. */
  const remote = (branch: string, path = FILE): string => git(origin, "show", `${branch}:${path}`) + "\n";
  const remoteLog = (branch: string): string[] => git(origin, "log", "--format=%s", branch).split("\n");
  const hasRemote = (branch: string): boolean => git(origin, "branch", "--list", branch) !== "";
  /** Somebody else lands a commit on main. */
  const land = (path: string, text: string, message: string): void => {
    git(seed, "pull", "--quiet", "origin", "main");
    mkdirSync(join(seed, path, ".."), { recursive: true });
    writeFileSync(join(seed, path), text);
    git(seed, "add", "--all");
    git(seed, "commit", "--quiet", "-m", message);
    git(seed, "push", "--quiet", "origin", "main");
  };

  /** The stand-in GitHub: what was asked of it, and what it says of each pull request. */
  const gh = { opened: [] as Array<{ head: string; base: string; title: string; body: string }>, described: [] as Array<{ number: number; body: string }>, closed: [] as number[], state: new Map<number, PullState>(), fail: false };
  const forge: Forge = {
    token: async () => "never-used-for-a-local-remote",
    openPull: async (o) => {
      if (gh.fail) throw new (await import("../src/save/forge.js")).ForgeError("pull request", 502, "down");
      gh.opened.push(o);
      const number = 100 + gh.opened.length;
      gh.state.set(number, "open");
      return { number, url: `https://github.test/pull/${number}` };
    },
    pullState: async (n) => gh.state.get(n) ?? "open",
    describePull: async (number, body) => void gh.described.push({ number, body }),
    closePull: async (n) => void gh.closed.push(n),
  };

  beforeAll(async () => {
    git(tmp, "init", "--quiet", "--bare", "-b", "main", origin);
    git(tmp, "clone", "--quiet", origin, seed);
    mkdirSync(join(seed, "packages/content/data/puzzles"), { recursive: true });
    writeFileSync(join(seed, FILE), shipped);
    writeFileSync(join(seed, "README.md"), "openseas\n");
    git(seed, "checkout", "--quiet", "-b", "main");
    git(seed, "add", "--all");
    git(seed, "commit", "--quiet", "-m", "content");
    git(seed, "push", "--quiet", "origin", "main");

    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_DEV_LOGIN: "Octo", STUDIO_REPO_DIR: volume, STUDIO_REPO: "octo/openseas", STUDIO_REPO_URL: origin, LOG_LEVEL: "silent" });
    app = await createApp(env, createLogger("silent", false), null, forge);
    await app.db.delete(schema.draft);
    base = `http://localhost:${await app.listen(0)}`;
    const dev = await fetch(`${base}/auth/dev`, { redirect: "manual" });
    session = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
  });
  afterAll(async () => {
    await app?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const numbers = (over: Partial<DraftNumbers> = {}): DraftNumbers => ({ seed: "keg-3", overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, ...over });
  const send = (method: string, path: string, body?: unknown): Promise<Response> => fetch(`${base}${path}`, { method, headers: { origin: STUDIO, cookie: session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const list = async (): Promise<Draft[]> => DraftListSchema.parse(await (await send("GET", "/drafts?puzzle=cooling")).json()).drafts;
  const open = async (n: DraftNumbers): Promise<Draft> => DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "cooling", numbers: n })).json());
  const put = async (d: Draft, n: DraftNumbers): Promise<Draft> => DraftSchema.parse(await (await send("PUT", `/drafts/${d.id}`, { numbers: n, revision: d.revision })).json());
  /** Save, and wait for the branch to be written. */
  async function save(d: Draft, name = "A save"): Promise<{ started: ReturnType<typeof SaveStartedSchema.parse>; draft: Draft }> {
    const r = await send("POST", `/drafts/${d.id}/save`, { revision: d.revision, name });
    expect(r.status).toBe(202);
    const started = SaveStartedSchema.parse(await r.json());
    await app.saver!.idle();
    return { started, draft: (await list()).find((x) => x.id === d.id)! };
  }
  const discardAll = async (): Promise<void> => {
    for (const d of await list()) await send("DELETE", `/drafts/${d.id}`);
  };

  it("says it can Save", async () => {
    expect(await (await fetch(`${base}/auth/me`)).json()).toMatchObject({ save: true });
  });

  it("makes a tester link at once, then writes the numbers to a branch and opens a draft pull request from the App", async () => {
    const draft = await open(numbers({ overrides: { pieceKinds: 5, "specialChancePerMille.charge": 40 }, roundSeconds: 120, paceSeconds: 12 }));
    const { started, draft: saved } = await save(draft, "Five kinds");
    // At once: the link, playable by anyone, and the draft marked as being saved.
    expect(started.draft.save).toMatchObject({ state: "saving", pull: null });
    expect(started.link).toMatchObject({ puzzle: "cooling", name: "Five kinds", author: "Octo", draft: draft.numbers });
    expect((await fetch(`${base}/links/${started.link.id}`)).status).toBe(200);

    const branch = `studio/cooling-${draft.id}`;
    expect(saved.save).toEqual({ state: "idle", error: null, pull: { number: 101, url: "https://github.test/pull/101" }, savedRevision: 1, behind: false });
    // The file on the remote's branch is the shipped one with those four numbers changed and not a byte else.
    const want = shipped.replace('"pieceKinds": 7', '"pieceKinds": 5').replace('"charge": 12', '"charge": 40').replace('  "roundSeconds": 150,', '  "paceSeconds": 12,\n  "roundSeconds": 120,');
    expect(remote(branch)).toBe(want);
    expect(remote("main")).toBe(shipped);
    expect(remoteLog(branch)).toEqual(["Tune cooling from the studio", "content"]);
    expect(git(origin, "log", "-1", "--format=%an <%ae>%n%b", branch)).toContain("openseas studio <studio@openseas.online>");
    expect(git(origin, "log", "-1", "--format=%b", branch)).toContain("config.pieceKinds: 7 -> 5");

    expect(gh.opened).toHaveLength(1);
    expect(gh.opened[0]).toMatchObject({ head: branch, base: "main", title: "Tune cooling: numbers from the studio" });
    const body = gh.opened[0]!.body;
    expect(body).toContain("[Octo](https://github.com/Octo)");
    expect(body).toContain("| `config.pieceKinds` | `7` | `5` |");
    expect(body).toContain("| `paceSeconds` | `(none)` | `12` |");
    expect(body).toContain(`${STUDIO}/play/${started.link.id}`);
    expect(body).toContain("This pull request is a draft");
    // Nothing that can push is left on the volume.
    expect(readFileSync(join(volume, "repo/.git/config"), "utf8")).not.toMatch(/token|extraheader|authorization/i);
  });

  it("adds a later Save to the same pull request, and puts back what the draft no longer changes", async () => {
    const [draft] = await list();
    const branch = `studio/cooling-${draft!.id}`;
    // One number put back, one moved again, the pace left to the file's default again.
    const next = await put(draft!, numbers({ overrides: { "specialChancePerMille.charge": 60 }, roundSeconds: 120 }));
    expect(next.save).toMatchObject({ savedRevision: 1, pull: { number: 101 } });
    const { draft: saved } = await save(next, "Sixty");
    expect(saved.save).toMatchObject({ state: "idle", pull: { number: 101 }, savedRevision: 2 });
    expect(remote(branch)).toBe(shipped.replace('"charge": 12', '"charge": 60').replace('"roundSeconds": 150', '"roundSeconds": 120'));
    expect(remoteLog(branch)).toEqual(["Tune cooling from the studio", "Tune cooling from the studio", "content"]);
    expect(gh.opened).toHaveLength(1);
    expect(gh.described).toHaveLength(1);
    expect(gh.described[0]!.body).not.toContain("pieceKinds");

    // Saved again with nothing new: no commit, and no failure.
    const { draft: again } = await save(saved, "Same");
    expect(again.save.state).toBe("idle");
    expect(remoteLog(branch)).toHaveLength(3);
  });

  it("says when main has moved under a draft, and merges it in only when asked", async () => {
    const [draft] = await list();
    const branch = `studio/cooling-${draft!.id}`;
    expect(draft!.save.behind).toBe(false);
    land("README.md", "openseas, moved on\n", "readme");
    // The last fetch is taken as read for a minute; the update itself always fetches.
    const updating = await send("POST", `/drafts/${draft!.id}/update`);
    expect(updating.status).toBe(202);
    expect(DraftSchema.parse(await updating.json()).save.state).toBe("saving");
    await app.saver!.idle();
    const [after] = await list();
    expect(after!.save).toMatchObject({ state: "idle", error: null, behind: false });
    expect(remote(branch, "README.md")).toBe("openseas, moved on\n");
    // Merged, never rebased: the draft's commits are where they were, under a merge.
    expect(remoteLog(branch).slice(1)).toEqual(expect.arrayContaining(["Tune cooling from the studio", "readme", "content"]));
    expect(git(origin, "log", "-1", "--format=%P", branch).split(" ")).toHaveLength(2);

    // Main changes the very line the draft changed: the update is refused and the branch is as it was.
    const head = git(origin, "rev-parse", branch);
    land(FILE, shipped.replace('"charge": 12', '"charge": 13'), "charge");
    await send("POST", `/drafts/${draft!.id}/update`);
    await app.saver!.idle();
    const [stuck] = await list();
    expect(stuck!.save).toMatchObject({ state: "failed", error: "conflict", behind: true });
    expect(git(origin, "rev-parse", branch)).toBe(head);
    expect(git(join(volume, "worktrees", draft!.id), "status", "--porcelain")).toBe("");
  });

  it("clears a draft when its pull request is merged or closed", async () => {
    const [draft] = await list();
    gh.state.set(101, "merged");
    // A pull request's state is taken as read for half a minute: move the clock on so this listing asks.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      expect(await list()).toEqual([]);
    } finally {
      Date.now = realNow;
    }
    expect(existsSync(join(volume, "worktrees", draft!.id))).toBe(false);
    // The branch on the remote is the merged pull request's to keep or delete; the draft does not touch it.
    expect(hasRemote(`studio/cooling-${draft!.id}`)).toBe(true);
    // The puzzle can have a draft again, and it starts a pull request of its own.
    const fresh = await open(numbers({ overrides: { pieceKinds: 6 } }));
    const { draft: saved } = await save(fresh);
    expect(saved.save.pull).toEqual({ number: 102, url: "https://github.test/pull/102" });
    expect(gh.opened[1]!.head).toBe(`studio/cooling-${fresh.id}`);
  });

  it("closes the pull request and deletes the branch of a draft that is discarded", async () => {
    const [draft] = await list();
    const branch = `studio/cooling-${draft!.id}`;
    expect(hasRemote(branch)).toBe(true);
    expect((await send("DELETE", `/drafts/${draft!.id}`)).status).toBe(200);
    expect(gh.closed).toEqual([102]);
    expect(hasRemote(branch)).toBe(false);
    expect(existsSync(join(volume, "worktrees", draft!.id))).toBe(false);
    expect(await list()).toEqual([]);
  });

  it("refuses a Save from a page behind its draft, one with nothing to save, and a key the file has no place for", async () => {
    await discardAll();
    const draft = await open(numbers());
    expect((await send("POST", `/drafts/${draft.id}/save`, { revision: 7, name: "x" })).status).toBe(409);
    expect((await send("POST", `/drafts/${draft.id}/save`, { revision: 1 })).status).toBe(400);
    expect((await send("POST", `/drafts/${draft.id}/update`)).status).toBe(409);
    expect((await send("POST", "/drafts/abcdefghij/save", { revision: 1, name: "x" })).status).toBe(404);
    expect((await fetch(`${base}/drafts/${draft.id}/save`, { method: "POST", headers: { cookie: session }, body: "{}" })).status).toBe(403);

    // Only a seed: no number differs, so there is nothing for a pull request to hold.
    const opened = gh.opened.length;
    const { draft: nothing } = await save(draft);
    expect(nothing.save).toMatchObject({ state: "failed", error: "nothing", pull: null });

    const odd = await put(nothing, numbers({ overrides: { "raider.hull": 3 } }));
    const { draft: refused } = await save(odd);
    expect(refused.save).toMatchObject({ state: "failed", error: "unknown_key", pull: null });
    expect(gh.opened).toHaveLength(opened);
    expect(hasRemote(`studio/cooling-${draft.id}`)).toBe(false);

    // GitHub down after the push: the branch is there, the failure is shown, and the next Save opens the pull request.
    const real = await put(refused, numbers({ overrides: { pieceKinds: 4 } }));
    gh.fail = true;
    const { draft: down } = await save(real);
    expect(down.save).toMatchObject({ state: "failed", error: "github", pull: null });
    expect(hasRemote(`studio/cooling-${draft.id}`)).toBe(true);
    gh.fail = false;
    const { draft: up } = await save(down);
    expect(up.save).toMatchObject({ state: "idle", error: null, savedRevision: 3 });
    expect(up.save.pull).not.toBeNull();
    // One commit for the numbers: the Save that could not open the pull request is not repeated.
    expect(remoteLog(`studio/cooling-${draft.id}`).filter((m) => m === "Tune cooling from the studio")).toHaveLength(1);
    await discardAll();
  });

  it("finds its branch again on a new volume", async () => {
    const draft = await open(numbers({ overrides: { pieceKinds: 5 } }));
    const { draft: saved } = await save(draft);
    const branch = `studio/cooling-${draft.id}`;
    // The volume is lost; the database and the remote are not.
    rmSync(volume, { recursive: true, force: true });
    const next = await put(saved, numbers({ overrides: { pieceKinds: 4 } }));
    const { draft: again } = await save(next);
    expect(again.save).toMatchObject({ state: "idle", error: null, savedRevision: 2, pull: saved.save.pull });
    expect(remoteLog(branch).filter((s) => s === "Tune cooling from the studio")).toHaveLength(2);
    expect(remote(branch)).toContain('"pieceKinds": 4');
    await discardAll();
  });
});

describeDb("a service with no clone or no App", () => {
  it("keeps drafts and says it cannot Save", async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_DEV_LOGIN: "Octo", STUDIO_REPO_DIR: "/nowhere", STUDIO_REPO: "octo/openseas", LOG_LEVEL: "silent" });
    const app = await createApp(env, createLogger("silent", false), null);
    try {
      expect(app.saver).toBeNull();
      const base = `http://localhost:${await app.listen(0)}`;
      const dev = await fetch(`${base}/auth/dev`, { redirect: "manual" });
      const session = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
      expect(await (await fetch(`${base}/auth/me`)).json()).toMatchObject({ save: false });
      await app.db.delete(schema.draft);
      const made = await fetch(`${base}/drafts`, { method: "POST", headers: { origin: STUDIO, cookie: session }, body: JSON.stringify({ puzzle: "cooling", numbers: { seed: null, overrides: { pieceKinds: 5 }, roundSeconds: null, paceSeconds: null, thresholds: null } }) });
      const draft = DraftSchema.parse(await made.json());
      expect(draft.save).toEqual({ state: "idle", error: null, pull: null, savedRevision: null, behind: false });
      const save = await fetch(`${base}/drafts/${draft.id}/save`, { method: "POST", headers: { origin: STUDIO, cookie: session }, body: JSON.stringify({ revision: 1, name: "x" }) });
      expect(save.status).toBe(503);
      expect(await save.json()).toEqual({ error: "unavailable" });
      await fetch(`${base}/drafts/${draft.id}`, { method: "DELETE", headers: { origin: STUDIO, cookie: session } });
    } finally {
      await app.close();
    }
  });
});
