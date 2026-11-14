import { DraftNumbersSchema, type DraftNumbers } from "@openseas/protocol";
import type { HarnessPuzzle } from "../puzzles.js";
import type { Scenario } from "../scenario/codec.js";
import { leafOverrides } from "./numbers.js";

/**
 * Where a page's draft and the one the service keeps meet (ADR 0045). A scenario is what the page
 * plays; `DraftNumbers` is the part of it the service keeps: the numbers and the pinned seed.
 */

/** True when a scenario carries anything of a draft: a number laid over content, or a pinned seed. */
export function carriesDraft(s: Scenario): boolean {
  return s.seed !== null || s.roundSeconds !== null || s.paceSeconds !== null || s.thresholds !== null || Object.keys(s.overrides).length > 0;
}

/**
 * A scenario's draft in the shape the service keeps, one override a changed leaf. Null when it has
 * no such shape (thresholds half typed, say): the page plays or refuses it as ever, and nothing is
 * saved until it has one.
 */
export function draftNumbers<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, s: Scenario): DraftNumbers | null {
  const parsed = DraftNumbersSchema.safeParse({ seed: s.seed, overrides: leafOverrides(puzzle, s), roundSeconds: s.roundSeconds, paceSeconds: s.paceSeconds, thresholds: s.thresholds });
  return parsed.success ? parsed.data : null;
}

/** A scenario with a stored draft's numbers and seed in place of its own; how its clock starts is kept. */
export function withDraft(s: Scenario, numbers: DraftNumbers | null): Scenario {
  if (!numbers) return { ...s, seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null };
  return { ...s, seed: numbers.seed, overrides: numbers.overrides, roundSeconds: numbers.roundSeconds, paceSeconds: numbers.paceSeconds, thresholds: numbers.thresholds };
}

/** A scenario with nothing of a draft: what the address holds while the service keeps the draft. */
export const withoutDraft = (s: Scenario): Scenario => withDraft(s, null);

/** JSON with every object's keys in order: the database hands an object back in an order of its own. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export const sameNumbers = (a: DraftNumbers, b: DraftNumbers): boolean => canonical(a) === canonical(b);
