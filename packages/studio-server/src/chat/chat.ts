import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { ChatItem, ChatModel, DraftNumbers, RoundSummary, SendChat } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import type { DraftRow } from "../drafts.js";
import type { Logger } from "../log.js";
import type { Repo } from "../save/repo.js";
import { branchFor } from "../save/saver.js";
import { MODEL_IDS } from "./prices.js";
import type { ModelProxy } from "./proxy.js";
import type { AgentEvent, AgentRunner, AgentTurn } from "./runner.js";
import type { AgentIdentity } from "./sdkRunner.js";
import { mayWrite, repoPath } from "./scope.js";

export interface ChatOptions {
  db: Db;
  repo: Repo;
  runner: AgentRunner;
  proxy: ModelProxy;
  /** The agent's unix user, whose the worktree's files are made before a turn; null where the service cannot become another user. */
  identity: AgentIdentity | null;
  /** US dollars: all the chat may spend, every draft together (ADR 0047). */
  capUsd: number;
  log: Logger;
}

/**
 * The chat (ADR 0042 decisions 5, 6, 8 and 9; ADR 0047): a turn of the agent on a draft's
 * worktree for each message, held by the service to the puzzle's own files, committed when it
 * ends, and stopped where it stands when the one spend cap is reached.
 */
export interface Chat {
  /** At startup: nothing is running, whatever the last process left. */
  start(): Promise<void>;
  /** A message from the owner. It starts a turn, or steers the one running. */
  send(row: DraftRow, input: SendChat): Promise<void>;
  /** Stop the draft's turn where it stands. What it had edited is still committed, so it can be reverted. */
  stop(draftId: string): void;
  /** At shutdown: stop every running turn where it stands, as `stop` does one. */
  stopAll(): void;
  /** Undo one turn's edits with a new commit. False when the turn made none, was reverted already, or no longer comes out cleanly. */
  revert(row: DraftRow, turn: number): Promise<boolean>;
  /** The owner's answer to a refused write: allow that path for this draft, or not. False when there is no such question. */
  answer(row: DraftRow, itemId: number, allow: boolean): Promise<boolean>;
  items(draftId: string, after: number): Promise<ChatItem[]>;
  running(draftId: string): boolean;
  spent(): Promise<number>;
  readonly capUsd: number;
  /** Resolves when no turn is running or being finished. For tests and shutdown. */
  idle(): Promise<void>;
}

const OVERRIDE = "config.";
type Top = "roundSeconds" | "paceSeconds" | "thresholds";
const TOPS: readonly Top[] = ["roundSeconds", "paceSeconds", "thresholds"];

/** A draft's numbers with some set and some put back, by their key in the content file. Throws on a key that is not a number's. */
export function withNumbers(numbers: DraftNumbers, set: Record<string, unknown>, reset: readonly string[]): DraftNumbers {
  const overrides: Record<string, unknown> = { ...numbers.overrides };
  const next: DraftNumbers = { ...numbers };
  const top = (key: string): Top | null => (TOPS.includes(key as Top) ? (key as Top) : null);
  for (const key of reset) {
    if (key.startsWith(OVERRIDE) && key.length > OVERRIDE.length) delete overrides[key.slice(OVERRIDE.length)];
    else if (top(key)) next[top(key)!] = null;
    else throw new Error(`${key} is not a number of the draft's: use config.<path>, roundSeconds, paceSeconds or thresholds`);
  }
  for (const [key, value] of Object.entries(set)) {
    if (key.startsWith(OVERRIDE) && key.length > OVERRIDE.length) overrides[key.slice(OVERRIDE.length)] = value;
    else if (top(key)) (next as Record<string, unknown>)[key] = value;
    else throw new Error(`${key} is not a number of the draft's: use config.<path>, roundSeconds, paceSeconds or thresholds`);
  }
  return { ...next, overrides: overrides as DraftNumbers["overrides"] };
}

