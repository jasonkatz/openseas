import type { Hex } from './hex';
import { hexDistance, hexRange } from './hex';
import { hashSeed, rngFromSeed, rngNext } from './rng';
import type { Building, BuildingKind, CommodityId, Island, OceanInfo } from './world';
import { COMMODITIES } from './world';

export const OCEAN_W = 44;
export const OCEAN_H = 30;

interface IslandSeed {
  id: string; name: string; hex: Hex; biome: Island['biome']; tagline: string;
  /** Market multipliers: cheap here / dear here. */
  cheap: CommodityId[]; dear: CommodityId[];
}

const SEEDS: IslandSeed[] = [
  { id: 'saltmarrow', name: 'Saltmarrow', hex: { q: 8, r: 8 }, biome: 'tropical', tagline: 'Where every voyage begins', cheap: ['rum', 'sugar'], dear: ['iron'] },
  { id: 'gullrock', name: 'Gullrock', hex: { q: 18, r: 4 }, biome: 'rocky', tagline: 'Wind-bitten and proud', cheap: ['iron', 'hemp'], dear: ['sugar', 'rum'] },
  { id: 'emberreach', name: 'Ember Reach', hex: { q: 30, r: 6 }, biome: 'volcanic', tagline: 'Forge of the eastern seas', cheap: ['iron'], dear: ['wood', 'cloth'] },
  { id: 'lantern', name: 'Lantern Atoll', hex: { q: 24, r: 14 }, biome: 'atoll', tagline: 'Lights on the water', cheap: ['cloth'], dear: ['hemp'] },
  { id: 'brineholm', name: 'Brineholm', hex: { q: 6, r: 20 }, biome: 'misty', tagline: 'Fog, ghosts, and good ale', cheap: ['wood', 'hemp'], dear: ['sugar'] },
  { id: 'verdigris', name: 'Verdigris', hex: { q: 16, r: 24 }, biome: 'jungle', tagline: 'Green to the waterline', cheap: ['sugar', 'wood'], dear: ['iron', 'cloth'] },
  { id: 'kestrel', name: 'Kestrel Point', hex: { q: 34, r: 20 }, biome: 'tropical', tagline: 'A haven for honest thieves', cheap: ['rum', 'cloth'], dear: ['hemp', 'wood'] },
  { id: 'wyrmtooth', name: 'Wyrmtooth', hex: { q: 38, r: 10 }, biome: 'rocky', tagline: 'Few go. Fewer return.', cheap: ['hemp'], dear: ['rum', 'sugar', 'iron'] },
];

const BUILDING_NAMES: Record<Island['biome'], Partial<Record<BuildingKind, string>>> = {
  tropical: { tavern: 'The Drunken Gull', shipwright: 'Marrow & Sons Shipwright', dock: 'Harbour Office', market: 'Spice Market', palace: 'Governor\'s House', bank: 'Counting House' },
  rocky: { tavern: 'The Broken Oar', shipwright: 'Gullrock Yards', dock: 'Harbourmaster', market: 'Ironmonger\'s Row', palace: 'Watch Tower', bank: 'Strongroom' },
  volcanic: { tavern: 'The Cinder Cup', shipwright: 'Basalt Slips', dock: 'Smoke Quay', market: 'Forge Market', palace: 'Obsidian Hall', bank: 'Vault of Ash' },
  atoll: { tavern: 'The Lantern Room', shipwright: 'Reef Wrights', dock: 'Lagoon Jetty', market: 'Pearl Bazaar', palace: 'Lighthouse', bank: 'Coral Bank' },
  misty: { tavern: 'The Lost Bell', shipwright: 'Fogbound Yards', dock: 'Grey Pier', market: 'Mist Market', palace: 'Old Keep', bank: 'The Ledger' },
  jungle: { tavern: 'The Parrot\'s Perch', shipwright: 'Canopy Shipworks', dock: 'River Mouth', market: 'Green Market', palace: 'Temple Steps', bank: 'Moss Vault' },
};

/** Deterministic island scene layout. World px, 1600x1000. */
function layoutBuildings(seed: IslandSeed): Building[] {
  const names = BUILDING_NAMES[seed.biome];
  const mk = (kind: BuildingKind, x: number, y: number, w: number, h: number): Building => ({
    id: `${seed.id}:${kind}`, kind, name: names[kind] ?? kind, x, y, w, h, door: { x: x + w / 2, y: y + h + 8 },
  });
  // Dock at the bottom (sea side); civic buildings up the hill.
  return [
    mk('dock', 700, 780, 220, 90),
    mk('tavern', 260, 420, 260, 170),
    mk('shipwright', 1080, 520, 300, 170),
    mk('market', 640, 330, 240, 150),
    mk('bank', 1000, 240, 200, 130),
    mk('palace', 380, 120, 320, 170),
  ];
}

function makeMarket(seed: IslandSeed): Record<CommodityId, number> {
  const m = {} as Record<CommodityId, number>;
  for (const c of COMMODITIES) {
    let mult = 1;
    if (seed.cheap.includes(c.id)) mult = 0.7;
    if (seed.dear.includes(c.id)) mult = 1.45;
    m[c.id] = Math.round(c.base * mult);
  }
  return m;
}

export const ISLANDS: Island[] = SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  hex: s.hex,
  biome: s.biome,
  tagline: s.tagline,
  width: 1600,
  height: 1000,
  spawn: { x: 800, y: 740 },
  buildings: layoutBuildings(s),
  seed: hashSeed(s.id),
  market: makeMarket(s),
}));

export const ISLAND_BY_ID: Record<string, Island> = Object.fromEntries(ISLANDS.map((i) => [i.id, i]));
export const HOME_ISLAND_ID = 'saltmarrow';

/** Deterministic rocks/shoals scattered across the ocean, never adjacent to islands. */
function makeRocks(): Hex[] {
  let rng = rngFromSeed(hashSeed('tidebound-rocks'));
  const rocks: Hex[] = [];
  const nearIsland = (h: Hex) => ISLANDS.some((i) => hexDistance(i.hex, h) <= 2);
  for (let r = 0; r < OCEAN_H; r++) {
    for (let q = 0; q < OCEAN_W; q++) {
      let v: number;
      [rng, v] = rngNext(rng);
      const h = { q, r };
      if (v < 0.035 && !nearIsland(h)) rocks.push(h);
    }
  }
  return rocks;
}

export const OCEAN: OceanInfo = { width: OCEAN_W, height: OCEAN_H, islands: ISLANDS, rocks: makeRocks() };

const ROCK_SET = new Set(OCEAN.rocks.map((h) => `${h.q},${h.r}`));
const ISLAND_SET = new Set(ISLANDS.map((i) => `${i.hex.q},${i.hex.r}`));

export function isOceanBlocked(h: Hex): boolean {
  if (h.q < 0 || h.r < 0 || h.q >= OCEAN_W || h.r >= OCEAN_H) return true;
  const k = `${h.q},${h.r}`;
  return ROCK_SET.has(k) || ISLAND_SET.has(k);
}

export function islandAt(h: Hex): Island | undefined {
  return ISLANDS.find((i) => i.hex.q === h.q && i.hex.r === h.r);
}

/** Hexes of water adjacent to an island (where ships anchor). */
export function islandAnchorage(i: Island): Hex[] {
  return hexRange(i.hex, 1).filter((h) => !(h.q === i.hex.q && h.r === i.hex.r) && !isOceanBlocked(h));
}
