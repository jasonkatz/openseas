/**
 * Save places picks (ADR 0053, ADR 0054), over HTTP against a real Postgres, a real `git` and three
 * stand-ins: a bare repository on this disk for the remote, a forge that records what GitHub
 * would have been asked, and a store that keeps takes in memory in the bucket's place. A pick is
 * placed as its take's bytes and nothing is decoded, so a take here is only what the service
 * checks of one: a WebP's first bytes saying it is one frame's size, or an MP3's. Runs only when
 * TEST_DATABASE_URL is set.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const FRAMES = "packages/boards/src/sprites/frames.json";
const framePath = (frame: string): string => `packages/boards/src/sprites/frames/salvage/${frame}.webp`;
const sound = (cue: string): string => `packages/boards/src/sounds/salvage/${cue}.mp3`;
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const SALVAGE = (JSON.parse(readFileSync(join(PACKAGES, "boards/src/sprites/frames.json"), "utf8")) as Record<string, string[]>).salvage!;
const [gold, ice, ember] = SALVAGE as [string, string, string];

/** A lossless WebP's first bytes, saying it is 192 pixels square, and whatever follows. */
function frame(salt: number): Buffer {
  const b = Buffer.alloc(64, salt);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(56, 4);
  b.write("WEBPVP8L", 8, "latin1");
  b.writeUInt32LE(44, 16);
  b[20] = 0x2f;
  b.writeUInt32LE(191 | (191 << 14), 21);
  return b;
}
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
    for (const [path, from] of [
      [CONTENT, "content/data/puzzles/salvage.json"],
      [FRAMES, "boards/src/sprites/frames.json"],
      // The puzzle's frame files, from which the build packs its atlas (ADR 0054).
      ...SALVAGE.map((f) => [framePath(f), `boards/src/sprites/frames/salvage/${f}.webp`] as const),
    ]) {
      mkdirSync(dirname(join(seed, path)), { recursive: true });
      writeFileSync(join(seed, path), readFileSync(join(PACKAGES, from)));
    }
    git(seed, "checkout", "--quiet", "-b", "main");
    git(seed, "add", "--all");
    git(seed, "commit", "--quiet", "-m", "content and art");
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

  const numbers = (picks: DraftNumbers["picks"] = { sprites: {}, sounds: {} }, over: Partial<DraftNumbers> = {}): DraftNumbers => ({ seed: "keg-3", overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks, ...over });
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

  it("saves a draft whose only change is a pick: each take committed as its bytes, one file a pick, the manifest untouched", async () => {
    const red = frame(1);
    const chime = mp3(1);
    const draft = await open(numbers());
    const redHash = await keep("sprite", gold, red, { draft: draft.id, take: 3 });
    const chimeHash = await keep("sound", "pop", chime);
    const saved = await save(await put(draft, numbers({ sprites: { [gold]: redHash }, sounds: { pop: chimeHash } })));
    expect(saved.save).toMatchObject({ state: "idle", error: null, detail: null, pull: { number: 201 } });

    const branch = `studio/salvage-${draft.id}`;
    expect(remote(branch, framePath(gold))!.equals(red)).toBe(true);
    expect(remote(branch, sound("pop"))!.equals(chime)).toBe(true);
    // A pick is one file written: no atlas is committed to encode again, and no other frame is touched.
    expect(git(origin, "diff", "--name-only", "main", branch).split("\n").sort()).toEqual([framePath(gold), sound("pop")].sort());
    expect(remote(branch, framePath(gold))!.equals(remote("main", framePath(gold))!)).toBe(false);
    expect(git(origin, "log", "-1", "--format=%B", branch)).toBe(`Place picks for salvage from the studio\n\nsprite ${gold}: take 3\nsound pop: ${chimeHash.slice(0, 10)}`);

    const pull = gh.opened.at(-1)!;
    expect(pull.title).toBe("Tune salvage: numbers and art from the studio");
    expect(pull.body).toContain(`| sprite \`${gold}\` | [take 3](https://service.test/takes/${redHash}) | \`${framePath(gold)}\` |`);
    expect(pull.body).toContain(`| sound \`pop\` | [${chimeHash.slice(0, 10)}](https://service.test/takes/${chimeHash}) | \`${sound("pop")}\` |`);
    expect(pull.body).toContain("pnpm --filter @openseas/docs capture salvage");
    expect(pull.body).toContain("that check is still owed");
    // What Save placed is not the chat's doing.
    expect(pull.body).not.toContain("Files edited by the studio's agent");
  });

  it("puts a pick back as a number is, and a synthesized cue deletes the sample", async () => {
    const [draft] = await list();
    const saved = await save(await put(draft!, numbers({ sprites: {}, sounds: { pop: "synth" } })));
    expect(saved.save).toMatchObject({ state: "idle", error: null });
    const branch = `studio/salvage-${draft!.id}`;
    // A frame let go is the base branch's file again.
    expect(remote(branch, framePath(gold))!.equals(remote("main", framePath(gold))!)).toBe(true);
    expect(remote(branch, sound("pop"))).toBeNull();
    expect(gh.described.at(-1)!.body).toContain(`| sound \`pop\` | synthesized | \`${sound("pop")}\` removed |`);
  });

  it("leaves a frame placed by hand on the branch as it is, and a pick of that frame wins over it", async () => {
    const [draft] = await list();
    // A hand placement committed on the draft's branch, as a turn of the chat would have.
    const blue = frame(2);
    const tree = worktree(draft!);
    mkdirSync(dirname(join(tree, framePath(ice))), { recursive: true });
    writeFileSync(join(tree, framePath(ice)), blue);
    git(tree, "add", "--all");
    git(tree, "commit", "--quiet", "-m", "A turn of the chat");

    const green = frame(3);
    const saved = await save(await put(draft!, numbers({ sprites: { [ember]: await keep("sprite", ember, green) }, sounds: {} })));
    expect(saved.save).toMatchObject({ state: "idle", error: null });
    const branch = `studio/salvage-${draft!.id}`;
    expect(remote(branch, framePath(ice))!.equals(blue)).toBe(true);
    expect(remote(branch, framePath(ember))!.equals(green)).toBe(true);

    const amber = frame(4);
    const over = await save(await put(saved, numbers({ sprites: { [ember]: await keep("sprite", ember, green), [ice]: await keep("sprite", ice, amber) }, sounds: {} })));
    expect(over.save).toMatchObject({ state: "idle", error: null });
    expect(remote(branch, framePath(ice))!.equals(amber)).toBe(true);
    await discardAll();
  });

  it("refuses a pick it cannot place, names the frame or cue, and leaves the worktree as it was", async () => {
    const draft = await open(numbers(undefined, { overrides: { kinds: 6 } }));
    const first = await save(draft);
    expect(first.save).toMatchObject({ state: "idle", error: null });
    const status = (): string => git(worktree(draft), "status", "--porcelain");

    const cases: Array<[string, DraftNumbers["picks"]]> = [
      // A hash no take has.
      [gold, { sprites: { [gold]: "0".repeat(64) }, sounds: {} }],
      // A take of another frame.
      [ice, { sprites: { [ice]: await keep("sprite", gold, frame(5)) }, sounds: {} }],
      // A take of another puzzle.
      [gold, { sprites: { [gold]: await keep("sprite", gold, frame(6), { puzzle: "overload" }) }, sounds: {} }],
      // A sound picked for a frame.
      [gold, { sprites: { [gold]: await keep("sound", gold, mp3(2)) }, sounds: {} }],
      // A frame the manifest does not list: a new frame is a change to code.
      ["brandnew", { sprites: { brandnew: await keep("sprite", "brandnew", frame(7)) }, sounds: {} }],
      // A cue whose take is not an MP3.
      ["pop", { sprites: {}, sounds: { pop: await keep("sound", "pop", Buffer.from("not a sound at all, whatever its row says")) } }],
    ];
    let current = first;
    for (const [name, picks] of cases) {
      current = await save(await put(current, numbers(picks, { overrides: { kinds: 4 } })));
      expect(current.save).toMatchObject({ state: "failed", error: "pick", detail: name });
      // Neither the number written before the picks were checked nor any file is left behind.
      expect(status()).toBe("");
    }
    // A take the bucket cannot give back is the service's failing, not the pick's.
    const lost = frame(8);
    await keep("sprite", gold, lost);
    store.objects.delete(`takes/${sha(lost)}`);
    current = await save(await put(current, numbers({ sprites: { [gold]: sha(lost) }, sounds: {} }, { overrides: { kinds: 4 } })));
    expect(current.save).toMatchObject({ state: "failed", error: "takes", detail: null });
    expect(status()).toBe("");
    // Put right, it saves, and the failure's detail goes.
    current = await save(await put(current, numbers(undefined, { overrides: { kinds: 4 } })));
    expect(current.save).toMatchObject({ state: "idle", error: null, detail: null });
    await discardAll();
  });
});
