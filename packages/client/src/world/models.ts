/**
 * The pieces of the world besides the outposts (outpost.ts): ships, drifting dust, drones and nav
 * buoys as chunky low-poly groups built from primitives. No art files; everything is geometry and
 * flat color, so it stays placeholder-art honest (DESIGN.md 3.10) while reading as a toy diorama. A
 * ship's static plates are merged into one mesh (batch.ts); the parts that move or change stay
 * their own.
 */
import * as THREE from "three";
import type { CrewFlagWire } from "@openseas/protocol";
import { drawEmblem, drawFlag, flagColor, flagKey } from "../crew/flag.js";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";
import { Batch, unseen } from "./batch.js";
import { WalkGrid, type Obstacle, type Spot } from "./walk.js";

export type { Building } from "./outpost.js";

export const PALETTE = {
  hull: 0xd6cfbf,
  hullDark: 0x9d968a,
  keel: 0x4a4f5a,
  seam: 0x7d776c,
  stripe: 0xc8663a,
  patch: 0x6f9aa6,
  patchWarm: 0xd9a24a,
  deck: 0xb9b4a8,
  deckSeam: 0x8f8a80,
  bridge: 0xa7a296,
  fin: 0xe4dccb,
  tin: 0xc3ccd4,
  tinDark: 0x8a94a0,
  steel: 0x5d6673,
  rail: 0x8f98a4,
  iron: 0x2e3238,
  rust: 0xc8663a,
  blue: 0x3e6f9a,
  panel: 0x2c5d8a,
  brass: 0xd4a548,
  parchment: 0xefe3c6,
  lamp: 0xffd36b,
  lampOff: 0x6b5a2a,
  window: 0xffe9a8,
  glow: 0x7fe3ff,
  heat: 0xff8a3d,
  portLamp: 0xff5a4a,
  starboardLamp: 0x6fe08a,
  canopy: 0xbfefff,
} as const;

const mat = (color: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color, ...extra });

const shaded = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** A tiny deterministic random source for decoration. */
class Dice {
  private s: PrngState;
  constructor(seed: string) {
    this.s = seedFromString(seed);
  }
  int(n: number): number {
    const r = nextInt(this.s, n);
    this.s = r.state;
    return r.value;
  }
  /** Uniform in [lo, hi) with a thousand steps. */
  range(lo: number, hi: number): number {
    return lo + ((hi - lo) * this.int(1000)) / 1000;
  }
}

export type Station = "cooling" | "engines" | "plating" | "gunnery" | "navigation";
export const STATION_ORDER: readonly Station[] = ["cooling", "engines", "plating", "gunnery", "navigation"];

/** A skiff's size in the world: big enough that a crew of pirates can walk its deck. */
export const SHIP_SCALE = 1.4;
/** How far her deck rides below where the model's own origin would put it, so it meets the dock's boarding tube. */
export const SHIP_SINK = 0.055;

/** Where a pirate stands to do something aboard, in the ship's own frame, and which way they face. */
export interface DeckPost {
  at: Spot;
  face: number;
}

export interface ShipDeck {
  /** Where a pirate may stand on deck, in the ship's own frame (x toward the bow, z to starboard). */
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

export interface ShipModel {
  group: THREE.Group;
  /** The hull and everything on it; the drift is applied here so the group's frame stays steady for labels. */
  body: THREE.Group;
  /** A generous box round the whole ship, for picking her out on the chart. */
  hit: THREE.Mesh;
  /** Just the hull and deck, for taps up close where the ground around her must stay walkable. */
  hullHit: THREE.Mesh;
  /** The deck's top, for taps to walk. */
  deckHit: THREE.Mesh;
  /** Invisible boxes over each station's gear and the helm, for taps on the thing itself. */
  stationHits: THREE.Mesh[];
  /** The tail fin, which carries the crew's emblem. */
  fin: THREE.Mesh;
  /** What stands over the deck and could hide a station: the fin. On deck it goes to glass. */
  glass: THREE.Mesh[];
  /** The clear canopy over the deck and its ribs. Drawn only from outside: on deck it is not there. */
  canopy: THREE.Group;
  flag: THREE.Mesh;
  /** The flag's own color when the ship flies no crew's colors. */
  plainFlag: number;
  /** The colors the ship is dressed in now, by flag key, or "" for none. */
  dressed: string;
  /** The engines' plumes, lit in flight. */
  engineGlow: THREE.Group;
  marker: THREE.Mesh;
  /** Where each station's label hangs, in the body's frame. */
  anchors: Record<Station, THREE.Vector3>;
  /** The helm, in the body's frame. */
  helm: THREE.Vector3;
  deck: ShipDeck;
}

const DECK_Y = 0.3;
const BRIDGE_Y = 0.37;
/** The bridge's forward edge and the foot of its steps. */
const BRIDGE_X = -0.17;
const STEPS_FOOT_X = -0.1;
const STEPS_HALF = 0.05;
const AIRLOCK_X = 0.04;
/** The rails stand this far either side of the keel, and the deck between them is walked to `WALK_Z`. */
const RAIL_Z = 0.225;
const WALK_Z = 0.165;
/** The antenna's tip: short enough that a docked skiff does not tower over the town. */
const MAST_TOP = 0.95;
/** The tail fin, a swept blade standing over the bridge on a spine: its corners in the ship's side view. */
const FIN = [
  [-0.15, 0.5],
  [-0.48, 0.5],
  [-0.54, 0.92],
  [-0.38, 0.92],
] as const;

/**
 * A skiff with its stations laid out on a deck a crew can walk: a raised bridge aft with the helm and the nav console, steps down to the
 * main deck, the antenna mast and the drive console amidships, the heat sinks to port, a turret
 * pair each side, the patch bay forward, and an airlock in each rail. A clear canopy closes it all
 * in, a tail fin stands over the bridge, and the flag's color says whose she is.
 */
export function buildShip(kind: "yours" | "aboard" | "other", shadows = true): ShipModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(SHIP_SCALE);
  body.position.y = -SHIP_SINK;
  group.add(body);
  const b = new Batch();
  const P = PALETTE;

