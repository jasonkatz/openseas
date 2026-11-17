import { and, asc, eq, gt, sql } from "drizzle-orm";
import { picksOf, wordsOf, type ChatFailure, type ChatItem, type ChatModel, type DraftNumbers, type RoundSummary, type SendChat } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import type { DraftRow } from "../drafts.js";
import { newLinkId } from "../links.js";
import { titleOf, type ChatRow } from "./chats.js";
import type { Logger } from "../log.js";
import type { Repo } from "../save/repo.js";
import { branchFor } from "../save/saver.js";
import { MODEL_IDS } from "./prices.js";
import type { ModelProxy } from "./proxy.js";
import type { AgentEvent, AgentRunner, AgentTurn, TurnResult } from "./runner.js";
import type { AgentIdentity } from "./sdkRunner.js";
import { mayWrite, repoPath } from "./scope.js";
import type { Takes } from "../takes/takes.js";

export interface ChatOptions {
  db: Db;
  repo: Repo;
  runner: AgentRunner;
  proxy: ModelProxy;
  /** The agent's unix user, whose the worktree's files are made before a turn; null where the service cannot become another user. */
  identity: AgentIdentity | null;
  /** US dollars: all the chat may spend, every draft together (ADR 0047). */
  capUsd: number;
  /** The library a turn's takes are kept in when it ends (ADR 0051); null when the service has no bucket. */
  takes: Takes | null;
  log: Logger;
}

/**
 * The chat (ADR 0042 decisions 5, 6, 8 and 9; ADR 0047; ADR 0060): a turn of the agent on a draft's
 * worktree for each message, held by the service to the puzzle's own files, committed when it
 * ends, and stopped where it stands when the one spend cap is reached. A draft has many chats,
 * each its own conversation and session, and runs one turn at a time, whichever chat's it is.
 */
export interface Chat {
  /** At startup: nothing is running, whatever the last process left. */
  start(): Promise<void>;
  /**
   * A message from the owner to a chat, or to a new one when `chat` is null. It starts a turn, or
   * steers the one running in that chat. A chat whose draft is gone is carried onto this one. The
   * chat's id; "busy" while another chat's turn runs on the draft, and nothing is done.
   */
  send(row: DraftRow, chat: ChatRow | null, input: SendChat): Promise<string | "busy">;
  /** Stop the chat's turn where it stands. What it had edited is still committed, so it can be reverted. */
  stop(chatId: string): void;
  /** At shutdown: stop every running turn where it stands, as `stop` does one. */
  stopAll(): void;
  /** Undo one turn's edits with a new commit. False when the turn made none, was reverted already, no longer comes out cleanly, or its draft is gone. */
  revert(chat: ChatRow, turn: number): Promise<boolean>;
  /** The owner's answer to a refused write: allow that path for the chat's draft, or not. False when there is no such question. */
  answer(chat: ChatRow, itemId: number, allow: boolean): Promise<boolean>;
  items(chatId: string, after: number): Promise<ChatItem[]>;
  /** Whether a turn of this chat runs. */
  running(chatId: string): boolean;
  /** Whether a turn runs on this draft, whichever chat's. */
  busy(draftId: string): boolean;
  /** The words of the reply being written on the chat's turn, so far; empty when none is. */
  live(chatId: string): string;
  /** Be told what happens in a chat, as it happens, in order (ADR 0055), and when its draft starts or ends another chat's turn. The answer ends it. */
  subscribe(chat: { id: string; draftId: string | null }, listener: (signal: ChatSignal) => void): () => void;
  spent(): Promise<number>;
  readonly capUsd: number;
  /** Resolves when no turn is running or being finished. For tests and shutdown. */
  idle(): Promise<void>;
}

/**
 * What a chat tells whoever watches it. `item`: a line was added, or one changed. `delta`: more
 * words of the reply being written, after forgetting the words so far when `reset`. `status`:
 * something else of the chat's changed (a turn started or ended, money was spent, a number moved);
 * the watcher reads what it needs.
 */
export type ChatSignal = { type: "item"; item: ChatItem } | { type: "delta"; text: string; reset: boolean } | { type: "status" };

