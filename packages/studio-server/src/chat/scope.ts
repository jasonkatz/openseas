import { isAbsolute, normalize, relative, sep } from "node:path";

/**
 * The open puzzle's own files (ADR 0042 decision 8, ADR 0047): what the agent may write without
 * asking. A puzzle's files carry its id: a folder named for it, or a file whose name starts with
 * it, under the packages a puzzle is made of and the two folders of design files. One shared file
 * is every puzzle's as well, since a puzzle's strings live in it.
 */
const ROOTS = ["packages/engine/", "packages/protocol/src/", "packages/content/", "packages/boards/", "packages/docs/", "packages/studio/src/", "packages/studio/e2e/", "docs/puzzles/", "docs/prototypes/"];
const SHARED = new Set(["packages/content/data/messages/en.json"]);

/** `cooling.json`, `cooling.test.ts`, `CoolingBoard.tsx`: the id, then anything but another small letter (`tug` is not `tugboat`). */
function named(part: string, id: string): boolean {
  if (part.slice(0, id.length).toLowerCase() !== id) return false;
  const next = part[id.length];
  return next === undefined || !/[a-z]/.test(next);
}

/** A path inside the worktree as the repository spells it, with `/` between its parts; null when it is not inside. */
export function repoPath(worktree: string, path: string): string | null {
  const rel = normalize(isAbsolute(path) ? relative(worktree, path) : path);
  if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** True when a repository path is one of the puzzle's own files. */
export function ownFile(puzzle: string, path: string): boolean {
  if (SHARED.has(path)) return true;
  const root = ROOTS.find((r) => path.startsWith(r));
  if (!root) return false;
  const parts = path.slice(root.length).split("/");
  const file = parts.pop()!;
  return parts.includes(puzzle) || named(file, puzzle);
}

/** True when the agent may write a repository path: the puzzle's own, or one the owner allowed for this draft (a file, or a folder and all under it). */
export function mayWrite(puzzle: string, path: string, allowed: readonly string[]): boolean {
  // Never the repository's own machinery, whatever was allowed: an allowed folder must not reach it by being a parent.
  if (path === ".git" || path.startsWith(".git/")) return false;
  return ownFile(puzzle, path) || allowed.some((a) => path === a || path.startsWith(a.endsWith("/") ? a : `${a}/`));
}
