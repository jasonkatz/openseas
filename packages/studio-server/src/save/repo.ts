import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Logger } from "../log.js";

export interface RepoOptions {
  /** Where the clone and the worktrees live: a volume, so they outlast a deploy. */
  dir: string;
  /** Where the repository is cloned from and pushed to. */
  url: string;
  /** The branch drafts are cut from and pull requests are opened against. */
  base: string;
  /** Who a commit made here is by. */
  author: { name: string; email: string };
  /** A token that may fetch and push, or null when the remote needs none (a test's local repository). */
  token(): Promise<string | null>;
  log: Logger;
}

/**
 * The service's clone of the repository and a worktree a draft (ADR 0042 decision 4, ADR 0046).
 * Everything goes through the `git` on the machine, one command at a time. The token that lets
 * git push is handed to that one command in its environment and is never written to the clone's
 * config, so nothing that later reads the volume finds it.
 */
export interface Repo {
  /** Clone the repository if the volume has none yet. */
  ready(): Promise<void>;
  /** Fetch the base branch, unless that was done within `maxAgeMs`. */
  fetchBase(maxAgeMs?: number): Promise<void>;
  /** The draft's worktree on its branch, made from the base branch (or from the branch on the remote, when the volume is new and the branch is not). */
  worktree(id: string, branch: string): Promise<string>;
  hasWorktree(id: string): boolean;
  read(id: string, path: string): Promise<string>;
  write(id: string, path: string, text: string): Promise<void>;
  /** A file as it is where the draft's branch left the base branch; null when it was not there. */
  baseFile(id: string, path: string): Promise<string | null>;
  /** Commit everything changed in the worktree. Null when nothing was. */
  commit(id: string, message: string): Promise<string | null>;
  /** How many commits the draft's branch has that the base branch does not. */
  ahead(id: string): Promise<number>;
  /** How many commits the base branch has that the draft's branch does not, as of the last fetch. */
  behind(id: string): Promise<number>;
  push(id: string, branch: string): Promise<void>;
  /** Merge the base branch into the draft's. False, and nothing changed, when they conflict. */
  mergeBase(id: string): Promise<boolean>;
  /** Remove the draft's worktree and branch, and the branch on the remote when asked. */
  remove(id: string, branch: string, remote: boolean): Promise<void>;
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args[0]} failed (${code}): ${stderr.trim().split("\n").pop() ?? ""}`);
  }
}

/**
 * How one git command is let through to the remote: the token as a header, in that command's
 * environment, for that remote's host and no other. Nothing for a remote that is not https.
 */
export function tokenEnv(url: string, token: string | null): NodeJS.ProcessEnv {
  if (!token || !url.startsWith("https://")) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${new URL(url).origin}/.extraheader`, GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` };
}

export function createRepo(o: RepoOptions): Repo {
  const root = join(o.dir, "repo");
  const trees = join(o.dir, "worktrees");
  const tree = (id: string): string => join(trees, id);
  const remoteBase = `origin/${o.base}`;
  let fetchedAt = 0;

  // One git command at a time: two drafts saving at once share one clone.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  /** The environment of one git command. A token rides as a header for the remote's host alone. */
  async function env(network: boolean): Promise<NodeJS.ProcessEnv> {
    const base: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: o.dir,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: o.author.name,
      GIT_AUTHOR_EMAIL: o.author.email,
      GIT_COMMITTER_NAME: o.author.name,
      GIT_COMMITTER_EMAIL: o.author.email,
    };
    return { ...base, ...(network ? tokenEnv(o.url, await o.token()) : {}) };
  }

  async function git(cwd: string, args: string[], opts: { network?: boolean; ok?: number[] } = {}): Promise<{ code: number; out: string }> {
    const environment = await env(opts.network ?? false);
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd, env: environment, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
        if (code === 0 || (code !== null && opts.ok?.includes(code))) return resolve({ code, out: stdout });
        reject(new GitError(args, code, stderr || String(err)));
      });
    });
  }

  const has = async (cwd: string, ref: string): Promise<boolean> => (await git(cwd, ["rev-parse", "--verify", "--quiet", ref], { ok: [1] })).code === 0;

  const repo: Repo = {
    ready: () =>
      serial(async () => {
        if (existsSync(join(root, ".git"))) return;
        await mkdir(o.dir, { recursive: true });
        o.log.info({ dir: root }, "cloning the repository");
        // No checkout: the files live in the worktrees, one a draft.
        await git(o.dir, ["clone", "--no-checkout", "--origin", "origin", "--branch", o.base, o.url, root], { network: true });
        fetchedAt = Date.now();
      }),

    fetchBase: (maxAgeMs = 0) =>
      serial(async () => {
        if (Date.now() - fetchedAt < maxAgeMs) return;
        await git(root, ["fetch", "--quiet", "origin", `+refs/heads/${o.base}:refs/remotes/${remoteBase}`], { network: true });
        fetchedAt = Date.now();
      }),

    worktree: (id, branch) =>
      serial(async () => {
        const path = tree(id);
        if (existsSync(join(path, ".git"))) return path;
        await mkdir(trees, { recursive: true });
        await git(root, ["worktree", "prune"]);
        if (await has(root, `refs/heads/${branch}`)) {
          await git(root, ["worktree", "add", "--quiet", path, branch]);
          return path;
        }
        // A new volume and an old branch: the draft's pull request is still open on the remote.
        const fetched = await git(root, ["fetch", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { network: true, ok: [1, 128] });
        const from = fetched.code === 0 ? `origin/${branch}` : remoteBase;
        await git(root, ["worktree", "add", "--quiet", "--no-track", "-b", branch, path, from]);
        return path;
      }),

    hasWorktree: (id) => existsSync(join(tree(id), ".git")),
    read: (id, path) => readFile(join(tree(id), path), "utf8"),
    write: async (id, path, text) => {
      await mkdir(dirname(join(tree(id), path)), { recursive: true });
      await writeFile(join(tree(id), path), text);
    },

    baseFile: (id, path) =>
      serial(async () => {
        const base = (await git(tree(id), ["merge-base", "HEAD", remoteBase])).out.trim();
        const shown = await git(tree(id), ["show", `${base}:${path}`], { ok: [128] });
        return shown.code === 0 ? shown.out : null;
      }),

    commit: (id, message) =>
      serial(async () => {
        await git(tree(id), ["add", "--all"]);
        if ((await git(tree(id), ["diff", "--cached", "--quiet"], { ok: [1] })).code === 0) return null;
        await git(tree(id), ["commit", "--quiet", "--no-verify", "-m", message]);
        return (await git(tree(id), ["rev-parse", "HEAD"])).out.trim();
      }),

    ahead: (id) => serial(async () => Number((await git(tree(id), ["rev-list", "--count", `${remoteBase}..HEAD`])).out.trim())),
    behind: (id) => serial(async () => Number((await git(tree(id), ["rev-list", "--count", `HEAD..${remoteBase}`])).out.trim())),

    push: (id, branch) =>
      serial(async () => {
        await git(tree(id), ["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], { network: true });
      }),

    mergeBase: (id) =>
      serial(async () => {
        const merged = await git(tree(id), ["merge", "--quiet", "--no-edit", remoteBase], { ok: [1] });
        if (merged.code === 0) return true;
        await git(tree(id), ["merge", "--abort"], { ok: [128] });
        return false;
      }),

    remove: (id, branch, remote) =>
      serial(async () => {
        if (!existsSync(join(root, ".git"))) return;
        if (existsSync(tree(id))) await git(root, ["worktree", "remove", "--force", tree(id)], { ok: [128] });
        await git(root, ["worktree", "prune"]);
        await git(root, ["branch", "--quiet", "-D", branch], { ok: [1] });
        if (remote) await git(root, ["push", "--quiet", "origin", "--delete", branch], { network: true, ok: [1] });
      }),
  };
  return repo;
}
