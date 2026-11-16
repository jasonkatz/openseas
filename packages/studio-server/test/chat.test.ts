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
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChatEventSchema, ChatListSchema, ChatSentSchema, ChatStateSchema, ChatSummarySchema, DraftSchema, type ChatEvent, type ChatItem, type ChatState, type Draft, type DraftNumbers } from "@openseas/protocol";
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

  /** What the stand-in GitHub was asked to open or describe. */
  const pulls = [] as Array<{ title: string; body: string }>;
  const forge: Forge = {
    token: async () => "unused",
    openPull: async (o) => {
      pulls.push({ title: o.title, body: o.body });
      return { number: 7 + pulls.length, url: `https://github.test/pull/${7 + pulls.length}` };
    },
    pullState: async () => "open",
    describePull: async (_n, title, body) => void pulls.push({ title, body }),
    closePull: async () => undefined,
  };

  beforeAll(async () => {
    const seed = join(tmp, "seed");
    git(tmp, "init", "--quiet", "--bare", "-b", "main", origin);
    git(tmp, "clone", "--quiet", origin, seed);
    for (const [path, text] of [[FILE, shipped], ["packages/content/data/puzzles/engines.json", readFileSync(join(fileURLToPath(import.meta.url), "../../../content/data/puzzles/engines.json"), "utf8")], ["docs/puzzles/cooling.md", "# Cooling\n"], ["docs/DESIGN.md", "# Design\n"], ["packages/engine/src/cooling/reduce.ts", "export const rule = 1;\n"]] as const) {
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
    await app.db.delete(schema.chat);
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

  const numbers = (over: Partial<DraftNumbers> = {}): DraftNumbers => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: {}, sounds: {} }, words: { texts: {}, category: null }, ...over });
  const send = (method: string, path: string, body?: unknown): Promise<Response> => fetch(`${base}${path}`, { method, headers: { origin: STUDIO, cookie: session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const open = async (n: DraftNumbers): Promise<Draft> => DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "cooling", numbers: n })).json());
  /** The chat each draft's tests talk in (ADR 0060): the first message to a draft starts one, and the ones after go to it. */
  const chats = new Map<string, string>();
  const chatOf = (d: Draft): string => {
    const id = chats.get(d.id);
    if (!id) throw new Error(`no chat yet on ${d.id}`);
    return id;
  };
  const state = async (d: Draft | string, after = 0): Promise<ChatState> => ChatStateSchema.parse(await (await send("GET", `/chats/${typeof d === "string" ? d : chatOf(d)}?after=${after}`)).json());
  const say = async (d: Draft, text: string, over: object = {}): Promise<Response> => {
    const r = await send("POST", `/drafts/${d.id}/chat`, { chat: chats.get(d.id) ?? null, text, model: "sonnet", rounds: [], refusals: [], ...over });
    if (r.status === 202) chats.set(d.id, ChatSentSchema.parse(await r.clone().json()).chat);
    return r;
  };
  /** Send a message and wait for the turn it starts to end. */
  async function turn(d: Draft, text: string, script: Script, over: object = {}): Promise<ChatState> {
    agent.script = script;
    expect((await say(d, text, over)).status).toBe(202);
    await app.chat!.idle();
    return state(d);
  }
  /** A draft's event stream (ADR 0055), as a page reads it: every event so far, and a wait for one that is not here yet. */
  async function watch(d: Draft | string): Promise<{ seen: ChatEvent[]; until(enough: (seen: ChatEvent[]) => boolean): Promise<void>; close(): void }> {
    const stop = new AbortController();
    const r = await fetch(`${base}/chats/${typeof d === "string" ? d : chatOf(d)}/events`, { headers: { origin: STUDIO, cookie: session }, signal: stop.signal });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const seen: ChatEvent[] = [];
    void (async () => {
      let text = "";
      const decoder = new TextDecoder();
      try {
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          text += decoder.decode(chunk, { stream: true });
          for (let at = text.indexOf("\n\n"); at >= 0; at = text.indexOf("\n\n")) {
            const block = text.slice(0, at);
            text = text.slice(at + 2);
            if (block.startsWith("data: ")) seen.push(ChatEventSchema.parse(JSON.parse(block.slice(6))));
          }
        }
      } catch {
        /* closed by the test */
      }
    })();
    return { seen, until: (enough) => expect.poll(() => enough(seen), { timeout: 10_000 }).toBe(true), close: () => stop.abort() };
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
    expect(s.chat.running).toBe(false);

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
    expect(s.chat.spentUsd).toBeCloseTo(0.02, 6);
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
    expect(s.draft!.numbers).toEqual(numbers({ seed: "keg-3", overrides: { pieceKinds: 6, heatRisePerMoves: 4 } }));
    expect(s.draft!.revision).toBe(draft.revision + 2);
    expect(readFileSync(join(tree(draft), FILE), "utf8")).toBe(shipped);
    expect(last(s, "turn").commit).toBeNull();
    draft = s.draft!;
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
    expect((await send("POST", `/chats/${chatOf(draft)}/allow`, { item: no.id, allow: false })).status).toBe(200);
    expect((await send("POST", `/chats/${chatOf(draft)}/allow`, { item: ask.id, allow: true })).status).toBe(200);
    // Answered once.
    expect((await send("POST", `/chats/${chatOf(draft)}/allow`, { item: ask.id, allow: true })).status).toBe(404);
    expect((await send("POST", `/chats/${chatOf(draft)}/allow`, { item: 999999, allow: true })).status).toBe(404);

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
    expect((await state(draft)).chat.running).toBe(true);
    // A second message does not start a second turn.
    const turns = agent.requests.length;
    expect((await say(draft, "Shorter than that.", { refusals: ["config.height: too tall"] })).status).toBe(202);
    await expect.poll(() => heard).toContain("Shorter than that.");
    expect(heard).toContain("config.height: too tall");
    expect(agent.requests).toHaveLength(turns);
    // Nothing else may write the branch while it runs, and the draft cannot be discarded under it.
    expect((await send("POST", `/drafts/${draft.id}/save`, { revision: draft.revision, name: "x" })).status).toBe(409);
    expect((await send("DELETE", `/drafts/${draft.id}`)).status).toBe(409);
    expect((await send("POST", `/chats/${chatOf(draft)}/revert`, { turn: 1 })).status).toBe(409);

    expect((await send("POST", `/chats/${chatOf(draft)}/stop`)).status).toBe(202);
    await app.chat!.idle();
    const s = await state(draft);
    expect(s.chat.running).toBe(false);
    expect(s.items.filter((i) => i.kind === "user").at(-1)).toMatchObject({ text: "Shorter than that.", steer: true, turn: 6 });
    // Stopped, and what it had written is a commit all the same, so it can be undone.
    const ended = last(s, "turn");
    expect(ended).toMatchObject({ status: "stopped", turn: 6 });
    expect(ended.commit).not.toBeNull();
  });

  it("reverts one turn's edits with a new commit, once", async () => {
    expect(readFileSync(join(tree(draft), "docs/puzzles/cooling.md"), "utf8")).toContain("Half a thought");
    const head = git(tree(draft), "rev-parse", "HEAD");
    expect((await send("POST", `/chats/${chatOf(draft)}/revert`, { turn: 6 })).status).toBe(200);
    expect(readFileSync(join(tree(draft), "docs/puzzles/cooling.md"), "utf8")).toBe("# Cooling\n\nSlag is rarer now.\n");
    // A new commit over the old ones: nothing is rewritten.
    expect(git(tree(draft), "rev-parse", "HEAD~1")).toBe(head);
    expect(log(draft)[0]).toBe("Revert chat turn 6 on cooling");
    expect(last(await state(draft), "turn")).toMatchObject({ turn: 6, reverted: true });
    expect((await send("POST", `/chats/${chatOf(draft)}/revert`, { turn: 6 })).status).toBe(409);
    // A turn that edited nothing has nothing to revert.
    expect((await send("POST", `/chats/${chatOf(draft)}/revert`, { turn: 2 })).status).toBe(409);
    expect((await send("POST", `/chats/${chatOf(draft)}/revert`, { turn: 0 })).status).toBe(400);
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
    // The pull request says what it holds: the numbers, and the files the agent edited.
    const pull = pulls.at(-1)!;
    expect(pull.title).toBe("Change cooling from the studio");
    expect(pull.body).toContain("| `config.pieceKinds` | `7` | `6` |");
    expect(pull.body).toContain("Files edited by the studio's agent");
    expect(pull.body).toContain("- `docs/puzzles/cooling.md`");
    expect(pull.body).toContain("- `packages/engine/src/cooling/reduce.ts`");
    expect(pull.body).not.toContain(`- \`${FILE}\``);
    expect(pull.body).toContain("for a developer to finish");
  });

  it("saves a draft the agent edited though no number differs", async () => {
    const plain = DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "engines", numbers: numbers() })).json());
    expect(plain.save.edits).toBe(false);
    // A turn that only talks leaves nothing to save.
    const talked = await turn(plain, "What does this puzzle pay most for?", async (a) => a.r.host.emit({ kind: "reply", text: "The compound move." }));
    expect(talked.draft!.save.edits).toBe(false);
    const refused = await send("POST", `/drafts/${plain.id}/save`, { revision: plain.revision, name: "Nothing yet" });
    expect(refused.status).toBe(202);
    await app.saver!.idle();
    expect((await state(plain)).draft!.save).toMatchObject({ state: "failed", error: "nothing", pull: null });

    // A turn that edits a file does, with every number as shipped.
    const edited = await turn(plain, "Note the rule in the design file.", async (a) => a.write("docs/puzzles/engines.md", "# Engines\n\nA rule, noted.\n"));
    expect(edited.draft!.save.edits).toBe(true);
    expect(edited.draft!.numbers).toEqual(numbers());
    expect((await send("POST", `/drafts/${plain.id}/save`, { revision: plain.revision, name: "Just the edit" })).status).toBe(202);
    await app.saver!.idle();
    const saved = (await state(plain)).draft!.save;
    expect(saved).toMatchObject({ state: "idle", error: null });
    expect(saved.pull).not.toBeNull();
    const branch = `studio/engines-${plain.id}`;
    expect(git(origin, "log", "--format=%s", branch).split("\n")).toEqual(["Chat turn 2 on engines", "content"]);
    expect(git(origin, "show", `${branch}:docs/puzzles/engines.md`)).toContain("A rule, noted.");
    const pull = pulls.at(-1)!;
    expect(pull.title).toBe("Change engines from the studio");
    expect(pull.body).toContain("No number differs from the base branch.");
    expect(pull.body).toContain("- `docs/puzzles/engines.md`");
    await send("DELETE", `/drafts/${plain.id}`);
  });

  it("tells a watching page each thing as it happens, and the whole chat on every connection", async () => {
    const before = await state(draft);
    const w = await watch(draft);
    await w.until((seen) => seen.length > 0);
    expect(w.seen[0]).toEqual({ type: "state", state: before });
    expect(before.live).toBe("");

    agent.script = async (a) => {
      a.r.host.emit({ kind: "delta", text: "", reset: true });
      a.r.host.emit({ kind: "delta", text: "Slag is ", reset: false });
      a.r.host.emit({ kind: "delta", text: "rare.", reset: false });
      // Held mid-reply until the owner says something.
      await a.next();
      a.r.host.emit({ kind: "reply", text: "Slag is rare." });
      a.r.host.emit({ kind: "step", id: "s1", tool: "Bash", summary: "pnpm test" });
      a.r.host.emit({ kind: "stepDone", id: "s1", detail: "passed", failed: false });
      a.write("docs/puzzles/cooling.md", "# Cooling\n\nSlag is rare.\n");
      expect(await a.r.host.setNumbers({ "config.pieceKinds": 6 }, [])).toContain("Set.");
    };
    expect((await say(draft, "How rare is slag?")).status).toBe(202);
    const words = (seen: ChatEvent[]): string => seen.reduce((text, e) => (e.type === "delta" ? (e.reset ? e.text : text + e.text) : text), "");
    await w.until((seen) => words(seen) === "Slag is rare.");
    // The words are no row yet, and a page that opens now is given them all the same.
    expect(kinds(await state(draft)).slice(before.items.length)).toEqual(["user"]);
    const late = await watch(draft);
    await late.until((seen) => seen.length > 0);
    expect(late.seen[0]).toMatchObject({ type: "state", state: { chat: { running: true }, live: "Slag is rare." } });
    expect((await state(draft)).live).toBe("Slag is rare.");
    late.close();

    expect((await say(draft, "Go on.")).status).toBe(202);
    await app.chat!.idle();
    await w.until((seen) => seen.some((e) => e.type === "item" && e.item.kind === "turn"));
    await w.until((seen) => seen.at(-1)?.type === "status");
    const told = w.seen.slice(1);
    // Each line once as it is made, the step again with its outcome, and the turn's end.
    const lines = told.flatMap((e) => (e.type === "item" ? [e.item] : []));
    expect(lines.map((i) => i.kind)).toEqual(["user", "user", "reply", "step", "step", "turn"]);
    expect(lines[3]).toMatchObject({ kind: "step", detail: null });
    expect(lines[4]).toMatchObject({ kind: "step", id: lines[3]!.id, detail: "passed", failed: false });
    expect(lines).toEqual((await state(draft)).items.slice(before.items.length).flatMap((i): ChatItem[] => (i.kind === "step" ? [{ ...i, detail: null }, i] : [i])));
    // The whole reply takes the place of the words so far: they are forgotten right after its line.
    const reply = told.findIndex((e) => e.type === "item" && e.item.kind === "reply");
    expect(told[reply + 1]).toEqual({ type: "delta", text: "", reset: true });
    expect(words(w.seen)).toBe("");
    // The page is told a turn runs, that the number moved while it ran, and that it ended.
    const statuses = told.flatMap((e) => (e.type === "status" ? [e.status] : []));
    expect(statuses[0]).toMatchObject({ chat: { running: true } });
    expect(statuses.some((x) => x.chat.running && x.draft?.numbers.overrides.pieceKinds === 6)).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ chat: { running: false }, draft: { numbers: { overrides: { pieceKinds: 6 } } } });
    expect((await state(draft)).live).toBe("");

    // An answer or a revert changes a line: the watching page is told the line as it now is.
    const ended = last(await state(draft), "turn");
    expect(ended.commit).not.toBeNull();
    w.seen.length = 0;
    expect((await send("POST", `/chats/${chatOf(draft)}/revert`, { turn: ended.turn })).status).toBe(200);
    await w.until((seen) => seen.length > 0);
    expect(w.seen).toEqual([{ type: "item", item: { ...ended, reverted: true } }]);
    w.close();
    // Nobody else's to watch.
    expect((await fetch(`${base}/chats/${chatOf(draft)}/events`)).status).toBe(401);
    expect((await send("GET", "/chats/abcdefghij/events")).status).toBe(404);
  });

  it("says why a turn failed, and leaves the draft free for the next", async () => {
    const s = await turn(draft, "Break.", async () => {
      throw new Error("No conversation found with session ID: 1234");
    });
    expect(last(s, "turn")).toMatchObject({ status: "failed", reason: "agent", error: "Error: No conversation found with session ID: 1234", commit: null });
    expect(s.chat.running).toBe(false);
    // An agent that cannot even be started is a failed turn too, and not a draft that runs for good.
    const start = runner.start;
    runner.start = () => {
      throw new Error("spawn ENOENT");
    };
    try {
      expect((await say(draft, "Again.")).status).toBe(202);
      await app.chat!.idle();
    } finally {
      runner.start = start;
    }
    const again = await state(draft);
    expect(last(again, "turn")).toMatchObject({ status: "failed", reason: "agent", error: "spawn ENOENT" });
    expect(again.chat.running).toBe(false);
    expect(last(await turn(draft, "And now?", async (a) => a.r.host.emit({ kind: "reply", text: "Fine." })), "turn")).toMatchObject({ status: "done" });
  });

  it("keeps many chats on a draft, each its own conversation, and runs one turn at a time", async () => {
    const first = chatOf(draft);
    const head = git(tree(draft), "rev-parse", "HEAD");
    // A message to no chat starts a new one, with a session of its own and a name from its first words.
    agent.script = async (a) => {
      a.write("docs/puzzles/cooling.md", "# Cooling\n\nFrom the second chat.\n");
      while (!("stopped" in (await a.next())));
    };
    const made = await send("POST", `/drafts/${draft.id}/chat`, { chat: null, text: "  Start over:\nwhat is   the  coolant for?  ", model: "sonnet", rounds: [], refusals: [] });
    expect(made.status).toBe(202);
    const second = ChatSentSchema.parse(await made.json()).chat;
    expect(second).not.toBe(first);
    expect(agent.requests.at(-1)!.session).toBeNull();
    const running = await state(second);
    expect(running.chat).toMatchObject({ id: second, title: "Start over: what is the coolant for?", draft: draft.id, running: true, turns: 1 });
    expect(running.busy).toBe(false);

    // The draft is busy: the first chat waits, says so, and may not start a turn or be steered into this one.
    const w = await watch(first);
    await w.until((seen) => seen.length > 0);
    expect(w.seen[0]).toMatchObject({ type: "state", state: { busy: true, chat: { running: false } } });
    const refused = await send("POST", `/drafts/${draft.id}/chat`, { chat: first, text: "Meanwhile?", model: "sonnet", rounds: [], refusals: [] });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "busy" });
    expect((await send("POST", `/drafts/${draft.id}/chat`, { chat: null, text: "A third?", model: "sonnet", rounds: [], refusals: [] })).status).toBe(409);
    // Stop is the running chat's: the first chat's stop stops nothing.
    expect((await send("POST", `/chats/${first}/stop`)).status).toBe(202);
    expect((await state(second)).chat.running).toBe(true);
    expect((await send("DELETE", `/chats/${second}`)).status).toBe(409);

    expect((await send("POST", `/chats/${second}/stop`)).status).toBe(202);
    await app.chat!.idle();
    // The waiting chat is told the draft is free again.
    await w.until((seen) => seen.some((e) => e.type === "status" && !e.status.busy));
    w.close();

    // The list has both, the one last spoken in first, and the owner can name one.
    const listed = ChatListSchema.parse(await (await send("GET", "/chats?puzzle=cooling")).json()).chats;
    expect(listed.map((c) => c.id).slice(0, 2)).toEqual([second, first]);
    const renamed = await send("PATCH", `/chats/${first}`, { title: "  Slag  " });
    expect(renamed.status).toBe(200);
    expect(ChatSummarySchema.parse(await renamed.json())).toMatchObject({ id: first, title: "Slag" });
    expect((await send("PATCH", `/chats/${first}`, { title: "   " })).status).toBe(400);
    expect((await state(first)).items.every((i) => i.kind !== "user" || i.text !== "Meanwhile?")).toBe(true);

    // Deleting a chat takes its lines, and leaves its turn's commit on the draft's branch.
    const commit = last(await state(second), "turn").commit;
    expect(commit).toBe(git(tree(draft), "rev-parse", "HEAD"));
    expect(git(tree(draft), "rev-parse", "HEAD~1")).toBe(head);
    expect((await send("DELETE", `/chats/${second}`)).status).toBe(200);
    expect((await send("GET", `/chats/${second}`)).status).toBe(404);
    expect(await app.db.select().from(schema.chatItem).where(eq(schema.chatItem.chatId, second))).toEqual([]);
    expect(git(tree(draft), "rev-parse", "HEAD")).toBe(commit);
    // The first chat carries on where it was, in its own session.
    await turn(draft, "Back to slag.", async (a) => a.r.host.emit({ kind: "reply", text: "Yes." }));
    expect(agent.requests.at(-1)!.session).toBe("session-of-cooling");
    expect(chatOf(draft)).toBe(first);
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
    // Each chat still shows what it has spent, and the other draft started none.
    expect(chats.has(other.id)).toBe(false);
    expect((await state(draft)).chat.spentUsd).toBeCloseTo(before + 1.2, 6);
    await send("DELETE", `/drafts/${other.id}`);
  });

  it("is the owner's alone, from the studio's pages", async () => {
    expect((await fetch(`${base}/chats/${chatOf(draft)}`)).status).toBe(401);
    expect((await fetch(`${base}/chats?puzzle=cooling`)).status).toBe(401);
    expect((await fetch(`${base}/drafts/${draft.id}/chat`, { method: "POST", headers: { cookie: session }, body: "{}" })).status).toBe(403);
    expect((await fetch(`${base}/chats/${chatOf(draft)}`, { method: "PATCH", headers: { cookie: session }, body: JSON.stringify({ title: "x" }) })).status).toBe(403);
    expect((await send("POST", `/drafts/${draft.id}/chat`, { text: "", model: "sonnet", rounds: [], refusals: [] })).status).toBe(400);
    expect((await send("POST", `/drafts/${draft.id}/chat`, { text: "x", model: "gpt", rounds: [], refusals: [] })).status).toBe(400);
    expect((await send("POST", `/drafts/${draft.id}/chat`, { chat: "abcdefghij", text: "x", model: "sonnet", rounds: [], refusals: [] })).status).toBe(404);
    expect((await send("GET", "/chats/abcdefghij")).status).toBe(404);
    expect((await send("GET", "/chats?puzzle=nonsense")).status).toBe(400);
  });

  it("keeps a draft's chats when the draft goes, to be read and carried onto the next draft", async () => {
    await app.db.delete(schema.meter);
    const id = chatOf(draft);
    const before = await state(id);
    expect(before.items.some((i) => i.kind === "turn" && i.commit !== null)).toBe(true);
    expect((await send("DELETE", `/drafts/${draft.id}`)).status).toBe(200);

    // The chat is still there, on no draft, every line of it; what its turns committed went with the draft's branch.
    const kept = await state(id);
    expect(kept.chat.draft).toBeNull();
    expect(kept.draft).toBeNull();
    expect(kept.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(kept.items.every((i) => i.kind !== "turn" || i.commit === null)).toBe(true);
    expect(kept.items.every((i) => i.kind !== "ask" || i.state !== "pending")).toBe(true);
    expect((await send("POST", `/chats/${id}/revert`, { turn: 1 })).status).toBe(409);
    const listed = ChatListSchema.parse(await (await send("GET", "/chats?puzzle=cooling")).json()).chats;
    expect(listed.find((c) => c.id === id)).toMatchObject({ draft: null, title: "Slag" });

    // A message from the puzzle's next draft carries it on: the agent starts afresh, told what was said.
    const next = await open(numbers());
    chats.set(next.id, id);
    const s = await turn(next, "Where were we?", async (a) => a.r.host.emit({ kind: "reply", text: "Slag." }));
    const r = agent.requests.at(-1)!;
    expect(r.session).toBeNull();
    expect(r.cwd).toBe(tree(next));
    expect(r.prompt).toContain("This conversation began on an earlier draft");
    expect(r.prompt).toContain("The owner: Make slag rarer and say why in the design file.");
    expect(r.prompt).toContain("You: Any time.");
    expect(r.prompt.indexOf("<earlier-conversation>")).toBeLessThan(r.prompt.indexOf("Where were we?"));
    expect(s.chat).toMatchObject({ id, draft: next.id, running: false });
    expect(s.draft?.id).toBe(next.id);
    expect(last(s, "turn")).toMatchObject({ status: "done", turn: 1 });
    // Its next turn resumes the new session, and is told nothing again.
    await turn(next, "Thanks.", async (a) => a.r.host.emit({ kind: "reply", text: "Welcome." }));
    expect(agent.requests.at(-1)!.session).toBe("session-of-cooling");
    expect(agent.requests.at(-1)!.prompt).not.toContain("earlier draft");

    // A chat on another draft of the owner's is not this draft's to carry.
    const elsewhere = DraftSchema.parse(await (await send("POST", "/drafts", { puzzle: "engines", numbers: numbers() })).json());
    expect((await send("POST", `/drafts/${elsewhere.id}/chat`, { chat: id, text: "Mine now?", model: "sonnet", rounds: [], refusals: [] })).status).toBe(409);
    await send("DELETE", `/drafts/${elsewhere.id}`);
    expect((await send("DELETE", `/drafts/${next.id}`)).status).toBe(200);
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
    await expect.poll(async () => (await state(d)).chat.running).toBe(true);
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
      expect((await fetch(`${base}/chats?puzzle=cooling`, { headers: { cookie: session } })).status).toBe(503);
      expect((await fetch(`${base}/drafts/${draft.id}/chat`, { method: "POST", headers: { origin: STUDIO, cookie: session }, body: JSON.stringify({ text: "hi", model: "sonnet", rounds: [], refusals: [] }) })).status).toBe(503);
      await fetch(`${base}/drafts/${draft.id}`, { method: "DELETE", headers: { origin: STUDIO, cookie: session } });
    } finally {
      await app.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
