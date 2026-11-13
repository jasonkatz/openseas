import { PuzzleNumbersSchema, thresholdProblems } from "@openseas/content";
import { content } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";
import type { Scenario } from "../scenario/codec.js";
import { applyOverrides, diffConfig, getPath } from "../scenario/overrides.js";
import { validateConfig } from "../scenario/validate.js";
import type { Threshold } from "../practice/usePractice.js";

export type { Threshold } from "../practice/usePractice.js";

/**
 * The numbers a round is played on: what a puzzle's content file holds that tuning can change
 * (ADR 0042 decision 2). `config` is what the engine is dealt; the other three are read around it:
 * the round's length, the live tier indicator's window, and what the score is rated against.
 */
export interface Numbers<C> {
  readonly config: C;
  readonly roundSeconds: number;
  readonly paceSeconds: number;
  readonly thresholds: readonly Threshold[];
}

/** One number the current build will not play, by its key in the content file (`config.maxMoves`, `thresholds`). */
export interface Refusal {
  readonly key: string;
  readonly message: string;
}

/** One number that differs from the content file, by its key there. */
export interface Change {
  readonly key: string;
  readonly shipped: unknown;
  readonly value: unknown;
}

/** What the content file ships: the numbers the server deals. */
export function shippedNumbers<S, M, C>(puzzle: HarnessPuzzle<S, M, C>): Numbers<C> {
  const file = content.puzzles[puzzle.id];
  return { config: puzzle.config, roundSeconds: file.roundSeconds, paceSeconds: file.paceSeconds, thresholds: file.thresholds };
}

/**
 * The shipped numbers with a scenario's laid over them. Nothing is checked here: a link may carry
 * anything, and `refusals` says whether the result can be played.
 */
export function tunedNumbers<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, scenario: Scenario): Numbers<C> {
  const shipped = shippedNumbers(puzzle);
  return {
    config: applyOverrides(shipped.config, scenario.overrides),
    roundSeconds: scenario.roundSeconds ?? shipped.roundSeconds,
    paceSeconds: scenario.paceSeconds ?? shipped.paceSeconds,
    thresholds: scenario.thresholds === null ? shipped.thresholds : (scenario.thresholds as readonly Threshold[]),
  };
}

/**
 * Why the current build will not play these numbers; empty when it will. The config is held to
 * the server's own checks (the wire schema, the engine's `validateConfig`, and the schema
 * stripping nothing: ADR 0019 decision 4), and the numbers around it to what a content file must
 * satisfy to load. Each refusal names the key it is about, so a control can show its own.
 */
export function refusals<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, numbers: Numbers<C>): Refusal[] {
  const out: Refusal[] = validateConfig(puzzle, numbers.config).issues.map((i) => ({ key: i.path ? `config.${i.path}` : "config", message: i.message }));
  const parsed = PuzzleNumbersSchema.safeParse({ roundSeconds: numbers.roundSeconds, paceSeconds: numbers.paceSeconds, thresholds: numbers.thresholds });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) out.push({ key: String(issue.path[0] ?? "config"), message: issue.message });
    return out;
  }
  const file = content.puzzles[puzzle.id];
  for (const message of thresholdProblems(parsed.data.thresholds, "parScore" in file ? file.parScore : undefined)) out.push({ key: "thresholds", message });
  return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every number that differs from the content file, config keys first, in the file's own order. */
export function changes<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, numbers: Numbers<C>): Change[] {
  const shipped = shippedNumbers(puzzle);
  const out: Change[] = Object.entries(diffConfig(shipped.config, numbers.config)).map(([path, value]) => ({ key: `config.${path}`, shipped: getPath(shipped.config, path), value }));
  for (const key of ["roundSeconds", "paceSeconds", "thresholds"] as const) {
    if (!same(shipped[key], numbers[key])) out.push({ key, shipped: shipped[key], value: numbers[key] });
  }
  return out;
}

/** A number as a details sheet shows it: thresholds as their scores, anything else as JSON. */
export function formatNumber(key: string, value: unknown): string {
  if (key === "thresholds" && Array.isArray(value)) return value.map((t: Partial<Threshold> | null) => String(t?.score ?? "?")).join(" / ");
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

const CONFIG = "config.";

/**
 * A scenario with one number set, by its key in the content file (`config.maxMoves`,
 * `roundSeconds`, `thresholds`). A value equal to the shipped one leaves no trace, so a control
 * moved back is a control that was never moved.
 */
export function withNumber<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, scenario: Scenario, key: string, value: unknown): Scenario {
  const shipped = shippedNumbers(puzzle);
  if (key.startsWith(CONFIG)) {
    const path = key.slice(CONFIG.length);
    const overrides: Record<string, unknown> = { ...leafOverrides(puzzle, scenario) };
    if (same(getPath(shipped.config, path), value)) delete overrides[path];
    else overrides[path] = value;
    return { ...scenario, overrides };
  }
  if (key === "roundSeconds") return { ...scenario, roundSeconds: value === shipped.roundSeconds ? null : (value as number) };
  if (key === "paceSeconds") return { ...scenario, paceSeconds: value === shipped.paceSeconds ? null : (value as number) };
  if (key === "thresholds") return { ...scenario, thresholds: same(value, shipped.thresholds) ? null : value };
  return scenario;
}

/** A scenario with one number back at its shipped value. */
export function withoutNumber<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, scenario: Scenario, key: string): Scenario {
  const shipped = shippedNumbers(puzzle);
  if (key.startsWith(CONFIG)) return withNumber(puzzle, scenario, key, getPath(shipped.config, key.slice(CONFIG.length)));
  return withNumber(puzzle, scenario, key, shipped[key as "roundSeconds" | "paceSeconds" | "thresholds"]);
}

/** A scenario with every number shipped: the seed and the clock's start are kept. */
export function withoutNumbers(scenario: Scenario): Scenario {
  return { ...scenario, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null };
}

/**
 * A scenario's config overrides as one entry a changed leaf. A link or a starting point may set a
 * whole branch (`c.raider={...}`); the panel sets and resets leaves, so it works on this form.
 */
export function leafOverrides<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, scenario: Scenario): Scenario["overrides"] {
  return diffConfig(puzzle.config, applyOverrides(puzzle.config, scenario.overrides));
}
