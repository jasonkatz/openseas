import { TEXT_MAX, isPuzzleText, textVars } from "@openseas/protocol";
import { humanize } from "./modes.js";

/** The sections of the Text panel, in order. Names are in the message table under `studio.text_group.<id>`. */
export const TEXT_GROUPS = ["identity", "intro", "play", "pieces", "result"] as const;
export type TextGroup = (typeof TEXT_GROUPS)[number];

/** One string of the puzzle's: its key in the message table, the words the build ships, and where the panel shows it. */
export interface TextEntry {
  readonly key: string;
  readonly shipped: string;
  readonly group: TextGroup;
  readonly label: string;
}

/**
 * Which section a string is shown in, read from its key: the puzzle's name and its line on the
 * grid; what the start card says; the names of pieces and specials with their help; what a result
 * card adds; and the rest, which is what the board says while a round runs.
 */
export function textGroup(puzzle: string, key: string): TextGroup {
  const tail = key.startsWith(`${puzzle}.`) ? key.slice(puzzle.length + 1) : key;
  if (tail === "title" || key.startsWith("home.")) return "identity";
  if (/^(how_to|hint|intro|goal|eyebrow)/.test(tail)) return "intro";
  if (/^(piece|special|kind|legend)([._]|$)/.test(tail)) return "pieces";
  if (/^result/.test(tail)) return "result";
  return "play";
}

/** Every string that is this puzzle's to rewrite (ADR 0057), in the message table's own order, the puzzle's name first. */
export function textEntries(puzzle: string, messages: Readonly<Record<string, string>>): TextEntry[] {
  const out: TextEntry[] = [];
  for (const [key, shipped] of Object.entries(messages)) {
    if (!isPuzzleText(puzzle, key)) continue;
    const tail = key === `home.practice_${puzzle}` ? "grid_name" : key === `home.practice_${puzzle}_blurb` ? "grid_blurb" : key.slice(puzzle.length + 1);
    out.push({ key, shipped, group: textGroup(puzzle, key), label: humanize(tail.replace(/\./g, " ")) });
  }
  const first = (e: TextEntry): number => (e.key === `${puzzle}.title` ? 0 : 1);
  return out.sort((a, b) => first(a) - first(b));
}

export const textMatches = (e: TextEntry, now: string, q: string): boolean => q === "" || `${e.key} ${e.label} ${e.shipped} ${now}`.toLowerCase().includes(q);

/** Why words cannot stand in a string's place, as a key of the message table; null when they can. */
export function textProblem(shipped: string, text: string): "empty" | "long" | "vars" | null {
  if (text.trim() === "") return "empty";
  if (text.length > TEXT_MAX) return "long";
  return textVars(text).join() === textVars(shipped).join() ? null : "vars";
}
