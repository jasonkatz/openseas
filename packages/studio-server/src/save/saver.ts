import { eq } from "drizzle-orm";
import type { DraftSaveError } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import type { DraftRow } from "../drafts.js";
import type { Logger } from "../log.js";
import { UnknownKeyError, contentPath, describeNumbers, writeNumbers } from "./content.js";
import { ForgeError, type Forge } from "./forge.js";
import type { Repo } from "./repo.js";

export interface SaverOptions {
  db: Db;
  repo: Repo;
  forge: Forge;
  log: Logger;
  /** The branch pull requests are opened against. */
  base: string;
  /** The studio site, for the tester link in a pull request's body. */
  studioOrigin: string;
}

/**
 * Save for a draft's numbers (ADR 0042 decision 10, ADR 0046), after the tester link, which the
 * route makes at once: the numbers written into the puzzle's content file in the draft's
 * worktree, a commit, a push, and a draft pull request from the studio's GitHub App with the
 * owner named in its body. A later Save adds commits to the same pull request. The checklist for
 * a changed puzzle is not run here: the pull request stays a draft and says so.
 */
export interface Saver {
  /** At startup: a Save the last process died under is marked as such, and the clone is made if the volume is new. */
  start(): Promise<void>;
  /** Mark a draft as being saved and write its branch in the background. `linkId` is the tester link this Save made. */
  save(row: DraftRow, login: string, linkId: string): Promise<DraftRow>;
  /** Mark a draft as being saved and merge the base branch into its branch in the background. It is never rebased. */
  update(row: DraftRow): Promise<DraftRow>;
  /**
   * The rows that are still drafts, each with whether the base branch has moved under it. A draft
   * whose pull request was merged or closed is cleared here: its row, worktree and branch go.
   */
  refresh(rows: DraftRow[]): Promise<Array<{ row: DraftRow; behind: boolean }>>;
  /** What a discarded draft leaves on GitHub and on the volume: its pull request closed, its branch and worktree gone. */
  discard(row: DraftRow): Promise<void>;
  /** Resolves when no Save or update is running. For tests. */
  idle(): Promise<void>;
}

export const branchFor = (row: Pick<DraftRow, "puzzle" | "id" | "branch">): string => row.branch ?? `studio/${row.puzzle}-${row.id}`;

const short = (v: unknown): string => {
  const text = v === undefined ? "(none)" : JSON.stringify(v);
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
};

type Changes = ReturnType<typeof describeNumbers>;

export function commitMessage(puzzle: string, changes: Changes): string {
  if (changes.length === 0) return `Put ${puzzle}'s numbers back from the studio`;
  return `Tune ${puzzle} from the studio\n\n${changes.map((c) => `${c.key}: ${short(c.from)} -> ${short(c.to)}`).join("\n")}`;
}

/** The body of a draft's pull request: who saved it, what it changes, where to play it, and what has not been done to it yet. */
export function pullBody(o: { puzzle: string; login: string; changes: Changes; linkUrl: string }): string {
  const cell = (v: unknown): string => `\`${short(v).replace(/\|/g, "\\|").replace(/`/g, "'")}\``;
  const table = o.changes.length ? ["| Key | Shipped | Draft |", "|---|---|---|", ...o.changes.map((c) => `| \`${c.key}\` | ${cell(c.from)} | ${cell(c.to)} |`)].join("\n") : "No number differs from the base branch now.";
  return [
    `Saved from the puzzle studio by [${o.login}](https://github.com/${o.login}).`,
    `Numbers changed in \`${contentPath(o.puzzle)}\`:`,
    table,
    `Play it: ${o.linkUrl}`,
    "This pull request is a draft. Only the numbers were written: the checklist for a changed puzzle (design file, guide, capture, strings) has not been run on it.",
  ].join("\n\n");
}

/** How long a pull request's state is taken as read before GitHub is asked again. */
const PULL_CHECK_MS = 30_000;
/** How old the last fetch of the base branch may be when a draft is asked whether it is behind. */
const BASE_FETCH_MS = 60_000;

