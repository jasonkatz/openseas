import { z } from "zod";
import type { HarnessPuzzle } from "../puzzles.js";

export interface Validation {
  readonly ok: boolean;
  /** Human-readable problems: the wire schema's, then the engine's. */
  readonly errors: readonly string[];
}

/**
 * A lab config is held to the same two checks the server applies to content at startup: the
 * protocol's wire schema and the engine's own validateConfig. Both, so a lab round can never run
 * on a config the server could not have issued.
 */
export function validateConfig<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, config: C): Validation {
  const errors: string[] = [];
  const parsed = puzzle.configSchema.safeParse(config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".") || "config"}: ${issue.message}`);
  }
  try {
    puzzle.def.validateConfig(config);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  // A config the schema would strip or coerce is not the config the engine saw.
  if (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(config)) errors.push("config: fields the wire schema does not know");
  return { ok: errors.length === 0, errors };
}

export const prettyIssue = (e: z.ZodError): string => z.prettifyError(e);
