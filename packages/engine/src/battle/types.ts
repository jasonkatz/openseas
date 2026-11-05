/**
 * Sea Battle: the captain's game, one ship against a brigand on a square grid of water, rocks,
 * winds and eddies (DESIGN.md 3.3). Each turn the captain spends movement tokens on up to
 * `segments` moves (left, forward, right), marks which segments fire a cannon to port or
 * starboard, and commits. The brigand plans its own turn from the same rules; both plans resolve
 * segment by segment at once: a move, then the wind, then the guns. A turn ends with a grapple
 * when the weaker ship is close enough, with a crippled hull, or at the turn limit.
 *
 * Headings are 0 north (up, -y), 1 east, 2 south, 3 west. A left or right turn carries the ship
 * one cell forward and then swings it 90 degrees, so a ship can never spin in place.
 *
 * Everything is integers (ADR 0003). The brigand's choices are made inside the reducer from the
 * seeded PRNG, so a replay of the move log reproduces the whole fight, AI and all. Aboard a ship
 * the tokens, loaded cannons and hull arrive as `supply` moves the server vouches for; in practice
 * the config supplies them itself each turn.
 */

import type { PrngState } from "../prng.js";

export type Heading = 0 | 1 | 2 | 3;
export const HEADING_DX: readonly number[] = [0, 1, 0, -1];
export const HEADING_DY: readonly number[] = [-1, 0, 1, 0];

export type MoveToken = "left" | "forward" | "right";
export const MOVE_TOKENS: readonly MoveToken[] = ["left", "forward", "right"];

export type Side = "port" | "starboard";

/** What a cell of the board is. Winds carry a heading; an eddy spins a ship clockwise. */
export type BattleCell = { readonly kind: "water" } | { readonly kind: "rock" } | { readonly kind: "wind"; readonly heading: Heading } | { readonly kind: "eddy" };

export interface ParsedBoard {
  readonly width: number;
  readonly height: number;
  /** Row-major, index = y * width + x. */
  readonly cells: readonly BattleCell[];
  readonly start: readonly [{ readonly x: number; readonly y: number; readonly heading: Heading }, { readonly x: number; readonly y: number; readonly heading: Heading }];
}

/** The brigand's knobs. Content's tiers feed these; the harness tunes them directly. */
export interface BrigandSpec {
  readonly cannons: number;
  /** Tokens dealt per turn: this many forward, and half as many (rounded up) each of left and right. */
  readonly tokensPerTurn: number;
  /** Cannons reloaded per turn. */
  readonly reloadPerTurn: number;
  /** Percent of planned shots that are actually fired; the rest are misjudged and held. */
  readonly accuracy: number;
  /** Percent weight on closing and grappling over keeping out of the captain's guns. */
  readonly aggression: number;
  /** Damage the brigand starts with, permille. */
  readonly startDamage: number;
}

export interface SupplySpec {
  readonly left: number;
  readonly forward: number;
  readonly right: number;
  /** Cannons loaded per turn. */
  readonly cannons: number;
}

export interface BattleConfig {
  /**
   * Boards the seed picks from: one string per row. `.` water, `#` rock, `^ > v <` a wind blowing
   * that way, `@` an eddy, `A` where the captain starts (facing north), `B` the brigand (south).
   */
  readonly boards: ReadonlyArray<readonly string[]>;
  /** Moves a turn may carry. */
  readonly segments: number;
  /** Seconds the captain has to plan a turn before the board commits what is queued. Aboard, the ship's turn. The reducer never reads it. */
  readonly turnSeconds: number;
  /** A ship holds at most this many tokens of a kind. */
  readonly tokenCap: number;
  /** Cells a shot travels. */
  readonly cannonRange: number;
  /** Hull damage per hit, permille. */
  readonly shotDamage: number;
  /** Hull damage for sailing (or being blown) into a rock, permille. */
  readonly rockDamage: number;
  /** Hull damage to both ships when they collide, permille. */
  readonly ramDamage: number;
  /** A ship this damaged can be grappled and boarded from an adjacent cell. */
  readonly grappleDamage: number;
  /** The fight is over after this many turns: the brigand breaks off. */
  readonly maxTurns: number;
  /** The captain's ship. */
  readonly cannons: number;
  readonly startLoaded: number;
  readonly startDamage: number;
  /** Tokens and loads dealt every turn in practice; null aboard, where `supply` moves bring the ship's. */
  readonly supply: SupplySpec | null;
  readonly brigand: BrigandSpec;
  /** Points per hit landed. */
  readonly hitPoints: number;
  /** Points for boarding or crippling the brigand, plus `turnBonus` for every turn to spare. */
  readonly winPoints: number;
  readonly turnBonus: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_BATTLE_BOARDS: ReadonlyArray<readonly string[]> = [
  [
    "################",
    "#......>>......#",
    "#..#...........#",
    "#......B.....#.#",
    "#....#.........#",
    "#..........@...#",
    "#.#............#",
    "#......^.......#",
    "#.......v......#",
    "#............#.#",
    "#...@..........#",
    "#.........#....#",
    "#.#.....A......#",
    "#...........#..#",
    "#......<<......#",
    "################",
  ],
];

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  boards: DEFAULT_BATTLE_BOARDS,
  segments: 4,
  turnSeconds: 12,
  tokenCap: 6,
  cannonRange: 3,
  shotDamage: 120,
  rockDamage: 80,
  ramDamage: 100,
  grappleDamage: 500,
  maxTurns: 20,
  cannons: 4,
  startLoaded: 2,
  startDamage: 0,
  supply: { left: 1, forward: 2, right: 1, cannons: 2 },
  brigand: { cannons: 4, tokensPerTurn: 3, reloadPerTurn: 1, accuracy: 65, aggression: 60, startDamage: 0 },
  hitPoints: 50,
  winPoints: 500,
  turnBonus: 40,
  maxMoves: 64,
};