const OVERRIDE = "config.";
/** How much of what was said as a turn failed is kept for the owner. */
const ERROR_MAX = 600;
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
  // The owner picks every take (ADR 0040); the agent is told which, and has no tool that picks.
  const picks = picksOf(numbers);
  const short = (o: Record<string, string>): string => Object.entries(o).map(([name, hash]) => `${name}: ${hash === "synth" ? "the synthesized cue" : hash.slice(0, 12)}`).join(", ");
  if (Object.keys(picks.sounds).length) lines.push(`Draft picks, sounds (cue: the start of the picked take's sha256, which is that of its \`placed-<n>.mp3\`): ${short(picks.sounds)}`);
  // The owner's own rewrites of the puzzle's strings (ADR 0057): Save writes them to the message table, so the agent leaves those keys be.
  const words = wordsOf(numbers);
  if (Object.keys(words.texts).length) lines.push(`Draft words (message key: the owner's rewrite, which Save writes to the message table; do not edit these keys yourself): ${JSON.stringify(words.texts)}`);
  if (words.category) lines.push(`Draft category: ${words.category}`);
  if (refusals.length) lines.push("The current build refuses these numbers, so nothing is dealt until they are fixed:", ...refusals.map((r) => `- ${r}`));
  if (rounds.length) {
    lines.push("Last rounds played, oldest first:");
    for (const r of rounds) lines.push(`- seed ${r.seed}: score ${r.score}, ${r.tier ? `tier ${r.tier}` : "unrated"}, ${Math.round(r.seconds)}s, ${r.moves} moves, on the ${r.tuned ? "draft's" : "shipped"} numbers`);
  } else lines.push("No round has been played on this page yet.");
  if (allowed.length) lines.push(`Paths the owner has allowed beyond the puzzle's own files: ${allowed.join(", ")}`);
  return lines.join("\n");
}

interface Running {
  chatId: string;
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
  /** The draft's worktree, once the turn has one. */
  cwd: string | null;
  /** The reply being written, so far. */
  live: string;
}

type ItemRow = typeof schema.chatItem.$inferSelect;
/**
 * A row as the page reads it. A line from a draft that is gone is shown as it ended: its commit went
 * with the draft's branch and cannot be reverted, and a question it put is no longer anyone's to answer.
 */
const toItem = (r: ItemRow): ChatItem => {
  const data = r.draftId !== null ? r.data : r.kind === "turn" ? { ...r.data, commit: null } : r.kind === "ask" && r.data.state === "pending" ? { ...r.data, state: "refused" } : r.data;
  return { id: r.id, turn: r.turn, kind: r.kind, at: r.createdAt.toISOString(), ...data } as ChatItem;
};

/** How much of an earlier conversation a carried chat's first message gives the agent, from its end. */
const CARRIED_MAX = 24_000;
/** What the agent is told of a chat that began on a draft that is gone (ADR 0060): what was said, and that the work went with the draft. */
export function carried(items: readonly ChatItem[]): string {
  const lines: string[] = [];
  for (const i of items) {
    if (i.kind === "user") lines.push(`The owner${i.steer ? " (while you worked)" : ""}: ${i.text}`);
    else if (i.kind === "reply") lines.push(`You: ${i.text}`);
  }
  let said = lines.join("\n\n");
  if (said.length > CARRIED_MAX) said = `[earlier lines left out]\n\n${said.slice(-CARRIED_MAX)}`;
  return [
    "This conversation began on an earlier draft of this puzzle, which is gone: its pull request merged or closed, or the owner discarded it. Its worktree and commits went with it, so whatever it edited is in main now or nowhere; look before you assume. Your earlier session is not available. What was said, oldest first:",
    "",
    "<earlier-conversation>",
    said,
    "</earlier-conversation>",
    "",
    "The owner's new message:",
    "",
  ].join("\n");
}