  // ---- the hull: a slab of painted plates over a darker belly and a keel, patched where she has been holed
  b.add(new THREE.BoxGeometry(0.9, 0.2, 0.42), P.hull, { p: [0, 0.14, 0] });
  b.add(new THREE.BoxGeometry(0.76, 0.09, 0.32), P.hullDark, { p: [-0.02, 0.0, 0] });
  b.add(new THREE.BoxGeometry(0.52, 0.05, 0.14), P.keel, { p: [-0.05, -0.065, 0] });
  for (let i = 0; i < 2; i++) b.add(new THREE.BoxGeometry(0.905, 0.005, 0.424), P.seam, { p: [0, 0.085 + i * 0.07, 0] });
  for (const x of [-0.3, -0.1, 0.1, 0.3]) b.add(new THREE.BoxGeometry(0.005, 0.2, 0.424), P.seam, { p: [x, 0.14, 0] });
  b.add(new THREE.BoxGeometry(0.92, 0.035, 0.43), P.stripe, { p: [0, 0.205, 0] });
  for (const [x, y, side, w, h, c, tilt] of [
    [0.31, 0.12, 1, 0.11, 0.07, P.patch, 0.08],
    [-0.21, 0.1, 1, 0.08, 0.06, P.patchWarm, -0.12],
    [0.2, 0.11, -1, 0.09, 0.07, P.patchWarm, 0.1],
    [-0.33, 0.13, -1, 0.1, 0.06, P.patch, -0.06],
  ] as const) {
    b.add(new THREE.BoxGeometry(w, h, 0.006), c, { p: [x, y, side * 0.212], r: [0, 0, tilt] });
    // A rivet at each corner of the patch.
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) b.add(new THREE.BoxGeometry(0.007, 0.007, 0.008), P.iron, { p: [x + dx * (w / 2 - 0.008), y + dy * (h / 2 - 0.008), side * 0.213], r: [0, 0, tilt] });
  }
  // The nose: a wedge to a painted tip, with a probe out ahead of it.
  b.add(new THREE.ConeGeometry(0.18, 0.4, 4), P.hull, { p: [0.64, 0.12, 0], r: [Math.PI / 4, 0, -Math.PI / 2], s: [1, 1, 0.77] });
  b.add(new THREE.ConeGeometry(0.075, 0.165, 4), P.stripe, { p: [0.76, 0.12, 0], r: [Math.PI / 4, 0, -Math.PI / 2], s: [1, 1, 0.77] });
  b.add(new THREE.CylinderGeometry(0.005, 0.007, 0.2, 5), P.iron, { p: [0.93, 0.12, 0], r: [0, 0, -Math.PI / 2] });
  b.addGlow(new THREE.SphereGeometry(0.012, 6, 5), P.glow, { p: [1.03, 0.12, 0] });
  // The engines: a nozzle each side of the stern, dark until she is under way.
  const nozzles = [-0.11, 0.11];
  for (const z of nozzles) {
    b.add(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 8), P.steel, { p: [-0.47, 0.1, z], r: [0, 0, Math.PI / 2] });
    b.add(new THREE.CylinderGeometry(0.07, 0.05, 0.07, 8), P.iron, { p: [-0.53, 0.1, z], r: [0, 0, Math.PI / 2] });
    b.addGlow(new THREE.CylinderGeometry(0.04, 0.04, 0.004, 8), 0x6a3a22, { p: [-0.566, 0.1, z], r: [0, 0, Math.PI / 2] });
  }
  b.add(new THREE.BoxGeometry(0.92, 0.05, 0.46), P.tinDark, { p: [0, 0.26, 0] });
  b.add(new THREE.BoxGeometry(0.84, 0.03, 0.36), P.deck, { p: [0, 0.285, 0] });
  // Deck plates: a seam across every so often and one down the middle.
  for (let i = 0; i < 6; i++) b.add(new THREE.BoxGeometry(0.004, 0.004, 0.36), P.deckSeam, { p: [-0.05 + i * 0.09, 0.302, 0] });
  b.add(new THREE.BoxGeometry(0.84, 0.004, 0.004), P.deckSeam, { p: [0, 0.302, 0] });
  // Turret mounts on the hull sides.
  for (const side of [-1, 1]) for (const x of [-0.05, 0.17]) b.add(new THREE.BoxGeometry(0.06, 0.05, 0.01), 0x1a1d22, { p: [x, 0.15, side * 0.213] });

  // ---- the bridge: raised aft, a hatch either side of the steps, windows in the stern
  const bridgeLen = BRIDGE_X + 0.42;
  b.add(new THREE.BoxGeometry(bridgeLen, BRIDGE_Y - DECK_Y, 0.36), P.hullDark, { p: [BRIDGE_X - bridgeLen / 2, (DECK_Y + BRIDGE_Y) / 2, 0] });
  b.add(new THREE.BoxGeometry(bridgeLen, 0.006, 0.36), P.bridge, { p: [BRIDGE_X - bridgeLen / 2, BRIDGE_Y, 0] });
  for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.003, 0.003, 0.36), P.deckSeam, { p: [BRIDGE_X - 0.04 - i * 0.08, BRIDGE_Y + 0.004, 0] });
  for (const z of [-0.12, 0.12]) {
    b.add(new THREE.BoxGeometry(0.006, 0.05, 0.036), 0x1a1d22, { p: [BRIDGE_X + 0.003, DECK_Y + 0.026, z] });
    b.addGlow(new THREE.BoxGeometry(0.004, 0.006, 0.012), P.glow, { p: [BRIDGE_X + 0.007, DECK_Y + 0.042, z] });
  }
  for (const z of [-0.1, 0.0, 0.1]) b.addGlow(new THREE.BoxGeometry(0.008, 0.035, 0.04), P.window, { p: [-0.452, 0.2, z] });
  // Three steps up, with a handrail each side.
  const rise = (BRIDGE_Y - DECK_Y) / 3;
  const run = (STEPS_FOOT_X - BRIDGE_X) / 2;
  for (let i = 0; i < 2; i++) {
    const top = DECK_Y + rise * (i + 1);
    const x0 = STEPS_FOOT_X - run * (i + 1);
    b.add(new THREE.BoxGeometry(run, top - DECK_Y, STEPS_HALF * 2), i ? P.tinDark : P.tin, { p: [x0 + run / 2, (top + DECK_Y) / 2, 0] });
  }
  for (const side of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.008, 0.06, 0.008), P.rail, { p: [STEPS_FOOT_X - 0.004, DECK_Y + 0.03, side * STEPS_HALF] });
    b.add(new THREE.BoxGeometry(0.085, 0.007, 0.007), P.rail, { p: [(STEPS_FOOT_X + BRIDGE_X) / 2, DECK_Y + 0.085, side * STEPS_HALF], r: [0, 0, -0.75] });
  }
  // The bridge's rail: across its front either side of the steps, and along its sides.
  for (const side of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.008, 0.012, RAIL_Z - 0.055), P.rail, { p: [BRIDGE_X, BRIDGE_Y + 0.055, side * (RAIL_Z + 0.055) / 2] });
    for (const z of [0.055, 0.14, RAIL_Z - 0.01]) b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.055, 4), P.rail, { p: [BRIDGE_X, BRIDGE_Y + 0.027, side * z] });
    for (const x of [-0.41, -0.33, -0.25, BRIDGE_X]) b.add(new THREE.CylinderGeometry(0.007, 0.007, 0.06, 4), P.rail, { p: [x, BRIDGE_Y + 0.03, side * RAIL_Z] });
    b.add(new THREE.BoxGeometry(bridgeLen, 0.012, 0.012), P.rail, { p: [BRIDGE_X - bridgeLen / 2, BRIDGE_Y + 0.06, side * RAIL_Z] });
    // The main deck's rail, with the airlock standing in it amidships: a frame to step through, a lamp on its lintel.
    for (const x of [BRIDGE_X + 0.02, -0.08, 0.16, 0.27, 0.38]) b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 4), P.rail, { p: [x, 0.32, side * RAIL_Z] });
    for (const x of [AIRLOCK_X - 0.035, AIRLOCK_X + 0.035]) b.add(new THREE.BoxGeometry(0.01, 0.1, 0.014), P.rail, { p: [x, 0.335, side * RAIL_Z] });
    b.add(new THREE.BoxGeometry(0.08, 0.012, 0.016), P.stripe, { p: [AIRLOCK_X, 0.39, side * RAIL_Z] });
    b.addGlow(new THREE.BoxGeometry(0.026, 0.007, 0.01), P.lamp, { p: [AIRLOCK_X, 0.4, side * RAIL_Z] });
    const aftLen = AIRLOCK_X - 0.035 - (BRIDGE_X + 0.02);
    b.add(new THREE.BoxGeometry(aftLen, 0.012, 0.012), P.rail, { p: [BRIDGE_X + 0.02 + aftLen / 2, 0.355, side * RAIL_Z] });
    const foreLen = 0.4 - (AIRLOCK_X + 0.035);
    b.add(new THREE.BoxGeometry(foreLen, 0.012, 0.012), P.rail, { p: [AIRLOCK_X + 0.035 + foreLen / 2, 0.355, side * RAIL_Z] });
    // Running lights at the stern: red to port, green to starboard.
    b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 4), P.iron, { p: [-0.41, BRIDGE_Y + 0.04, side * 0.16] });
    b.addGlow(new THREE.SphereGeometry(0.011, 9, 7), side < 0 ? P.portLamp : P.starboardLamp, { p: [-0.41, BRIDGE_Y + 0.088, side * 0.16] });
  }

  // ---- the helm and the nav console on the bridge
  const helmAt = new THREE.Vector3(-0.24, BRIDGE_Y + 0.085, 0);
  // A pedestal with a lit panel facing the captain, and a yoke to steer by.
  b.add(new THREE.BoxGeometry(0.02, 0.07, 0.07), P.steel, { p: [helmAt.x + 0.014, BRIDGE_Y + 0.035, 0] });
  b.add(new THREE.BoxGeometry(0.026, 0.02, 0.086), P.iron, { p: [helmAt.x + 0.012, BRIDGE_Y + 0.078, 0], r: [0, 0, 0.5] });
  b.addGlow(new THREE.BoxGeometry(0.004, 0.02, 0.07), P.glow, { p: [helmAt.x + 0.0, BRIDGE_Y + 0.081, 0], r: [0, 0, 0.5] });
  b.add(new THREE.TorusGeometry(0.036, 0.006, 5, 10, Math.PI), P.iron, { p: [helmAt.x - 0.012, helmAt.y - 0.012, 0], r: [0, Math.PI / 2, 0] });
  for (const z of [-0.036, 0.036]) b.add(new THREE.SphereGeometry(0.009, 6, 5), P.stripe, { p: [helmAt.x - 0.012, helmAt.y - 0.012, z] });
  const navAt = { x: -0.37, z: 0.125 };
  // A console with a star chart glowing on its top, and a little globe of the system standing over it.
  b.add(new THREE.BoxGeometry(0.075, 0.05, 0.055), P.steel, { p: [navAt.x, BRIDGE_Y + 0.025, navAt.z] });
  b.addGlow(new THREE.BoxGeometry(0.066, 0.004, 0.046), 0x2f86a8, { p: [navAt.x, BRIDGE_Y + 0.052, navAt.z] });
  for (const [dx, dz] of [
    [-0.02, -0.012],
    [0.012, 0.01],
    [0.024, -0.014],
    [-0.006, 0.016],
  ] as const)
    b.addGlow(new THREE.BoxGeometry(0.005, 0.002, 0.005), P.window, { p: [navAt.x + dx, BRIDGE_Y + 0.055, navAt.z + dz] });
  b.add(new THREE.CylinderGeometry(0.002, 0.002, 0.03, 4), P.iron, { p: [navAt.x + 0.026, BRIDGE_Y + 0.068, navAt.z + 0.016] });
  b.addGlow(new THREE.SphereGeometry(0.01, 7, 5), P.glow, { p: [navAt.x + 0.026, BRIDGE_Y + 0.09, navAt.z + 0.016] });

  // ---- the main deck: the drive console, the heat sinks, the turrets, the patch bay, a hatch, stores
  const mastX = 0.1;
  // The drive console aft of the mast: a bank with a sloped face of lit keys and two throttle levers.
  b.add(new THREE.BoxGeometry(0.016, 0.05, 0.09), P.steel, { p: [mastX - 0.04, DECK_Y + 0.025, 0] });
  b.add(new THREE.BoxGeometry(0.024, 0.012, 0.09), P.iron, { p: [mastX - 0.043, DECK_Y + 0.054, 0], r: [0, 0, 0.45] });
  for (let i = 0; i < 4; i++) b.addGlow(new THREE.BoxGeometry(0.006, 0.004, 0.01), i % 2 ? P.glow : P.lamp, { p: [mastX - 0.047, DECK_Y + 0.061, -0.03 + i * 0.02], r: [0, 0, 0.45] });
  for (const z of [-0.02, 0.015]) {
    b.add(new THREE.CylinderGeometry(0.003, 0.003, 0.034, 4), P.tin, { p: [mastX - 0.036, DECK_Y + 0.072, z], r: [0, 0, -0.3] });
    b.add(new THREE.SphereGeometry(0.006, 6, 4), P.stripe, { p: [mastX - 0.031, DECK_Y + 0.089, z] });
  }
  const ventAt = { x: 0.25, z: -0.125 };
  // The heat sinks: a block with a row of fins standing out of it, a hot core between them, the vent lever and a coolant line.
  b.add(new THREE.BoxGeometry(0.06, 0.05, 0.06), P.iron, { p: [ventAt.x, DECK_Y + 0.025, ventAt.z] });
  for (let i = 0; i < 5; i++) b.add(new THREE.BoxGeometry(0.05, 0.05, 0.005), P.tinDark, { p: [ventAt.x, DECK_Y + 0.075, ventAt.z - 0.024 + i * 0.012] });
  b.addGlow(new THREE.BoxGeometry(0.04, 0.006, 0.05), P.heat, { p: [ventAt.x, DECK_Y + 0.053, ventAt.z] });
  b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 5), P.tin, { p: [ventAt.x - 0.03, DECK_Y + 0.105, ventAt.z], r: [0, 0, Math.PI / 2 - 0.25] });
  b.add(new THREE.SphereGeometry(0.009, 6, 4), P.stripe, { p: [ventAt.x - 0.092, DECK_Y + 0.089, ventAt.z] });
  b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 5), P.steel, { p: [ventAt.x + 0.03, DECK_Y + 0.03, ventAt.z + 0.035], r: [Math.PI / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 7), P.blue, { p: [ventAt.x + 0.05, DECK_Y + 0.02, ventAt.z - 0.035] });
  const turretsAt = [-0.05, 0.17];
  for (const side of [-1, 1]) {
    for (const x of turretsAt) {
      // A turret against the rail, so the deck between them stays clear: a ring, a dome on it, twin barrels out over the side.
      b.add(new THREE.CylinderGeometry(0.027, 0.03, 0.02, 8), P.steel, { p: [x, DECK_Y + 0.01, side * 0.168] });
      b.add(new THREE.SphereGeometry(0.025, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), P.tinDark, { p: [x, DECK_Y + 0.02, side * 0.168] });
      for (const dx of [-0.009, 0.009]) b.add(new THREE.CylinderGeometry(0.006, 0.007, 0.1, 6), P.iron, { p: [x + dx, DECK_Y + 0.035, side * 0.215], r: [Math.PI / 2, 0, 0] });
      b.addGlow(new THREE.BoxGeometry(0.008, 0.005, 0.005), P.glow, { p: [x, DECK_Y + 0.046, side * 0.165] });
    }
  }
  // Slugs in a rack by the starboard aft turret.
  for (let i = 0; i < 3; i++) b.add(new THREE.CylinderGeometry(0.007, 0.007, 0.018, 6), P.brass, { p: [-0.11 + i * 0.019, DECK_Y + 0.009, 0.185] });
  const patchAt = { x: 0.37, z: 0.12 };
  // The patch bay: a bench with a hull plate on it and a welder beside the plate, spare plates stacked at its foot.
  b.add(new THREE.BoxGeometry(0.1, 0.045, 0.05), P.steel, { p: [patchAt.x, DECK_Y + 0.0225, patchAt.z] });
  b.add(new THREE.BoxGeometry(0.12, 0.008, 0.03), P.tin, { p: [patchAt.x, DECK_Y + 0.05, patchAt.z], r: [0, 0.25, 0] });
  b.add(new THREE.BoxGeometry(0.026, 0.016, 0.016), P.stripe, { p: [patchAt.x + 0.03, DECK_Y + 0.056, patchAt.z - 0.012] });
  b.add(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 4), P.iron, { p: [patchAt.x + 0.012, DECK_Y + 0.056, patchAt.z - 0.012], r: [0, 0, Math.PI / 2] });
  b.addGlow(new THREE.SphereGeometry(0.004, 5, 4), P.glow, { p: [patchAt.x + 0.001, DECK_Y + 0.056, patchAt.z - 0.012] });
  for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.1, 0.008, 0.016), i % 2 ? P.patch : P.tinDark, { p: [patchAt.x - 0.005, DECK_Y + 0.004 + i * 0.008, patchAt.z + 0.04] });
  // The hatch.
  b.add(new THREE.BoxGeometry(0.08, 0.006, 0.07), P.steel, { p: [0.24, DECK_Y + 0.003, 0.045] });
  for (let i = 0; i < 4; i++) b.add(new THREE.BoxGeometry(0.004, 0.003, 0.066), 0x1a1d22, { p: [0.21 + i * 0.02, DECK_Y + 0.0065, 0.045] });
  // Stores.
  for (const [x, z, c] of [
    [0.335, -0.16, P.stripe],
    [0.36, -0.135, P.patch],
  ] as const) {
    b.add(new THREE.CylinderGeometry(0.019, 0.019, 0.045, 8), c, { p: [x, DECK_Y + 0.0225, z] });
    b.add(new THREE.CylinderGeometry(0.0195, 0.0195, 0.004, 8), P.iron, { p: [x, DECK_Y + 0.035, z] });
  }

  // ---- the antenna mast: a pole with two yards of aerial, a dish and a light at its tip
  b.add(new THREE.CylinderGeometry(0.01, 0.02, MAST_TOP - 0.28, 6), P.tinDark, { p: [mastX, (MAST_TOP + 0.28) / 2, 0] });
  b.add(new THREE.CylinderGeometry(0.024, 0.028, 0.03, 6), P.steel, { p: [mastX, DECK_Y + 0.015, 0] });
  for (const [y, half] of [
    [MAST_TOP - 0.1, 0.11],
    [MAST_TOP - 0.2, 0.075],
  ] as const) {
    b.add(new THREE.BoxGeometry(0.006, 0.006, half * 2), P.steel, { p: [mastX, y, 0] });
    for (const side of [-1, 1]) b.add(new THREE.BoxGeometry(0.004, 0.03, 0.004), P.steel, { p: [mastX, y, side * half] });
  }
  b.add(new THREE.SphereGeometry(0.05, 9, 4, 0, Math.PI * 2, 0, 0.9), P.tin, { p: [mastX + 0.035, MAST_TOP - 0.31, 0], r: [0, 0, -Math.PI / 2 - 0.5] });
  b.addGlow(new THREE.SphereGeometry(0.012, 6, 5), P.portLamp, { p: [mastX, MAST_TOP + 0.01, 0] });
  // ---- the fin's spine over the bridge, on a post at the stern and a frame over the head of the steps
  const spineY = FIN[0][1];
  b.add(new THREE.BoxGeometry(FIN[0][0] - FIN[1][0] + 0.02, 0.024, 0.026), P.steel, { p: [(FIN[0][0] + FIN[1][0]) / 2, spineY - 0.012, 0] });
  b.add(new THREE.BoxGeometry(0.026, spineY - 0.3, 0.026), P.steel, { p: [-0.462, (spineY + 0.3) / 2, 0] });
  for (const side of [-1, 1]) {
    const lean = Math.atan2(0.055, spineY - BRIDGE_Y);
    b.add(new THREE.BoxGeometry(0.012, Math.hypot(0.055, spineY - BRIDGE_Y), 0.012), P.steel, { p: [BRIDGE_X, (spineY + BRIDGE_Y) / 2, side * 0.0275], r: [side * lean, 0, 0] });
  }
  const solid = b.build(shadows);
  body.add(solid);

  // Stays from the mast down to the rails.
  const stayMat = new THREE.LineBasicMaterial({ color: 0x4a515c });
  const stays: THREE.Vector3[] = [];
  for (const side of [-1, 1]) for (const x of [-0.06, 0.06]) stays.push(new THREE.Vector3(mastX, MAST_TOP - 0.1, 0), new THREE.Vector3(mastX + x, 0.32, side * RAIL_Z));
  body.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stays), stayMat));

  // ---- the tail fin: a swept blade on the spine, painted with the crew's emblem when she flies their colors
  const finShape = new THREE.Shape();
  FIN.forEach(([x, y], i) => (i ? finShape.lineTo(x, y) : finShape.moveTo(x, y)));
  finShape.closePath();
  const finGeo = new THREE.ShapeGeometry(finShape);
  {
    // The emblem's texture is laid over the fin's own box, whatever its sweep.
    const xs = FIN.map((c) => c[0]);
    const ys = FIN.map((c) => c[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const uv = finGeo.attributes.uv as THREE.BufferAttribute;
    const at = finGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (at.getX(i) - x0) / (Math.max(...xs) - x0), (at.getY(i) - y0) / (Math.max(...ys) - y0));
  }
  const fin = shaded(finGeo, mat(P.fin, { side: THREE.DoubleSide, transparent: true }));
  body.add(fin);
  const glass: THREE.Mesh[] = [fin];
  // A stripe along its leading edge, the hull's own.
  const edge = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(FIN[3][0] - FIN[0][0], FIN[3][1] - FIN[0][1]), 0.022, 0.008), new THREE.MeshLambertMaterial({ color: P.stripe, transparent: true }));
  edge.position.set((FIN[0][0] + FIN[3][0]) / 2, (FIN[0][1] + FIN[3][1]) / 2, 0);
  edge.rotation.z = Math.atan2(FIN[3][1] - FIN[0][1], FIN[3][0] - FIN[0][0]);
  body.add(edge);
  glass.push(edge);

  // ---- the canopy: a clear shell over the whole deck, and the ribs that hold it
  const canopy = new THREE.Group();
  const SHELL = { x: 0.47, y: 0.36, z: 0.252, at: -0.01, base: 0.335 };
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: P.canopy, transparent: true, opacity: 0.2, depthWrite: false }),
  );
  shell.scale.set(SHELL.x, SHELL.y, SHELL.z);
  shell.position.set(SHELL.at, SHELL.base, 0);
  shell.renderOrder = 2;
  canopy.add(shell);
  const ribMat = new THREE.MeshLambertMaterial({ color: P.tin });
  for (const x of [-0.3, -0.1, 0.1, 0.3]) {
    // Each rib is the shell's own cross-section where it stands.
    const k = Math.sqrt(1 - ((x - SHELL.at) / SHELL.x) ** 2);
    const rib = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012 / k, 4, 14, Math.PI), ribMat);
    rib.rotation.y = Math.PI / 2;
    rib.scale.set(SHELL.z * k, SHELL.y * k, 0.3);
    rib.position.set(x, SHELL.base, 0);
    canopy.add(rib);
  }
  const sill = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 4, 28), ribMat);
  sill.rotation.x = Math.PI / 2;
  sill.scale.set(SHELL.x, SHELL.z, 0.4);
  sill.position.set(SHELL.at, SHELL.base, 0);
  canopy.add(sill);
  body.add(canopy);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09, 3, 1),
    new THREE.MeshBasicMaterial({ color: kind === "other" ? PALETTE.parchment : PALETTE.brass, side: THREE.DoubleSide }),
  );
  flag.position.set(mastX - 0.09, MAST_TOP + 0.08, 0);
  body.add(flag);

  // ---- the engines' glow: a lit throat and a plume from each nozzle, shown under way
  // The group sits at the nozzles' mouths, so stretching it along x lengthens the plumes from there.
  const engineGlow = new THREE.Group();
  engineGlow.position.set(-0.568, 0.1, 0);
  for (const z of nozzles) {
    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.046, 10), new THREE.MeshBasicMaterial({ color: 0xd8f6ff }));
    throat.rotation.y = -Math.PI / 2;
    throat.position.set(-0.001, 0, z);
    engineGlow.add(throat);
    // Two blades of light crossed, so the plume shows from above and from the side.
    for (const turn of [0, Math.PI / 2]) {
      const plume = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.13),
        new THREE.MeshBasicMaterial({ map: plumeTexture(), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      plume.rotation.x = turn;
      plume.position.set(-0.31, 0, z);
      engineGlow.add(plume);
    }
  }
  engineGlow.visible = false;
  body.add(engineGlow);

  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), new THREE.MeshBasicMaterial({ color: PALETTE.brass }));
  marker.rotation.x = Math.PI;
  marker.position.set(mastX, MAST_TOP + 0.38, 0);
  marker.visible = kind !== "other";
  body.add(marker);

  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.3, 0.6), unseen());
  hit.position.y = 0.7;
  body.add(hit);
  const hullHit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.42, 0.46), unseen());
  hullHit.position.set(0.02, 0.21, 0);
  body.add(hullHit);
  const deckHit = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.02, 0.38), unseen());
  deckHit.position.y = DECK_Y;
  body.add(deckHit);
  const stationHits: THREE.Mesh[] = [];
  const stationHit = (key: Station | "helm", x: number, y: number, z: number, w: number, h: number, d: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), unseen());
    m.position.set(x, y, z);
    m.userData.station = key;
    body.add(m);
    stationHits.push(m);
  };
  stationHit("cooling", ventAt.x, DECK_Y + 0.06, ventAt.z, 0.09, 0.12, 0.08);
  stationHit("engines", mastX, DECK_Y + 0.1, 0, 0.12, 0.2, 0.12);
  stationHit("plating", patchAt.x, DECK_Y + 0.04, patchAt.z, 0.12, 0.08, 0.08);
  stationHit("gunnery", turretsAt[0]!, DECK_Y + 0.04, 0.17, 0.08, 0.08, 0.08);
  stationHit("navigation", navAt.x, BRIDGE_Y + 0.04, navAt.z, 0.09, 0.08, 0.07);
  stationHit("helm", helmAt.x, helmAt.y, 0, 0.04, 0.12, 0.12);

  // ---- where a pirate may walk on deck
  const PAD = 0.016;
  const heightAt = (x: number, z: number): number => {
    if (x < BRIDGE_X) return BRIDGE_Y;
    if (x < STEPS_FOOT_X && Math.abs(z) < STEPS_HALF) return DECK_Y + ((BRIDGE_Y - DECK_Y) * (STEPS_FOOT_X - x)) / (STEPS_FOOT_X - BRIDGE_X);
    return DECK_Y;
  };
  const grid = new WalkGrid(-0.44, -0.2, 0.44, 0.2, 0.011).fill((x, z) => (x >= BRIDGE_X && x <= 0.41 && Math.abs(z) <= WALK_Z) || (x >= -0.41 && x < BRIDGE_X && Math.abs(z) <= WALK_Z - 0.005));
  const obstacles: Obstacle[] = [
    // The bridge's front, but for the steps, and the handrails beside them.
    { kind: "box", x: BRIDGE_X, z: (RAIL_Z + STEPS_HALF) / 2, hw: 0.006, hd: (RAIL_Z - STEPS_HALF) / 2, angle: 0 },
    { kind: "box", x: BRIDGE_X, z: -(RAIL_Z + STEPS_HALF) / 2, hw: 0.006, hd: (RAIL_Z - STEPS_HALF) / 2, angle: 0 },
    { kind: "box", x: (BRIDGE_X + STEPS_FOOT_X) / 2, z: STEPS_HALF, hw: (STEPS_FOOT_X - BRIDGE_X) / 2, hd: 0.004, angle: 0 },
    { kind: "box", x: (BRIDGE_X + STEPS_FOOT_X) / 2, z: -STEPS_HALF, hw: (STEPS_FOOT_X - BRIDGE_X) / 2, hd: 0.004, angle: 0 },
    { kind: "circle", x: mastX, z: 0, r: 0.03 },
    { kind: "box", x: mastX - 0.04, z: 0, hw: 0.01, hd: 0.045, angle: 0 },
    { kind: "box", x: ventAt.x + 0.01, z: ventAt.z - 0.005, hw: 0.045, hd: 0.035, angle: 0 },
    { kind: "box", x: patchAt.x, z: patchAt.z + 0.01, hw: 0.05, hd: 0.04, angle: 0 },
    { kind: "circle", x: 0.35, z: -0.15, r: 0.03 },
    { kind: "box", x: helmAt.x + 0.006, z: 0, hw: 0.01, hd: 0.045, angle: 0 },
    { kind: "box", x: navAt.x, z: navAt.z, hw: 0.04, hd: 0.03, angle: 0 },
    { kind: "circle", x: -0.41, z: 0.16, r: 0.008 },
    { kind: "circle", x: -0.41, z: -0.16, r: 0.008 },
  ];
  for (const side of [-1, 1]) for (const x of turretsAt) obstacles.push({ kind: "box", x, z: side * 0.175, hw: 0.03, hd: 0.03, angle: 0 });
  for (const o of obstacles) grid.block(o, PAD);

  const anchors: Record<Station, THREE.Vector3> = {
    cooling: new THREE.Vector3(ventAt.x, DECK_Y + 0.12, ventAt.z),
    engines: new THREE.Vector3(mastX, 0.55, 0),
    plating: new THREE.Vector3(patchAt.x, DECK_Y + 0.07, patchAt.z),
    gunnery: new THREE.Vector3(turretsAt[0]!, DECK_Y + 0.07, 0.18),
    navigation: new THREE.Vector3(navAt.x, BRIDGE_Y + 0.08, navAt.z),
  };
  const deck: ShipDeck = {
    grid,
    heightAt,
    stations: {
      cooling: { at: { x: ventAt.x - 0.064, z: ventAt.z }, face: 0 },
      engines: { at: { x: mastX, z: -0.07 }, face: Math.PI / 2 },
      plating: { at: { x: patchAt.x, z: patchAt.z - 0.062 }, face: Math.PI / 2 },
      gunnery: { at: { x: turretsAt[0]!, z: 0.12 }, face: Math.PI / 2 },
      navigation: { at: { x: navAt.x, z: navAt.z - 0.058 }, face: Math.PI / 2 },
    },
    helm: { at: { x: helmAt.x - 0.06, z: 0 }, face: 0 },
    idle: [
      { x: 0.0, z: 0.02 },
      { x: 0.22, z: 0.07 },
      { x: -0.12, z: 0.06 },
      { x: 0.3, z: -0.03 },
      { x: -0.05, z: -0.09 },
      { x: 0.16, z: -0.06 },
    ],
    airlock: (side) => ({ x: AIRLOCK_X, z: side * (WALK_Z - 0.01) }),
  };
  const plainFlag = kind === "other" ? PALETTE.parchment : PALETTE.brass;
  return { group, body, hit, hullHit, deckHit, stationHits, fin, glass, canopy, flag, plainFlag, dressed: "", engineGlow, marker, anchors, helm: helmAt, deck };
}