/** What a message to the agent carries under the owner's words (ADR 0042 decision 5). */
export function context(numbers: DraftNumbers, refusals: readonly string[], rounds: readonly RoundSummary[], allowed: readonly string[]): string {
  const changed = Object.keys(numbers.overrides).length > 0 || TOPS.some((k) => numbers[k] !== null);
  const lines = ["", "---", "From the studio, for this message:"];
  lines.push(changed ? `Draft numbers (what differs from shipped): ${JSON.stringify({ config: numbers.overrides, ...Object.fromEntries(TOPS.filter((k) => numbers[k] !== null).map((k) => [k, numbers[k]])) })}` : "Draft numbers: none changed; the board is on the shipped numbers.");
  if (numbers.seed) lines.push(`Pinned seed: ${numbers.seed}`);
  if (refusals.length) lines.push("The current build refuses these numbers, so nothing is dealt until they are fixed:", ...refusals.map((r) => `- ${r}`));
  if (rounds.length) {
    lines.push("Last rounds played, oldest first:");
    for (const r of rounds) lines.push(`- seed ${r.seed}: score ${r.score}, ${r.tier ? `tier ${r.tier}` : "unrated"}, ${Math.round(r.seconds)}s, ${r.moves} moves, on the ${r.tuned ? "draft's" : "shipped"} numbers`);
  } else lines.push("No round has been played on this page yet.");
  if (allowed.length) lines.push(`Paths the owner has allowed beyond the puzzle's own files: ${allowed.join(", ")}`);
  return lines.join("\n");
}

interface Running {
  turn: AgentTurn;
  number: number;
  stopped: boolean;
  capped: boolean;
  spentUsd: number;
  /** Refused paths already put to the owner this turn. */
  asked: Set<string>;
  /** Step ids to the item that shows them. */
  steps: Map<string, number>;
  allowed: string[];
  /** Writes to the database, one after another, in the order things happened. */
  log: Promise<unknown>;
}