export interface BattleShip {
  readonly x: number;
  readonly y: number;
  readonly heading: Heading;
  /** Permille of a wrecked hull. */
  readonly damage: number;
  readonly loaded: number;
  readonly cannons: number;
  readonly tokens: Readonly<Record<MoveToken, number>>;
}

/** One segment of a turn's plan: a move, or holding still, and which guns fire after it. */
export interface BattleSegment {
  readonly move: MoveToken | null;
  readonly port: boolean;
  readonly starboard: boolean;
}

export interface BattlePlan {
  readonly segments: readonly BattleSegment[];
  /** Board the other ship if it is adjacent and damaged enough after a segment. */
  readonly grapple: boolean;
}

export const EMPTY_PLAN: BattlePlan = { segments: [], grapple: false };

export type BattleMove =
  | ({ readonly type: "commit" } & BattlePlan)
  /** Aboard only: what the ship brings this turn. Tokens add up to the cap; loads and the hull are the ship's own numbers. */
  | { readonly type: "supply"; readonly left: number; readonly forward: number; readonly right: number; readonly cannons: number; readonly hull: number }
  /** The captain breaks off the fight: the round ends as a disengagement. */
  | { readonly type: "end" };

/** How a fight ended, from the captain's side. */
export type BattleOutcome = "boarded" | "crippled" | "boarded_by" | "crippled_by" | "broke_off" | "disengaged";

export const WIN_OUTCOMES: readonly BattleOutcome[] = ["boarded", "crippled"];

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly heading: Heading;
}

/** Ship 0 is the captain's, 1 the brigand. */
export type ShipIndex = 0 | 1;

export type BattleEvent =
  /** A ship tried to move: where it ended up and what, if anything, stopped it. */
  | { readonly seg: number; readonly type: "move"; readonly ship: ShipIndex; readonly token: MoveToken; readonly from: Pose; readonly to: Pose; readonly blocked: "rock" | "edge" | "ship" | null; readonly damage: number }
  /** A wind carried a ship one cell. */
  | { readonly seg: number; readonly type: "push"; readonly ship: ShipIndex; readonly from: Pose; readonly to: Pose; readonly blocked: "rock" | "edge" | "ship" | null; readonly damage: number }
  /** An eddy spun a ship. */
  | { readonly seg: number; readonly type: "spin"; readonly ship: ShipIndex; readonly from: Pose; readonly to: Pose }
  /** A shot: the cells it crossed, and whether it struck the other ship. */
  | { readonly seg: number; readonly type: "shot"; readonly ship: ShipIndex; readonly side: Side; readonly cells: ReadonlyArray<{ readonly x: number; readonly y: number }>; readonly hit: boolean; readonly damage: number }
  /** Grappling hooks went over: the boarding party's ship, and whether they took the other. */
  | { readonly seg: number; readonly type: "grapple"; readonly ship: ShipIndex; readonly success: boolean }
  | { readonly seg: number; readonly type: "ended"; readonly outcome: BattleOutcome };

export interface BattleTurnReport {
  readonly turn: number;
  readonly plan: BattlePlan;
  readonly brigandPlan: BattlePlan;
  readonly events: readonly BattleEvent[];
  /** Hits the captain landed and took this turn. */
  readonly hits: number;
  readonly hitsTaken: number;
  /** Shots the captain's ship fired, for the ship's magazine. */
  readonly shots: number;
  /** Damage the captain's ship took this turn, permille, for the ship's hull. */
  readonly damageTaken: number;
  readonly points: number;
}

export interface BattleState {
  readonly config: BattleConfig;
  readonly board: ParsedBoard;
  readonly boardIndex: number;
  readonly ships: readonly [BattleShip, BattleShip];
  /** Turns resolved so far. */
  readonly turn: number;
  readonly rng: PrngState;
  readonly score: number;
  readonly hits: number;
  readonly hitsTaken: number;
  /** Turns in a row with at least one hit landed. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly moveCount: number;
  readonly lastTurn: BattleTurnReport | null;
  readonly finished: boolean;
  readonly outcome: BattleOutcome | null;
}