/**
 * A boarding tube from the dock's edge up to a ship's airlock, built in the outpost's dock frame: a
 * walkway in a clear sleeve, hooped along its length.
 */
export function buildBoardingTube(from: THREE.Vector3, to: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const span = to.clone().sub(from);
  const length = span.length();
  // Laid along its own x from the dock to the ship.
  g.position.copy(from).addScaledVector(span, 0.5);
  g.rotation.order = "YZX";
  g.rotation.y = -Math.atan2(span.z, span.x);
  g.rotation.z = Math.atan2(span.y, Math.hypot(span.x, span.z));
  const R = 0.05;
  const floor = shaded(new THREE.BoxGeometry(length, 0.012, 0.064), mat(PALETTE.tinDark));
  g.add(floor);
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, length, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: PALETTE.canopy, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
  );
  sleeve.rotation.z = Math.PI / 2;
  sleeve.position.y = R * 0.55;
  g.add(sleeve);
  for (let i = 0; i < 4; i++) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 4, 12), mat(i === 0 || i === 3 ? PALETTE.stripe : PALETTE.tin));
    hoop.rotation.y = Math.PI / 2;
    hoop.position.set(-length / 2 + (i * length) / 3, R * 0.55, 0);
    g.add(hoop);
  }
  return g;
}

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  paint(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function setMap(mesh: THREE.Mesh, map: THREE.Texture | null, color: number): void {
  const m = mesh.material as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;
  m.map?.dispose();
  m.map = map;
  m.color.setHex(map ? 0xffffff : color);
  m.needsUpdate = true;
}

/**
 * Dress a ship in its owner's crew colors (M6): the crew's flag on the antenna and its emblem on
 * the tail fin, in the flag's field color, so a crew's ships read as one fleet on the chart. Null
 * strikes the colors. Painted with the same Canvas 2D code as the flags in the cards.
 */
export function dressShip(model: ShipModel, colors: CrewFlagWire | null): void {
  const key = colors ? flagKey(colors) : "";
  if (model.dressed === key) return;
  model.dressed = key;
  if (!colors) {
    setMap(model.flag, null, model.plainFlag);
    model.flag.scale.set(1, 1, 1);
    setMap(model.fin, null, PALETTE.fin);
    return;
  }
  setMap(model.flag, canvasTexture(96, 64, (ctx) => drawFlag(ctx, colors, 96, 64)), model.plainFlag);
  // The flag's plane is two by one; a crew flag is three by two.
  model.flag.scale.set(1, 4 / 3, 1);
  const finHex = `#${PALETTE.fin.toString(16).padStart(6, "0")}`;
  setMap(
    model.fin,
    canvasTexture(112, 120, (ctx) => {
      ctx.fillStyle = finHex;
      ctx.fillRect(0, 0, 112, 120);
      // The middle of the blade, clear of its swept edges.
      drawEmblem(ctx, colors.emblem, 50, 62, 62, flagColor(colors.field), finHex);
    }),
    PALETTE.fin,
  );
}

let plumeTex: THREE.Texture | null = null;
/** An engine's plume: white hot at the nozzle (the texture's right edge), blue and gone by its tail, soft at its sides. */
function plumeTexture(): THREE.Texture {
  if (plumeTex) return plumeTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = c.getContext("2d")!;
  const along = g.createLinearGradient(128, 0, 0, 0);
  along.addColorStop(0, "rgba(255,255,255,1)");
  along.addColorStop(0.2, "rgba(170,236,255,0.9)");
  along.addColorStop(0.6, "rgba(90,170,255,0.35)");
  along.addColorStop(1, "rgba(70,120,255,0)");
  g.fillStyle = along;
  g.fillRect(0, 0, 128, 32);
  g.globalCompositeOperation = "destination-in";
  const across = g.createLinearGradient(0, 0, 0, 32);
  across.addColorStop(0, "rgba(0,0,0,0)");
  across.addColorStop(0.5, "rgba(0,0,0,1)");
  across.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = across;
  g.fillRect(0, 0, 128, 32);
  plumeTex = new THREE.CanvasTexture(c);
  plumeTex.colorSpace = THREE.SRGBColorSpace;
  return plumeTex;
}

/** A drift of dust over the chart: a loose string of small rocks in a thin haze. */
export function buildDust(seed: string): THREE.Group {
  const dice = new Dice(`dust:${seed}`);
  const g = new THREE.Group();
  const rocks = 9 + dice.int(6);
  const tones = [0x8d86a3, 0x756f8c, 0xa39cb8, 0x5f5a73];
  const b = new Batch();
  for (let i = 0; i < rocks; i++) {
    const r = 0.03 + dice.range(0, 0.06);
    b.add(new THREE.DodecahedronGeometry(r, 0), tones[dice.int(tones.length)]!, {
      p: [dice.range(-0.9, 0.9), dice.range(-0.12, 0.12), dice.range(-0.32, 0.32)],
      r: [dice.range(0, 3), dice.range(0, 3), dice.range(0, 3)],
      s: [1, 0.6 + dice.range(0, 0.5), 0.7 + dice.range(0, 0.5)],
    });
  }
  g.add(b.build(false));
  // A soft haze round the rocks: sprites, so it has no edge from any side.
  for (let i = 0; i < 3; i++) {
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xa99ad6, transparent: true, opacity: 0.2, depthWrite: false }));
    haze.scale.set(1.5 + dice.range(0, 0.6), 0.7 + dice.range(0, 0.3), 1);
    haze.position.set(i * 0.6 - 0.6 + dice.range(-0.1, 0.1), dice.range(-0.05, 0.05), dice.range(-0.12, 0.12));
    g.add(haze);
  }
  return g;
}

