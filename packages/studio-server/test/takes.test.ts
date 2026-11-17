/**
 * The takes kept from before (ADR 0051, ADR 0063, ADR 0064). Nothing makes, keeps, lists or picks
 * a take now (ADR 0062): what is left is reading one by its hash, from rows and a bucket that
 * were filled before. The bucket's client is tested against a stand-in that records what it was
 * sent, and the route over HTTP against a real Postgres and a real `git`, with a store that holds
 * takes in memory in the bucket's place. No key is real, and no bucket is reached.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChatStateSchema, DraftSchema, type Draft } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import type { AgentRunner, TurnRequest } from "../src/chat/runner.js";
import { schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import type { Forge } from "../src/save/forge.js";
import { createBucketStore, createMemoryStore } from "../src/takes/store.js";

/** A lossless WebP's first bytes: what a sprite take was. */
function frame(salt = 0): Buffer {
  const b = Buffer.alloc(40, salt);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(32, 4);
  b.write("WEBPVP8L", 8, "latin1");
  return b;
}
/** An MP3's first bytes: what a sound take was. */
const mp3 = (salt = 0): Buffer => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(64, salt)]);
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const put = (root: string, path: string, data: Buffer | string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
};

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

  it("gets by key with signed requests, says when there is nothing under a key, and writes nothing", async () => {
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const store = createBucketStore({ endpoint, bucket: "takes-bucket", accessKeyId: "AKID", secretAccessKey: "secret", region: "auto", pathStyle: true });
    // The bucket holds a take from before.
    kept.set("/takes-bucket/takes/abc", frame());
    expect((await store.get("takes/abc"))!.equals(frame())).toBe(true);
    expect(await store.get("takes/none")).toBeNull();
    await expect(store.get("takes/broken")).rejects.toThrow(/500/);
    const sent = seen[0]!;
    expect(sent).toMatchObject({ method: "GET", url: "/takes-bucket/takes/abc" });
    expect(sent.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/);
    expect(sent.auth).not.toContain("secret");
    // Nothing makes a take now (ADR 0062): the store has no way to write, and asked for nothing but reads.
    expect(Object.keys(store)).toEqual(["get"]);
    expect(seen.every((r) => r.method === "GET")).toBe(true);
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

describeDb("the takes kept from before", () => {
  let app: App;
  let base: string;
  let session = "";
  const tmp = mkdtempSync(join(tmpdir(), "studio-takes-"));
  const origin = join(tmp, "origin.git");
  const store = createMemoryStore();
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

  /** What the scripted agent does with its turn: here, what a generation script once left behind. */
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
  let draft: Draft;
  async function turn(does: (r: TurnRequest) => void) {
    script = does;
    const sent = await send("POST", `/drafts/${draft.id}/chat`, { text: "a softer clear", model: "sonnet", rounds: [], refusals: [] });
    expect(sent.status).toBe(202);
    const { chat } = (await sent.json()) as { chat: string };
    await app.chat!.idle();
    return ChatStateSchema.parse(await (await send("GET", `/chats/${chat}`)).json());
  }
  /** A take as a turn left it before ADR 0062: its row in the table, its bytes in the bucket. */
  async function kept(kind: "sprite" | "sound", name: string, bytes: Buffer): Promise<string> {
    const hash = sha(bytes);
    store.objects.set(`takes/${hash}`, { bytes, contentType: kind === "sound" ? "audio/mpeg" : "image/webp" });
    await app.db.insert(schema.take).values({ hash, kind, puzzle: "cooling", name, bytes: bytes.length, prompt: "As it was asked for.", draftId: "gonedraft1", take: 1, author: "octo" });
    return hash;
  }

  it("serves a kept take, a sound or a picture, to anyone who has its hash, from any origin, for good", async () => {
    const sound = await kept("sound", "clear", mp3(1));
    const res = await fetch(`${base}/takes/${sound}`, { headers: { origin: "https://elsewhere.test" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(mp3(1))).toBe(true);
    const picture = await fetch(`${base}/takes/${await kept("sprite", "cog", frame(7))}`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/webp");
    expect((await fetch(`${base}/takes/${"0".repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${base}/takes/not-a-hash`)).status).toBe(404);
  });

  it("lists no take to anyone: the route is gone", async () => {
    expect((await send("GET", "/takes?puzzle=cooling")).status).toBe(404);
    expect((await fetch(`${base}/takes?puzzle=cooling`)).status).toBe(404);
    const me = (await (await send("GET", "/auth/me")).json()) as Record<string, unknown>;
    expect(me).not.toHaveProperty("takes");
    expect(me).not.toHaveProperty("picks");
  });

  it("keeps nothing a turn leaves behind: a sound or a picture under `.art/` is no take", async () => {
    draft = DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "cooling", numbers: { seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null } })).json());
    const rows = (await app.db.select().from(schema.take)).length;
    const objects = store.objects.size;
    const state = await turn((r) => {
      // Where the generation scripts once left their takes (ADR 0040). Nothing reads there now.
      put(r.cwd, ".art/sounds/cooling/clear/placed-1.mp3", mp3(2));
      put(r.cwd, ".art/sprites/cooling/cog/frame-1.webp", frame(3));
    });
    expect(state.items.at(-1)).toMatchObject({ kind: "turn", status: "done", commit: null });
    expect((await app.db.select().from(schema.take)).length).toBe(rows);
    expect(store.objects.size).toBe(objects);
    expect((await fetch(`${base}/takes/${sha(mp3(2))}`)).status).toBe(404);
  });

  it("leaves the kept takes where they are when a draft is discarded", async () => {
    const before = await app.db.select().from(schema.take);
    expect((await send("DELETE", `/drafts/${draft.id}`)).status).toBe(200);
    expect(await app.db.select().from(schema.take)).toEqual(before);
    expect((await fetch(`${base}/takes/${before[0]!.hash}`)).status).toBe(200);
  });
});

describeDb("a service with no bucket", () => {
  it("serves no take", async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_DEV_LOGIN: "Octo", LOG_LEVEL: "silent" });
    const app = await createApp(env, createLogger("silent", false), null);
    try {
      const base = `http://localhost:${await app.listen(0)}`;
      expect(app.takes).toBeNull();
      expect((await fetch(`${base}/takes/${"0".repeat(64)}`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