export function createSaver(o: SaverOptions): Saver {
  const { db, repo, forge, log } = o;
  const checked = new Map<string, number>();
  let jobs: Promise<void> = Promise.resolve();

  const mark = async (id: string, set: Partial<typeof schema.draft.$inferInsert>): Promise<DraftRow | null> => {
    const [row] = await db.update(schema.draft).set(set).where(eq(schema.draft.id, id)).returning();
    return row ?? null;
  };
  const fresh = async (id: string): Promise<DraftRow | null> => (await db.select().from(schema.draft).where(eq(schema.draft.id, id)).limit(1))[0] ?? null;

  const errorOf = (e: unknown): DraftSaveError => (e instanceof UnknownKeyError ? "unknown_key" : e instanceof ForgeError ? "github" : e instanceof Failed ? e.code : "git");
  class Failed extends Error {
    constructor(readonly code: DraftSaveError) {
      super(code);
    }
  }

  /** One job at a time, and whatever a job throws is the draft's to show, never the process's to die of. */
  const enqueue = (id: string, what: string, work: () => Promise<void>): void => {
    jobs = jobs.then(async () => {
      try {
        await work();
        await mark(id, { saveState: "idle", saveError: null });
      } catch (e) {
        const code = errorOf(e);
        if (code === "git" || code === "github") log.error({ err: e, draft: id }, `${what} failed`);
        else log.info({ draft: id, code }, `${what} refused`);
        await mark(id, { saveState: "failed", saveError: code }).catch((err: unknown) => log.error({ err }, "could not record a failed save"));
      }
    });
  };

  async function saveJob(id: string, login: string, linkId: string): Promise<void> {
    const row = await fresh(id);
    if (!row) return;
    const branch = branchFor(row);
    const path = contentPath(row.puzzle);
    await repo.ready();
    await repo.fetchBase();
    await repo.worktree(id, branch);
    const before = await repo.read(id, path);
    const base = await repo.baseFile(id, path);
    const after = writeNumbers(before, row.numbers, row.savedNumbers, base);
    if (after !== before) await repo.write(id, path, after);
    await repo.commit(id, commitMessage(row.puzzle, describeNumbers(before, row.numbers)));
    // Recorded before the push: if that fails, the next Save still knows what this one wrote.
    await mark(id, { branch, savedNumbers: row.numbers });
    if ((await repo.ahead(id)) === 0) throw new Failed("nothing");
    await repo.push(id, branch);
    const body = pullBody({ puzzle: row.puzzle, login, changes: describeNumbers(base ?? before, row.numbers), linkUrl: `${o.studioOrigin}/play/${linkId}` });
    if (row.pullNumber === null) {
      const pull = await forge.openPull({ head: branch, base: o.base, title: `Tune ${row.puzzle}: numbers from the studio`, body });
      await mark(id, { pullNumber: pull.number, pullUrl: pull.url });
      log.info({ draft: id, pull: pull.number }, "draft pull request opened");
    } else await forge.describePull(row.pullNumber, body);
    await mark(id, { savedRevision: row.revision });
  }

  async function updateJob(id: string): Promise<void> {
    const row = await fresh(id);
    if (!row?.branch) return;
    await repo.ready();
    await repo.fetchBase();
    await repo.worktree(id, row.branch);
    if (!(await repo.mergeBase(id))) throw new Failed("conflict");
    await repo.push(id, row.branch);
  }

  async function clear(row: DraftRow, why: string): Promise<void> {
    await db.delete(schema.draft).where(eq(schema.draft.id, row.id));
    checked.delete(row.id);
    log.info({ draft: row.id, pull: row.pullNumber, why }, "draft cleared with its pull request");
    if (row.branch) await repo.remove(row.id, row.branch, false).catch((err: unknown) => log.warn({ err, draft: row.id }, "could not remove a cleared draft's worktree"));
  }

  return {
    async start() {
      const stuck = await db.update(schema.draft).set({ saveState: "failed", saveError: "interrupted" }).where(eq(schema.draft.saveState, "saving")).returning({ id: schema.draft.id });
      if (stuck.length) log.warn({ drafts: stuck.map((r) => r.id) }, "saves interrupted by a restart");
      // The first clone takes a while; nothing waits for it but the first Save.
      void repo.ready().catch((err: unknown) => log.error({ err }, "could not clone the repository; Save will try again"));
    },
    async save(row, login, linkId) {
      const marked = (await mark(row.id, { saveState: "saving", saveError: null })) ?? row;
      enqueue(row.id, "save", () => saveJob(row.id, login, linkId));
      return marked;
    },
    async update(row) {
      const marked = (await mark(row.id, { saveState: "saving", saveError: null })) ?? row;
      enqueue(row.id, "update", () => updateJob(row.id));
      return marked;
    },
    async refresh(rows) {
      const out: Array<{ row: DraftRow; behind: boolean }> = [];
      for (const row of rows) {
        // Whatever GitHub or git cannot say now, the draft is still listed: it is the owner's work.
        try {
          if (row.pullNumber !== null && row.saveState !== "saving" && Date.now() - (checked.get(row.id) ?? 0) > PULL_CHECK_MS) {
            const state = await forge.pullState(row.pullNumber);
            checked.set(row.id, Date.now());
            if (state !== "open") {
              await clear(row, state);
              continue;
            }
          }
        } catch (err) {
          log.warn({ err, draft: row.id }, "could not read a draft's pull request");
        }
        let behind = false;
        try {
          if (row.branch && row.saveState !== "saving" && repo.hasWorktree(row.id)) {
            await repo.fetchBase(BASE_FETCH_MS).catch((err: unknown) => log.warn({ err }, "could not fetch the base branch"));
            behind = (await repo.behind(row.id)) > 0;
          }
        } catch (err) {
          log.warn({ err, draft: row.id }, "could not compare a draft with the base branch");
        }
        out.push({ row, behind });
      }
      return out;
    },
    async discard(row) {
      checked.delete(row.id);
      if (row.pullNumber !== null) await forge.closePull(row.pullNumber).catch((err: unknown) => log.warn({ err, draft: row.id }, "could not close a discarded draft's pull request"));
      if (row.branch) await repo.remove(row.id, row.branch, true).catch((err: unknown) => log.warn({ err, draft: row.id }, "could not remove a discarded draft's branch"));
    },
    idle: () => jobs,
  };
}
