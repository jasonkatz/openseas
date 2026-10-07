/**
 * Sea battle runs on a SQUARE grid (like the classic), while the ocean itself is hex.
 * We reuse the {q,r} shape as {x,y} to avoid a second coordinate type: q = column, r = row.
 */
import type { Hex } from '../hex';

export type Cell = Hex;

export const BATTLE_W = 12;
export const BATTLE_H = 12;
export const BATTLE_TURN_MS = 20000;
export const BATTLE_RESOLVE_MS = 5500;
export const BATTLE_MAX_TURNS = 14;
export const SEGMENTS = 4;
export const CANNON_RANGE = 3;
export const SHOT_DAMAGE = 10;
export const RAM_DAMAGE = 6;
export const ROCK_DAMAGE = 5;

/** Headings on the square grid: 0=N, 1=E, 2=S, 3=W. */
export const SQ_DIRS: readonly Cell[] = [{ q: 0, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 0 }];
export const SQ_HEADING_NAMES = ['N', 'E', 'S', 'W'] as const;

export type MoveToken = 'L' | 'F' | 'R' | null;

export interface TurnOrders {
  moves: MoveToken[];                               // length 4
  shots: { port: boolean; starboard: boolean }[];   // length 4
  grapple: boolean;
}

export interface BattleShip {
  id: string;
  name: string;
  type: string;
  npc: boolean;
  side: 0 | 1;
  cell: Cell;
  heading: number;
  hull: number;
  maxHull: number;
  /** Tokens available to spend this turn (replenished each turn from sail power). */
  tokens: { L: number; F: number; R: number };
  loaded: number;
  cannons: number;
  grappleReady: boolean;
  crew: string[];
  orders: TurnOrders | null;
  sunk: boolean;
  /** Cosmetic sprite index. */
  sprite: number;
}

export interface BattleEvent {
  turn: number;
  seg: number;
  kind: 'move' | 'turn' | 'shot' | 'hit' | 'miss' | 'ram' | 'rock' | 'grapple' | 'sunk' | 'blocked';
  shipId: string;
  from?: Cell;
  to?: Cell;
  heading?: number;
  targetId?: string;
  dmg?: number;
  path?: Cell[];
}

export interface BattleState {
  id: string;
  turn: number;
  phase: 'orders' | 'resolving' | 'boarding' | 'over';
  /** Server clock ms when the current phase ends. */
  phaseEndsAt: number;
  ships: BattleShip[];
  rocks: Cell[];
  /** Events from the last resolved turn, for animation. */
  lastEvents: BattleEvent[];
  winnerSide: 0 | 1 | null;
  /** Why it ended: 'sunk' | 'boarded' | 'disengaged'. */
  outcome: 'sunk' | 'boarded' | 'disengaged' | null;
  /** Side that initiated boarding (grappler), if phase is boarding. */
  boardingSide: 0 | 1 | null;
  log: string[];
}

export function emptyOrders(): TurnOrders {
  return { moves: [null, null, null, null], shots: [0, 1, 2, 3].map(() => ({ port: false, starboard: false })), grapple: false };
}
