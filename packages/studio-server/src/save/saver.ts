import { eq } from "drizzle-orm";
import { CueDataSchema, DrawingSchema, NO_LOOK, NO_WORDS, lookOf, wordsOf, type DraftSaveError } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import type { DraftRow } from "../drafts.js";
import type { Logger } from "../log.js";
import { UnknownKeyError, contentPath, cuesPath, describeLook, describeNumbers, describeTexts, messagesPath, piecesPath, writeLook, writeNumbers, writeTexts } from "./content.js";
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

/** A Save the service turns down, with the code the page shows. */
export class SaveRefused extends Error {
  constructor(readonly code: "nothing" | "conflict") {
    super(code);
  }
}

/**
 * Save (ADR 0042 decision 10, ADR 0046, ADR 0049), after the tester link, which
 * the route makes at once: the draft's numbers written into the puzzle's content file in its worktree
 * its words into the message table (ADR 0057) and its pieces and cues into their files in
 * `boards/data` (ADR 0065), a commit, a push of that and of whatever
 * the chat's turns committed, and a draft pull request from the studio's GitHub App with the owner
 * named in its body. A later Save adds commits to the same pull
 * request. That is all of Save: the pull request stays a draft for a developer to finish. A draft
 * kept with picks of takes has them read past: Save places no sound and no picture (ADR 0062, ADR 0064).
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
type Texts = ReturnType<typeof describeTexts>;
/** The pieces and cues a Save redraws and revoices, by name (ADR 0065). */
export interface LookChanges {
  readonly pieces: readonly string[];
  readonly cues: readonly string[];
}
const NO_LOOK_CHANGES: LookChanges = { pieces: [], cues: [] };

export function commitMessage(puzzle: string, changes: Changes, texts: Texts = [], look: LookChanges = NO_LOOK_CHANGES): string {
  const lines = [...changes.map((c) => `${c.key}: ${short(c.from)} -> ${short(c.to)}`), ...texts.map((x) => `text ${x.key}: ${short(x.from)} -> ${short(x.to)}`), ...look.pieces.map((n) => `piece ${n} redrawn`), ...look.cues.map((n) => `cue ${n} revoiced`)];
  if (lines.length === 0) return `Put ${puzzle}'s numbers back from the studio`;
  const verb = changes.length ? "Tune" : texts.length ? "Reword" : "Restyle";
  return `${verb} ${puzzle} from the studio\n\n${lines.join("\n")}`;
}

/** How many of the agent's files a pull request's body names before it says how many more there are. */
const FILES_LISTED = 40;

