import type { GroupId } from "../tuning/groups.js";

/**
 * The studio's modes (DESIGN.md 3.14, ADR 0056): what the rail down the page's left edge switches
 * the panel between. Play holds the round; the four after it hold the puzzle's numbers, split by
 * what they decide (Rating its own since ADR 0069); the last three hold its pieces, its sound (ADR 0065) and its words (ADR 0057).
 * Names and one line each are in the message table under `studio.mode.<id>` and `studio.mode_hint.<id>`.
 */
export const MODE_IDS = ["play", "setup", "tuning", "scoring", "rating", "sprites", "sounds", "text"] as const;
export type ModeId = (typeof MODE_IDS)[number];

export const NUMBER_MODES = ["setup", "tuning", "scoring", "rating"] as const;
export type NumberMode = (typeof NUMBER_MODES)[number];

export const isNumberMode = (mode: ModeId): mode is NumberMode => (NUMBER_MODES as readonly string[]).includes(mode);

/** The rail, top to bottom; a null is the gap between its three clusters. */
export const RAIL: readonly (ModeId | null)[] = ["play", null, "setup", "tuning", "scoring", "rating", null, "sprites", "sounds", "text"];

/**
 * A section of numbers in a panel: one of the tuning groups (tuning/groups.ts), the keys no group
 * names, the round's length, or what a score is rated against.
 */
export type SectionId = GroupId | "other" | "round" | "rating";

/** Which sections each numbers mode shows, in order. Every section is in exactly one mode. */
export const MODE_SECTIONS: Readonly<Record<NumberMode, readonly SectionId[]>> = {
  setup: ["board", "round", "limits"],
  tuning: ["deal", "pace", "other"],
  scoring: ["scoring"],
  rating: ["rating"],
};

export function modeOfSection(section: SectionId): NumberMode {
  return NUMBER_MODES.find((m) => MODE_SECTIONS[m].includes(section)) ?? "tuning";
}

/** A key as a label: `heatRisePerMoves` reads "Heat rise per moves". The key itself stays in the control's title. */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The words a key's name ends with when it names its own unit, by the unit (tuning/controls). */
const UNIT_WORDS: Readonly<Record<string, RegExp>> = { permille: / per ?mille$/i, percent: / percents?$/i, ms: / ms$/i, seconds: / seconds$/i };

/**
 * A key's label and its unit, said once. Where the name ends in a unit worth a tag
 * (`streakStepPercent`), the label drops the word and the tag carries it; a unit the name reads
 * well with (`heatRisePerMoves`) stays in the label and gets no tag.
 */
export function labelOf(name: string, branch: string | null, unit: string | null): { label: string; branch: string | null; unit: string | null } {
  const pattern = unit ? UNIT_WORDS[unit] : undefined;
  const label = humanize(name);
  const over = branch ? humanize(branch) : null;
  if (!pattern) return { label, branch: over, unit: null };
  if (pattern.test(label)) return { label: label.replace(pattern, ""), branch: over, unit };
  if (over && pattern.test(over)) return { label, branch: over.replace(pattern, ""), unit };
  return { label, branch: over, unit: null };
}
