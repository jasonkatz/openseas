import { z } from "zod";

const Tick = z.int().min(0).max(1_000_000);
const Rot = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const SwordfightMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), col: z.int().min(0).max(15), rot: Rot, tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  /** Aboard only: wrack from a board outside this fight, as the server announced it. */
  z.object({ type: z.literal("incoming"), board: z.int().min(0).max(16), wrack: z.int().min(1).max(999), blade: z.int().min(0).max(15), tick: Tick }),
  /** The fight is over for this board: the player yields, or the server says the other side is beaten. */
  z.object({ type: z.literal("end"), won: z.boolean(), tick: Tick }),
]);
export type SwordfightMoveWire = z.infer<typeof SwordfightMoveSchema>;

export const SwordAiSchema = z.object({
  thinkTicks: z.int().min(1).max(10_000),
  skill: z.int().min(0).max(100),
  blade: z.int().min(0).max(15),
});

export const SwordBladeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  columns: z.array(z.int().min(0).max(9)).min(1).max(64),
});

export const SwordfightConfigSchema = z.object({
  width: z.int().min(4).max(10),
  height: z.int().min(6).max(20),
  colors: z.int().min(3).max(6),
  breakerPermille: z.int().min(0).max(1000),
  ripenMoves: z.int().min(1).max(20),
  cellPoints: z.int().min(0).max(1000),
  slabBonus: z.int().min(0).max(1000),
  attackPoints: z.int().min(1).max(100_000),
  offset: z.boolean(),
  landAfterTicks: z.int().min(1).max(10_000),
  incomingCapRows: z.int().min(1).max(20),
  blades: z.array(SwordBladeSchema).min(1).max(16),
  player: z.boolean(),
  blade: z.int().min(0).max(15),
  allies: z.array(SwordAiSchema).max(8),
  foes: z.array(SwordAiSchema).max(8),
  winPoints: z.int().min(0).max(1_000_000),
  tickMs: z.int().min(20).max(5000),
  dropTicks: z.int().min(0).max(1000),
  fallTicks: z.int().min(1).max(1000),
  maxTick: z.int().min(1).max(1_000_000),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type SwordfightConfigWire = z.infer<typeof SwordfightConfigSchema>;

/** One board of a melee as everyone in it sees it: a row-major string, top row first, `.` empty, 0-5 a color, A-F a breaker, `#` wrack. */
export const MeleeBoardSchema = z.object({
  /** The pirate at the board, or a brigand's number. */
  pirateId: z.string().nullable(),
  name: z.string(),
  side: z.union([z.literal(0), z.literal(1)]),
  cells: z.string().max(400),
  /** Wrack waiting to land. */
  pending: z.int().min(0),
  out: z.boolean(),
  points: z.int().min(0),
});
export type MeleeBoardWire = z.infer<typeof MeleeBoardSchema>;
