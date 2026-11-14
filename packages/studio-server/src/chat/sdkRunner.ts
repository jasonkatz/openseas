import { spawn } from "node:child_process";
import { createSdkMcpServer, query, tool, type CanUseTool, type HookCallback, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Logger } from "../log.js";
import { STUDIO_PROMPT, type AgentEvent, type AgentRunner, type AgentTurn, type TurnRequest, type TurnResult } from "./runner.js";

/** The unix user the agent's processes run as, when the service can become it (chat/agentUser). */
export interface AgentIdentity {
  uid: number;
  gid: number;
  home: string;
}

export interface SdkRunnerOptions {
  /** Null off production, where the service is not root: the agent then runs as the service's own user, with the same scrubbed environment. */
  identity: AgentIdentity | null;
  /** The keys the generation scripts read (ADR 0040, ADR 0042 decision 9): the only credentials in the agent's shell. */
  scriptKeys: Readonly<Record<string, string>>;
  log: Logger;
  /** The Claude Code executable, when it is not the one the SDK ships. */
  executable?: string;
}

/** The skills the agent loads from the worktree (ADR 0042 decision 5). */
const SKILLS = ["puzzles", "puzzle-sprites", "puzzle-sounds"];
/** Tools that write a file by its path: held to the puzzle's scope before they run. */
const WRITERS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Tools that reach past the turn: scheduling, other sessions, other worktrees. The agent has no use for them here. */
const NOT_HERE = ["CronCreate", "CronDelete", "CronList", "RemoteTrigger", "ScheduleWakeup", "PushNotification", "EnterWorktree", "ExitWorktree", "SendMessage", "AskUserQuestion"];
const DETAIL = 6000;

const clip = (text: string, max = DETAIL): string => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text);
const pathOf = (input: unknown): string | null => {
  const i = input as { file_path?: unknown; notebook_path?: unknown } | null;
  return typeof i?.file_path === "string" ? i.file_path : typeof i?.notebook_path === "string" ? i.notebook_path : null;
};

/** One line for a step: the file, the command, the pattern. A file inside the worktree is named as the repository names it. */
export function summarize(toolName: string, input: unknown, cwd = ""): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const first = (...keys: string[]): string | null => {
    for (const k of keys) if (typeof i[k] === "string" && i[k]) return i[k] as string;
    return null;
  };
  const line = first("file_path", "notebook_path", "command", "pattern", "skill", "url", "query", "description") ?? (toolName.startsWith("mcp__studio__") ? JSON.stringify(i) : "");
  const first1 = line.split("\n")[0] ?? "";
  return clip(cwd && first1.startsWith(`${cwd}/`) ? first1.slice(cwd.length + 1) : first1, 200);
}

/** A tool result's text, whatever shape the block took. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b: { type?: string; text?: string }) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).join("\n");
}

/** A queue the turn's messages are fed through: the first, and any that steer it. */
function inbox(): { push(m: SDKUserMessage): void; end(): void; stream: AsyncIterable<SDKUserMessage> } {
  const waiting: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  return {
    push(m) {
      waiting.push(m);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    stream: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (waiting.length) yield waiting.shift()!;
          if (ended) return;
          await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
        }
      },
    },
  };
}

const userMessage = (text: string, priority?: "next"): SDKUserMessage => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, ...(priority ? { priority } : {}) }) as SDKUserMessage;

/**
 * The chat's agent: the Claude Agent SDK on the draft's worktree (ADR 0042 decision 5, ADR 0047).
 * It loads `CLAUDE.md` and the three puzzle skills from the worktree itself, so a change to a
 * skill needs no change here. Its process is another unix user's, started with an environment
 * built from nothing: where the model is (the service's proxy), a token for this turn, a home,
 * a path, and the two keys the generation scripts read. No other variable of the service's
 * reaches it.
 */
