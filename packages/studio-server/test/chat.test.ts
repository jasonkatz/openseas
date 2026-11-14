/**
 * The chat (ADR 0047), over HTTP against a real Postgres and a real `git`, with three stand-ins:
 * a bare repository for the remote, a recording forge for GitHub, and a scripted agent in place
 * of the Claude Agent SDK. The scripted agent is given what the real one is (a worktree, a
 * prompt, the model's address and a token, the host's rules) and does what a test tells it:
 * write files, ask to write, set numbers, and call the model through the service's own proxy, to
 * a stand-in for Anthropic's API that answers with usage. No model runs and no key is real.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChatStateSchema, DraftSchema, type ChatItem, type ChatState, type Draft, type DraftNumbers } from "@openseas/protocol";
import { createApp, type App } from "../src/app.js";
import type { AgentRunner, AgentTurn, TurnRequest } from "../src/chat/runner.js";
import { createDb, schema } from "../src/db/index.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/log.js";
import type { Forge } from "../src/save/forge.js";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const STUDIO = "http://localhost:5174";
const REAL_KEY = "sk-ant-the-real-key";
const FILE = "packages/content/data/puzzles/cooling.json";
const shipped = readFileSync(join(fileURLToPath(import.meta.url), "../../../content/data/puzzles/cooling.json"), "utf8");

/** What a scripted turn can do. */
interface Act {
  r: TurnRequest;
  write(path: string, text: string): void;
  /** Ask the model, as the agent's process would: through the proxy, with the turn's token. The status the proxy answered. */
  model(token?: string): Promise<number>;
  /** Wait until the turn is steered or stopped. */
  next(): Promise<{ steer: string } | { stopped: true }>;
  stopped(): boolean;
}
type Script = (a: Act) => Promise<void>;

