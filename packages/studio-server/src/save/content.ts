import { isPuzzleText, textVars, wordsOf, type DraftNumbers } from "@openseas/protocol";
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
  // The category is a key of the content file like any other (ADR 0057).
  const { category } = wordsOf(n);
  if (category !== null) out.set("category", category);
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

/** Where every string lives in the repository (CLAUDE.md rule 5). */
export const messagesPath = "packages/content/data/messages/en.json";

/**
 * The message table with a draft's rewritten strings written into it (ADR 0057), each where it
 * stands, so the commit's diff shows those lines and no others. `saved` is what the Save before
 * this one wrote: a string the draft has let go since goes back to what the table held where the
 * draft's branch left the base branch. A string that is not this puzzle's, that the table does
 * not have, or that drops or adds a name the shipped one fills in (`{count}`) refuses the Save:
 * the page holds a draft to the same, so only a draft made some other way gets here.
 */
export function writeTexts(text: string, puzzle: string, texts: Readonly<Record<string, string>>, saved: Readonly<Record<string, string>>, base: string | null): string {
  let out = text;
  for (const key of Object.keys(saved)) {
    if (key in texts) continue;
    const was = base === null ? undefined : getJsonValue(base, [key]);
    if (typeof was === "string" && getJsonValue(out, [key]) !== undefined) out = setJsonValue(out, [key], was);
  }
  for (const [key, words] of Object.entries(texts)) {
    const now = getJsonValue(out, [key]);
    const shipped = base === null ? now : (getJsonValue(base, [key]) ?? now);
    if (!isPuzzleText(puzzle, key) || typeof now !== "string" || typeof shipped !== "string") throw new UnknownKeyError(key);
    if (textVars(words).join() !== textVars(shipped).join()) throw new UnknownKeyError(key);
    out = setJsonValue(out, [key], words);
  }
  return out;
}

/** What a draft's strings change in the table, a line a key, for a commit message and a pull request's body. */
export function describeTexts(before: string, texts: Readonly<Record<string, string>>): Array<{ key: string; from: unknown; to: string }> {
  const out: Array<{ key: string; from: unknown; to: string }> = [];
  for (const [key, to] of Object.entries(texts)) {
    const from = getJsonValue(before, [key]);
    if (from !== to) out.push({ key, from, to });
  }
  return out;
}

/** Where a puzzle's pieces live in the repository (ADR 0065). */
export const piecesPath = (puzzle: string): string => `packages/boards/data/pieces/${puzzle}.json`;
/** Where every cue lives (ADR 0065): one file for the game, since a cue is played by many boards. */
export const cuesPath = "packages/boards/data/cues.json";

/**
 * A look file (a puzzle's pieces, or the cues) with a draft's entries written into it (ADR 0065),
 * each where it stands and drawn as the one it replaces, so the commit's diff shows those lines and
 * no others. `saved` is what the Save before this one wrote: an entry the draft has let go since
 * goes back to what the file held where the draft's branch left the base branch. An entry the file
 * has no such name for refuses the Save: the page offers only the names the build has, so only a
 * draft made some other way gets here. Each entry's shape was checked as the draft was read.
 */
export function writeLook(text: string, entries: Readonly<Record<string, unknown>>, saved: Readonly<Record<string, unknown>>, base: string | null): string {
  let out = text;
  for (const name of Object.keys(saved)) {
    if (name in entries) continue;
    const was = base === null ? undefined : getJsonValue(base, [name]);
    if (was !== undefined && getJsonValue(out, [name]) !== undefined) out = setJsonValue(out, [name], was);
  }
  for (const [name, value] of Object.entries(entries)) {
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(name) || getJsonValue(out, [name]) === undefined) throw new UnknownKeyError(name);
    out = setJsonValue(out, [name], value);
  }
  return out;
}

/** The names of the entries a draft changes in a look file: those whose value differs from what the file held. */
export function describeLook(before: string, entries: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(entries)
    .filter(([name, value]) => JSON.stringify(getJsonValue(before, [name])) !== JSON.stringify(value))
    .map(([name]) => name);
}