/** What a draft's pull request is called: by its numbers, and its words when it rewrites any, more plainly when the chat edited files too. */
export const pullTitle = (puzzle: string, edited: readonly string[], words = false, look = false): string => {
  if (edited.length) return `Change ${puzzle} from the studio`;
  const parts = ["numbers", ...(words ? ["words"] : []), ...(look ? ["look"] : [])];
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Tune ${puzzle}: ${said} from the studio`;
};

/**
 * The body of a draft's pull request: who saved it, the numbers it changes, the strings it
 * rewrites, the files the chat's agent edited, where to play it, and what is left for a developer
 * (ADR 0049). `edited` is every file the branch changes but the puzzle's content file and the
 * message table.
 */
export function pullBody(o: { puzzle: string; login: string; changes: Changes; edited: readonly string[]; linkUrl: string; texts?: Texts; look?: LookChanges }): string {
  const texts = o.texts ?? [];
  const look = o.look ?? NO_LOOK_CHANGES;
  const restyled = look.pieces.length + look.cues.length > 0;
  const cell = (v: unknown): string => `\`${short(v).replace(/\|/g, "\\|").replace(/`/g, "'")}\``;
  const table = o.changes.length ? ["| Key | Shipped | Draft |", "|---|---|---|", ...o.changes.map((c) => `| \`${c.key}\` | ${cell(c.from)} | ${cell(c.to)} |`)].join("\n") : "No number differs from the base branch.";
  const files = o.edited.slice(0, FILES_LISTED).map((f) => `- \`${f}\``);
  if (o.edited.length > FILES_LISTED) files.push(`- and ${o.edited.length - FILES_LISTED} more`);
  const left = [
    "This pull request is a draft, and the studio leaves it there. It holds what was tuned and what the chat's agent edited, and nothing more: the rest of what a changed puzzle needs (its design file, its guide, a capture where the look changed, its strings) is for a developer to finish before marking it ready.",
    ...(texts.length ? [`A string changed: the puzzle's guide and its design file may quote it, so both are re-read (\`packages/docs\`, \`docs/puzzles\` or \`docs/prototypes\`).`] : []),
    ...(look.pieces.length ? [`A piece was redrawn: the guide's pictures are captured again (\`pnpm --filter @openseas/docs capture ${o.puzzle}\`), and the board is looked at with every piece in one colour (\`docs/BRAND.md\` section 3).`] : []),
    ...(look.cues.length ? ["A cue was revoiced in this puzzle's own copy: it is heard on this puzzle's board and no other, and the studio's sound tests hold it to `docs/BRAND.md` section 8."] : []),
  ];
  return [
    `Saved from the puzzle studio by [${o.login}](https://github.com/${o.login}).`,
    `Numbers changed in \`${contentPath(o.puzzle)}\`:`,
    table,
    ...(texts.length ? [`Strings rewritten in \`${messagesPath}\`:`, ["| Key | Shipped | Draft |", "|---|---|---|", ...texts.map((x) => `| \`${x.key}\` | ${cell(x.from)} | ${cell(x.to)} |`)].join("\n")] : []),
    ...(look.pieces.length ? [`Pieces redrawn in \`${piecesPath(o.puzzle)}\`: ${look.pieces.map((n) => `\`${n}\``).join(", ")}`] : []),
    ...(look.cues.length ? [`Cues revoiced in \`${cuesPath(o.puzzle)}\`: ${look.cues.map((n) => `\`${n}\``).join(", ")}`] : []),
    ...(o.edited.length ? ["Files edited by the studio's agent, in the chat, a commit a turn:", files.join("\n")] : []),
    `Play the numbers${texts.length ? " and words" : ""}${restyled ? " and look" : ""}: ${o.linkUrl}${o.edited.length ? " (the link plays the deployed build; the edits above are seen on this pull request's preview)" : ""}`,
    ...left,
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

  const errorOf = (e: unknown): DraftSaveError => (e instanceof UnknownKeyError ? "unknown_key" : e instanceof ForgeError ? "github" : e instanceof SaveRefused ? e.code : "git");

  /** One job at a time, and whatever a job throws is the draft's to show, never the process's to die of. */
  const enqueue = (id: string, what: string, work: () => Promise<void>): void => {
    jobs = jobs.then(async () => {
      try {
        await work();
        await mark(id, { saveState: "idle", saveError: null, saveErrorDetail: null });
      } catch (e) {
        const code = errorOf(e);
        if (code === "git" || code === "github") log.error({ err: e, draft: id }, `${what} failed`);
        else log.info({ draft: id, code }, `${what} refused`);
        await mark(id, { saveState: "failed", saveError: code, saveErrorDetail: null }).catch((err: unknown) => log.error({ err }, "could not record a failed save"));
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
    // The draft's strings go into the message table (ADR 0057), worked out before anything is written so a refusal writes nothing.
    const texts = wordsOf(row.numbers).texts;
    const savedTexts = (row.savedNumbers ? wordsOf(row.savedNumbers) : NO_WORDS).texts;
    const worded = Object.keys(texts).length > 0 || Object.keys(savedTexts).length > 0;
    const tableBefore = worded ? await repo.read(id, messagesPath) : "";
    const tableBase = worded ? await repo.baseFile(id, messagesPath) : null;
    const tableAfter = worded ? writeTexts(tableBefore, row.puzzle, texts, savedTexts, tableBase) : "";
    // And its pieces and cues into their files in boards/data (ADR 0065), likewise worked out first.
    // Each entry is given back by its schema first: the database keeps an object's keys in an order
    // of its own, and the file is written in the order the schema names them.
    const stored = lookOf(row.numbers);
    const canon = <T,>(entries: Record<string, unknown>, schema: { parse(v: unknown): T }): Record<string, T> => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, schema.parse(v)]));
    const look = { pieces: canon(stored.pieces, DrawingSchema), cues: canon(stored.cues, CueDataSchema) };
    const savedLook = row.savedNumbers ? lookOf(row.savedNumbers) : NO_LOOK;
    const looks: Array<{ path: string; entries: Record<string, unknown>; before: string; base: string | null; after: string }> = [];
    for (const [file, entries, saved] of [
      [piecesPath(row.puzzle), look.pieces, savedLook.pieces],
      [cuesPath(row.puzzle), look.cues, savedLook.cues],
    ] as const) {
      if (Object.keys(entries).length === 0 && Object.keys(saved).length === 0) continue;
      const was = await repo.read(id, file);
      const at = await repo.baseFile(id, file);
      looks.push({ path: file, entries, before: was, base: at, after: writeLook(was, entries, saved, at) });
    }
    try {
      if (after !== before) await repo.write(id, path, after);
      if (tableAfter !== tableBefore) await repo.write(id, messagesPath, tableAfter);
      for (const f of looks) if (f.after !== f.before) await repo.write(id, f.path, f.after);
    } catch (e) {
      // Whatever this Save wrote before it stopped is put back, so the chat's next turn does not commit half of it.
      const touched = new Set([path, ...(worded ? [messagesPath] : []), ...looks.map((f) => f.path)]);
      await repo.restore(id, (await repo.changed(id)).filter((f) => touched.has(f))).catch((err: unknown) => log.warn({ err, draft: id }, "could not put back a stopped Save's files"));
      throw e;
    }
    const lookOfFile = (file: string): string[] => {
      const f = looks.find((x) => x.path === file);
      return f ? describeLook(f.before, f.entries) : [];
    };
    await repo.commit(id, commitMessage(row.puzzle, describeNumbers(before, row.numbers), describeTexts(tableBefore, texts), { pieces: lookOfFile(piecesPath(row.puzzle)), cues: lookOfFile(cuesPath(row.puzzle)) }));
    // Recorded before the push: if that fails, the next Save still knows what this one wrote.
    await mark(id, { branch, savedNumbers: row.numbers });
    if ((await repo.ahead(id)) === 0) throw new SaveRefused("nothing");
    await repo.push(id, branch);
    // Whatever the branch changes besides the numbers' own file and the message table is the chat's doing: the pull request says so.
    const ours = new Set([path, ...(worded ? [messagesPath] : []), ...looks.map((f) => f.path)]);
    const edited = (await repo.files(id)).filter((f) => !ours.has(f));
    const reworded = describeTexts(tableBase ?? tableBefore, texts);
    // Against the base branch, as the numbers are: what the pull request changes in all.
    const lookAgainstBase = (file: string): string[] => {
      const f = looks.find((x) => x.path === file);
      return f ? describeLook(f.base ?? f.before, f.entries) : [];
    };
    const restyled: LookChanges = { pieces: lookAgainstBase(piecesPath(row.puzzle)), cues: lookAgainstBase(cuesPath(row.puzzle)) };
    const title = pullTitle(row.puzzle, edited, reworded.length > 0, restyled.pieces.length + restyled.cues.length > 0);
    const body = pullBody({ puzzle: row.puzzle, login, changes: describeNumbers(base ?? before, row.numbers), edited, linkUrl: `${o.studioOrigin}/play/${linkId}`, texts: reworded, look: restyled });
    if (row.pullNumber === null) {
      const pull = await forge.openPull({ head: branch, base: o.base, title, body });
      await mark(id, { pullNumber: pull.number, pullUrl: pull.url });
      log.info({ draft: id, pull: pull.number }, "draft pull request opened");
    } else await forge.describePull(row.pullNumber, title, body);
    await mark(id, { savedRevision: row.revision });
  }

  async function updateJob(id: string): Promise<void> {
    const row = await fresh(id);
    if (!row?.branch) return;
    await repo.ready();
    await repo.fetchBase();
    await repo.worktree(id, row.branch);
    if (!(await repo.mergeBase(id))) throw new SaveRefused("conflict");
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
      const marked = (await mark(row.id, { saveState: "saving", saveError: null, saveErrorDetail: null })) ?? row;
      enqueue(row.id, "save", () => saveJob(row.id, login, linkId));
      return marked;
    },
    async update(row) {
      const marked = (await mark(row.id, { saveState: "saving", saveError: null, saveErrorDetail: null })) ?? row;
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
