import { z } from 'zod';
import type { BattleState } from './battle/types';
import type { PuzzleConfig, PuzzleId } from './puzzles/types';
import type { Avatar, Crew, Pirate, Ship, CommodityId } from './world';

export const AvatarSchema = z.object({
  skin: z.number().int().min(0).max(5),
  hair: z.number().int().min(0).max(7),
  hairColor: z.number().int().min(0).max(5),
  shirt: z.number().int().min(0).max(9),
  pants: z.number().int().min(0).max(9),
  hat: z.number().int().min(0).max(5),
});

const PuzzleIdSchema = z.enum(['bilging', 'sailing', 'carpentry', 'gunnery', 'navigation', 'swordfight']);
const StationSchema = z.enum(['bilging', 'sailing', 'carpentry', 'gunnery', 'navigation']);
const CommoditySchema = z.enum(['rum', 'hemp', 'iron', 'sugar', 'wood', 'cloth']);

export const LogEntrySchema = z.object({ at: z.number().int().nonnegative(), a: z.unknown() });

export const ClientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('login'), name: z.string().min(2).max(20), token: z.string().optional(), avatar: AvatarSchema.optional() }),
  z.object({ t: z.literal('pos'), x: z.number(), y: z.number(), facing: z.number().int().min(0).max(3), moving: z.boolean() }),
  z.object({ t: z.literal('chat'), channel: z.enum(['local', 'crew', 'global']), text: z.string().min(1).max(240) }),
  z.object({ t: z.literal('emote'), emote: z.string().max(20) }),
  z.object({ t: z.literal('setAvatar'), avatar: AvatarSchema }),
  // Crew
  z.object({ t: z.literal('createCrew'), name: z.string().min(2).max(24), motto: z.string().max(60).optional() }),
  z.object({ t: z.literal('joinCrew'), crewId: z.string() }),
  z.object({ t: z.literal('leaveCrew') }),
  // Economy
  z.object({ t: z.literal('buyShip'), type: z.enum(['sloop', 'cutter', 'brig', 'frigate']), name: z.string().min(2).max(24) }),
  z.object({ t: z.literal('trade'), commodity: CommoditySchema, qty: z.number().int().min(1).max(500), side: z.enum(['buy', 'sell']) }),
  z.object({ t: z.literal('unloadHold'), shipId: z.string() }),
  // Ships
  z.object({ t: z.literal('boardShip'), shipId: z.string() }),
  z.object({ t: z.literal('leaveShip') }),
  z.object({ t: z.literal('takeStation'), station: StationSchema.nullable() }),
  z.object({ t: z.literal('setSail'), islandId: z.string() }),
  z.object({ t: z.literal('dock') }),
  z.object({ t: z.literal('listShips') }),
  z.object({ t: z.literal('hireHand'), station: StationSchema }),
  z.object({ t: z.literal('dismissHand'), handId: z.string() }),
  // Puzzles
  z.object({ t: z.literal('puzzleStart'), puzzle: PuzzleIdSchema, practice: z.boolean().optional() }),
  z.object({ t: z.literal('puzzleCheckpoint'), sessionId: z.string(), entries: z.array(LogEntrySchema).max(2000), elapsedMs: z.number().int().nonnegative(), points: z.number(), performance: z.number() }),
  z.object({ t: z.literal('puzzleEnd'), sessionId: z.string() }),
  // Battle
  z.object({ t: z.literal('battleOrders'), moves: z.array(z.enum(['L', 'F', 'R']).nullable()).length(4), shots: z.array(z.object({ port: z.boolean(), starboard: z.boolean() })).length(4), grapple: z.boolean() }),
  z.object({ t: z.literal('battleReady') }),
  // Swordfight (boarding)
  z.object({ t: z.literal('sfAction'), action: z.unknown() }),
  z.object({ t: z.literal('leaderboard') }),
  z.object({ t: z.literal('listCrews') }),
  z.object({ t: z.literal('ping'), at: z.number() }),
]);

export type ClientMsg = z.infer<typeof ClientMsgSchema>;

export interface PresenceEntry {
  id: string;
  name: string;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  avatar: Avatar;
  crewName?: string;
  emote?: string;
  title?: string;
}

export interface ShipView extends Ship {
  crewNames: Record<string, string>;
  /** Names + avatars of everyone aboard for the deck scene. */
  aboardPirates: PresenceEntry[];
}

export interface IslandRoomView {
  kind: 'island';
  islandId: string;
  pirates: PresenceEntry[];
  /** Ships docked here. */
  ships: Ship[];
}

export interface ShipRoomView {
  kind: 'ship';
  ship: ShipView;
  battle: BattleState | null;
}

export type RoomView = IslandRoomView | ShipRoomView;

export interface SwordfightPlayerView {
  pirateId: string;
  name: string;
  side: 0 | 1;
  npc: boolean;
  /** Serialized engine state for rendering. */
  state: unknown;
  ko: boolean;
}

export interface SwordfightView {
  id: string;
  phase: 'fighting' | 'over';
  endsAt: number;
  players: SwordfightPlayerView[];
  winnerSide: 0 | 1 | null;
  sides: [string, string];
}

export type ServerMsg =
  | { t: 'welcome'; pirate: Pirate; token: string; serverTime: number }
  | { t: 'error'; msg: string }
  | { t: 'toast'; text: string; kind?: 'info' | 'good' | 'bad' }
  | { t: 'room'; view: RoomView }
  | { t: 'presence'; islandId: string; pirates: PresenceEntry[] }
  | { t: 'presenceLeave'; id: string }
  | { t: 'chat'; from: string; fromId: string; channel: 'local' | 'crew' | 'global' | 'system'; text: string; at: number }
  | { t: 'pirate'; pirate: Pirate }
  | { t: 'crew'; crew: Crew | null }
  | { t: 'ship'; ship: ShipView }
  | { t: 'ships'; ships: Ship[] }
  | { t: 'crews'; crews: Crew[] }
  | { t: 'puzzleSeed'; sessionId: string; puzzle: PuzzleId; seed: number; config: PuzzleConfig }
  | { t: 'puzzleVerified'; sessionId: string; points: number; performance: number; ok: boolean }
  | { t: 'puzzleReward'; puzzle: PuzzleId; points: number; performance: number; poe: number }
  | { t: 'battle'; state: BattleState }
  | { t: 'battleEnd'; won: boolean; booty: { poe: number; goods: Partial<Record<CommodityId, number>> } | null; summary: string }
  | { t: 'swordfight'; view: SwordfightView }
  | { t: 'swordfightEnd'; wonSide: 0 | 1; yourSide: 0 | 1 }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'leaderboard'; rows: { name: string; puzzle: PuzzleId; best: number; rating: number }[] };
