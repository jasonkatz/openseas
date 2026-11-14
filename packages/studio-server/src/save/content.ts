import type { DraftNumbers } from "@openseas/protocol";
import { getJsonValue, removeJsonValue, setJsonValue } from "./jsonEdit.js";

/** Where a puzzle's numbers live in the repository (CLAUDE.md rule 4). */
export const contentPath = (puzzle: string): string => `packages/content/data/puzzles/${puzzle}.json`;

/** A draft's override path is one a content file could hold: plain keys with dots between. */
const PATH = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/;

export class UnknownKeyError extends Error {
  constructor(readonly key: string) {
    super(`the content file has no place for ${key}`);
  }
}

type Top = "roundSeconds" | "paceSeconds" | "thresholds";
const TOP: readonly Top[] = ["roundSeconds", "paceSeconds", "thresholds"];

/** Every key a draft's numbers set, as the content file spells it. */
function keys(n: DraftNumbers): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [path, value] of Object.entries(n.overrides)) out.set(`config.${path}`, value);
  for (const key of TOP) if (n[key] !== null) out.set(key, n[key]);
  return out;
}

/**
 * A puzzle's content file with a draft's numbers written into it (ADR 0046). `saved` is what the
 * Save before this one wrote: a key the draft has stopped changing since goes back to what the
 * file held where the draft's branch left the base branch (`base`), so a number put back in the
 * studio is put back in the pull request. Anything else in the file, a hand edit included, is
 * left as it is. The seed is not a number of the file's and is not written.
 */
export function writeNumbers(text: string, numbers: DraftNumbers, saved: DraftNumbers | null, base: string | null): string {
  const want = keys(numbers);
  let out = text;
  for (const key of saved ? keys(saved).keys() : []) {
    if (want.has(key)) continue;
    const path = key.split(".");
    const was = base === null ? undefined : getJsonValue(base, path);
    out = was === undefined ? removeJsonValue(out, path) : setJsonValue(out, path, was, "roundSeconds");
  }
  for (const [key, value] of want) {
    if (!PATH.test(key)) throw new UnknownKeyError(key);
    try {
      // `paceSeconds` is the one key a file may leave to its default; it goes above the round's length, where the files that have it keep it.
      out = setJsonValue(out, key.split("."), value, key === "paceSeconds" ? "roundSeconds" : undefined);
    } catch {
      throw new UnknownKeyError(key);
    }
  }
  return out;
}

/** What a draft's numbers change in a file, a line a key, for a commit message and a pull request's body. */
export function describeNumbers(before: string, numbers: DraftNumbers): Array<{ key: string; from: unknown; to: unknown }> {
  const out: Array<{ key: string; from: unknown; to: unknown }> = [];
  for (const [key, to] of keys(numbers)) {
    const from = getJsonValue(before, key.split("."));
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ key, from, to });
  }
  return out;
}
