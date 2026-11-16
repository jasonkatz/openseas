import { DraftNumbersSchema, NO_PICKS, NO_WORDS, pickCount, picksOf, wordCount, wordsOf, type DraftNumbers } from "@openseas/protocol";
import type { StudioPuzzle } from "../puzzles.js";
import type { Scenario } from "../scenario/codec.js";
import { leafOverrides } from "./numbers.js";

/**
 * Where a page's draft and the one the service keeps meet (ADR 0045). A scenario is what the page
 * plays; `DraftNumbers` is the part of it the service keeps: the numbers, the picks (ADR 0052)
 * the words (ADR 0057) and the pinned seed. A service older than picks or than words drops them:
 * what it does not keep is left out of what is sent and compared, and stays with the page.
 */

/** What of a draft the service at hand keeps beside its numbers. */
export interface Keeps {
  readonly picks: boolean;
  readonly words: boolean;
}
export const KEEPS_ALL: Keeps = { picks: true, words: true };

/** True when a scenario carries anything of a draft: a number laid over content, a pick, or a pinned seed. */
export function carriesDraft(s: Scenario, keeps: Keeps = KEEPS_ALL): boolean {
  return (keeps.picks && pickCount(s) > 0) || (keeps.words && wordCount(s) > 0) || s.seed !== null || s.roundSeconds !== null || s.paceSeconds !== null || s.thresholds !== null || Object.keys(s.overrides).length > 0;
}

/**
 * A scenario's draft in the shape the service keeps, one override a changed leaf. Null when it has
 * no such shape (thresholds half typed, say): the page plays or refuses it as ever, and nothing is
 * saved until it has one.
 */
export function draftNumbers<S, M, C>(puzzle: StudioPuzzle<S, M, C>, s: Scenario, keeps: Keeps = KEEPS_ALL): DraftNumbers | null {
  const parsed = DraftNumbersSchema.safeParse({ seed: s.seed, overrides: leafOverrides(puzzle, s), roundSeconds: s.roundSeconds, paceSeconds: s.paceSeconds, thresholds: s.thresholds, picks: keeps.picks ? s.picks : NO_PICKS, words: keeps.words ? s.words : NO_WORDS });
  return parsed.success ? parsed.data : null;
}

/** A scenario with a stored draft's numbers and seed in place of its own; how its clock starts is kept. */
export function withDraft(s: Scenario, numbers: DraftNumbers | null, keeps: Keeps = KEEPS_ALL): Scenario {
  const kept = { ...(keeps.picks ? {} : { picks: s.picks }), ...(keeps.words ? {} : { words: s.words }) };
  if (!numbers) return { ...s, seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks: NO_PICKS, words: NO_WORDS, ...kept };
  return { ...s, seed: numbers.seed, overrides: numbers.overrides, roundSeconds: numbers.roundSeconds, paceSeconds: numbers.paceSeconds, thresholds: numbers.thresholds, picks: picksOf(numbers), words: wordsOf(numbers), ...kept };
}

/** A scenario with nothing of a draft: what the address holds while the service keeps the draft. */
export const withoutDraft = (s: Scenario, keeps: Keeps = KEEPS_ALL): Scenario => withDraft(s, null, keeps);

/** JSON with every object's keys in order: the database hands an object back in an order of its own. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const whole = (n: DraftNumbers): DraftNumbers => ({ ...n, picks: picksOf(n), words: wordsOf(n) });
export const sameNumbers = (a: DraftNumbers, b: DraftNumbers): boolean => canonical(whole(a)) === canonical(whole(b));
