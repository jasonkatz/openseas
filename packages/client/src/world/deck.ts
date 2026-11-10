/**
 * The inside of a skiff as a place to walk (ADR 0032, ADR 0035): where the deck is, where the gear
 * stands on it, and where a crew may stand. Layout only. Nothing here is drawn and nothing touches
 * the DOM, so `models.ts` builds the hull and the gear round these numbers and a test can walk the
 * deck without a browser.
 *
 * The ship's own frame: x toward the bow, y up, z to starboard.
 */
import { WalkGrid, type Obstacle, type Spot } from "./walk.js";

export type Station = "cooling" | "engines" | "plating" | "gunnery" | "navigation";
export const STATION_ORDER: readonly Station[] = ["cooling", "engines", "plating", "gunnery", "navigation"];

/** Where a pirate stands to do something aboard, in the ship's own frame, and which way they face. */
export interface DeckPost {
  at: Spot;
  face: number;
}

export interface ShipDeck {
  /** Where a pirate may stand on deck. */
  grid: WalkGrid;
  heightAt(x: number, z: number): number;
  stations: Record<Station, DeckPost>;
  /** Behind the helm, the captain's place. */
  helm: DeckPost;
  /** Where hands with nothing to do stand about, by index. */
  idle: Spot[];
  /** The airlock amidships on the given side (+1 starboard, -1 port), where the boarding tube comes aboard. */
  airlock(side: number): Spot;
}

export const DECK_Y = 0.3;
export const BRIDGE_Y = 0.37;
/** The bridge is forward: its aft edge, and the foot of the steps up to it. */
export const BRIDGE_X = 0.17;
export const STEPS_FOOT_X = 0.1;
export const STEPS_HALF = 0.05;
export const AIRLOCK_X = 0.04;
/** The hull's skin and its inner wall, either side of the centerline. The deck between is walked to `WALK_Z`; the gear stands outside that, against the walls. */
export const HULL_Z = 0.25;
/** Half her beam, for whatever has to meet her side. */
export const HULL_HALF = HULL_Z;
export const WALL_Z = 0.225;
export const WALK_Z = 0.165;
/** The lip of the tub the deck sits in, the top of the side walls, and the roof over them. */
export const SILL_Y = 0.31;
export const WALL_TOP = 0.43;
export const ROOF_Y = 0.52;
/** The hull's ends: the stern bulkhead, and the bulkhead the nose stands on. */
export const STERN_X = -0.47;
export const BOW_X = 0.47;

/** Where the gear stands on the deck. */
export const HELM_X = 0.33;
export const NAV = { x: 0.225, z: 0.125 } as const;
export const CORE_X = -0.335;
export const DRIVE_X = -0.275;
export const VENT = { x: -0.195, z: -0.125 } as const;
export const PATCH = { x: -0.19, z: 0.12 } as const;
export const TURRETS_X = [-0.05, 0.125] as const;
export const STORES = { x: -0.3725, z: -0.1375 } as const;
export const LOCKER = { x: -0.385, z: 0.15 } as const;

/**
 * Where a crew may walk and stand inside a skiff: the grid, the posts at the stations and the
 * airlocks. Layout only, nothing drawn, so `buildShip` puts the hull and the gear round it and a
 * test can walk it. The bridge is forward and two steps up; the main deck runs aft of it to the
 * drive core, with the gear against the walls and the middle clear.
 */
export function skiffDeck(): ShipDeck {
  const PAD = 0.016;
  const heightAt = (x: number, z: number): number => {
    if (x > BRIDGE_X) return BRIDGE_Y;
    if (x > STEPS_FOOT_X && Math.abs(z) < STEPS_HALF) return DECK_Y + ((BRIDGE_Y - DECK_Y) * (x - STEPS_FOOT_X)) / (BRIDGE_X - STEPS_FOOT_X);
    return DECK_Y;
  };
  const grid = new WalkGrid(-0.44, -0.2, 0.44, 0.2, 0.011).fill((x, z) => (x >= -0.41 && x <= BRIDGE_X && Math.abs(z) <= WALK_Z) || (x > BRIDGE_X && x <= 0.4 && Math.abs(z) <= WALK_Z - 0.005));
  const obstacles: Obstacle[] = [
    // The bridge's aft edge, but for the steps, and the handrails beside them.
    { kind: "box", x: BRIDGE_X, z: (WALL_Z + STEPS_HALF) / 2, hw: 0.006, hd: (WALL_Z - STEPS_HALF) / 2, angle: 0 },
    { kind: "box", x: BRIDGE_X, z: -(WALL_Z + STEPS_HALF) / 2, hw: 0.006, hd: (WALL_Z - STEPS_HALF) / 2, angle: 0 },
    { kind: "box", x: (BRIDGE_X + STEPS_FOOT_X) / 2, z: STEPS_HALF, hw: (BRIDGE_X - STEPS_FOOT_X) / 2, hd: 0.004, angle: 0 },
    { kind: "box", x: (BRIDGE_X + STEPS_FOOT_X) / 2, z: -STEPS_HALF, hw: (BRIDGE_X - STEPS_FOOT_X) / 2, hd: 0.004, angle: 0 },
    { kind: "box", x: HELM_X + 0.006, z: 0, hw: 0.01, hd: 0.045, angle: 0 },
    { kind: "box", x: NAV.x, z: NAV.z, hw: 0.04, hd: 0.03, angle: 0 },
    { kind: "circle", x: CORE_X, z: 0, r: 0.04 },
    { kind: "box", x: DRIVE_X, z: 0, hw: 0.012, hd: 0.045, angle: 0 },
    { kind: "box", x: VENT.x + 0.01, z: VENT.z - 0.005, hw: 0.045, hd: 0.035, angle: 0 },
    { kind: "box", x: PATCH.x, z: PATCH.z + 0.01, hw: 0.05, hd: 0.04, angle: 0 },
    { kind: "circle", x: STORES.x, z: STORES.z, r: 0.03 },
    { kind: "box", x: LOCKER.x, z: LOCKER.z, hw: 0.028, hd: 0.022, angle: 0 },
  ];
  for (const side of [-1, 1]) for (const x of TURRETS_X) obstacles.push({ kind: "box", x, z: side * 0.175, hw: 0.03, hd: 0.03, angle: 0 });
  for (const o of obstacles) grid.block(o, PAD);
  return {
    grid,
    heightAt,
    stations: {
      cooling: { at: { x: VENT.x - 0.064, z: VENT.z }, face: 0 },
      engines: { at: { x: DRIVE_X + 0.052, z: 0 }, face: Math.PI },
      plating: { at: { x: PATCH.x, z: PATCH.z - 0.062 }, face: Math.PI / 2 },
      gunnery: { at: { x: TURRETS_X[0], z: 0.12 }, face: Math.PI / 2 },
      navigation: { at: { x: NAV.x, z: NAV.z - 0.058 }, face: Math.PI / 2 },
    },
    helm: { at: { x: HELM_X - 0.06, z: 0 }, face: 0 },
    idle: [
      { x: 0.0, z: 0.02 },
      { x: -0.12, z: 0.07 },
      { x: 0.07, z: -0.07 },
      { x: -0.13, z: -0.05 },
      { x: 0.03, z: 0.1 },
      { x: -0.05, z: -0.09 },
    ],
    airlock: (side) => ({ x: AIRLOCK_X, z: side * (WALK_Z - 0.01) }),
  };
}