let softDotTex: THREE.Texture | null = null;
/** A white dot fading to nothing at its edge, for haze and glows. */
function softDot(): THREE.Texture {
  if (softDotTex) return softDotTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  softDotTex = new THREE.CanvasTexture(c);
  softDotTex.colorSpace = THREE.SRGBColorSpace;
  return softDotTex;
}

export interface DroneModel {
  group: THREE.Group;
  /** The running light on its back, which blinks. */
  lamp: THREE.Mesh;
  /** The thruster pods either side, which flicker. */
  pods: THREE.Mesh[];
}

/** A courier drone circling an outpost: a pill of a body, a pod either side, a light. */
export function buildDrone(): DroneModel {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.05), mat(PALETTE.tin));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.05, 4), mat(PALETTE.rust));
  nose.rotation.z = -Math.PI / 2;
  nose.rotation.x = Math.PI / 4;
  nose.position.x = 0.078;
  group.add(body, nose);
  const pods: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.06), mat(PALETTE.iron));
    arm.position.set(-0.01, 0, side * 0.05);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 8), new THREE.MeshBasicMaterial({ color: PALETTE.glow }));
    pod.position.set(-0.01, -0.012, side * 0.085);
    group.add(arm, pod);
    pods.push(pod);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
  lamp.position.set(-0.03, 0.026, 0);
  group.add(lamp);
  return { group, lamp, pods };
}

