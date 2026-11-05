import { z } from "zod";
import { ErrorCodeSchema, PirateSummarySchema, PuzzleIdSchema, RatingViewSchema } from "./common.js";
import { BattleConfigSchema } from "./battle.js";
import { BilgingConfigSchema } from "./bilging.js";
import { CarpentryConfigSchema } from "./carpentry.js";
import { NavigationConfigSchema } from "./navigation.js";
import { SailingConfigSchema } from "./sailing.js";
import { GunneryConfigSchema } from "./gunnery.js";
import { MeleeBoardSchema, SwordfightConfigSchema } from "./swordfight.js";
import { BoardShipSchema, ChatChannelSchema, ShipEventWireSchema, ShipSnapshotSchema, StationSchema } from "./ship.js";

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
    /**
     * Any puzzle's move, kept loose on the wire: a union would let the first matching variant strip
     * fields another puzzle needs (a Gunnery `end` carries a tick). The server narrows it to the
     * session's own puzzle schema; a move that fails that check is an illegal move.
     */
    move: z.looseObject({ type: z.string().min(1).max(32) }),
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
  /** Board a ship at the pirate's island, or one at sea from the notice board. */
  z.object({ type: z.literal("ship.board"), shipId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("ship.leave") }),
  /** Take a station aboard the pirate's ship, or null to stand down. */
  z.object({ type: z.literal("ship.station"), station: StationSchema.nullable() }),
  /** Captain only: set sail along a route leg from the island the ship is docked at. */
  z.object({ type: z.literal("ship.sail"), routeId: z.string().min(1).max(64) }),
  /** Captain only: evade the brigand that hailed the ship. */
  z.object({ type: z.literal("ship.evade") }),
  /** Captain only: fight the brigand that hailed the ship. The battle board is dealt as a puzzle session. */
  z.object({ type: z.literal("ship.engage") }),
  /** Captain only: hand the wheel to someone aboard. */
  z.object({ type: z.literal("ship.wheel"), pirateId: z.string().min(1).max(64) }),
  /** Owner only: whether others may board. */
  z.object({ type: z.literal("ship.lock"), inviteOnly: z.boolean() }),
  /** Start a board at the pirate's station; the ship must be at sea. Moves flow as puzzle.move. */
  z.object({ type: z.literal("duty.start") }),
  /** Ships at the pirate's island and ships at sea. */
  z.object({ type: z.literal("board.list") }),
  /** Buy a ship at the shipyard of the island the pirate stands on (ADR 0010). */
  z.object({ type: z.literal("shipyard.buy"), classId: z.string().min(1).max(64) }),
  /** Say something to the ship's crew or to everyone ashore at the same island. */
  z.object({ type: z.literal("chat.send"), channel: ChatChannelSchema, text: z.string().trim().min(1).max(280) }),
  /** Who is ashore at the pirate's island right now. */
  z.object({ type: z.literal("island.who") }),
  /** Aboard, in a boarding melee without a board (joined late, or back from a drop): deal one. */
  z.object({ type: z.literal("melee.join") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

const PuzzleStartedBase = z.object({
  type: z.literal("puzzle.started"),
  sessionId: SessionId,
  seed: z.string(),
  /** Server clock ms when the round must be finished. The client shows a timer against it. */
  deadlineAt: z.number(),
  serverNow: z.number(),
  /** Present when the round is a duty board aboard a ship rather than practice. */
  duty: z
    .object({
      shipId: z.string(),
      station: StationSchema,
      /** Bilging only: the ship's bilge in rows when the board was dealt; the board's first move sets it. */
      water: z.int().min(0).max(32).optional(),
    })
    .optional(),
  /** Present when the round is the captain's sea battle aboard a ship. */
  battle: z.object({ shipId: z.string(), tierId: z.string() }).optional(),
  /** Present when the round is the pirate's board in a boarding melee aboard a ship (M5). */
  melee: z.object({ shipId: z.string(), tierId: z.string() }).optional(),
  /**
   * A fight the captain reconnected to: the moves the server already holds, in order. The client
   * replays them from the seed without sending them again and carries on from there.
   */
  resume: z.object({ moves: z.array(z.looseObject({ type: z.string().min(1).max(32) })) }).optional(),
});

/** One variant per puzzle so a client narrows `config` by `puzzle`. */
export const PuzzleStartedSchema = z.discriminatedUnion("puzzle", [
  PuzzleStartedBase.extend({ puzzle: z.literal("bilging"), config: BilgingConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("sailing"), config: SailingConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("carpentry"), config: CarpentryConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("gunnery"), config: GunneryConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("navigation"), config: NavigationConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("battle"), config: BattleConfigSchema }),
  PuzzleStartedBase.extend({ puzzle: z.literal("swordfight"), config: SwordfightConfigSchema }),
]);

export const PuzzleResultSchema = z.object({
  type: z.literal("puzzle.result"),
  sessionId: SessionId,
  score: z.int().min(0),
  moves: z.int().min(0),
  bestCombo: z.int().min(0),
  /** False when the client's hash diverged from the server replay; the server's numbers stand. */
  verified: z.boolean(),
  /** Null when the round was not rated: a duty board cut short by docking or standing down. */
  rating: RatingViewSchema.nullable(),
  /** "up", "down", or "same" relative to the tier before the round; null when unrated. */
  tierChange: z.enum(["up", "down", "same"]).nullable(),
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
  z.object({ type: z.literal("ship.state"), ship: ShipSnapshotSchema, events: z.array(ShipEventWireSchema), serverNow: z.number() }),
  /** The pirate is no longer aboard: they went ashore, or their held seat timed out. */
  z.object({ type: z.literal("ship.left"), shipId: z.string(), reason: z.enum(["left", "timed_out"]) }),
  z.object({ type: z.literal("board.ships"), islandId: z.string(), ships: z.array(BoardShipSchema), serverNow: z.number() }),
  /** The ship's bilge changed at a turn: the Bilging board at this session logs a water move with this row. */
  z.object({ type: z.literal("duty.water"), sessionId: SessionId, row: z.int().min(0).max(32) }),
  /** A ship turn passed during a battle: the captain's board logs a supply move with exactly these numbers. */
  z.object({
    type: z.literal("battle.supply"),
    sessionId: SessionId,
    left: z.int().min(0).max(32),
    forward: z.int().min(0).max(32),
    right: z.int().min(0).max(32),
    cannons: z.int().min(0).max(32),
    hull: z.int().min(0).max(1000),
  }),
  /** Wrack from another board in the melee: the pirate's board logs an incoming move with exactly these numbers, in this order. */
  z.object({ type: z.literal("melee.incoming"), sessionId: SessionId, wrack: z.int().min(1).max(999), blade: z.int().min(0).max(15), from: z.string() }),
  /** Every board in the melee, for the boards beside the pirate's own. Sent whenever one changes. */
  z.object({ type: z.literal("melee.boards"), shipId: z.string(), boards: z.array(MeleeBoardSchema), serverNow: z.number() }),
  /** The melee is decided for the side outside the pirate's board: their board logs an end move saying this. */
  z.object({ type: z.literal("melee.over"), sessionId: SessionId, won: z.boolean() }),
  /** The pirate's own summary changed: they came ashore somewhere new, or bought a ship. */
  z.object({ type: z.literal("pirate.updated"), pirate: PirateSummarySchema }),
  z.object({
    type: z.literal("chat.message"),
    channel: ChatChannelSchema,
    pirateId: z.string(),
    name: z.string(),
    text: z.string(),
    at: z.number(),
  }),
  /** Everyone ashore at an island. Sent to those ashore there whenever it changes, and on request. */
  z.object({ type: z.literal("island.presence"), islandId: z.string(), pirates: z.array(z.object({ pirateId: z.string(), name: z.string() })) }),
  z.object({ type: z.literal("error"), code: ErrorCodeSchema, detail: z.string().optional() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type PuzzleStarted = z.infer<typeof PuzzleStartedSchema>;
export type PuzzleResult = z.infer<typeof PuzzleResultSchema>;
export type ShipStateMessage = Extract<ServerMessage, { type: "ship.state" }>;
export type ChatMessage = Extract<ServerMessage, { type: "chat.message" }>;
export type MeleeBoardsMessage = Extract<ServerMessage, { type: "melee.boards" }>;

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const r = ClientMessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  const r = ServerMessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}
