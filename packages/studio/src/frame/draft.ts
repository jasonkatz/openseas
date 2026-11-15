import { DraftNumbersSchema, NO_PICKS, pickCount, picksOf, type DraftNumbers } from "@openseas/protocol";
import type { HarnessPuzzle } from "../puzzles.js";
import type { Scenario } from "../scenario/codec.js";
import { leafOverrides } from "./numbers.js";

/**
 * Where a page's draft and the one the service keeps meet (ADR 0045). A scenario is what the page
 * plays; `DraftNumbers` is the part of it the service keeps: the numbers, the picks (ADR 0052)
 * and the pinned seed. A service older than picks drops them: with `picks` false they are left
 * out of what is sent and compared, and stay with the page.
 */

/** True when a scenario carries anything of a draft: a number laid over content, a pick, or a pinned seed. */
export function carriesDraft(s: Scenario, picks = true): boolean {
  return (picks && pickCount(s) > 0) || s.seed !== null || s.roundSeconds !== null || s.paceSeconds !== null || s.thresholds !== null || Object.keys(s.overrides).length > 0;
}

/**
 * A scenario's draft in the shape the service keeps, one override a changed leaf. Null when it has
 * no such shape (thresholds half typed, say): the page plays or refuses it as ever, and nothing is
 * saved until it has one.
 */
export function draftNumbers<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, s: Scenario, picks = true): DraftNumbers | null {
  const parsed = DraftNumbersSchema.safeParse({ seed: s.seed, overrides: leafOverrides(puzzle, s), roundSeconds: s.roundSeconds, paceSeconds: s.paceSeconds, thresholds: s.thresholds, picks: picks ? s.picks : NO_PICKS });
  return parsed.success ? parsed.data : null;
}

/** A scenario with a stored draft's numbers and seed in place of its own; how its clock starts is kept. */
export function withDraft(s: Scenario, numbers: DraftNumbers | null, picks = true): Scenario {
  const kept = picks ? {} : { picks: s.picks };
  if (!numbers) return { ...s, seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks: NO_PICKS, ...kept };
  return { ...s, seed: numbers.seed, overrides: numbers.overrides, roundSeconds: numbers.roundSeconds, paceSeconds: numbers.paceSeconds, thresholds: numbers.thresholds, picks: picksOf(numbers), ...kept };
}

/** A scenario with nothing of a draft: what the address holds while the service keeps the draft. */
export const withoutDraft = (s: Scenario, picks = true): Scenario => withDraft(s, null, picks);

/** JSON with every object's keys in order: the database hands an object back in an order of its own. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const whole = (n: DraftNumbers): DraftNumbers => ({ ...n, picks: picksOf(n) });
export const sameNumbers = (a: DraftNumbers, b: DraftNumbers): boolean => canonical(whole(a)) === canonical(whole(b));
