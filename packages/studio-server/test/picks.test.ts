/**
 * Save places picks (ADR 0053), over HTTP against a real Postgres, a real `git` and three
 * stand-ins: a bare repository on this disk for the remote, a forge that records what GitHub
 * would have been asked, and a store that keeps takes in memory in the bucket's place. A pick is
 * placed as its take's bytes and nothing is decoded, so a take here is only what the service
 * checks of one: an MP3's first bytes. Only a cue is picked: a draft kept with sprite picks from
 * before pieces were drawn in code still loads and saves, and its sprite picks place nothing
 * (ADR 0062, ADR 0063). Runs only when TEST_DATABASE_URL is set.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DraftListSchema, DraftSchema, type Draft, type DraftNumbers } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import type { Forge } from "../src/save/forge.js";
import { createMemoryStore } from "../src/takes/store.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const STUDIO = "http://localhost:5174";
const PACKAGES = join(fileURLToPath(import.meta.url), "../../..");
const CONTENT = "packages/content/data/puzzles/salvage.json";
const sound = (cue: string): string => `packages/boards/src/sounds/salvage/${cue}.mp3`;
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const mp3 = (salt: number): Buffer => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(256, salt)]);

describeDb("save places picks", () => {
  let app: App;
  let base: string;
  let session = "";
  const store = createMemoryStore();
  const tmp = mkdtempSync(join(tmpdir(), "studio-picks-"));
  const origin = join(tmp, "origin.git");
  const seed = join(tmp, "seed");
  const volume = join(tmp, "volume");

  const gitEnv = { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv }).trim();
  /** A file's bytes as a branch of the remote holds it; null when it has none. */
  const remote = (branch: string, path: string): Buffer | null => {
    try {
      return execFileSync("git", ["show", `${branch}:${path}`], { cwd: origin, env: gitEnv, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  /** A take kept as the chat's turn would keep it: the bytes in the bucket, then the row. */
  async function keep(kind: "sprite" | "sound", name: string, bytes: Buffer, o: { puzzle?: string; draft?: string; take?: number } = {}): Promise<string> {
    const hash = sha(bytes);
    await store.put(`takes/${hash}`, bytes, kind === "sprite" ? "image/webp" : "audio/mpeg");
    await app.db.insert(schema.take).values({ hash, kind, puzzle: o.puzzle ?? "salvage", name, bytes: bytes.length, prompt: null, draftId: o.draft ?? "elsewhere1", take: o.take ?? 1, author: "octo" }).onConflictDoNothing();
    return hash;
  }

  const gh = { opened: [] as Array<{ head: string; title: string; body: string }>, described: [] as Array<{ number: number; title: string; body: string }> };
  const forge: Forge = {
    token: async () => "never-used-for-a-local-remote",
    openPull: async (o) => {
      gh.opened.push(o);
      return { number: 200 + gh.opened.length, url: `https://github.test/pull/${200 + gh.opened.length}` };
    },
    pullState: async () => "open",
    describePull: async (number, title, body) => void gh.described.push({ number, title, body }),
    closePull: async () => undefined,
  };

  beforeAll(async () => {
    git(tmp, "init", "--quiet", "--bare", "-b", "main", origin);
    git(tmp, "clone", "--quiet", origin, seed);
    mkdirSync(dirname(join(seed, CONTENT)), { recursive: true });
    writeFileSync(join(seed, CONTENT), readFileSync(join(PACKAGES, "content/data/puzzles/salvage.json")));
    // A sample the base branch already ships, for a pick let go to be put back as.
    mkdirSync(dirname(join(seed, sound("thud"))), { recursive: true });
    writeFileSync(join(seed, sound("thud")), mp3(9));
    git(seed, "checkout", "--quiet", "-b", "main");
    git(seed, "add", "--all");
    git(seed, "commit", "--quiet", "-m", "content and a sample");
    git(seed, "push", "--quiet", "origin", "main");

    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_PUBLIC_URL: "https://service.test", STUDIO_DEV_LOGIN: "Octo", STUDIO_REPO_DIR: volume, STUDIO_REPO: "octo/openseas", STUDIO_REPO_URL: origin, LOG_LEVEL: "silent" });
    app = await createApp(env, createLogger("silent", false), null, forge, undefined, store);
    await app.db.delete(schema.draft);
    await app.db.delete(schema.take);
    base = `http://localhost:${await app.listen(0)}`;
    const dev = await fetch(`${base}/auth/dev`, { redirect: "manual" });
    session = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
  });
  afterAll(async () => {
    await app?.db.delete(schema.take);
    await app?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const numbers = (picks: DraftNumbers["picks"] = { sounds: {} }, over: Partial<DraftNumbers> = {}): DraftNumbers => ({ seed: "keg-3", overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks, ...over });
  const send = (method: string, path: string, body?: unknown): Promise<Response> => fetch(`${base}${path}`, { method, headers: { origin: STUDIO, cookie: session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const list = async (): Promise<Draft[]> => DraftListSchema.parse(await (await send("GET", "/drafts?puzzle=salvage")).json()).drafts;
  const open = async (n: DraftNumbers): Promise<Draft> => DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "salvage", numbers: n })).json());
  const put = async (d: Draft, n: DraftNumbers): Promise<Draft> => DraftSchema.parse(await (await send("PUT", `/drafts/${d.id}`, { numbers: n, revision: d.revision })).json());
  async function save(d: Draft): Promise<Draft> {
    const r = await send("POST", `/drafts/${d.id}/save`, { revision: d.revision, name: "Picks" });
    expect(r.status).toBe(202);
    await app.saver!.idle();
    return (await list()).find((x) => x.id === d.id)!;
  }
  const discardAll = async (): Promise<void> => {
    for (const d of await list()) await send("DELETE", `/drafts/${d.id}`);
  };
  const worktree = (d: Draft): string => join(volume, "worktrees", d.id);

  it("saves a draft whose only change is a pick: each take committed as its bytes, one file a pick", async () => {
    const chime = mp3(1);
    const knock = mp3(2);
    const draft = await open(numbers());
    const chimeHash = await keep("sound", "pop", chime, { draft: draft.id, take: 3 });
    const knockHash = await keep("sound", "thud", knock);
    const saved = await save(await put(draft, numbers({ sounds: { pop: chimeHash, thud: knockHash } })));
    expect(saved.save).toMatchObject({ state: "idle", error: null, detail: null, pull: { number: 201 } });

    const branch = `studio/salvage-${draft.id}`;
    expect(remote(branch, sound("pop"))!.equals(chime)).toBe(true);
    expect(remote(branch, sound("thud"))!.equals(knock)).toBe(true);
    // A pick is one file written, and nothing else is touched.
    expect(git(origin, "diff", "--name-only", "main", branch).split("\n").sort()).toEqual([sound("pop"), sound("thud")].sort());
    expect(git(origin, "log", "-1", "--format=%B", branch)).toBe(`Place picks for salvage from the studio\n\nsound pop: take 3\nsound thud: ${knockHash.slice(0, 10)}`);

    const pull = gh.opened.at(-1)!;
    expect(pull.title).toBe("Tune salvage: numbers and sounds from the studio");
    expect(pull.body).toContain(`| sound \`pop\` | [take 3](https://service.test/takes/${chimeHash}) | \`${sound("pop")}\` |`);
    expect(pull.body).toContain(`| sound \`thud\` | [${knockHash.slice(0, 10)}](https://service.test/takes/${knockHash}) | \`${sound("thud")}\` |`);
    expect(pull.body).toContain("that check is still owed");
    // What Save placed is not the chat's doing.
    expect(pull.body).not.toContain("Files edited by the studio's agent");
  });

  it("puts a pick back as a number is, and a synthesized cue deletes the sample", async () => {
    const [draft] = await list();
    const saved = await save(await put(draft!, numbers({ sounds: { pop: "synth" } })));
    expect(saved.save).toMatchObject({ state: "idle", error: null });
    const branch = `studio/salvage-${draft!.id}`;
    // A cue let go is the base branch's sample again.
    expect(remote(branch, sound("thud"))!.equals(remote("main", sound("thud"))!)).toBe(true);
    expect(remote(branch, sound("pop"))).toBeNull();
    expect(gh.described.at(-1)!.body).toContain(`| sound \`pop\` | synthesized | \`${sound("pop")}\` removed |`);
    await discardAll();
  });

  it("refuses a pick it cannot place, names the cue, and leaves the worktree as it was", async () => {
    const draft = await open(numbers(undefined, { overrides: { kinds: 6 } }));
    const first = await save(draft);
    expect(first.save).toMatchObject({ state: "idle", error: null });
    const status = (): string => git(worktree(draft), "status", "--porcelain");

    const cases: Array<[string, DraftNumbers["picks"]]> = [
      // A hash no take has.
      ["pop", { sounds: { pop: "0".repeat(64) } }],
      // A take of another cue.
      ["thud", { sounds: { thud: await keep("sound", "pop", mp3(3)) } }],
      // A take of another puzzle.
      ["pop", { sounds: { pop: await keep("sound", "pop", mp3(4), { puzzle: "overload" }) } }],
      // A sprite take kept from before pieces were drawn in code: nothing places one.
      ["pop", { sounds: { pop: await keep("sprite", "pop", mp3(5)) } }],
      // A cue whose take is not an MP3.
      ["pop", { sounds: { pop: await keep("sound", "pop", Buffer.from("not a sound at all, whatever its row says")) } }],
    ];
    let current = first;
    for (const [name, picks] of cases) {
      current = await save(await put(current, numbers(picks, { overrides: { kinds: 4 } })));
      expect(current.save).toMatchObject({ state: "failed", error: "pick", detail: name });
      // Neither the number written before the picks were checked nor any file is left behind.
      expect(status()).toBe("");
    }
    // A take the bucket cannot give back is the service's failing, not the pick's.
    const lost = mp3(6);
    await keep("sound", "pop", lost);
    store.objects.delete(`takes/${sha(lost)}`);
    current = await save(await put(current, numbers({ sounds: { pop: sha(lost) } }, { overrides: { kinds: 4 } })));
    expect(current.save).toMatchObject({ state: "failed", error: "takes", detail: null });
    expect(status()).toBe("");
    // Put right, it saves, and the failure's detail goes.
    current = await save(await put(current, numbers(undefined, { overrides: { kinds: 4 } })));
    expect(current.save).toMatchObject({ state: "idle", error: null, detail: null });
    await discardAll();
  });

  it("loads a draft kept with sprite picks, lists no sprite take, and saves it placing only its sounds", async () => {
    const chime = mp3(7);
    const chimeHash = await keep("sound", "pop", chime);
    const pictureHash = await keep("sprite", "debris-gold", Buffer.from("a frame kept before pieces were drawn in code"));
    const draft = await open(numbers({ sounds: { pop: chimeHash } }, { overrides: { kinds: 6 } }));
    // The row as a service from before ADR 0062 left it: a sprite pick beside the sound's.
    const old = { ...numbers(undefined, { overrides: { kinds: 6 } }), picks: { sprites: { "debris-gold": pictureHash }, sounds: { pop: chimeHash } } };
    await app.db.update(schema.draft).set({ numbers: old as DraftNumbers }).where(eq(schema.draft.id, draft.id));

    // It reads, without its sprite pick.
    const [read] = await list();
    expect(read!.numbers.picks).toEqual({ sounds: { pop: chimeHash } });
    expect(read!.numbers.overrides).toEqual({ kinds: 6 });
    // The sprite take's row is still there and is listed nowhere; its bytes can still be read by their hash.
    const takes = (await (await send("GET", "/takes?puzzle=salvage")).json()) as { takes: Array<{ hash: string; kind: string }> };
    expect(takes.takes.some((t) => t.kind === "sprite")).toBe(false);
    expect(takes.takes.some((t) => t.hash === chimeHash)).toBe(true);
    expect((await fetch(`${base}/takes/${pictureHash}`)).status).toBe(200);
    expect((await app.db.select().from(schema.take).where(eq(schema.take.hash, pictureHash))).length).toBe(1);

    const saved = await save(read!);
    expect(saved.save).toMatchObject({ state: "idle", error: null, detail: null });
    const branch = `studio/salvage-${draft.id}`;
    expect(git(origin, "diff", "--name-only", "main", branch).split("\n").sort()).toEqual([CONTENT, sound("pop")].sort());
    expect(remote(branch, sound("pop"))!.equals(chime)).toBe(true);
    await discardAll();
  });
});
