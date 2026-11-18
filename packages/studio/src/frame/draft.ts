import { DraftNumbersSchema, NO_LOOK, NO_WORDS, lookCount, lookOf, wordCount, wordsOf, type DraftNumbers } from "@openseas/protocol";
import type { StudioPuzzle } from "../puzzles.js";
import type { Scenario } from "../scenario/codec.js";
import { leafOverrides } from "./numbers.js";

/**
 * Where a page's draft and the one the service keeps meet (ADR 0045). A scenario is what the page
 * plays; `DraftNumbers` is the part of it the service keeps: the numbers, the words (ADR 0057),
 * the look (ADR 0065) and the pinned seed. A service older than words or the look drops them: what
 * it does not keep is left out of what is sent and compared, and stays with the page. A draft kept with picks of takes is read
 * without them (ADR 0063, ADR 0064).
 */

/** What of a draft the service at hand keeps beside its numbers. */
export interface Keeps {
  readonly words: boolean;
  readonly look: boolean;
}
export const KEEPS_ALL: Keeps = { words: true, look: true };

/** True when a scenario carries anything of a draft: a number laid over content, a word rewritten, a piece redrawn, a cue revoiced, or a pinned seed. */
export function carriesDraft(s: Scenario, keeps: Keeps = KEEPS_ALL): boolean {
  return (keeps.words && wordCount(s) > 0) || (keeps.look && lookCount(s) > 0) || s.seed !== null || s.roundSeconds !== null || s.paceSeconds !== null || s.thresholds !== null || Object.keys(s.overrides).length > 0;
}

/**
 * A scenario's draft in the shape the service keeps, one override a changed leaf. Null when it has
 * no such shape (thresholds half typed, say): the page plays or refuses it as ever, and nothing is
 * saved until it has one.
 */
export function draftNumbers<S, M, C>(puzzle: StudioPuzzle<S, M, C>, s: Scenario, keeps: Keeps = KEEPS_ALL): DraftNumbers | null {
  const parsed = DraftNumbersSchema.safeParse({ seed: s.seed, overrides: leafOverrides(puzzle, s), roundSeconds: s.roundSeconds, paceSeconds: s.paceSeconds, thresholds: s.thresholds, words: keeps.words ? s.words : NO_WORDS, look: keeps.look ? s.look : NO_LOOK });
  return parsed.success ? parsed.data : null;
}

/** A scenario with a stored draft's numbers and seed in place of its own; how its clock starts is kept. */
export function withDraft(s: Scenario, numbers: DraftNumbers | null, keeps: Keeps = KEEPS_ALL): Scenario {
  const kept = { ...(keeps.words ? {} : { words: s.words }), ...(keeps.look ? {} : { look: s.look }) };
  if (!numbers) return { ...s, seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, words: NO_WORDS, look: NO_LOOK, ...kept };
  return { ...s, seed: numbers.seed, overrides: numbers.overrides, roundSeconds: numbers.roundSeconds, paceSeconds: numbers.paceSeconds, thresholds: numbers.thresholds, words: wordsOf(numbers), look: lookOf(numbers), ...kept };
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

const whole = (n: DraftNumbers): DraftNumbers => ({ ...n, words: wordsOf(n), look: lookOf(n) });
export const sameNumbers = (a: DraftNumbers, b: DraftNumbers): boolean => canonical(whole(a)) === canonical(whole(b));
