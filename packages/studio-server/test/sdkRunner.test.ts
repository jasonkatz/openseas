/**
 * The chat's real agent (chat/sdkRunner): the Claude Agent SDK and the Claude Code executable it
 * ships, run for one turn against a stand-in for Anthropic's API that plays a fixed script of
 * tool calls. No model runs and no key is real, and everything else is: the process is spawned,
 * as the agent's own unix user where this machine lets the test become one, its environment is
 * what the runner built, the write hook and the numbers tool are called by the executable, and
 * the model is reached only through the service's proxy.
 *
 * It needs the executable for this platform, which the SDK brings as an optional dependency.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureAgentUser } from "../src/chat/agentUser.js";
import { createModelProxy, type ModelProxy } from "../src/chat/proxy.js";
import type { AgentEvent } from "../src/chat/runner.js";
import { createSdkRunner, type AgentIdentity } from "../src/chat/sdkRunner.js";
import { mayWrite, repoPath } from "../src/chat/scope.js";
import { createLogger } from "../src/log.js";

const require = createRequire(import.meta.url);
const hasExecutable = ((): boolean => {
  try {
    const sdk = require.resolve("@anthropic-ai/claude-agent-sdk");
    const local = createRequire(sdk);
    for (const name of [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`, `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}-musl`]) {
      try {
        local.resolve(`${name}/package.json`);
        return true;
      } catch {
        /* the other one */
      }
    }
    return false;
  } catch {
    return false;
  }
})();

const REAL_KEY = "sk-ant-the-real-key";
const SECRET_OF_THE_SERVICE = "postgres://the-service-only";

interface Block {
  type: "text" | "tool_use";
  text?: string;
  name?: string;
  input?: unknown;
}

/** One assistant message as the Messages API streams it. */
function sse(model: string, n: number, blocks: Block[]): string {
  const out: string[] = [];
  const ev = (type: string, data: object): void => void out.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n`);
  ev("message_start", { message: { id: `msg_${n}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else {
      ev("content_block_start", { index, content_block: { type: "tool_use", id: `toolu_${n}_${index}`, name: b.name, input: {} } });
      ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    ev("content_block_stop", { index });
  });
  ev("message_delta", { delta: { stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } });
  ev("message_stop", {});
  return out.join("\n") + "\n";
}