export function createChat(o: ChatOptions): Chat {
  const { db, repo, log } = o;
  const live = new Map<string, Running>();
  const finishing = new Set<Promise<void>>();

  const add = async (draftId: string, turn: number, kind: ChatItem["kind"], data: Record<string, unknown>): Promise<number> => {
    const [row] = await db.insert(schema.chatItem).values({ draftId, turn, kind, data }).returning({ id: schema.chatItem.id });
    return row!.id;
  };
  const fresh = async (id: string): Promise<DraftRow | null> => (await db.select().from(schema.draft).where(eq(schema.draft.id, id)).limit(1))[0] ?? null;
  const spent = async (): Promise<number> => (await db.select().from(schema.meter).where(eq(schema.meter.id, 1)).limit(1))[0]?.spentUsd ?? 0;

  /** A refused write, put to the owner once a turn a path. */
  const ask = (draftId: string, run: Running, path: string): void => {
    if (run.asked.has(path)) return;
    run.asked.add(path);
    run.log = run.log.then(() => add(draftId, run.number, "ask", { path, state: "pending" }));
  };

  async function finish(row: DraftRow, run: Running, result: { status: "done" | "failed"; error?: string }): Promise<void> {
    await run.log.catch(() => undefined);
    let commit: string | null = null;
    try {
      // Whatever a command wrote outside the puzzle's files is put back before the commit: the scope is the service's to hold, not the agent's to keep.
      const changed = await repo.changed(row.id);
      const outside = changed.filter((p) => !mayWrite(row.puzzle, p, run.allowed));
      if (outside.length) {
        await repo.restore(row.id, outside);
        for (const p of outside) ask(row.id, run, p);
        await run.log.catch(() => undefined);
      }
      commit = await repo.commit(row.id, `Chat turn ${run.number} on ${row.puzzle}`);
      // A draft the agent has edited can be saved though no number differs (ADR 0049).
      if (commit) await db.update(schema.draft).set({ chatCommits: sql`${schema.draft.chatCommits} + 1` }).where(eq(schema.draft.id, row.id));
    } catch (err) {
      log.error({ err, draft: row.id }, "could not commit a chat turn");
    }
    const status = run.capped ? "capped" : run.stopped ? "stopped" : result.status;
    if (status === "failed") log.warn({ draft: row.id, turn: run.number, error: result.error }, "chat turn failed");
    await add(row.id, run.number, "turn", { status, commit, costUsd: run.spentUsd, reverted: false });
    live.delete(row.id);
  }

  async function begin(row: DraftRow, input: SendChat): Promise<void> {
    const number = row.chatTurns + 1;
    const branch = branchFor(row);
    await db.update(schema.draft).set({ chatTurns: number, branch }).where(eq(schema.draft.id, row.id));
    await add(row.id, number, "user", { text: input.text, model: input.model, steer: false });

    // Reserved before anything is awaited again, so a second message steers this turn and does not start another.
    const run: Running = { turn: null as unknown as AgentTurn, number, stopped: false, capped: false, spentUsd: 0, asked: new Set(), steps: new Map(), allowed: [...row.allowedPaths], log: Promise.resolve() };
    live.set(row.id, run);
    const queued: string[] = [];
    run.turn = { done: new Promise(() => undefined), steer: (text) => void queued.push(text), stop: () => undefined };

    const before = await spent();
    let cwd: string;
    try {
      await repo.ready();
      if (!repo.hasWorktree(row.id)) await repo.fetchBase();
      cwd = await repo.worktree(row.id, branch);
      if (o.identity) await repo.own(row.id, o.identity.uid, o.identity.gid);
    } catch (err) {
      log.error({ err, draft: row.id }, "could not prepare a draft's worktree for the chat");
      await add(row.id, number, "turn", { status: "failed", commit: null, costUsd: 0, reverted: false });
      live.delete(row.id);
      return;
    }

    const gate = o.proxy.admit({
      open: () => !run.capped && before + run.spentUsd < o.capUsd,
      spend: (usd) => {
        run.spentUsd += usd;
        run.log = run.log.then(async () => {
          await db.insert(schema.meter).values({ id: 1, spentUsd: usd }).onConflictDoUpdate({ target: schema.meter.id, set: { spentUsd: sql`${schema.meter.spentUsd} + ${usd}` } });
          await db.update(schema.draft).set({ spentUsd: sql`${schema.draft.spentUsd} + ${usd}` }).where(eq(schema.draft.id, row.id));
        });
        // The cap is all drafts together, and a turn that reaches it stops where it stands (ADR 0047).
        if (before + run.spentUsd >= o.capUsd && !run.capped) {
          run.capped = true;
          log.warn({ draft: row.id, turn: number, capUsd: o.capUsd }, "spend cap reached: stopping the turn");
          run.turn.stop();
        }
      },
    });

    const onEvent = (e: AgentEvent): void => {
      run.log = run.log
        .then(async () => {
          if (e.kind === "session") await db.update(schema.draft).set({ chatSession: e.id }).where(eq(schema.draft.id, row.id));
          else if (e.kind === "reply") await add(row.id, number, "reply", { text: e.text });
          else if (e.kind === "step") run.steps.set(e.id, await add(row.id, number, "step", { tool: e.tool, summary: e.summary, detail: null, failed: false }));
          else {
            const item = run.steps.get(e.id);
            if (item !== undefined) await db.update(schema.chatItem).set({ data: sql`${schema.chatItem.data} || ${JSON.stringify({ detail: e.detail, failed: e.failed })}::jsonb` }).where(eq(schema.chatItem.id, item));
          }
        })
        .catch((err: unknown) => log.error({ err, draft: row.id }, "could not record a chat event"));
    };

    const turn = o.runner.start({
      cwd,
      puzzle: row.puzzle,
      prompt: `${input.text}\n${context(row.numbers, input.refusals, input.rounds, run.allowed)}`,
      model: MODEL_IDS[input.model],
      session: row.chatSession,
      modelUrl: o.proxy.url,
      modelToken: gate.token,
      host: {
        mayWrite: (path) => {
          const rel = repoPath(cwd, path);
          // Outside the worktree there is nothing of the repository's to allow: refused, and not put to the owner.
          if (rel === null) return false;
          if (mayWrite(row.puzzle, rel, run.allowed)) return true;
          ask(row.id, run, rel);
          return false;
        },
        setNumbers: async (set, reset) => {
          const now = await fresh(row.id);
          if (!now) return "The draft is gone.";
          let numbers: DraftNumbers;
          try {
            numbers = withNumbers(now.numbers, set, reset);
          } catch (err) {
            return `Not set: ${err instanceof Error ? err.message : String(err)}`;
          }
          await db.update(schema.draft).set({ numbers, revision: sql`${schema.draft.revision} + 1`, updatedAt: new Date() }).where(eq(schema.draft.id, row.id));
          return `Set. The draft now changes: ${JSON.stringify({ config: numbers.overrides, roundSeconds: numbers.roundSeconds, paceSeconds: numbers.paceSeconds, thresholds: numbers.thresholds })}. The owner's controls have moved. Whether the build plays these is checked on the owner's page and reported in their next message.`;
        },
        numbers: async () => (await fresh(row.id))?.numbers ?? row.numbers,
        emit: onEvent,
      },
    });
    run.turn = turn;
    for (const text of queued) turn.steer(text);
    if (run.stopped) turn.stop();

    const ended = turn.done
      .then((result) => finish(row, run, result))
      .catch((err: unknown) => {
        log.error({ err, draft: row.id }, "could not finish a chat turn");
        live.delete(row.id);
      })
      .finally(() => {
        gate.close();
        finishing.delete(ended);
      });
    finishing.add(ended);
  }

  return {
    capUsd: o.capUsd,
    async start() {
      // A turn the last process died under never wrote how it ended. Say so, so the page does not wait for it.
      const open = await db.execute<{ draft_id: string; turn: number }>(sql`
        select u.draft_id, u.turn from studio.chat_item u
        where u.kind = 'user' and not exists (select 1 from studio.chat_item t where t.draft_id = u.draft_id and t.turn = u.turn and t.kind = 'turn')
        group by u.draft_id, u.turn`);
      for (const r of open) await add(r.draft_id, r.turn, "turn", { status: "failed", commit: null, costUsd: 0, reverted: false });
    },
    async send(row, input) {
      const run = live.get(row.id);
      if (!run) return begin(row, input);
      // A message sent while a turn runs steers that turn (ADR 0042 decision 5).
      await add(row.id, run.number, "user", { text: input.text, model: input.model, steer: true });
      run.turn.steer(`${input.text}\n${context((await fresh(row.id))?.numbers ?? row.numbers, input.refusals, input.rounds, run.allowed)}`);
    },
    stop(draftId) {
      const run = live.get(draftId);
      if (!run) return;
      run.stopped = true;
      run.turn.stop();
    },
    stopAll() {
      for (const run of live.values()) {
        run.stopped = true;
        run.turn.stop();
      }
    },
    async revert(row, turn) {
      if (live.has(row.id)) return false;
      const [item] = await db.select().from(schema.chatItem).where(and(eq(schema.chatItem.draftId, row.id), eq(schema.chatItem.turn, turn), eq(schema.chatItem.kind, "turn"))).limit(1);
      const sha = item?.data.commit;
      if (!item || typeof sha !== "string" || item.data.reverted === true) return false;
      if (!(await repo.revert(row.id, sha, `Revert chat turn ${turn} on ${row.puzzle}`))) return false;
      await db.update(schema.chatItem).set({ data: { ...item.data, reverted: true } }).where(eq(schema.chatItem.id, item.id));
      return true;
    },
    async answer(row, itemId, allow) {
      const [item] = await db.select().from(schema.chatItem).where(and(eq(schema.chatItem.id, itemId), eq(schema.chatItem.draftId, row.id), eq(schema.chatItem.kind, "ask"))).limit(1);
      const path = item?.data.path;
      if (!item || typeof path !== "string" || item.data.state !== "pending") return false;
      await db.update(schema.chatItem).set({ data: { ...item.data, state: allow ? "allowed" : "refused" } }).where(eq(schema.chatItem.id, item.id));
      if (!allow) return true;
      const paths = [...new Set([...row.allowedPaths, path])];
      await db.update(schema.draft).set({ allowedPaths: paths }).where(eq(schema.draft.id, row.id));
      const run = live.get(row.id);
      if (run) {
        run.allowed.push(path);
        run.asked.delete(path);
        run.turn.steer(`The owner has allowed writes to ${path} for this draft. Carry on with what needed it.`);
      }
      return true;
    },
    async items(draftId, after) {
      const rows = await db.select().from(schema.chatItem).where(and(eq(schema.chatItem.draftId, draftId), gt(schema.chatItem.id, after))).orderBy(asc(schema.chatItem.id));
      return rows.map((r) => ({ id: r.id, turn: r.turn, kind: r.kind, at: r.createdAt.toISOString(), ...r.data }) as ChatItem);
    },
    running: (draftId) => live.has(draftId),
    spent,
    async idle() {
      while (finishing.size) await Promise.all([...finishing]);
    },
  };
}

export type { ChatModel };
