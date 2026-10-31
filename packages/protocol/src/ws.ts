import { z } from "zod";
import { ErrorCodeSchema, PirateSummarySchema, PuzzleIdSchema, RatingViewSchema } from "./common.js";
import { BilgingConfigSchema } from "./bilging.js";
import { CarpentryConfigSchema } from "./carpentry.js";
import { AnyMoveSchema } from "./puzzles.js";
import { SailingConfigSchema } from "./sailing.js";
import { GunneryConfigSchema } from "./gunnery.js";

const SessionId = z.string().min(8).max(64);
const Hash = z.string().regex(/^[0-9a-f]{8}$/);

export const ClientMetricsSchema = z.object({
  /** Input-to-render latency percentiles in ms, measured on the client (DESIGN.md 5.3). */
  inputToRenderP50: z.number().min(0).max(60_000),
  inputToRenderP95: z.number().min(0).max(60_000),
  samples: z.int().min(0),
});
export type ClientMetrics = z.infer<typeof ClientMetricsSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), t: z.number() }),
  z.object({ type: z.literal("puzzle.start"), puzzle: PuzzleIdSchema }),
  z.object({
    type: z.literal("puzzle.move"),
    sessionId: SessionId,
    /** 0-based index of this move in the log. */
    seq: z.int().min(0).max(100_000),
    move: AnyMoveSchema,
    /** Engine state hash after applying the move, for early divergence detection. */
    hash: Hash,
  }),
  z.object({
    type: z.literal("puzzle.finish"),
    sessionId: SessionId,
    hash: Hash,
    metrics: ClientMetricsSchema.optional(),
  }),
  z.object({ type: z.literal("puzzle.abandon"), sessionId: SessionId }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

const PuzzleStartedBase = z.object({
  type: z.literal("puzzle.started"),
  sessionId: SessionId,
  seed: z.string(),
  /** Server clock ms when the round must be finished. The client shows a timer against it. */
  deadlineAt: z.number(),
  serverNow: z.number(),
});

/** One variant per puzzle so a client narrows `config` by `puzzle`. */
export const PuzzleStartedSchema = z.discriminatedUnion("puzzle", [
  PuzzleStartedBase.extend({ puzzle: z.literal("bilging"), config: BilgingConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("sailing"), config: SailingConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("carpentry"), config: CarpentryConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("gunnery"), config: GunneryConfigSchema }),
]);

export const PuzzleResultSchema = z.object({
  type: z.literal("puzzle.result"),
  sessionId: SessionId,
  score: z.int().min(0),
  moves: z.int().min(0),
  bestCombo: z.int().min(0),
  /** False when the client's hash diverged from the server replay; the server's numbers stand. */
  verified: z.boolean(),
  rating: RatingViewSchema,
  /** "up", "down", or "same" relative to the tier before the round. */
  tierChange: z.enum(["up", "down", "same"]),
});

export const PuzzleRejectedSchema = z.object({
  type: z.literal("puzzle.rejected"),
  sessionId: SessionId,
  reason: z.enum(["divergence", "illegal_move", "bad_sequence", "deadline", "too_many_moves"]),
  atSeq: z.int().optional(),
});

export const ServerMessageSchema = z.union([
  z.object({ type: z.literal("pong"), t: z.number(), serverNow: z.number() }),
  z.object({ type: z.literal("welcome"), pirate: PirateSummarySchema, serverNow: z.number() }),
  PuzzleStartedSchema,
  z.object({ type: z.literal("puzzle.ack"), sessionId: SessionId, seq: z.int() }),
  PuzzleResultSchema,
  PuzzleRejectedSchema,
  z.object({ type: z.literal("error"), code: ErrorCodeSchema, detail: z.string().optional() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type PuzzleStarted = z.infer<typeof PuzzleStartedSchema>;
export type PuzzleResult = z.infer<typeof PuzzleResultSchema>;

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const r = ClientMessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  const r = ServerMessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}
