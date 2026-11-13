import { z } from "zod";

const Count = z.int().min(0).max(32);
const Permille = z.int().min(0).max(1000);

export const BattleSegmentSchema = z.object({
  move: z.enum(["left", "forward", "right"]).nullable(),
  port: z.boolean(),
  starboard: z.boolean(),
});
export type BattleSegmentWire = z.infer<typeof BattleSegmentSchema>;

export const BattleMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("commit"), segments: z.array(BattleSegmentSchema).max(8), grapple: z.boolean() }),
  /** Aboard only: the ship's deal for the turn, as the server announced it. */
  z.object({ type: z.literal("supply"), left: Count, forward: Count, right: Count, turrets: Count, hull: Permille }),
  /** The captain breaks off the fight. */
  z.object({ type: z.literal("end") }),
]);
export type BattleMoveWire = z.infer<typeof BattleMoveSchema>;

export const BattleSupplySchema = z.object({
  left: Count.describe("Left-turn tokens dealt each turn."),
  forward: Count.describe("Forward tokens dealt each turn."),
  right: Count.describe("Right-turn tokens dealt each turn."),
  turrets: Count.describe("Turrets loaded each turn."),
});

export const BattleRaiderSchema = z.object({
  turrets: Count.describe("Turrets on the raider's ship."),
  tokensPerTurn: Count.describe("Forward tokens the raider is dealt each turn. It gets half as many, rounded up, of each turn token."),
  reloadPerTurn: Count.describe("Turrets the raider loads each turn."),
  accuracy: z.int().min(0).max(100).describe("Percent of the raider's planned shots that are fired: the rest are misjudged and held."),
  aggression: z.int().min(0).max(100).describe("Percent weight the raider puts on closing and grappling over keeping clear of the captain's turrets."),
  startDamage: z.int().min(0).max(999).describe("Hull damage the raider starts the fight with, per mille."),
});

export const BattleConfigSchema = z.object({
  boards: z.array(z.array(z.string().regex(/^[.#^>v<@AB]+$/).min(5).max(32)).min(5).max(32)).min(1).max(32).describe("Boards the seed picks from, a string a row: space, asteroids, currents, wells and both ships' starts."),
  segments: z.int().min(1).max(8).describe("Moves a turn may carry: more lets a ship fly and fire further in one turn."),
  turnSeconds: z.int().min(3).max(600).describe("Seconds the captain has to plan a turn before the board commits what is queued."),
  tokenCap: z.int().min(1).max(32).describe("The most movement tokens of one kind a ship can hold: tokens dealt past it are lost."),
  turretRange: z.int().min(1).max(16).describe("Cells a shot travels: higher lets ships hit each other from further apart."),
  shotDamage: Permille.describe("Hull damage a hit from a turret does, per mille."),
  asteroidDamage: Permille.describe("Hull damage for flying, or being carried, into an asteroid, per mille."),
  ramDamage: Permille.describe("Hull damage to both ships when they collide, per mille."),
  grappleDamage: Permille.describe("Hull damage, per mille, at which a ship can be grappled and boarded from the next cell."),
  maxTurns: z.int().min(1).max(200).describe("Turns before the raider breaks off: fewer gives less time to win, and turns to spare pay a bonus."),
  turrets: Count.describe("Turrets on the captain's ship."),
  startLoaded: Count.describe("Turrets loaded when the fight opens, on both ships, up to the turrets each one has."),
  startDamage: z.int().min(0).max(999).describe("Hull damage the captain's ship starts the fight with, per mille."),
  supply: BattleSupplySchema.nullable().describe("Tokens and turret loads the captain is dealt every turn in practice. Null aboard: the ship brings them."),
  raider: BattleRaiderSchema.describe("The raider the captain fights: its ship, what it is dealt each turn and how it plays."),
  hitPoints: z.int().min(0).max(1_000_000).describe("Points for each hit landed on the raider."),
  hitTakenPoints: z.int().min(0).max(1_000_000).describe("Points lost for each hit taken, so hits score as a margin. The score never drops below zero."),
  scorePercent: z.int().min(1).max(1000).describe("Percent every turn's points are scaled by: harder raiders score more."),
  winPoints: z.int().min(0).max(1_000_000).describe("Points for boarding or crippling the raider."),
  turnBonus: z.int().min(0).max(1_000_000).describe("Points added to a win for every turn left before the raider would have broken off."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type BattleConfigWire = z.infer<typeof BattleConfigSchema>;

/** How a fight ended, from the captain's side. */
export const BattleOutcomeSchema = z.enum(["boarded", "crippled", "boarded_by", "crippled_by", "broke_off", "disengaged"]);
export type BattleOutcomeWire = z.infer<typeof BattleOutcomeSchema>;
