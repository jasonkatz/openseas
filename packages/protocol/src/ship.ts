import { z } from "zod";
import { BattleOutcomeSchema } from "./battle.js";
import { CrewTagSchema, DutyPuzzleIdSchema, PirateLookWireSchema } from "./common.js";

/** Stations are the duty puzzles. */
export const StationSchema = DutyPuzzleIdSchema;
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
  /** A bot: AI crew booted up when the ship flew short-handed, not a player (DESIGN.md 3.4). */
  bot: z.boolean(),
  /** The crew (M6) this pirate belongs to, so shipmates who share one can be told apart. Null for bots. */
  crewId: Id.nullable().default(null),
  /** The jacket and headgear they wear on deck. Null for bots, who always wear a smock and kerchief. */
  look: PirateLookWireSchema.nullable().default(null),
});
export type CrewView = z.infer<typeof CrewViewSchema>;

export const ShipLocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("docked"), outpostId: Id }),
  z.object({
    kind: z.literal("in-flight"),
    laneId: Id,
    from: Id,
    to: Id,
    progress: Permille,
    /** A raider waiting on the captain's answer. */
    hail: z.object({ tierId: Id, sinceTurn: z.int().min(0) }).nullable(),
    /** The fight under way: the ship holds position while the captain flies the battle board. */
    battle: z.object({ tierId: Id, sinceTurn: z.int().min(0) }).nullable(),
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
  heat: Permille,
  damage: Permille,
  loaded: z.int().min(0),
  turrets: z.int().min(0),
  lastTurn: TurnReportSchema.nullable(),
  /** Server clock ms when the next turn fires. */
  nextTurnAt: z.number().nullable(),
  turnMs: z.int().min(1000),
  voyagesCompleted: z.int().min(0),
  /** The boarding melee under way (M5): everyone aboard fights at the airlock while the ship holds position. */
  melee: z.object({ tierId: Id }).nullable(),
  /** The owner's crew (M6): the ship flies its flag. Null when the owner is in no crew. */
  colors: CrewTagSchema.nullable().default(null),
});
export type ShipSnapshot = z.infer<typeof ShipSnapshotSchema>;

/** What changed since the last snapshot, with names attached so the client can say who. */
export const ShipEventWireSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boarded"), pirateId: Id, name: z.string() }),
  z.object({ type: z.literal("left"), pirateId: Id, name: z.string(), reason: z.enum(["left", "timed_out"]) }),
  /** A bot booted up as the ship flew, at a station or waiting for one to open. */
  z.object({ type: z.literal("booted_up"), pirateId: Id, name: z.string(), station: StationSchema.nullable() }),
  /** Bots disembarked: the ship docked, emptied of pirates, or needed the berth. */
  z.object({ type: z.literal("powered_down"), names: z.array(z.string()) }),
  z.object({ type: z.literal("station"), pirateId: Id, name: z.string(), station: StationSchema.nullable() }),
  z.object({ type: z.literal("helm"), pirateId: Id, name: z.string() }),
  z.object({ type: z.literal("launched"), laneId: Id }),
  z.object({ type: z.literal("hailed"), tierId: Id }),
  z.object({ type: z.literal("evaded"), tierId: Id, auto: z.boolean() }),
  z.object({ type: z.literal("engaged"), tierId: Id }),
  /** The fight is over. `plunder` is the whole purse paid out on a win, in credits; 0 otherwise. */
  z.object({ type: z.literal("battle_ended"), tierId: Id, outcome: BattleOutcomeSchema, plunder: z.int().min(0), turns: z.int().min(0) }),
  /** A boarding opened the melee: steel out, everyone to the airlock. */
  z.object({ type: z.literal("boarding"), tierId: Id }),
  z.object({ type: z.literal("arrived"), outpostId: Id, turns: z.int().min(0) }),
  z.object({ type: z.literal("abandoned"), outpostId: Id }),
]);
export type ShipEventWire = z.infer<typeof ShipEventWireSchema>;

/** Chat channels in v1 (DESIGN.md 3.7): the ship's, everyone at an outpost, and the pirate's crew wherever they are. */
export const ChatChannelSchema = z.enum(["ship", "outpost", "crew"]);
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
  /** The owner's crew, whose flag the ship flies, or null. */
  colors: CrewTagSchema.nullable().default(null),
  /** The owner is in the viewer's crew: a crew-only ship is open to the viewer. */
  crewmate: z.boolean().default(false),
});
export type BoardShip = z.infer<typeof BoardShipSchema>;
