/**
 * Save places picks (ADR 0053), over HTTP against a real Postgres, a real `git`, the real sprite
 * script on the real Cooling atlas, and three stand-ins: a bare repository on this disk for the
 * remote, a forge that records what GitHub would have been asked, and a store that keeps takes in
 * memory in the bucket's place. Runs only when TEST_DATABASE_URL is set, and needs Pillow.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DraftListSchema, DraftSchema, type Draft, type DraftNumbers } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import { ensureAgentUser } from "../src/chat/agentUser.js";
import type { Forge } from "../src/save/forge.js";
import { createPlacer } from "../src/save/picks.js";
import { createRepo } from "../src/save/repo.js";
import { createMemoryStore } from "../src/takes/store.js";

const url = process.env.TEST_DATABASE_URL;
const pillow = (() => {
  try {
    execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
// CI installs Pillow (ci.yml); only a machine without it skips, and says why.
if (url && !pillow && process.env.CI) throw new Error("the picks tests need Pillow (python3 -m pip install pillow)");
const describeDb = url && pillow ? describe : describe.skip;

const STUDIO = "http://localhost:5174";
const PACKAGES = join(fileURLToPath(import.meta.url), "../../..");
const CONTENT = "packages/content/data/puzzles/cooling.json";
const ATLAS = "packages/boards/src/sprites/cooling.webp";
const FRAMES = "packages/boards/src/sprites/frames.json";
const override = (frame: string): string => `packages/boards/src/sprites/overrides/cooling-${frame}.webp`;
const sound = (cue: string): string => `packages/boards/src/sounds/cooling/${cue}.mp3`;
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const frameNames = Object.keys((JSON.parse(readFileSync(join(PACKAGES, "boards/src/sprites/frames.json"), "utf8")) as Record<string, Record<string, unknown>>).cooling!);

describeDb("save places picks", () => {
  let app: App;
  let base: string;
  let session = "";
  const store = createMemoryStore();
  const tmp = mkdtempSync(join(tmpdir(), "studio-picks-"));
  const origin = join(tmp, "origin.git");
  const seed = join(tmp, "seed");
  const volume = join(tmp, "volume");
  const [cog, valve, bolt] = frameNames as [string, string, string];

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
  /** The colour at a frame's centre in an atlas. */
  const centre = (atlas: Buffer, frame: string): number[] => {
    const file = join(tmp, `atlas-${Math.random().toString(36).slice(2)}.webp`);
    writeFileSync(file, atlas);
    const out = execFileSync("python3", ["-I", "-c", "import json,sys\nfrom PIL import Image\nx,y,w,h=json.load(open(sys.argv[2]))['cooling'][sys.argv[3]]\nprint(json.dumps(Image.open(sys.argv[1]).convert('RGBA').getpixel((x+w//2,y+h//2))))", file, join(seed, FRAMES), frame], { encoding: "utf8" });
    return JSON.parse(out) as number[];
  };
  /** A frame as `sprites.py frames` writes a take: a lossless 192px WebP, here of one colour. */
  const paint = (rgba: [number, number, number, number]): Buffer => {
    const file = join(tmp, `take-${rgba.join("-")}.webp`);
    execFileSync("python3", ["-I", "-c", "import sys\nfrom PIL import Image\nImage.new('RGBA',(192,192),tuple(int(v) for v in sys.argv[2:6])).save(sys.argv[1],lossless=True,method=6)", file, ...rgba.map(String)]);
    return readFileSync(file);
  };
  const mp3 = (salt: number): Buffer => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(256, salt)]);
  /** A take kept as the chat's turn would keep it: the bytes in the bucket, then the row. */
  async function keep(kind: "sprite" | "sound", name: string, bytes: Buffer, o: { puzzle?: string; draft?: string; take?: number } = {}): Promise<string> {
    const hash = sha(bytes);
    await store.put(`takes/${hash}`, bytes, kind === "sprite" ? "image/webp" : "audio/mpeg");
    await app.db.insert(schema.take).values({ hash, kind, puzzle: o.puzzle ?? "cooling", name, bytes: bytes.length, prompt: null, draftId: o.draft ?? "elsewhere1", take: o.take ?? 1, author: "octo" }).onConflictDoNothing();
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
      [CONTENT, "content/data/puzzles/cooling.json"],
      [ATLAS, "boards/src/sprites/cooling.webp"],
      [FRAMES, "boards/src/sprites/frames.json"],
    ] as const) {
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
  const list = async (): Promise<Draft[]> => DraftListSchema.parse(await (await send("GET", "/drafts?puzzle=cooling")).json()).drafts;
  const open = async (n: DraftNumbers): Promise<Draft> => DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "cooling", numbers: n })).json());
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

  it("saves a draft whose only change is a pick: the frame pasted into the atlas, its take kept as the override byte for byte, the sound copied", async () => {
    const red = paint([255, 0, 0, 255]);
    const chime = mp3(1);
    const shipped = remote("main", ATLAS)!;
    const draft = await open(numbers());
    const redHash = await keep("sprite", cog, red, { draft: draft.id, take: 3 });
    const chimeHash = await keep("sound", "clear", chime);
    const picked = await put(draft, numbers({ sprites: { [cog]: redHash }, sounds: { clear: chimeHash } }));
    const saved = await save(picked);
    expect(saved.save).toMatchObject({ state: "idle", error: null, detail: null, pull: { number: 201 } });

    const branch = `studio/cooling-${draft.id}`;
    expect(remote(branch, override(cog))!.equals(red)).toBe(true);
    expect(remote(branch, sound("clear"))!.equals(chime)).toBe(true);
    const atlas = remote(branch, ATLAS)!;
    expect(atlas.equals(shipped)).toBe(false);
    const [r, g, b, a] = centre(atlas, cog);
    expect(r).toBeGreaterThan(240);
    expect(g! + b!).toBeLessThan(20);
    expect(a).toBe(255);
    // Every other frame is the shipped one, but for what one quality-90 encode does.
    const before = centre(shipped, valve);
    centre(atlas, valve).forEach((v, i) => expect(Math.abs(v - before[i]!)).toBeLessThan(12));
    // The manifest and the numbers are untouched.
    expect(remote(branch, FRAMES)!.equals(remote("main", FRAMES)!)).toBe(true);
    expect(remote(branch, CONTENT)!.equals(remote("main", CONTENT)!)).toBe(true);
    expect(git(origin, "log", "-1", "--format=%B", branch)).toBe(`Place picks for cooling from the studio\n\nsprite ${cog}: take 3\nsound clear: ${chimeHash.slice(0, 10)}`);

    const pull = gh.opened.at(-1)!;
    expect(pull.title).toBe("Tune cooling: numbers and art from the studio");
    expect(pull.body).toContain(`| sprite \`${cog}\` | [take 3](https://service.test/takes/${redHash}) | \`${override(cog)}\` |`);
    expect(pull.body).toContain(`| sound \`clear\` | [${chimeHash.slice(0, 10)}](https://service.test/takes/${chimeHash}) | \`${sound("clear")}\` |`);
    expect(pull.body).toContain("pnpm --filter @openseas/docs capture cooling");
    expect(pull.body).toContain("that check is still owed");
    // What Save placed is not the chat's doing.
    expect(pull.body).not.toContain("Files edited by the studio's agent");
  });

  it("puts a pick back as a number is: the override gone, the atlas the base's byte for byte, a synthesized cue deleting the sample", async () => {
    const [draft] = await list();
    const back = await put(draft!, numbers({ sprites: {}, sounds: { clear: "synth" } }));
    const saved = await save(back);
    expect(saved.save).toMatchObject({ state: "idle", error: null });
    const branch = `studio/cooling-${draft!.id}`;
    expect(remote(branch, override(cog))).toBeNull();
    expect(remote(branch, ATLAS)!.equals(remote("main", ATLAS)!)).toBe(true);
    expect(remote(branch, sound("clear"))).toBeNull();
    expect(gh.described.at(-1)!.body).toContain(`| sound \`clear\` | synthesized | \`${sound("clear")}\` removed |`);
  });

  it("keeps a frame placed by hand on the branch when it places the picks from the base's atlas", async () => {
    const [draft] = await list();
    // A hand placement committed on the draft's branch, as a turn of the chat would have: an override and the atlas it was pasted into.
    const blue = paint([0, 0, 255, 255]);
    const tree = worktree(draft!);
    mkdirSync(dirname(join(tree, override(valve))), { recursive: true });
    writeFileSync(join(tree, override(valve)), blue);
    execFileSync("python3", ["-I", join(PACKAGES, "boards/scripts/sprites.py"), "--root", tree, "put", "cooling"]);
    git(tree, "add", "--all");
    git(tree, "commit", "--quiet", "-m", "A turn of the chat");

    const green = paint([0, 255, 0, 255]);
    const greenHash = await keep("sprite", bolt, green);
    const picked = await put(draft!, numbers({ sprites: { [bolt]: greenHash }, sounds: {} }));
    const saved = await save(picked);
    expect(saved.save).toMatchObject({ state: "idle", error: null });
    const atlas = remote(`studio/cooling-${draft!.id}`, ATLAS)!;
    const [vr, vg, vb] = centre(atlas, valve);
    expect(vb).toBeGreaterThan(240);
    expect(vr! + vg!).toBeLessThan(20);
    const [br, bg, bb] = centre(atlas, bolt);
    expect(bg).toBeGreaterThan(240);
    expect(br! + bb!).toBeLessThan(20);
    expect(remote(`studio/cooling-${draft!.id}`, override(valve))!.equals(blue)).toBe(true);
    await discardAll();
  });

  it("refuses a pick it cannot place, names the frame or cue, and leaves the worktree as it was", async () => {
    const red = paint([255, 0, 0, 255]);
    const draft = await open(numbers(undefined, { overrides: { pieceKinds: 5 } }));
    const first = await save(draft);
    expect(first.save).toMatchObject({ state: "idle", error: null });
    const tree = worktree(draft);
    const status = (): string => git(tree, "status", "--porcelain");

    const cases: Array<[string, DraftNumbers["picks"]]> = [
      // A hash no take has.
      [cog, { sprites: { [cog]: "0".repeat(64) }, sounds: {} }],
      // A take of another frame.
      [valve, { sprites: { [valve]: await keep("sprite", cog, red) }, sounds: {} }],
      // A take of another puzzle.
      [cog, { sprites: { [cog]: await keep("sprite", cog, paint([1, 2, 3, 255]), { puzzle: "engines" }) }, sounds: {} }],
      // A sound picked for a frame.
      [cog, { sprites: { [cog]: await keep("sound", cog, mp3(2)) }, sounds: {} }],
      // A frame the atlas does not have: a new frame is a change to code.
      ["brandnew", { sprites: { brandnew: await keep("sprite", "brandnew", paint([9, 9, 9, 255])) }, sounds: {} }],
    ];
    let current = first;
    for (const [name, picks] of cases) {
      current = await save(await put(current, numbers(picks, { overrides: { pieceKinds: 4 } })));
      expect(current.save).toMatchObject({ state: "failed", error: "pick", detail: name });
      // Neither the number written before the picks were checked nor any picture is left behind.
      expect(status()).toBe("");
    }
    // Put right, it saves, and the failure's detail goes.
    current = await save(await put(current, numbers(undefined, { overrides: { pieceKinds: 4 } })));
    expect(current.save).toMatchObject({ state: "idle", error: null, detail: null });
    await discardAll();
  });

  it("decodes the takes as the agent's unix user, where the service may become one, and never without it in production", async () => {
    const log = createLogger("silent", false);
    const dir = join(tmp, "agent-volume");
    mkdirSync(dir, { recursive: true });
    chmodSync(tmp, 0o755);
    const repo = createRepo({ dir, url: origin, base: "main", author: { name: "t", email: "t@t" }, token: async () => null, log });
    await repo.ready();
    await repo.fetchBase();
    const tree = await repo.worktree("agentplace", "studio/cooling-agentplace");
    const red = paint([255, 0, 0, 255]);
    const hash = await keep("sprite", cog, red);
    const picks = { sprites: { [cog]: hash }, sounds: {} };
    const none = { sprites: {}, sounds: {} };

    // In production, a frame is never decoded as the service.
    const bare = createPlacer({ repo, takes: app.takes, identity: null, production: true, log });
    await expect(bare.place({ id: "agentplace", puzzle: "cooling", worktree: tree, picks, saved: none })).rejects.toMatchObject({ code: "takes" });
    expect(git(tree, "status", "--porcelain")).toBe("");

    const identity = ensureAgentUser("studio-agent-test", dir, log);
    const placer = createPlacer({ repo, takes: app.takes, identity, log });
    const placement = await placer.place({ id: "agentplace", puzzle: "cooling", worktree: tree, picks, saved: none });
    expect(placement.placed).toMatchObject([{ kind: "sprite", name: cog, pick: hash, take: null, file: override(cog) }]);
    expect(readFileSync(join(tree, override(cog))).equals(red)).toBe(true);
    // Where the test runs as root the script ran as the agent's user, so what it wrote is that user's.
    if (identity) expect(statSync(join(tree, ATLAS)).uid).toBe(identity.uid);
  });
});
