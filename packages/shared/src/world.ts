import type { Hex } from './hex';
import type { PuzzleId } from './puzzles/types';

export type Biome = 'tropical' | 'volcanic' | 'atoll' | 'misty' | 'jungle' | 'rocky';

export type BuildingKind = 'tavern' | 'shipwright' | 'dock' | 'market' | 'palace' | 'bank';

export interface Building {
  id: string;
  kind: BuildingKind;
  name: string;
  /** Island-scene rectangle in world pixels. */
  x: number; y: number; w: number; h: number;
  /** Door hotspot (world px). */
  door: { x: number; y: number };
}

export interface Island {
  id: string;
  name: string;
  hex: Hex;
  biome: Biome;
  tagline: string;
  /** Island scene size in world px. */
  width: number; height: number;
  spawn: { x: number; y: number };
  buildings: Building[];
  /** Decorative blobs (palms, rocks) placed deterministically. */
  seed: number;
  /** Commodity prices (buy/sell), relative to base. */
  market: Record<CommodityId, number>;
}

export type CommodityId = 'rum' | 'hemp' | 'iron' | 'sugar' | 'wood' | 'cloth';
export const COMMODITIES: readonly { id: CommodityId; name: string; base: number }[] = [
  { id: 'rum', name: 'Rum', base: 18 },
  { id: 'hemp', name: 'Hemp', base: 9 },
  { id: 'iron', name: 'Iron', base: 24 },
  { id: 'sugar', name: 'Sugar', base: 11 },
  { id: 'wood', name: 'Wood', base: 7 },
  { id: 'cloth', name: 'Cloth', base: 15 },
];

export type ShipTypeId = 'sloop' | 'cutter' | 'brig' | 'frigate';
export interface ShipType {
  id: ShipTypeId;
  name: string;
  price: number;
  maxCrew: number;
  cannons: number;      // per side
  hull: number;         // max hull points
  baseSpeed: number;    // hexes per minute on the ocean
  holdSize: number;
  /** Move tokens per battle turn at full sail power. */
  maxMoves: number;
  sprite: number;
}
export const SHIP_TYPES: Record<ShipTypeId, ShipType> = {
  sloop:   { id: 'sloop',   name: 'Sloop',   price: 2500,  maxCrew: 6,  cannons: 2, hull: 60,  baseSpeed: 10, holdSize: 40,  maxMoves: 4, sprite: 0 },
  cutter:  { id: 'cutter',  name: 'Cutter',  price: 7000,  maxCrew: 10, cannons: 3, hull: 90,  baseSpeed: 9,  holdSize: 80,  maxMoves: 4, sprite: 1 },
  brig:    { id: 'brig',    name: 'Brig',    price: 16000, maxCrew: 16, cannons: 4, hull: 130, baseSpeed: 8,  holdSize: 140, maxMoves: 3, sprite: 2 },
  frigate: { id: 'frigate', name: 'Frigate', price: 40000, maxCrew: 24, cannons: 6, hull: 200, baseSpeed: 7,  holdSize: 240, maxMoves: 3, sprite: 3 },
};

export const STATIONS: readonly PuzzleId[] = ['bilging', 'sailing', 'carpentry', 'gunnery', 'navigation'];

export const STATION_INFO: Record<PuzzleId, { name: string; verb: string; icon: string }> = {
  bilging:    { name: 'Bilge',      verb: 'Pump the bilge',   icon: '🪣' },
  sailing:    { name: 'Sails',      verb: 'Trim the sails',   icon: '⛵' },
  carpentry:  { name: 'Carpentry',  verb: 'Patch the hull',   icon: '🔨' },
  gunnery:    { name: 'Guns',       verb: 'Load the cannons', icon: '💣' },
  navigation: { name: 'Helm',       verb: 'Plot the course',  icon: '🧭' },
  swordfight: { name: 'Swordfight', verb: 'Cross blades',     icon: '⚔️' },
};

export interface Avatar {
  skin: number;   // 0..5
  hair: number;   // 0..7 style
  hairColor: number; // 0..5
  shirt: number;  // palette index 0..9
  pants: number;  // 0..9
  hat: number;    // 0 none .. 5
}

export interface PirateStats { games: number; best: number; rating: number }

export type Location =
  | { kind: 'island'; islandId: string; x: number; y: number }
  | { kind: 'ship'; shipId: string; station: PuzzleId | null };

export interface Pirate {
  id: string;
  name: string;
  avatar: Avatar;
  poe: number;
  crewId: string | null;
  stats: Record<PuzzleId, PirateStats>;
  location: Location;
  createdAt: number;
  title: string;
}

export interface Crew {
  id: string;
  name: string;
  captainId: string;
  members: string[];
  color: number;
  motto: string;
  treasury: number;
  fame: number;
}

export interface ShipStats {
  /** Damage taken, 0..hull. */
  damage: number;
  /** Bilge water 0..100. */
  bilge: number;
  /** 0..1 derived from Sails station performance. */
  sailPower: number;
  /** Loaded cannons, 0..cannons*2. */
  loaded: number;
  /** 0..1 derived from Helm station performance. */
  nav: number;
  /** 0..1 recent carpentry performance. */
  carpentry: number;
}

export type ShipStatus =
  | { kind: 'docked'; islandId: string }
  | { kind: 'sailing'; from: string; to: string; path: Hex[]; index: number; progress: number }
  | { kind: 'battle'; battleId: string }
  | { kind: 'adrift' };

export interface Ship {
  id: string;
  name: string;
  type: ShipTypeId;
  ownerId: string;
  crewId: string | null;
  hex: Hex;
  heading: number;
  status: ShipStatus;
  stats: ShipStats;
  stations: Record<PuzzleId, string | null>;
  aboard: string[];
  hold: { poe: number; goods: Partial<Record<CommodityId, number>> };
  /** Duty report: recent performance per pirate (0..1). */
  duty: Record<string, number>;
  /** Hired NPC deckhands. They hold stations like pirates do (ids start with 'h'). */
  hands: Deckhand[];
}

export interface Deckhand { id: string; name: string; skill: number; avatar: Avatar }

export interface OceanInfo {
  width: number;   // in hexes (q range 0..width-1 after offset)
  height: number;
  islands: Island[];
  /** Rocky shoals (impassable). */
  rocks: Hex[];
}