export function createChat(o: ChatOptions): Chat {
  const { db, repo, log } = o;
  const live = new Map<string, Running>();
  const finishing = new Set<Promise<void>>();

  /** Watchers by chat, and the draft each watched chat is on, so a draft's news reaches every chat of it that is watched. */
  const watchers = new Map<string, Set<(signal: ChatSignal) => void>>();
  const homes = new Map<string, string | null>();
  /** A watcher that throws is that watcher's trouble: the turn and the others carry on. */
  const tell = (chatId: string, signal: ChatSignal): void => {
    for (const listener of watchers.get(chatId) ?? []) {
      try {
        listener(signal);
      } catch (err) {
        log.warn({ err, chat: chatId }, "a chat watcher failed");
      }
    }
  };
  /** Something of the draft's changed (a turn of one of its chats started or ended, a number moved): every chat of it hears. */
  const tellDraft = (draftId: string): void => {
    for (const [chatId, home] of homes) if (home === draftId) tell(chatId, { type: "status" });
  };
  const add = async (chatId: string, draftId: string, turn: number, kind: ChatItem["kind"], data: Record<string, unknown>): Promise<number> => {
    const [row] = await db.insert(schema.chatItem).values({ chatId, draftId, turn, kind, data }).returning();
    tell(chatId, { type: "item", item: toItem(row!) });
    return row!.id;
  };
  /** Change some of a line, and tell the watchers the line as it now is. */
  const patch = async (itemId: number, data: Record<string, unknown>): Promise<void> => {
    const [row] = await db.update(schema.chatItem).set({ data: sql`${schema.chatItem.data} || ${JSON.stringify(data)}::jsonb` }).where(eq(schema.chatItem.id, itemId)).returning();
    if (row) tell(row.chatId, { type: "item", item: toItem(row) });
  };
  const touch = (chatId: string): Promise<unknown> => db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chatId));
  const runOf = (chatId: string): Running | undefined => [...live.values()].find((r) => r.chatId === chatId);
  const failed = (reason: ChatFailure, error?: string): Record<string, unknown> => ({ status: "failed", reason, error: error ? error.slice(0, ERROR_MAX) : null, commit: null, costUsd: 0, reverted: false });
  const fresh = async (id: string): Promise<DraftRow | null> => (await db.select().from(schema.draft).where(eq(schema.draft.id, id)).limit(1))[0] ?? null;
  const spent = async (): Promise<number> => (await db.select().from(schema.meter).where(eq(schema.meter.id, 1)).limit(1))[0]?.spentUsd ?? 0;

  /** A refused write, put to the owner once a turn a path. */
  const ask = (draftId: string, run: Running, path: string): void => {
    if (run.asked.has(path)) return;
    run.asked.add(path);
    run.log = run.log.then(() => add(run.chatId, draftId, run.number, "ask", { path, state: "pending" }));
  };

  async function finish(row: DraftRow, run: Running, result: TurnResult): Promise<void> {
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
    // Whatever takes the turn's commands made are kept now, so the owner's panels list them (ADR 0051).
    // What they cost was metered as the scripts made them, through the proxy (ADR 0059).
    if (o.takes && run.cwd) {
      try {
        await o.takes.ingest(run.cwd, { draft: row.id, puzzle: row.puzzle, owner: row.owner });
      } catch (err) {
        log.error({ err, draft: row.id }, "could not keep a turn's takes");
      }
    }
    const status = run.capped ? "capped" : run.stopped ? "stopped" : result.status;
    if (status === "failed") log.warn({ draft: row.id, turn: run.number, error: result.error }, "chat turn failed");
    try {
      await add(run.chatId, row.id, run.number, "turn", { status, commit, costUsd: run.spentUsd, reverted: false, ...(status === "failed" ? { reason: result.reason ?? "agent", error: result.error?.slice(0, ERROR_MAX) ?? null } : {}) });
      await touch(run.chatId);
    } finally {
      // Whatever became of the row, the draft is not left with a turn that never ends.
      live.delete(row.id);
      tellDraft(row.id);
      tell(run.chatId, { type: "status" });
    }
  }

  async function begin(row: DraftRow, chat: ChatRow | null, input: SendChat): Promise<string> {
    const number = row.chatTurns + 1;
    const chatId = chat?.id ?? newLinkId();
    // Reserved before anything is awaited, so a second message steers this turn and does not start another.
    const run: Running = { chatId, turn: null as unknown as AgentTurn, number, stopped: false, capped: false, spentUsd: 0, asked: new Set(), steps: new Map(), allowed: [...row.allowedPaths], log: Promise.resolve(), cwd: null, live: "" };
    live.set(row.id, run);
    const queued: string[] = [];
    run.turn = { done: new Promise(() => undefined), steer: (text) => void queued.push(text), stop: () => undefined };

    // A chat whose draft is gone is carried onto this one: its session was the old worktree's, so the agent starts afresh and is told what was said.
    const moved = chat !== null && chat.draftId !== row.id;
    const earlier = chat !== null && chat.turns > 0 && (moved || chat.session === null) ? carried(await allItems(chatId)) : "";
    const session = moved ? null : (chat?.session ?? null);
    const branch = branchFor(row);
    try {
      await db.update(schema.draft).set({ chatTurns: number, branch }).where(eq(schema.draft.id, row.id));
      if (chat) await db.update(schema.chat).set({ draftId: row.id, session, turns: sql`${schema.chat.turns} + 1`, updatedAt: new Date() }).where(eq(schema.chat.id, chatId));
      else await db.insert(schema.chat).values({ id: chatId, owner: row.owner, puzzle: row.puzzle, draftId: row.id, title: titleOf(input.text), turns: 1 });
      if (watchers.has(chatId)) homes.set(chatId, row.id);
      await add(chatId, row.id, number, "user", { text: input.text, model: input.model, steer: false });
    } catch (err) {
      live.delete(row.id);
      throw err;
    }
    tellDraft(row.id);
    tell(chatId, { type: "status" });

    let before: number;
    let cwd: string;
    try {
      before = await spent();
      await repo.ready();
      if (!repo.hasWorktree(row.id)) await repo.fetchBase();
      cwd = await repo.worktree(row.id, branch);
      if (o.identity) await repo.own(row.id, o.identity.uid, o.identity.gid);
      run.cwd = cwd;
    } catch (err) {
      log.error({ err, draft: row.id }, "could not prepare a draft's worktree for the chat");
      live.delete(row.id);
      await add(chatId, row.id, number, "turn", failed("worktree", err instanceof Error ? err.message : String(err))).catch((e: unknown) => log.error({ err: e, draft: row.id }, "could not record a failed turn"));
      tellDraft(row.id);
      tell(chatId, { type: "status" });
      return chatId;
    }

    const gate = o.proxy.admit({
      open: () => !run.capped && before + run.spentUsd < o.capUsd,
      spend: (usd) => {
        run.spentUsd += usd;
        run.log = run.log
          .then(async () => {
            await db.insert(schema.meter).values({ id: 1, spentUsd: usd }).onConflictDoUpdate({ target: schema.meter.id, set: { spentUsd: sql`${schema.meter.spentUsd} + ${usd}` } });
            await db.update(schema.draft).set({ spentUsd: sql`${schema.draft.spentUsd} + ${usd}` }).where(eq(schema.draft.id, row.id));
            await db.update(schema.chat).set({ spentUsd: sql`${schema.chat.spentUsd} + ${usd}` }).where(eq(schema.chat.id, chatId));
            tell(chatId, { type: "status" });
          })
          // A write that failed must not stop every later one of the turn's: the chain carries on.
          .catch((err: unknown) => log.error({ err, draft: row.id }, "could not record what a turn spent"));
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
          if (e.kind === "session") await db.update(schema.chat).set({ session: e.id }).where(eq(schema.chat.id, chatId));
          else if (e.kind === "delta") {
            // Never a row: the whole block follows as a reply. Kept here so a page that connects mid-reply is given the words so far.
            run.live = e.reset ? e.text : run.live + e.text;
            tell(chatId, { type: "delta", text: e.text, reset: e.reset });
          } else if (e.kind === "reply") {
            await add(chatId, row.id, number, "reply", { text: e.text });
            // The line now says it whole.
            run.live = "";
            tell(chatId, { type: "delta", text: "", reset: true });
          } else if (e.kind === "step") run.steps.set(e.id, await add(chatId, row.id, number, "step", { tool: e.tool, summary: e.summary, detail: null, failed: false }));
          else {
            const item = run.steps.get(e.id);
            if (item !== undefined) await patch(item, { detail: e.detail, failed: e.failed });
          }
        })
        .catch((err: unknown) => log.error({ err, draft: row.id }, "could not record a chat event"));
    };

    let turn: AgentTurn;
    try {
      turn = o.runner.start({
        cwd,
        puzzle: row.puzzle,
        prompt: `${earlier}${input.text}\n${context(row.numbers, input.refusals, input.rounds, run.allowed)}`,
        model: MODEL_IDS[input.model],
        session,
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
            // The owner's controls follow at once, not at the turn's end.
            tellDraft(row.id);
            return `Set. The draft now changes: ${JSON.stringify({ config: numbers.overrides, roundSeconds: numbers.roundSeconds, paceSeconds: numbers.paceSeconds, thresholds: numbers.thresholds })}. The owner's controls have moved. Whether the build plays these is checked on the owner's page and reported in their next message.`;
          },
          numbers: async () => (await fresh(row.id))?.numbers ?? row.numbers,
          emit: onEvent,
        },
      });
    } catch (err) {
      // An agent that could not even be started is a turn that failed, said so, and not a draft held for good.
      log.error({ err, draft: row.id }, "could not start the agent");
      turn = { done: Promise.resolve({ status: "failed", error: err instanceof Error ? err.message : String(err) }), steer: () => undefined, stop: () => undefined };
    }
    run.turn = turn;
    for (const text of queued) turn.steer(text);
    if (run.stopped) turn.stop();

    const ended = turn.done
      .then((result) => finish(row, run, result))
      .catch((err: unknown) => {
        log.error({ err, draft: row.id }, "could not finish a chat turn");
        live.delete(row.id);
        tellDraft(row.id);
        tell(chatId, { type: "status" });
      })
      .finally(() => {
        gate.close();
        finishing.delete(ended);
      });
    finishing.add(ended);
    return chatId;
  }

  async function allItems(chatId: string): Promise<ChatItem[]> {
    const rows = await db.select().from(schema.chatItem).where(eq(schema.chatItem.chatId, chatId)).orderBy(asc(schema.chatItem.id));
    return rows.map(toItem);
  }

  return {
    capUsd: o.capUsd,
    async start() {
      // A turn the last process died under never wrote how it ended. Say so, so the page does not wait for it.
      const open = await db.execute<{ chat_id: string; draft_id: string | null; turn: number }>(sql`
        select u.chat_id, u.draft_id, u.turn from studio.chat_item u
        where u.kind = 'user' and not exists (select 1 from studio.chat_item t where t.chat_id = u.chat_id and t.turn = u.turn and t.kind = 'turn')
        group by u.chat_id, u.draft_id, u.turn`);
      for (const r of open) {
        const [row] = await db.insert(schema.chatItem).values({ chatId: r.chat_id, draftId: r.draft_id, turn: r.turn, kind: "turn", data: failed("restart") }).returning();
        tell(r.chat_id, { type: "item", item: toItem(row!) });
      }
    },
    async send(row, chat, input) {
      const run = live.get(row.id);
      if (!run) return begin(row, chat, input);
      // A draft runs one turn at a time: a message to another of its chats waits for this one.
      if (chat?.id !== run.chatId) return "busy";
      // A message sent while a turn runs steers that turn (ADR 0042 decision 5).
      await add(run.chatId, row.id, run.number, "user", { text: input.text, model: input.model, steer: true });
      await touch(run.chatId);
      run.turn.steer(`${input.text}\n${context((await fresh(row.id))?.numbers ?? row.numbers, input.refusals, input.rounds, run.allowed)}`);
      return run.chatId;
    },
    stop(chatId) {
      const run = runOf(chatId);
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
    async revert(chat, turn) {
      const draftId = chat.draftId;
      if (!draftId || live.has(draftId)) return false;
      const row = await fresh(draftId);
      if (!row) return false;
      const [item] = await db
        .select()
        .from(schema.chatItem)
        .where(and(eq(schema.chatItem.chatId, chat.id), eq(schema.chatItem.draftId, draftId), eq(schema.chatItem.turn, turn), eq(schema.chatItem.kind, "turn")))
        .limit(1);
      const sha = item?.data.commit;
      if (!item || typeof sha !== "string" || item.data.reverted === true) return false;
      if (!(await repo.revert(draftId, sha, `Revert chat turn ${turn} on ${row.puzzle}`))) return false;
      await patch(item.id, { reverted: true });
      return true;
    },
    async answer(chat, itemId, allow) {
      const draftId = chat.draftId;
      if (!draftId) return false;
      const [item] = await db
        .select()
        .from(schema.chatItem)
        .where(and(eq(schema.chatItem.id, itemId), eq(schema.chatItem.chatId, chat.id), eq(schema.chatItem.draftId, draftId), eq(schema.chatItem.kind, "ask")))
        .limit(1);
      const path = item?.data.path;
      if (!item || typeof path !== "string" || item.data.state !== "pending") return false;
      await patch(item.id, { state: allow ? "allowed" : "refused" });
      if (!allow) return true;
      const row = await fresh(draftId);
      if (!row) return true;
      const paths = [...new Set([...row.allowedPaths, path])];
      await db.update(schema.draft).set({ allowedPaths: paths }).where(eq(schema.draft.id, draftId));
      // The path is the draft's to write now, whichever of its chats is running.
      const run = live.get(draftId);
      if (run) {
        run.allowed.push(path);
        run.asked.delete(path);
        run.turn.steer(`The owner has allowed writes to ${path} for this draft. Carry on with what needed it.`);
      }
      return true;
    },
    async items(chatId, after) {
      const rows = await db.select().from(schema.chatItem).where(and(eq(schema.chatItem.chatId, chatId), gt(schema.chatItem.id, after))).orderBy(asc(schema.chatItem.id));
      return rows.map(toItem);
    },
    running: (chatId) => runOf(chatId) !== undefined,
    busy: (draftId) => live.has(draftId),
    live: (chatId) => runOf(chatId)?.live ?? "",
    subscribe(chat, listener) {
      const set = watchers.get(chat.id) ?? new Set();
      watchers.set(chat.id, set);
      homes.set(chat.id, chat.draftId);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0 && watchers.get(chat.id) === set) {
          watchers.delete(chat.id);
          homes.delete(chat.id);
        }
      };
    },
    spent,
    async idle() {
      while (finishing.size) await Promise.all([...finishing]);
    },
  };
}

export type { ChatModel };