describe.skipIf(!hasExecutable)("the real agent, on a scripted model", () => {
  const tmp = mkdtempSync(join(tmpdir(), "studio-sdk-"));
  const cwd = join(tmp, "worktree");
  let upstream: Server;
  let proxy: ModelProxy;
  let identity: AgentIdentity | null = null;
  /** What the stand-in API was sent. */
  const api = { keys: new Set<string>(), mainTurns: [] as Array<{ tools: string[]; results: string[]; system: string; said: string }> };
  /** The script: the n-th answer of the main conversation. */
  let script: Block[][] = [];
  /** Set, the stand-in takes the main conversation's request and never answers it. */
  let silent = false;

  beforeAll(async () => {
    mkdirSync(join(cwd, "docs/puzzles"), { recursive: true });
    mkdirSync(join(cwd, ".claude/skills/puzzles"), { recursive: true });
    writeFileSync(join(cwd, "CLAUDE.md"), "# openseas\n\nThe project's own instructions, from the worktree.\n");
    writeFileSync(join(cwd, ".claude/skills/puzzles/SKILL.md"), "---\nname: puzzles\ndescription: The rules every openseas puzzle is held to.\n---\n\nThe bar.\n");
    writeFileSync(join(cwd, "docs/puzzles/cooling.md"), "# Cooling\n");
    writeFileSync(join(cwd, "docs/DESIGN.md"), "# Design\n");
    execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd });
    // Where the test may become another user, it does: the worktree and a home are that user's, and nothing else is.
    chmodSync(tmp, 0o755);
    identity = ensureAgentUser("studio-agent-test", tmp, createLogger("silent", false));
    if (identity) execFileSync("chown", ["-R", `${identity.uid}:${identity.gid}`, cwd]);

    upstream = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        api.keys.add(String(req.headers["x-api-key"]));
        const body = JSON.parse(raw || "{}") as { model?: string; stream?: boolean; tools?: Array<{ name: string }>; system?: unknown; messages?: Array<{ role: string; content: unknown }> };
        const tools = (body.tools ?? []).map((t) => t.name);
        // The agent's own conversation is the one that carries tools; anything else the executable asks on the side (a title for the session) gets a word back.
        const main = tools.includes("Write");
        let blocks: Block[] = [{ type: "text", text: "ok" }];
        if (main) {
          const results = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type: string; content?: unknown }>).filter((b) => b.type === "tool_result").map((b) => JSON.stringify(b.content)) : []));
          api.mainTurns.push({ tools, results, system: JSON.stringify(body.system ?? ""), said: JSON.stringify(body.messages ?? []) });
          blocks = script[api.mainTurns.length - 1] ?? [{ type: "text", text: "Nothing more to do." }];
          if (silent) return;
        }
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(sse(body.model ?? "", api.mainTurns.length, blocks));
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } }));
        }
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    proxy = await createModelProxy({ apiKey: REAL_KEY, upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, log: createLogger("silent", false) });
  });
  afterAll(async () => {
    await proxy?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(tmp, { recursive: true, force: true });
    if (identity) {
      try {
        execFileSync("userdel", ["studio-agent-test"], { stdio: "ignore" });
      } catch {
        /* left behind on a machine that will not let it go */
      }
    }
  });

  it("runs as its own user with an environment built from nothing, is held to the puzzle's files, and moves numbers through the tool", async () => {
    script = [
      [
        { type: "text", text: "I'll make the change." },
        { type: "tool_use", name: "Write", input: { file_path: join(cwd, "docs/DESIGN.md"), content: "# Design\n\nNot mine to write.\n" } },
      ],
      [{ type: "tool_use", name: "Write", input: { file_path: join(cwd, "docs/puzzles/cooling.md"), content: "# Cooling\n\nWritten by the agent.\n" } }],
      [{ type: "tool_use", name: "mcp__studio__set_numbers", input: { set: { "config.pieceKinds": 5 } } }],
      [{ type: "tool_use", name: "Bash", input: { command: "env | sort > env.txt; id -u > uid.txt; echo done" } }],
      [{ type: "text", text: "Done. This was a file edit: Save and look at the pull request's preview." }],
    ];
    // What the service's own process holds and the agent's must not.
    process.env.DATABASE_URL = SECRET_OF_THE_SERVICE;
    process.env.STUDIO_SECRET = "the-session-secret";
    process.env.GITHUB_APP_PRIVATE_KEY = "the-app-key";
    process.env.ANTHROPIC_API_KEY = REAL_KEY;

    const events: AgentEvent[] = [];
    const set: unknown[] = [];
    const refused: string[] = [];
    let spent = 0;
    const gate = proxy.admit({ open: () => true, spend: (usd) => void (spent += usd) });
    const runner = createSdkRunner({ identity, scriptKeys: { OPENAI_API_KEY: "sk-openai-for-sprites", ELEVENLABS_API_KEY: "el-for-sounds" }, log: createLogger("silent", false) });
    const turn = runner.start({
      cwd,
      puzzle: "cooling",
      prompt: "Make slag rarer.",
      model: "claude-sonnet-5-5",
      session: null,
      modelUrl: proxy.url,
      modelToken: gate.token,
      host: {
        mayWrite: (path) => {
          const rel = repoPath(cwd, path);
          const ok = rel !== null && mayWrite("cooling", rel, []);
          if (!ok) refused.push(rel ?? path);
          return ok;
        },
        setNumbers: async (s) => {
          set.push(s);
          return "Set.";
        },
        numbers: async () => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null }),
        emit: (e) => void events.push(e),
      },
    });
    const result = await turn.done;
    gate.close();
    delete process.env.DATABASE_URL;
    delete process.env.STUDIO_SECRET;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(result, JSON.stringify(events.slice(-6))).toEqual({ status: "done" });

    // The write outside the puzzle's files never happened, and the agent was told why; the one inside did.
    expect(readFileSync(join(cwd, "docs/DESIGN.md"), "utf8")).toBe("# Design\n");
    expect(refused).toEqual(["docs/DESIGN.md"]);
    expect(api.mainTurns[1]!.results.join("\n")).toContain("not one of the cooling puzzle's own files");
    expect(readFileSync(join(cwd, "docs/puzzles/cooling.md"), "utf8")).toBe("# Cooling\n\nWritten by the agent.\n");
    // The numbers moved through the service, not through a file.
    expect(set).toEqual([{ "config.pieceKinds": 5 }]);

    // What the owner is shown: the words, a line a step, and each step's outcome.
    expect(events.find((e) => e.kind === "session")).toBeTruthy();
    expect(events.filter((e) => e.kind === "reply").map((e) => (e.kind === "reply" ? e.text : ""))).toEqual(["I'll make the change.", "Done. This was a file edit: Save and look at the pull request's preview."]);
    // Its words came as it wrote them, before each whole block: the first reply's are all there when its block arrives, and a new message starts from none.
    const first = events.findIndex((e) => e.kind === "reply");
    const sofar = events.slice(0, first).reduce((text, e) => (e.kind === "delta" ? (e.reset ? e.text : text + e.text) : text), "");
    expect(sofar).toBe("I'll make the change.");
    expect(events.filter((e) => e.kind === "delta" && e.reset).length).toBeGreaterThanOrEqual(5);
    const steps = events.filter((e) => e.kind === "step").map((e) => (e.kind === "step" ? e.tool : ""));
    expect(steps).toEqual(["Write", "Write", "mcp__studio__set_numbers", "Bash"]);
    const outcomes = events.filter((e) => e.kind === "stepDone");
    expect(outcomes).toHaveLength(4);
    expect(outcomes[0]).toMatchObject({ failed: true });
    expect(outcomes[1]).toMatchObject({ failed: false });

    // The agent's shell: where the model is and this turn's token, the two script keys, and nothing of the service's.
    const env = readFileSync(join(cwd, "env.txt"), "utf8");
    expect(env).toContain(`ANTHROPIC_BASE_URL=${proxy.url}`);
    expect(env).toContain("OPENAI_API_KEY=sk-openai-for-sprites");
    expect(env).toContain("ELEVENLABS_API_KEY=el-for-sounds");
    for (const secret of [REAL_KEY, SECRET_OF_THE_SERVICE, "the-session-secret", "the-app-key", "DATABASE_URL", "STUDIO_SECRET", "GITHUB_APP"]) expect(env, secret).not.toContain(secret);
    if (identity) {
      expect(readFileSync(join(cwd, "uid.txt"), "utf8").trim()).toBe(String(identity.uid));
      expect(env).toContain(`HOME=${identity.home}`);
    }
    // The model was reached through the proxy alone: the real key went upstream, the turn's token never did, and the turn was metered.
    expect([...api.keys]).toEqual([REAL_KEY]);
    expect(spent).toBeGreaterThan(0);
    // It was told the studio's rules, and it read the project's instructions from the worktree.
    expect(api.mainTurns[0]!.system).toContain("openseas puzzle studio");
    expect(api.mainTurns[0]!.tools).toEqual(expect.arrayContaining(["Write", "Bash", "mcp__studio__set_numbers", "mcp__studio__get_numbers"]));
    expect(api.mainTurns[0]!.tools).not.toContain("CronCreate");
    expect(existsSync(join(cwd, "env.txt"))).toBe(true);
  }, 120_000);

  it("hears a message sent while it works, in the same turn", async () => {
    script = [[{ type: "tool_use", name: "Bash", input: { command: "touch working.txt; python3 -c 'import time; time.sleep(4)'; echo worked" } }], [{ type: "text", text: "Shorter it is." }]];
    api.mainTurns.length = 0;
    const events: AgentEvent[] = [];
    const gate = proxy.admit({ open: () => true, spend: () => undefined });
    const turn = createSdkRunner({ identity, scriptKeys: {}, log: createLogger("silent", false) }).start({
      cwd,
      puzzle: "cooling",
      prompt: "Rewrite the design file.",
      model: "claude-sonnet-5-5",
      session: null,
      modelUrl: proxy.url,
      modelToken: gate.token,
      host: { mayWrite: () => true, setNumbers: async () => "Set.", numbers: async () => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null }), emit: (e) => void events.push(e) },
    });
    await expect.poll(() => existsSync(join(cwd, "working.txt")), { timeout: 60_000 }).toBe(true);
    turn.steer("Shorter than that, please.");
    expect(await turn.done).toEqual({ status: "done" });
    gate.close();
    // One turn, and the model's next look at the conversation has the owner's second message in it.
    expect(api.mainTurns).toHaveLength(2);
    expect(api.mainTurns[0]!.said).not.toContain("Shorter than that, please.");
    expect(api.mainTurns[1]!.said).toContain("Shorter than that, please.");
    expect(api.mainTurns[1]!.said).toContain("worked");
    expect(events.filter((e) => e.kind === "reply").map((e) => (e.kind === "reply" ? e.text : ""))).toEqual(["Shorter it is."]);
  }, 120_000);

  it("starts a new session, and says so, when the one to resume has no transcript", async () => {
    script = [[{ type: "text", text: "Fresh start." }]];
    api.mainTurns.length = 0;
    const events: AgentEvent[] = [];
    const gate = proxy.admit({ open: () => true, spend: () => undefined });
    const turn = createSdkRunner({ identity, scriptKeys: {}, log: createLogger("silent", false) }).start({
      cwd,
      puzzle: "cooling",
      prompt: "Make three takes of the clear cue.",
      model: "claude-sonnet-5-5",
      session: "ccf606c8-14e7-41db-b159-f3d46f2a1a17",
      modelUrl: proxy.url,
      modelToken: gate.token,
      host: { mayWrite: () => true, setNumbers: async () => "Set.", numbers: async () => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null }), emit: (e) => void events.push(e) },
    });
    expect(await turn.done, JSON.stringify(events)).toEqual({ status: "done" });
    gate.close();
    // The new session is the one the next turn resumes, and the agent was told why it starts afresh.
    const session = events.find((e) => e.kind === "session");
    expect(session && session.kind === "session" ? session.id : null).not.toBe("ccf606c8-14e7-41db-b159-f3d46f2a1a17");
    expect(api.mainTurns[0]!.said).toContain("could not be resumed");
    expect(api.mainTurns[0]!.said).toContain("Make three takes of the clear cue.");
    expect(events.filter((e) => e.kind === "reply").map((e) => (e.kind === "reply" ? e.text : ""))).toEqual(["Fresh start."]);
  }, 120_000);

  it("makes all of the agent's home its own again, whatever uid an earlier deploy gave it", () => {
    if (!identity) return;
    // What an earlier deploy's user left: its session transcripts, under another uid.
    const projects = join(identity.home, ".claude/projects");
    mkdirSync(projects, { recursive: true });
    writeFileSync(join(projects, "old.jsonl"), "{}\n");
    execFileSync("chown", ["-R", "12345:12345", join(identity.home, ".claude")]);
    const again = ensureAgentUser("studio-agent-test", tmp, createLogger("silent", false));
    expect(again).not.toBeNull();
    for (const p of [join(identity.home, ".claude"), projects, join(projects, "old.jsonl")]) expect(statSync(p).uid, p).toBe(again!.uid);
  });

  it("stops a turn whose agent says nothing for too long, and says that is why", async () => {
    silent = true;
    api.mainTurns.length = 0;
    const gate = proxy.admit({ open: () => true, spend: () => undefined });
    const at = Date.now();
    const turn = createSdkRunner({ identity, scriptKeys: {}, log: createLogger("silent", false), idleMs: 3000 }).start({
      cwd,
      puzzle: "cooling",
      prompt: "Hello?",
      model: "claude-sonnet-5-5",
      session: null,
      modelUrl: proxy.url,
      modelToken: gate.token,
      host: { mayWrite: () => true, setNumbers: async () => "Set.", numbers: async () => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null }), emit: () => undefined },
    });
    const result = await turn.done;
    silent = false;
    gate.close();
    expect(result).toMatchObject({ status: "failed", reason: "idle" });
    expect(api.mainTurns.length).toBeGreaterThan(0);
    expect(Date.now() - at).toBeLessThan(30_000);
  }, 120_000);

  it("does not take a long command for silence", async () => {
    script = [[{ type: "tool_use", name: "Bash", input: { command: "python3 -c 'import time; time.sleep(12)'; echo slept" } }], [{ type: "text", text: "Slept." }]];
    api.mainTurns.length = 0;
    const gate = proxy.admit({ open: () => true, spend: () => undefined });
    const turn = createSdkRunner({ identity, scriptKeys: {}, log: createLogger("silent", false), idleMs: 5000 }).start({
      cwd,
      puzzle: "cooling",
      prompt: "Run the slow thing.",
      model: "claude-sonnet-5-5",
      session: null,
      modelUrl: proxy.url,
      modelToken: gate.token,
      host: { mayWrite: () => true, setNumbers: async () => "Set.", numbers: async () => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null }), emit: () => undefined },
    });
    expect(await turn.done).toEqual({ status: "done" });
    gate.close();
    expect(api.mainTurns[1]!.results.join("\n")).toContain("slept");
  }, 120_000);

  it("stops where it stands when told to", async () => {
    // A command that would run for a minute, were it left to.
    script = [[{ type: "tool_use", name: "Bash", input: { command: "touch started.txt; tail -f /dev/null; echo slept > slept.txt" } }]];
    api.mainTurns.length = 0;
    const events: AgentEvent[] = [];
    const gate = proxy.admit({ open: () => true, spend: () => undefined });
    const turn = createSdkRunner({ identity, scriptKeys: {}, log: createLogger("silent", false) }).start({
      cwd,
      puzzle: "cooling",
      prompt: "Wait a while.",
      model: "claude-sonnet-5-5",
      session: null,
      modelUrl: proxy.url,
      modelToken: gate.token,
      host: { mayWrite: () => true, setNumbers: async () => "Set.", numbers: async () => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null }), emit: (e) => void events.push(e) },
    });
    await expect.poll(() => existsSync(join(cwd, "started.txt")), { timeout: 60_000 }).toBe(true);
    // The command is running and has not come back.
    expect(events.some((e) => e.kind === "stepDone")).toBe(false);
    const at = Date.now();
    turn.stop();
    await turn.done;
    gate.close();
    expect(Date.now() - at).toBeLessThan(20_000);
    expect(existsSync(join(cwd, "slept.txt"))).toBe(false);
    // Nothing of the turn is left running on the machine.
    await expect.poll(() => execFileSync("sh", ["-c", "pgrep -f 'tail -f /dev/nul[l]' || true"], { encoding: "utf8" }).trim(), { timeout: 10_000 }).toBe("");
  }, 120_000);
});
