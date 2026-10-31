import { z } from "zod";
import { BilgingConfigSchema, BilgingMoveSchema } from "./bilging.js";
import type { PuzzleIdWire } from "./common.js";
import { SailingConfigSchema, SailingMoveSchema } from "./sailing.js";

/**
 * Per-puzzle wire schemas. The server validates a move against the schema of the session's puzzle,
 * so a Bilging swap sent to a Sailing round is rejected as an illegal move, not accepted as junk.
 */
export const PUZZLE_MOVE_SCHEMAS = {
  bilging: BilgingMoveSchema,
  sailing: SailingMoveSchema,
} as const satisfies Record<PuzzleIdWire, z.ZodType>;

export const PUZZLE_CONFIG_SCHEMAS = {
  bilging: BilgingConfigSchema,
  sailing: SailingConfigSchema,
} as const satisfies Record<PuzzleIdWire, z.ZodType>;

/** Any puzzle's move. Loose on purpose: the session narrows it to its own puzzle's schema. */
export const AnyMoveSchema = z.union([BilgingMoveSchema, SailingMoveSchema]);
export type AnyMoveWire = z.infer<typeof AnyMoveSchema>;

export type MoveWireFor<P extends PuzzleIdWire> = z.infer<(typeof PUZZLE_MOVE_SCHEMAS)[P]>;
export type ConfigWireFor<P extends PuzzleIdWire> = z.infer<(typeof PUZZLE_CONFIG_SCHEMAS)[P]>;

export function parseMoveFor<P extends PuzzleIdWire>(puzzle: P, raw: unknown): MoveWireFor<P> | null {
  const r = PUZZLE_MOVE_SCHEMAS[puzzle].safeParse(raw);
  return r.success ? (r.data as MoveWireFor<P>) : null;
}
