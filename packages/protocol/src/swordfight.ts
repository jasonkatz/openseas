import { z } from "zod";

const Tick = z.int().min(0).max(1_000_000);
const Rot = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const SwordfightMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), col: z.int().min(0).max(15), rot: Rot, tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  /** Aboard only: scrap from a board outside this fight, as the server announced it. */
  z.object({ type: z.literal("incoming"), board: z.int().min(0).max(16), scrap: z.int().min(1).max(999), blade: z.int().min(0).max(15), tick: Tick }),
  /** The fight is over for this board: the player yields, or the server says the other side is beaten. */
  z.object({ type: z.literal("end"), won: z.boolean().optional(), tick: Tick }),
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
  width: z.int().min(4).max(10).describe("Columns on each board."),
  height: z.int().min(6).max(20).describe("Rows on each board: fewer leaves less room before a board tops out."),
  colors: z.int().min(3).max(6).describe("Block colors in the deal: more makes same-colored groups harder to gather."),
  breakerPermille: z.int().min(0).max(1000).describe("Chance, per mille, that each block of a falling pair is a breaker."),
  dealSeed: z.string().max(200).describe("Names the shared stream of pairs. Empty: the fight's own seed deals every board the same pairs."),
  ripenMoves: z.int().min(1).max(20).describe("Drops on a board before scrap that landed there ripens into colored blocks."),
  scrapMatchPermille: z.int().min(0).max(1000).describe("Chance, per mille, that a block of scrap is dealt a color seen around where it lands, not a random one."),
  cellPoints: z.int().min(0).max(1000).describe("Points for each block broken."),
  slabBonus: z.int().min(0).max(1000).describe("Extra points a slab earns for its size, growing with every pair of blocks in it."),
  attackPoints: z.int().min(1).max(100_000).describe("Points of attack it takes to send one block of scrap: lower sends more scrap for the same break."),
  offset: z.boolean().describe("Whether scrap a board sends first cancels scrap waiting to land on that board."),
  landAfterTicks: z.int().min(1).max(10_000).describe("Ticks scrap waits on a board before it lands, unless the board's next drop comes first."),
  incomingCapRows: z.int().min(1).max(20).describe("The most rows of scrap that land at once: the rest waits."),
  blades: z.array(SwordBladeSchema).min(1).max(16).describe("The blades the fight knows: each sets the order of columns its scrap lands in."),
  player: z.boolean().describe("Whether the first board is the player's. Off for a fight the server runs for a raider crew alone."),
  blade: z.int().min(0).max(15).describe("The player's blade, as a place in the list of blades."),
  allies: z.array(SwordAiSchema).max(8).describe("The pirates fighting on the player's side: how fast each drops, how well it plays and its blade."),
  foes: z.array(SwordAiSchema).max(8).describe("The pirates on the other side: how fast each drops, how well it plays and its blade."),
  winPoints: z.int().min(1).max(1_000_000).describe("Points a won fight scores before its attack rate. A fight not won scores its rate, kept under this."),
  scorePercent: z.int().min(1).max(1000).describe("Percent the attack rate is scaled by: harder raiders score more."),
  minRateSeconds: z.int().min(1).max(3600).describe("The attack rate counts at least this many seconds of fight, so a quick end posts no freak rate."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds a tick lasts: lower runs every count in ticks faster."),
  dropTicks: z.int().min(0).max(1000).describe("Ticks after a pair appears before it can come to rest: higher slows the fastest play."),
  fallTicks: z.int().min(1).max(1000).describe("Ticks a block takes to fall one row on the board. It changes only how the fall looks."),
  maxTick: z.int().min(1).max(1_000_000).describe("No move may claim a tick beyond this: the longest a fight can run."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type SwordfightConfigWire = z.infer<typeof SwordfightConfigSchema>;

/** One board of a melee as everyone in it sees it: a row-major string, top row first, `.` empty, 0-5 a color, A-F a breaker, `#` scrap. */
export const MeleeBoardSchema = z.object({
  /** The pirate at the board, or a raider's number. */
  pirateId: z.string().nullable(),
  name: z.string(),
  side: z.union([z.literal(0), z.literal(1)]),
  cells: z.string().max(400),
  /** Scrap waiting to land. */
  pending: z.int().min(0),
  out: z.boolean(),
  points: z.int().min(0),
});
export type MeleeBoardWire = z.infer<typeof MeleeBoardSchema>;