export function createSdkRunner(o: SdkRunnerOptions): AgentRunner {
  const environment = (r: TurnRequest): Record<string, string> => ({
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: o.identity?.home ?? process.env.HOME ?? "/tmp",
    LANG: process.env.LANG ?? "C.UTF-8",
    ANTHROPIC_BASE_URL: r.modelUrl,
    ANTHROPIC_API_KEY: r.modelToken,
    CLAUDE_AGENT_SDK_CLIENT_APP: "openseas-studio",
    ...o.scriptKeys,
  });

  return {
    start(r): AgentTurn {
      const abort = new AbortController();
      const input = inbox();
      input.push(userMessage(r.prompt));
      const emit = (e: AgentEvent): void => r.host.emit(e);

      const refuse = (path: string): string =>
        `The studio refused this write: ${path} is not one of the ${r.puzzle} puzzle's own files. Do not work around it. Tell the owner which path you need and why; they can allow it for this draft.`;
      // Asked before a tool runs, whatever the worktree's own settings allow.
      const guard: HookCallback = async (hook) => {
        if (hook.hook_event_name !== "PreToolUse" || !WRITERS.has(hook.tool_name)) return {};
        const path = pathOf(hook.tool_input);
        if (path === null || r.host.mayWrite(path)) return {};
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: refuse(path) } };
      };
      // Asked for whatever would otherwise stop for a person: commands run without asking, writes by the scope.
      const canUseTool: CanUseTool = async (toolName, toolInput) => {
        const path = WRITERS.has(toolName) ? pathOf(toolInput) : null;
        if (path !== null && !r.host.mayWrite(path)) return { behavior: "deny", message: refuse(path) };
        return { behavior: "allow", updatedInput: toolInput };
      };

      const studio = createSdkMcpServer({
        name: "studio",
        instructions: "The draft's numbers. Use set_numbers for any number that has a control; do not edit the content file for those.",
        tools: [
          tool(
            "set_numbers",
            "Set numbers of the open draft, by the key the puzzle's content file uses: `config.<path>` (dots for nesting, e.g. `config.specialChancePerMille.charge`), `roundSeconds`, `paceSeconds`, `thresholds`. The owner's controls move at once. `reset` puts keys back to their shipped values. Values are checked by the studio page, which reports what the build refuses in the next message.",
            { set: z.record(z.string(), z.unknown()).optional(), reset: z.array(z.string()).optional() },
            async (args) => ({ content: [{ type: "text", text: await r.host.setNumbers(args.set ?? {}, args.reset ?? []) }] }),
            // Always in the agent's hands, never behind a search: "make it harder" should reach for this first.
            { alwaysLoad: true },
          ),
          tool("get_numbers", "Read what the open draft changes from the shipped numbers, and its pinned seed.", {}, async () => ({ content: [{ type: "text", text: JSON.stringify(await r.host.numbers()) }] }), { alwaysLoad: true }),
        ],
      });

      const run = async (): Promise<TurnResult> => {
        let result: TurnResult = { status: "failed", error: "the agent ended without a result" };
        const stream = query({
          prompt: input.stream,
          options: {
            cwd: r.cwd,
            model: r.model,
            ...(r.session ? { resume: r.session } : {}),
            // CLAUDE.md and the skills come from the worktree; nothing from a home directory or a machine.
            settingSources: ["project"],
            skills: SKILLS,
            systemPrompt: { type: "preset", preset: "claude_code", append: STUDIO_PROMPT(r.puzzle) },
            mcpServers: { studio },
            // No allowedTools: a bare entry would approve a tool before canUseTool is asked (and the SDK
            // warns on every turn). canUseTool allows the studio's own tools, which write no file.
            disallowedTools: NOT_HERE,
            permissionMode: "default",
            canUseTool,
            hooks: { PreToolUse: [{ hooks: [guard] }] },
            abortController: abort,
            env: environment(r),
            ...(o.executable ? { pathToClaudeCodeExecutable: o.executable } : {}),
            // The environment handed over is the one built above and what the SDK adds to it; nothing is inherited.
            spawnClaudeCodeProcess: (s) =>
              spawn(s.command, s.args, { cwd: s.cwd, env: s.env as NodeJS.ProcessEnv, signal: s.signal, stdio: ["pipe", "pipe", "ignore"], ...(o.identity ? { uid: o.identity.uid, gid: o.identity.gid } : {}) }),
          },
        });
        for await (const m of stream) {
          if (m.type === "system" && m.subtype === "init") emit({ kind: "session", id: m.session_id });
          else if (m.type === "assistant" && m.parent_tool_use_id === null) {
            for (const block of m.message.content) {
              if (block.type === "text" && block.text.trim()) emit({ kind: "reply", text: block.text });
              else if (block.type === "tool_use") emit({ kind: "step", id: block.id, tool: block.name, summary: summarize(block.name, block.input, r.cwd) });
            }
          } else if (m.type === "user" && m.parent_tool_use_id === null && Array.isArray(m.message.content)) {
            for (const block of m.message.content) {
              if (block.type === "tool_result") emit({ kind: "stepDone", id: block.tool_use_id, detail: clip(resultText(block.content)), failed: block.is_error === true });
            }
          } else if (m.type === "result") {
            result = m.subtype === "success" && !m.is_error ? { status: "done" } : { status: "failed", error: m.subtype === "success" ? String(m.result).slice(0, 500) : m.subtype };
            // One turn a message: the process is not kept between them, and the session is resumed.
            input.end();
          }
        }
        return result;
      };

      const done = run().catch((err: unknown): TurnResult => {
        if (!abort.signal.aborted) o.log.error({ err }, "agent turn failed");
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      });
      return {
        done,
        steer: (text) => input.push(userMessage(text, "next")),
        stop: () => {
          input.end();
          abort.abort();
        },
      };
    },
  };
}