export interface BuoyModel {
  group: THREE.Group;
  lamp: THREE.Mesh;
}

/** A nav buoy marking a lane's midpoint: a spindle that hangs in the void and turns, a lamp at its tip. */
export function buildBuoy(): BuoyModel {
  const group = new THREE.Group();
  const upper = shaded(new THREE.ConeGeometry(0.075, 0.13, 6), mat(PALETTE.rust));
  upper.position.y = 0.145;
  const lower = shaded(new THREE.ConeGeometry(0.075, 0.2, 6), mat(PALETTE.tinDark));
  lower.rotation.x = Math.PI;
  lower.position.y = -0.02;
  const band = shaded(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 6), mat(PALETTE.tin));
  band.position.y = 0.08;
  group.add(upper, lower, band);
  // Two little panels, so it reads as a made thing from far off.
  for (const side of [-1, 1]) {
    const panel = shaded(new THREE.BoxGeometry(0.09, 0.006, 0.05), mat(PALETTE.panel));
    panel.position.set(side * 0.13, 0.08, 0);
    group.add(panel);
  }
  const post = shaded(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 5), mat(PALETTE.iron));
  post.position.y = 0.27;
  group.add(post);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
  lamp.position.y = 0.34;
  group.add(lamp);
  return { group, lamp };
}
