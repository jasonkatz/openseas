import { z } from "zod";
import { PUZZLES, type PuzzleId } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";

export interface Validation {
  readonly ok: boolean;
  /** Human-readable problems: the wire schema's, then the engine's. */
  readonly errors: readonly string[];
}

/**
 * Whether the server would accept `config` for puzzle `id`. It is held to what the server holds a
 * config to: the protocol's wire schema, which content loads every puzzle's config through
 * (ADR 0039), and the engine's own validateConfig. A lab round, a log opened for review and every
 * battle and melee a voyage would deal are checked here, so the bench never runs a config the
 * server could not have issued.
 */
export function serverAcceptsConfig(id: PuzzleId, config: unknown): Validation {
  const errors: string[] = [];
  const parsed = PUZZLE_CONFIG_SCHEMAS[id].safeParse(config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".") || "config"}: ${issue.message}`);
  }
  try {
    PUZZLES[id].validateConfig(config);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  // A config the schema would strip or fill is not the config the engine saw. Key order is not a
  // difference: a config built by spreading or edited by path may list its fields in any order, and
  // the server compares values, not spellings.
  if (parsed.success && canonical(parsed.data) !== canonical(config)) errors.push("config: fields the wire schema does not know");
  return { ok: errors.length === 0, errors };
}

/** JSON with every object's keys sorted, so two configs compare by value alone. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

export const prettyIssue = (e: z.ZodError): string => z.prettifyError(e);