describeDb("chat", () => {
  let app: App;
  let base: string;
  let session = "";
  let upstream: Server;
  const tmp = mkdtempSync(join(tmpdir(), "studio-chat-"));
  const origin = join(tmp, "origin.git");
  const volume = join(tmp, "volume");
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

  /** What the stand-in for Anthropic's API was sent, and what each answer says it used. */
  const api = { keys: [] as string[], models: [] as string[], usage: { input_tokens: 100_000, output_tokens: 20_000 } };
  /** The turns the scripted agent was asked to run, and the script for the next. */
  const agent = { requests: [] as TurnRequest[], script: (async () => undefined) as Script };

  const runner: AgentRunner = {
    start(r): AgentTurn {
      agent.requests.push(r);
      let stopped = false;
      let wake: ((v: { steer: string } | { stopped: true }) => void) | null = null;
      const steers: string[] = [];
      const act: Act = {
        r,
        write: (path, text) => {
          mkdirSync(dirname(join(r.cwd, path)), { recursive: true });
          writeFileSync(join(r.cwd, path), text);
        },
        model: async (token = r.modelToken) => (await fetch(`${r.modelUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": token, "content-type": "application/json" }, body: JSON.stringify({ model: r.model, messages: [] }) })).status,
        next: () => (stopped ? Promise.resolve({ stopped: true }) : steers.length ? Promise.resolve({ steer: steers.shift()! }) : new Promise((resolve) => (wake = resolve))),
        stopped: () => stopped,
      };
      r.host.emit({ kind: "session", id: `session-of-${r.puzzle}` });
      const done = agent.script(act).then(
        () => ({ status: "done" as const }),
        (err: unknown) => ({ status: "failed" as const, error: String(err) }),
      );
      return {
        done,
        steer: (text) => (wake ? (wake({ steer: text }), (wake = null)) : void steers.push(text)),
        stop: () => {
          stopped = true;
          wake?.({ stopped: true });
        },
      };
    },
  };

  const forge: Forge = {
    token: async () => "unused",
    openPull: async () => ({ number: 7, url: "https://github.test/pull/7" }),
    pullState: async () => "open",
    describePull: async () => undefined,
    closePull: async () => undefined,
  };

  beforeAll(async () => {
    const seed = join(tmp, "seed");
    git(tmp, "init", "--quiet", "--bare", "-b", "main", origin);
    git(tmp, "clone", "--quiet", origin, seed);
    for (const [path, text] of [[FILE, shipped], ["docs/puzzles/cooling.md", "# Cooling\n"], ["docs/DESIGN.md", "# Design\n"], ["packages/engine/src/cooling/reduce.ts", "export const rule = 1;\n"]] as const) {
      mkdirSync(dirname(join(seed, path)), { recursive: true });
      writeFileSync(join(seed, path), text);
    }
    git(seed, "checkout", "--quiet", "-b", "main");
    git(seed, "add", "--all");
    git(seed, "commit", "--quiet", "-m", "content");
    git(seed, "push", "--quiet", "origin", "main");

    upstream = createServer((req, res) => {
      api.keys.push(String(req.headers["x-api-key"]));
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        api.models.push((JSON.parse(body) as { model: string }).model);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "message", content: [], usage: api.usage }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));

    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: url!,
      STUDIO_SECRET: "test-secret-test-secret",
      STUDIO_ORIGINS: STUDIO,
      STUDIO_DEV_LOGIN: "Octo",
      STUDIO_REPO_DIR: volume,
      STUDIO_REPO: "octo/openseas",
      STUDIO_REPO_URL: origin,
      ANTHROPIC_API_KEY: REAL_KEY,
      STUDIO_MODEL_UPSTREAM: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      // Sonnet at 100k in and 20k out is forty cents a call: the third call reaches a dollar.
      STUDIO_SPEND_CAP_USD: "1",
      LOG_LEVEL: "silent",
    });
    app = await createApp(env, createLogger("silent", false), null, forge, runner);
    await app.db.delete(schema.draft);
    await app.db.delete(schema.meter);
    base = `http://localhost:${await app.listen(0)}`;
    const dev = await fetch(`${base}/auth/dev`, { redirect: "manual" });
    session = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
  });
  let closed = false;
  afterAll(async () => {
    if (!closed) await app?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(tmp, { recursive: true, force: true });
  });

  const numbers = (over: Partial<DraftNumbers> = {}): DraftNumbers => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, ...over });
  const send = (method: string, path: string, body?: unknown): Promise<Response> => fetch(`${base}${path}`, { method, headers: { origin: STUDIO, cookie: session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const open = async (n: DraftNumbers): Promise<Draft> => DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "cooling", numbers: n })).json());
  const state = async (d: Draft, after = 0): Promise<ChatState> => ChatStateSchema.parse(await (await send("GET", `/drafts/${d.id}/chat?after=${after}`)).json());
  const say = (d: Draft, text: string, over: object = {}): Promise<Response> => send("POST", `/drafts/${d.id}/chat`, { text, model: "sonnet", rounds: [], refusals: [], ...over });
  /** Send a message and wait for the turn it starts to end. */
  async function turn(d: Draft, text: string, script: Script, over: object = {}): Promise<ChatState> {
    agent.script = script;
    expect((await say(d, text, over)).status).toBe(202);
    await app.chat!.idle();
    return state(d);
  }
  const kinds = (s: ChatState): string[] => s.items.map((i) => i.kind);
  const last = <K extends ChatItem["kind"]>(s: ChatState, kind: K): Extract<ChatItem, { kind: K }> => s.items.filter((i): i is Extract<ChatItem, { kind: K }> => i.kind === kind).at(-1)!;
  const tree = (d: Draft): string => join(volume, "worktrees", d.id);
  const log = (d: Draft): string[] => git(tree(d), "log", "--format=%s").split("\n");
  let draft: Draft;

  it("says it has a chat", async () => {
    expect(await (await fetch(`${base}/auth/me`)).json()).toMatchObject({ chat: true, save: true });
  });

  it("runs a turn on the draft's own worktree, shows what the agent said and did, and commits its edits", async () => {
    draft = await open(numbers({ seed: "keg-3", overrides: { pieceKinds: 5 } }));
    const s = await turn(
      draft,
      "Make slag rarer and say why in the design file.",
      async (a) => {
        a.r.host.emit({ kind: "reply", text: "I'll change the design file." });
        a.r.host.emit({ kind: "step", id: "t1", tool: "Edit", summary: "docs/puzzles/cooling.md" });
        expect(a.r.host.mayWrite(join(a.r.cwd, "docs/puzzles/cooling.md"))).toBe(true);
        a.write("docs/puzzles/cooling.md", "# Cooling\n\nSlag is rarer now.\n");
        a.r.host.emit({ kind: "stepDone", id: "t1", detail: "+Slag is rarer now.", failed: false });
        expect(await a.model()).toBe(200);
        a.r.host.emit({ kind: "reply", text: "Done. This is a file edit: Save and look at the pull request's preview." });
      },
      { model: "haiku", rounds: [{ seed: "a1", score: 420, tier: "able", seconds: 150, moves: 61, tuned: true }], refusals: ["config.width: too small"] },
    );
    expect(kinds(s)).toEqual(["user", "reply", "step", "reply", "turn"]);
    expect(s.items[0]).toMatchObject({ kind: "user", text: "Make slag rarer and say why in the design file.", model: "haiku", steer: false, turn: 1 });
    expect(s.items[2]).toMatchObject({ kind: "step", tool: "Edit", summary: "docs/puzzles/cooling.md", detail: "+Slag is rarer now.", failed: false });
    expect(s.running).toBe(false);

    // What the agent was given: the worktree, the model picked, and the page's knowledge under the owner's words.
    const r = agent.requests.at(-1)!;
    expect(r).toMatchObject({ cwd: tree(draft), puzzle: "cooling", model: "claude-haiku-5-5", session: null });
    expect(r.prompt).toContain("Make slag rarer");
    expect(r.prompt).toContain('"config":{"pieceKinds":5}');
    expect(r.prompt).toContain("Pinned seed: keg-3");
    expect(r.prompt).toContain("config.width: too small");
    expect(r.prompt).toContain("seed a1: score 420, tier able");

    // The turn is one commit on the draft's branch, by the studio.
    const ended = last(s, "turn");
    expect(ended).toMatchObject({ status: "done", reverted: false });
    expect(ended.commit).toBe(git(tree(draft), "rev-parse", "HEAD"));
    expect(log(draft)).toEqual(["Chat turn 1 on cooling", "content"]);
    expect(git(tree(draft), "rev-parse", "--abbrev-ref", "HEAD")).toBe(`studio/cooling-${draft.id}`);
    expect(git(tree(draft), "status", "--porcelain")).toBe("");

    // The model was paid for with the real key, which the agent never held, and the turn's cost is the draft's and the meter's.
    expect(api.keys).toEqual([REAL_KEY]);
    expect(r.modelToken).not.toContain(REAL_KEY);
    expect(api.models).toEqual(["claude-haiku-5-5"]);
    expect(ended.costUsd).toBeCloseTo(0.02, 6);
    expect(s.spentUsd).toBeCloseTo(0.02, 6);
    expect(s.cap).toEqual({ spentUsd: expect.closeTo(0.02, 6) as number, capUsd: 1 });
  });

  it("resumes the session on the next turn, and reads only what is new", async () => {
    const before = await state(draft);
    const s = await turn(draft, "And thanks.", async (a) => a.r.host.emit({ kind: "reply", text: "Any time." }));
    expect(agent.requests.at(-1)!.session).toBe("session-of-cooling");
    const fresh = await state(draft, before.items.at(-1)!.id);
    expect(kinds(fresh)).toEqual(["user", "reply", "turn"]);
    // A turn that edits nothing commits nothing.
    expect(last(s, "turn")).toMatchObject({ status: "done", commit: null, turn: 2 });
    expect(log(draft)).toHaveLength(2);
  });

  it("moves the draft's numbers through the agent's tool, and never the content file", async () => {
    const s = await turn(draft, "Make it harder.", async (a) => {
      expect(await a.r.host.numbers()).toMatchObject({ overrides: { pieceKinds: 5 } });
      expect(await a.r.host.setNumbers({ "config.pieceKinds": 6, roundSeconds: 120 }, [])).toContain("Set.");
      expect(await a.r.host.setNumbers({ seed: "nope" }, [])).toContain("Not set");
      expect(await a.r.host.setNumbers({ "config.heatRisePerMoves": 4 }, ["roundSeconds"])).toContain('"heatRisePerMoves":4');
    });
    expect(s.draft.numbers).toEqual(numbers({ seed: "keg-3", overrides: { pieceKinds: 6, heatRisePerMoves: 4 } }));
    expect(s.draft.revision).toBe(draft.revision + 2);
    expect(readFileSync(join(tree(draft), FILE), "utf8")).toBe(shipped);
    expect(last(s, "turn").commit).toBeNull();
    draft = s.draft;
  });

  it("refuses a write outside the puzzle's files, puts back what a command wrote there, and asks the owner", async () => {
    const s = await turn(draft, "Tidy things up.", async (a) => {
      // Asked first, as the write tools are: refused, and the owner is asked.
      expect(a.r.host.mayWrite("docs/DESIGN.md")).toBe(false);
      expect(a.r.host.mayWrite("/etc/passwd")).toBe(false);
      expect(a.r.host.mayWrite("../../repo/.git/config")).toBe(false);
      // Not asked, as a shell command is not: written anyway, in and out of scope, tracked and new.
      a.write("packages/engine/src/cooling/reduce.ts", "export const rule = 2;\n");
      a.write("docs/DESIGN.md", "# Design\n\nRewritten by a command.\n");
      a.write("packages/engine/src/engines/sneak.ts", "export {};\n");
    });
    // The puzzle's own file is committed; the two others are as they were, and each is a question.
    expect(readFileSync(join(tree(draft), "packages/engine/src/cooling/reduce.ts"), "utf8")).toContain("rule = 2");
    expect(readFileSync(join(tree(draft), "docs/DESIGN.md"), "utf8")).toBe("# Design\n");
    expect(existsSync(join(tree(draft), "packages/engine/src/engines/sneak.ts"))).toBe(false);
    expect(git(tree(draft), "show", "--stat", "--format=", "HEAD")).toContain("reduce.ts");
    expect(git(tree(draft), "show", "--stat", "--format=", "HEAD")).not.toContain("DESIGN");
    const asks = s.items.filter((i) => i.kind === "ask" && i.turn === 4);
    // A path outside the worktree is refused and is nobody's to allow: the owner is not asked about it.
    expect(asks.map((i) => (i.kind === "ask" ? [i.path, i.state] : null)).sort()).toEqual([["docs/DESIGN.md", "pending"], ["packages/engine/src/engines/sneak.ts", "pending"]]);
    // One question a path a turn, however often it was tried.
    expect(asks.filter((i) => i.kind === "ask" && i.path === "docs/DESIGN.md")).toHaveLength(1);
  });

  it("lets the owner allow a path for the draft, in the chat, and the agent may then write it", async () => {
    const before = await state(draft);
    const ask = before.items.find((i) => i.kind === "ask" && i.path === "docs/DESIGN.md")!;
    const no = before.items.find((i) => i.kind === "ask" && i.path === "packages/engine/src/engines/sneak.ts")!;
    expect((await send("POST", `/drafts/${draft.id}/chat/allow`, { item: no.id, allow: false })).status).toBe(200);
    expect((await send("POST", `/drafts/${draft.id}/chat/allow`, { item: ask.id, allow: true })).status).toBe(200);
    // Answered once.
    expect((await send("POST", `/drafts/${draft.id}/chat/allow`, { item: ask.id, allow: true })).status).toBe(404);
    expect((await send("POST", `/drafts/${draft.id}/chat/allow`, { item: 999999, allow: true })).status).toBe(404);

    const s = await turn(draft, "Go on then.", async (a) => {
      expect(a.r.prompt).toContain("docs/DESIGN.md");
      expect(a.r.host.mayWrite("docs/DESIGN.md")).toBe(true);
      expect(a.r.host.mayWrite("docs/GLOSSARY.md")).toBe(false);
      a.write("docs/DESIGN.md", "# Design\n\nA row for cooling.\n");
    });
    expect(git(tree(draft), "show", "--stat", "--format=", "HEAD")).toContain("docs/DESIGN.md");
    expect(s.items.filter((i) => i.kind === "ask").map((i) => (i.kind === "ask" ? i.state : ""))).toEqual(expect.arrayContaining(["allowed", "refused"]));
  });

  it("steers the running turn with a message sent meanwhile, and stops it where it stands", async () => {
    let heard = "";
    agent.script = async (a) => {
      a.write("docs/puzzles/cooling.md", "# Cooling\n\nHalf a thought.\n");
      const n = await a.next();
      heard = "steer" in n ? n.steer : "";
      await a.next();
    };
    expect((await say(draft, "Rewrite the design file.")).status).toBe(202);
    expect((await state(draft)).running).toBe(true);
    // A second message does not start a second turn.
    const turns = agent.requests.length;
    expect((await say(draft, "Shorter than that.", { refusals: ["config.height: too tall"] })).status).toBe(202);
    await expect.poll(() => heard).toContain("Shorter than that.");
    expect(heard).toContain("config.height: too tall");
    expect(agent.requests).toHaveLength(turns);
    // Nothing else may write the branch while it runs, and the draft cannot be discarded under it.
    expect((await send("POST", `/drafts/${draft.id}/save`, { revision: draft.revision, name: "x" })).status).toBe(409);
    expect((await send("DELETE", `/drafts/${draft.id}`)).status).toBe(409);
    expect((await send("POST", `/drafts/${draft.id}/chat/revert`, { turn: 1 })).status).toBe(409);

    expect((await send("POST", `/drafts/${draft.id}/chat/stop`)).status).toBe(202);
    await app.chat!.idle();
    const s = await state(draft);
    expect(s.running).toBe(false);
    expect(s.items.filter((i) => i.kind === "user").at(-1)).toMatchObject({ text: "Shorter than that.", steer: true, turn: 6 });
    // Stopped, and what it had written is a commit all the same, so it can be undone.
    const ended = last(s, "turn");
    expect(ended).toMatchObject({ status: "stopped", turn: 6 });
    expect(ended.commit).not.toBeNull();
  });

  it("reverts one turn's edits with a new commit, once", async () => {
    expect(readFileSync(join(tree(draft), "docs/puzzles/cooling.md"), "utf8")).toContain("Half a thought");
    const head = git(tree(draft), "rev-parse", "HEAD");
    expect((await send("POST", `/drafts/${draft.id}/chat/revert`, { turn: 6 })).status).toBe(200);
    expect(readFileSync(join(tree(draft), "docs/puzzles/cooling.md"), "utf8")).toBe("# Cooling\n\nSlag is rarer now.\n");
    // A new commit over the old ones: nothing is rewritten.
    expect(git(tree(draft), "rev-parse", "HEAD~1")).toBe(head);
    expect(log(draft)[0]).toBe("Revert chat turn 6 on cooling");
    expect(last(await state(draft), "turn")).toMatchObject({ turn: 6, reverted: true });
    expect((await send("POST", `/drafts/${draft.id}/chat/revert`, { turn: 6 })).status).toBe(409);
    // A turn that edited nothing has nothing to revert.
    expect((await send("POST", `/drafts/${draft.id}/chat/revert`, { turn: 2 })).status).toBe(409);
    expect((await send("POST", `/drafts/${draft.id}/chat/revert`, { turn: 0 })).status).toBe(400);
  });

  it("gives Save the chat's commits to push, on the same branch and pull request", async () => {
    const started = await send("POST", `/drafts/${draft.id}/save`, { revision: draft.revision, name: "After the chat" });
    expect(started.status).toBe(202);
    await app.saver!.idle();
    const branch = `studio/cooling-${draft.id}`;
    const pushed = git(origin, "log", "--format=%s", branch).split("\n");
    expect(pushed).toEqual(expect.arrayContaining(["Tune cooling from the studio", "Revert chat turn 6 on cooling", "Chat turn 1 on cooling"]));
    expect(git(origin, "show", `${branch}:docs/puzzles/cooling.md`)).toContain("Slag is rarer now.");
    expect(git(origin, "show", `${branch}:${FILE}`)).toContain('"pieceKinds": 6');
  });

  it("holds every turn to one cap, and stops the turn that reaches it where it stands", async () => {
    const before = (await state(draft)).cap.spentUsd;
    const statuses: number[] = [];
    let wroteAfter = false;
    const s = await turn(draft, "Think hard.", async (a) => {
      a.write("docs/puzzles/cooling.md", "# Cooling\n\nBefore the cap.\n");
      // A token that is not this turn's opens nothing.
      expect(await a.model("studio-turn-forged")).toBe(401);
      for (let i = 0; i < 6 && !a.stopped(); i++) statuses.push(await a.model());
      // A real agent's process is killed here; this one checks, and a request made anyway is refused.
      statuses.push(await a.model());
      wroteAfter = !a.stopped();
    });
    // Forty cents a call against a dollar: the third call reaches it, the turn is stopped, and nothing more is let through.
    expect(statuses).toEqual([200, 200, 200, 403]);
    expect(wroteAfter).toBe(false);
    const ended = last(s, "turn");
    expect(ended).toMatchObject({ status: "capped" });
    expect(ended.costUsd).toBeCloseTo(1.2, 6);
    expect(ended.commit).not.toBeNull();
    expect(s.cap.spentUsd).toBeCloseTo(before + 1.2, 6);
    expect(s.cap.spentUsd).toBeGreaterThanOrEqual(s.cap.capUsd);
    expect(api.keys.every((k) => k === REAL_KEY)).toBe(true);

    // The cap is all drafts together: no draft starts a turn past it.
    const asked = agent.requests.length;
    const refused = await say(draft, "One more?");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "capped" });
    const other = DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "engines", numbers: numbers() })).json());
    expect((await say(other, "Hello?")).status).toBe(409);
    expect(agent.requests).toHaveLength(asked);
    // Each draft still shows what it has spent.
    expect((await state(other)).spentUsd).toBe(0);
    expect((await state(draft)).spentUsd).toBeCloseTo(before + 1.2, 6);
    await send("DELETE", `/drafts/${other.id}`);
  });

  it("is the owner's alone, from the studio's pages, and takes a draft's chat with the draft", async () => {
    expect((await fetch(`${base}/drafts/${draft.id}/chat`)).status).toBe(401);
    expect((await fetch(`${base}/drafts/${draft.id}/chat`, { method: "POST", headers: { cookie: session }, body: "{}" })).status).toBe(403);
    expect((await send("POST", `/drafts/${draft.id}/chat`, { text: "", model: "sonnet", rounds: [], refusals: [] })).status).toBe(400);
    expect((await send("POST", `/drafts/${draft.id}/chat`, { text: "x", model: "gpt", rounds: [], refusals: [] })).status).toBe(400);
    expect((await send("GET", "/drafts/abcdefghij/chat")).status).toBe(404);
    expect((await send("DELETE", `/drafts/${draft.id}`)).status).toBe(200);
    expect(await app.db.select().from(schema.chatItem)).toEqual([]);
    // What was spent stays spent.
    const [meter] = await app.db.select().from(schema.meter);
    expect(meter!.spentUsd).toBeGreaterThanOrEqual(1);
  });

  // Last: it closes the service. A redeploy must not wait out a turn (ADR 0048).
  it("stops a running turn where it stands when the service shuts down, and records it", async () => {
    await app.db.delete(schema.meter);
    const d = await open(numbers());
    agent.script = async (a) => {
      a.write("docs/puzzles/cooling.md", "# Cooling\n\nCut off by a redeploy.\n");
      while (!("stopped" in (await a.next())));
    };
    expect((await say(d, "Rewrite the design file.")).status).toBe(202);
    await expect.poll(async () => (await state(d)).running).toBe(true);
    closed = true;
    await app.close();
    const { db, close } = createDb(url!);
    try {
      const rows = await db.select().from(schema.chatItem);
      const ended = rows.find((r) => r.draftId === d.id && r.kind === "turn");
      expect(ended?.data).toMatchObject({ status: "stopped" });
      expect(ended?.data.commit).toBe(git(tree(d), "rev-parse", "HEAD"));
    } finally {
      await close();
    }
  });
});

