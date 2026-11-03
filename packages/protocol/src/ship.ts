import { z } from "zod";
import { PuzzleIdSchema } from "./common.js";

/** Stations are the duty puzzles. */
export const StationSchema = PuzzleIdSchema;
export type StationWire = z.infer<typeof StationSchema>;

const Id = z.string().min(1).max(64);
const Permille = z.int().min(0).max(1000);

export const CrewViewSchema = z.object({
  pirateId: Id,
  name: z.string(),
  station: StationSchema.nullable(),
  captain: z.boolean(),
  /** Dropped; their seat is held for the grace period. */
  away: z.boolean(),
});
export type CrewView = z.infer<typeof CrewViewSchema>;

export const ShipLocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("docked"), islandId: Id }),
  z.object({
    kind: z.literal("at-sea"),
    routeId: Id,
    from: Id,
    to: Id,
    progress: Permille,
    /** A brigand waiting on the captain's answer. */
    hail: z.object({ tierId: Id, sinceTurn: z.int().min(0) }).nullable(),
  }),
]);
export type ShipLocation = z.infer<typeof ShipLocationSchema>;

export const TurnReportSchema = z.object({
  turn: z.int().min(0),
  /** Each station's output, percent of par. */
  outputs: z.record(StationSchema, z.int().min(0)),
  held: z.boolean(),
  speed: z.int().min(0),
  tokens: z.int().min(0),
});
export type TurnReportWire = z.infer<typeof TurnReportSchema>;

/** Everything the client shows about a ship it is aboard. The server sends a whole one each time. */
export const ShipSnapshotSchema = z.object({
  shipId: Id,
  name: z.string(),
  classId: Id,
  ownerId: Id,
  captainId: Id.nullable(),
  crew: z.array(CrewViewSchema),
  maxCrew: z.int().min(1),
  inviteOnly: z.boolean(),
  location: ShipLocationSchema,
  turn: z.int().min(0),
  water: Permille,
  damage: Permille,
  loaded: z.int().min(0),
  cannons: z.int().min(0),
  lastTurn: TurnReportSchema.nullable(),
  /** Server clock ms when the next turn fires. */
  nextTurnAt: z.number().nullable(),
  turnMs: z.int().min(1000),
  voyagesCompleted: z.int().min(0),
});
export type ShipSnapshot = z.infer<typeof ShipSnapshotSchema>;

/** What changed since the last snapshot, with names attached so the client can say who. */
export const ShipEventWireSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boarded"), pirateId: Id, name: z.string() }),
  z.object({ type: z.literal("left"), pirateId: Id, name: z.string(), reason: z.enum(["left", "timed_out"]) }),
  z.object({ type: z.literal("station"), pirateId: Id, name: z.string(), station: StationSchema.nullable() }),
  z.object({ type: z.literal("wheel"), pirateId: Id, name: z.string() }),
  z.object({ type: z.literal("sailed"), routeId: Id }),
  z.object({ type: z.literal("hailed"), tierId: Id }),
  z.object({ type: z.literal("evaded"), tierId: Id, auto: z.boolean() }),
  z.object({ type: z.literal("arrived"), islandId: Id, turns: z.int().min(0) }),
  z.object({ type: z.literal("abandoned"), islandId: Id }),
]);
export type ShipEventWire = z.infer<typeof ShipEventWireSchema>;

/** Chat channels in v1 (DESIGN.md 3.7). Crew chat arrives with crews in M6. */
export const ChatChannelSchema = z.enum(["ship", "island"]);
export type ChatChannel = z.infer<typeof ChatChannelSchema>;

/** A ship as the notice board lists it. */
export const BoardShipSchema = z.object({
  shipId: Id,
  name: z.string(),
  classId: Id,
  captainName: z.string(),
  crew: z.int().min(0),
  maxCrew: z.int().min(1),
  location: ShipLocationSchema,
  inviteOnly: z.boolean(),
  /** The viewer owns it. */
  yours: z.boolean(),
});
export type BoardShip = z.infer<typeof BoardShipSchema>;
