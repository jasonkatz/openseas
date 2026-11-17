/**
 * Takes (ADR 0051). The scan of a worktree is tested on a folder alone; the bucket's client
 * against a stand-in that records what it was sent; and the whole of it over HTTP against a real
 * Postgres and a real `git`, with a store that keeps takes in memory in the bucket's place and a
 * scripted agent that leaves the files the generation scripts would. No generator is called, no
 * key is real, and no bucket is reached.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChatStateSchema, DraftSchema, StudioMeSchema, TakeListSchema, type Draft } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import type { AgentRunner, TurnRequest } from "../src/chat/runner.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import type { Forge } from "../src/save/forge.js";
import { isMp3, scanTakes } from "../src/takes/scan.js";
import { createBucketStore, createMemoryStore } from "../src/takes/store.js";

/** A lossless WebP's first bytes, saying it is `size` pixels square: what a sprite take was, before pieces were drawn in code. No scan keeps one now. */
function frame(size = 192, salt = 0): Buffer {
  const b = Buffer.alloc(40, salt);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(32, 4);
  b.write("WEBPVP8L", 8, "latin1");
  b.writeUInt32LE(20, 16);
  b[20] = 0x2f;
  b.writeUInt32LE((size - 1) | ((size - 1) << 14), 21);
  return b;
}
const mp3 = (salt = 0): Buffer => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(64, salt)]);
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const put = (root: string, path: string, data: Buffer | string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
};

describe("the scan of a worktree for takes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "studio-scan-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("knows a sound by its first bytes", () => {
    expect(isMp3(mp3())).toBe(true);
    expect(isMp3(frame())).toBe(false);
    expect(isMp3(Buffer.from("ID3\u0004rest"))).toBe(true);
    expect(isMp3(Buffer.from("RIFFwave"))).toBe(false);
  });

  it("finds what the script leaves, with the words each was made from, and passes over a picture", () => {
    const tree = join(tmp, "found");
    put(tree, ".art/sounds/cooling/clear/placed-1.mp3", mp3(1));
    put(tree, ".art/sounds/cooling/clear/take-1.wav", "the raw take is not what is kept");
    put(tree, ".art/sounds/cooling/clear/take-1.json", JSON.stringify({ model: "m", text: "A soft chime." }));
    put(tree, ".art/sounds/cooling/clear/placed-2.mp3", mp3(2));
    put(tree, ".art/sounds/cooling/thud/placed-3.mp3", mp3(3));
    put(tree, ".art/sounds/engines/hum/placed-1.mp3", mp3(4));
    // A frame, where the sprite script once left one: no picture is a take any more (ADR 0062).
    put(tree, ".art/sprites/cooling/cog/frame-1.webp", frame(192, 1));
    const found = scanTakes(tree, "cooling");
    expect(found.map((t) => [t.kind, t.name, t.take, t.prompt])).toEqual([
      ["sound", "clear", 1, "A soft chime."],
      ["sound", "clear", 2, null],
      ["sound", "thud", 3, null],
    ]);
    expect(found[0]!.bytes.equals(mp3(1))).toBe(true);
  });

  it("passes over a link, a folder that is a link, a file too large, and a file that is not what its name says", () => {
    const tree = join(tmp, "hostile");
    const secret = join(tmp, "secret");
    put(secret, "placed-1.mp3", mp3(9));
    put(secret, "clear/placed-1.mp3", mp3(9));
    put(tree, ".art/sounds/cooling/clear/placed-5.mp3", mp3(5));
    // A link to a real sound outside the worktree: never followed.
    symlinkSync(join(secret, "placed-1.mp3"), join(tree, ".art/sounds/cooling/clear/placed-1.mp3"));
    // A cue's folder that is a link to one outside.
    symlinkSync(join(secret, "clear"), join(tree, ".art/sounds/cooling/thud"));
    put(tree, ".art/sounds/cooling/clear/placed-2.mp3", Buffer.concat([mp3(2), Buffer.alloc(3 * 1024 * 1024)]));
    put(tree, ".art/sounds/cooling/clear/placed-3.mp3", "RIFF but no sound");
    put(tree, ".art/sounds/cooling/../cooling/bad name/placed-1.mp3", mp3(6));
    expect(scanTakes(tree, "cooling").map((t) => [t.name, t.take])).toEqual([["clear", 5]]);

    // The whole of `.art` a link elsewhere: nothing is read through it.
    const linked = join(tmp, "linked");
    mkdirSync(linked);
    symlinkSync(join(tree, ".art"), join(linked, ".art"));
    expect(scanTakes(linked, "cooling")).toEqual([]);
    expect(scanTakes(join(tmp, "nowhere"), "cooling")).toEqual([]);
    expect(scanTakes(tree, "../cooling")).toEqual([]);
  });
});