describeDb("a service with no model key or no cap", () => {
  it("keeps Save and says it has no chat", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "studio-nochat-"));
    const forge: Forge = { token: async () => "x", openPull: async () => ({ number: 1, url: "https://github.test/pull/1" }), pullState: async () => "open", describePull: async () => undefined, closePull: async () => undefined };
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url!, STUDIO_SECRET: "test-secret-test-secret", STUDIO_ORIGINS: STUDIO, STUDIO_DEV_LOGIN: "Octo", STUDIO_REPO_DIR: tmp, STUDIO_REPO: "octo/openseas", STUDIO_REPO_URL: join(tmp, "nowhere.git"), ANTHROPIC_API_KEY: REAL_KEY, LOG_LEVEL: "silent" });
    const app = await createApp(env, createLogger("silent", false), null, forge);
    try {
      expect(app.chat).toBeNull();
      const base = `http://localhost:${await app.listen(0)}`;
      const dev = await fetch(`${base}/auth/dev`, { redirect: "manual" });
      const session = dev.headers.getSetCookie().find((c) => c.startsWith("studio_session="))!.split(";")[0]!;
      expect(await (await fetch(`${base}/auth/me`)).json()).toMatchObject({ save: true, chat: false });
      await app.db.delete(schema.draft);
      const made = await fetch(`${base}/drafts`, { method: "POST", headers: { origin: STUDIO, cookie: session }, body: JSON.stringify({ puzzle: "cooling", numbers: { seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null } }) });
      const draft = DraftSchema.parse(await made.json());
      expect((await fetch(`${base}/drafts/${draft.id}/chat`, { headers: { cookie: session } })).status).toBe(503);
      expect((await fetch(`${base}/drafts/${draft.id}/chat`, { method: "POST", headers: { origin: STUDIO, cookie: session }, body: JSON.stringify({ text: "hi", model: "sonnet", rounds: [], refusals: [] }) })).status).toBe(503);
      await fetch(`${base}/drafts/${draft.id}`, { method: "DELETE", headers: { origin: STUDIO, cookie: session } });
    } finally {
      await app.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