describe("the bucket's client", () => {
  let server: Server;
  const seen: Array<{ method: string; url: string; host: string; auth: string; type: string | undefined; body: Buffer }> = [];
  const kept = new Map<string, Buffer>();
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({ method: req.method!, url: req.url!, host: String(req.headers.host), auth: String(req.headers.authorization), type: req.headers["content-type"], body });
        if (req.method === "PUT") {
          kept.set(req.url!, body);
          res.writeHead(200).end();
        } else if (kept.has(req.url!)) res.writeHead(200).end(kept.get(req.url!));
        else if (req.url!.includes("broken")) res.writeHead(500).end();
        else res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("puts and gets by key with signed requests, and says when there is nothing under a key", async () => {
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const store = createBucketStore({ endpoint, bucket: "takes-bucket", accessKeyId: "AKID", secretAccessKey: "secret", region: "auto", pathStyle: true });
    await store.put("takes/abc", frame(), "image/webp");
    expect((await store.get("takes/abc"))!.equals(frame())).toBe(true);
    expect(await store.get("takes/none")).toBeNull();
    await expect(store.get("takes/broken")).rejects.toThrow(/500/);
    const sent = seen[0]!;
    expect(sent).toMatchObject({ method: "PUT", url: "/takes-bucket/takes/abc", type: "image/webp" });
    expect(sent.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/);
    expect(sent.auth).not.toContain("secret");
  });

  it("addresses a Railway bucket by host", async () => {
    // Nothing answers at this name: the address the request was made to is all that is checked.
    const store = createBucketStore({ endpoint: "http://storage.invalid", bucket: "my-bucket", accessKeyId: "AKID", secretAccessKey: "secret", region: "auto", pathStyle: false });
    await expect(store.get("takes/abc")).rejects.toThrow();
    const real = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    try {
      expect(await store.get("takes/abc")).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
    expect(urls).toEqual(["http://my-bucket.storage.invalid/takes/abc"]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;
const STUDIO = "http://localhost:5174";

describeDb("takes, kept when a turn ends", () => {
  let app: App;
  let base: string;
  let session = "";
  const tmp = mkdtempSync(join(tmpdir(), "studio-takes-"));
  const origin = join(tmp, "origin.git");
  const store = createMemoryStore();
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

  /** What the scripted agent does with its turn: here, what a generation script would leave behind. */
  let script: (r: TurnRequest) => void = () => undefined;
  const runner: AgentRunner = {
    start(r) {
      const done = Promise.resolve().then(() => {
        script(r);
        return { status: "done" as const };
      });
      return { done, steer: () => undefined, stop: () => undefined };
    },
  };
  const forge: Forge = { token: async () => "unused", openPull: async () => ({ number: 1, url: "https://github.test/pull/1" }), pullState: async () => "open", describePull: async () => undefined, closePull: async () => undefined };

  beforeAll(async () => {
    const seed = join(tmp, "seed");
    git(tmp, "init", "--quiet", "--bare", "-b", "main", origin);
    git(tmp, "clone", "--quiet", origin, seed);
    put(seed, ".gitignore", ".art/\n");
    put(seed, "packages/content/data/puzzles/cooling.json", "{}\n");
    git(seed, "checkout", "--quiet", "-b", "main");
    git(seed, "add", "--all");
    git(seed, "commit", "--quiet", "-m", "content");
    git(seed, "push", "--quiet", "origin", "main");
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_DEV_LOGIN: "Octo", STUDIO_REPO_DIR: join(tmp, "volume"), STUDIO_REPO: "octo/openseas", STUDIO_REPO_URL: origin, STUDIO_SPEND_CAP_USD: "5", LOG_LEVEL: "silent" });
    app = await createApp(env, createLogger("silent", false), null, forge, runner, store);
    await app.db.delete(schema.draft);
    await app.db.delete(schema.meter);
    await app.db.delete(schema.take);
    base = `http://localhost:${await app.listen(0)}`;
    const dev = await fetch(`${base}/auth/dev`, { redirect: "manual" });
    session = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
  });
  afterAll(async () => {
    await app?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const send = (method: string, path: string, body?: unknown): Promise<Response> => fetch(`${base}${path}`, { method, headers: { origin: STUDIO, cookie: session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const list = async (puzzle = "cooling") => TakeListSchema.parse(await (await send("GET", `/takes?puzzle=${puzzle}`)).json()).takes;
  let draft: Draft;
  async function turn(does: (r: TurnRequest) => void) {
    script = does;
    const sent = await send("POST", `/drafts/${draft.id}/chat`, { text: "new takes of the clear cue", model: "sonnet", rounds: [], refusals: [] });
    expect(sent.status).toBe(202);
    const { chat } = (await sent.json()) as { chat: string };
    await app.chat!.idle();
    return ChatStateSchema.parse(await (await send("GET", `/chats/${chat}`)).json());
  }

  it("says it keeps takes, and has none yet", async () => {
    expect(StudioMeSchema.parse(await (await send("GET", "/auth/me")).json()).takes).toBe(true);
    expect(await list()).toEqual([]);
    draft = DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "cooling", numbers: { seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null } })).json());
  });

  it("keeps the takes a turn's commands made, lists them for the owner, and counts what they cost", async () => {
    const state = await turn((r) => {
      put(r.cwd, ".art/sounds/cooling/clear/placed-1.mp3", mp3(1));
      put(r.cwd, ".art/sounds/cooling/clear/take-1.json", JSON.stringify({ text: "A soft chime." }));
      put(r.cwd, ".art/sounds/cooling/clear/placed-2.mp3", mp3(2));
      put(r.cwd, ".art/sounds/cooling/thud/placed-1.mp3", mp3(3));
      // A picture left where the sprite script once left its frames: not a take, and not kept (ADR 0062).
      put(r.cwd, ".art/sprites/cooling/cog/frame-1.webp", frame(192, 1));
    });
    const takes = await list();
    expect(takes.map((t) => [t.kind, t.name, t.take, t.prompt, t.draft]).sort()).toEqual([
      ["sound", "clear", 1, "A soft chime.", draft.id],
      ["sound", "clear", 2, null, draft.id],
      ["sound", "thud", 1, null, draft.id],
    ]);
    expect(takes.find((t) => t.take === 1 && t.name === "clear")!.hash).toBe(sha(mp3(1)));
    // The bucket holds each under its hash, typed by the service, and no picture.
    expect(store.objects.get(`takes/${sha(mp3(1))}`)).toEqual({ bytes: mp3(1), contentType: "audio/mpeg" });
    expect(store.objects.has(`takes/${sha(frame(192, 1))}`)).toBe(false);
    // Keeping takes charges nothing: what they cost was metered as the scripts made them, through the proxy (ADR 0059). Nothing was committed, since `.art/` is ignored.
    const ended = state.items.at(-1)!;
    expect(ended).toMatchObject({ kind: "turn", status: "done", commit: null });
    expect(ended.kind === "turn" && ended.costUsd).toBe(0);
  });

  it("keeps a take once: a later turn adds only what is new", async () => {
    const before = (await list()).length;
    const state = await turn((r) => put(r.cwd, ".art/sounds/cooling/clear/placed-3.mp3", mp3(4)));
    expect((await list()).length).toBe(before + 1);
    const ended = state.items.at(-1)!;
    expect(ended.kind === "turn" && ended.costUsd).toBe(0);
  });

  it("serves a take to anyone who has its hash, from any origin, for good", async () => {
    const hash = sha(mp3(1));
    const res = await fetch(`${base}/takes/${hash}`, { headers: { origin: "https://elsewhere.test" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(mp3(1))).toBe(true);
    expect((await fetch(`${base}/takes/${"0".repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${base}/takes/not-a-hash`)).status).toBe(404);
  });

  it("leaves a sprite take kept from before where it is: listed nowhere, still read by its hash", async () => {
    // A row and its bytes as a turn left them before pieces were drawn in code (ADR 0062, ADR 0063).
    const old = frame(192, 7);
    await store.put(`takes/${sha(old)}`, old, "image/webp");
    await app.db.insert(schema.take).values({ hash: sha(old), kind: "sprite", puzzle: "cooling", name: "cog", bytes: old.length, prompt: "A brass cog.", draftId: "gonedraft1", take: 1, author: "octo" });
    expect((await list()).map((t) => t.kind)).not.toContain("sprite");
    const res = await fetch(`${base}/takes/${sha(old)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect((await app.db.select().from(schema.take)).some((r) => r.kind === "sprite")).toBe(true);
  });

  it("lists takes for the owner alone", async () => {
    expect((await fetch(`${base}/takes?puzzle=cooling`)).status).toBe(401);
    expect((await send("GET", "/takes?puzzle=nonsense")).status).toBe(400);
    expect(await list("engines")).toEqual([]);
  });

  it("keeps a draft's takes when the draft is discarded", async () => {
    const before = await list();
    expect((await send("DELETE", `/drafts/${draft.id}`)).status).toBe(200);
    expect(await list()).toEqual(before);
    expect((await fetch(`${base}/takes/${before[0]!.hash}`)).status).toBe(200);
  });
});

describeDb("a service with no bucket", () => {
  it("keeps no takes and says so", async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_DEV_LOGIN: "Octo", LOG_LEVEL: "silent" });
    const app = await createApp(env, createLogger("silent", false), null);
    try {
      const base = `http://localhost:${await app.listen(0)}`;
      const dev = await fetch(`${base}/auth/dev`, { redirect: "manual" });
      const cookie = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
      expect(StudioMeSchema.parse(await (await fetch(`${base}/auth/me`, { headers: { cookie } })).json()).takes).toBe(false);
      expect((await fetch(`${base}/takes?puzzle=cooling`, { headers: { cookie } })).status).toBe(503);
      expect((await fetch(`${base}/takes/${"0".repeat(64)}`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
