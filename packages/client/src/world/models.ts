/**
 * The pieces of the world besides the outposts (outpost.ts): ships, drifting dust, drones and nav
 * buoys as chunky low-poly groups built from primitives. No art files; everything is geometry and
 * flat color, so it stays placeholder-art honest (DESIGN.md 3.10) while reading as a toy diorama. A
 * ship's static plates are merged into a few meshes (batch.ts): her tub, each side wall and her
 * roof, so she can be cut away aboard. The parts that move or change stay their own. Where a crew
 * walks inside her is laid out in deck.ts, which draws nothing.
 */
import * as THREE from "three";
import type { CrewFlagWire } from "@openseas/protocol";
import { drawEmblem, drawFlag, flagColor, flagKey } from "../crew/flag.js";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Batch, unseen, type Vec3 } from "./batch.js";
import {
  AIRLOCK_X,
  BOW_X,
  BRIDGE_X,
  BRIDGE_Y,
  CORE_X,
  DECK_Y,
  DRIVE_X,
  HELM_X,
  HULL_Z,
  LOCKER,
  NAV,
  PATCH,
  ROOF_Y,
  SILL_Y,
  STEPS_FOOT_X,
  STEPS_HALF,
  STERN_X,
  STORES,
  TURRETS_X,
  VENT,
  WALL_TOP,
  WALL_Z,
  skiffDeck,
  type ShipDeck,
  type Station,
} from "./deck.js";

export { HULL_HALF, STATION_ORDER, type DeckPost, type ShipDeck, type Station } from "./deck.js";

export type { Building } from "./outpost.js";

export const PALETTE = {
  hull: 0xd6cfbf,
  hullDark: 0x9d968a,
  keel: 0x4a4f5a,
  seam: 0x7d776c,
  stripe: 0xc8663a,
  patch: 0x6f9aa6,
  patchWarm: 0xd9a24a,
  deck: 0x9299a6,
  deckSeam: 0x6c7380,
  walkway: 0xaab1bd,
  bridge: 0x848b99,
  lining: 0x4d5870,
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

/** A skiff's size in the world: big enough that a crew of pirates can walk its deck. */
export const SHIP_SCALE = 1.4;
/** How far her deck rides below where the model's own origin would put it, so it meets the dock's boarding tube. */
export const SHIP_SINK = 0.055;

export interface ShipModel {
  group: THREE.Group;
  /** The hull and everything in it; the drift is applied here so the group's frame stays steady for labels. */
  body: THREE.Group;
  /** A generous box round the whole ship, for picking her out on the chart. */
  hit: THREE.Mesh;
  /** Just the hull, for taps up close where the ground around her must stay walkable. */
  hullHit: THREE.Mesh;
  /** The deck's top, for taps to walk. */
  deckHit: THREE.Mesh;
  /** Invisible boxes over each station's gear and the helm, for taps on the thing itself. */
  stationHits: THREE.Mesh[];
  /** The tail fin, which carries the crew's emblem. */
  fin: THREE.Mesh;
  /** The panel painted on each slope of the roof, which carries the crew's flag. The two share one material. */
  flags: THREE.Mesh[];
  /** The panels' own color when the ship flies no crew's colors. */
  plainFlag: number;
  /** The colors the ship is dressed in now, by flag key, or "" for none. */
  dressed: string;
  /**
   * Open her up for a crew aboard, or shut her. Given the side the camera looks from (+1 starboard,
   * -1 port), the roof, the canopy and that side's wall are not drawn and the far wall stands as
   * the room's back. Null draws her whole, as she is seen from outside.
   */
  cutaway(side: number | null): void;
  /** The engines' plumes, lit in flight. */
  engineGlow: THREE.Group;
  marker: THREE.Mesh;
  /** Where each station's label hangs, in the body's frame. */
  anchors: Record<Station, THREE.Vector3>;
  /** The helm, in the body's frame. */
  helm: THREE.Vector3;
  deck: ShipDeck;
}

/** How high the "your ship" marker hangs over her on the chart. */
export const MARKER_Y = 1.0;

/** The tail fin standing on the roof aft: its corners in the ship's side view. */
const FIN = [
  [-0.2, ROOF_Y],
  [-0.44, ROOF_Y],
  [-0.5, 0.74],
  [-0.38, 0.74],
] as const;

/** A cross-section of the hull: points (z, y) going round it. */
type Outline = readonly (readonly [number, number])[];

/** An outline drawn in toward a point on the centerline. */
const shrink = (outline: Outline, k: number, aboutY: number): Outline => outline.map(([z, y]) => [z * k, aboutY + (y - aboutY) * k] as const);

/**
 * A faceted solid run through cross-sections along the ship's length, each with the same number
 * of points, and capped at both ends. This is how the hull gets a shape of its own instead of
 * being a box.
 */
function loft(sections: readonly { x: number; pts: Outline }[]): THREE.BufferGeometry {
  const tris: number[][] = [];
  const at = (s: { x: number; pts: Outline }, i: number): number[] => {
    const p = s.pts[i % s.pts.length]!;
    return [s.x, p[1], p[0]];
  };
  for (let k = 0; k < sections.length - 1; k++) {
    const s0 = sections[k]!;
    const s1 = sections[k + 1]!;
    for (let i = 0; i < s0.pts.length; i++) {
      tris.push([...at(s0, i), ...at(s0, i + 1), ...at(s1, i + 1)], [...at(s0, i), ...at(s1, i + 1), ...at(s1, i)]);
    }
  }
  const first = sections[0]!;
  const last = sections[sections.length - 1]!;
  for (let i = 1; i < first.pts.length - 1; i++) {
    tris.push([...at(first, 0), ...at(first, i + 1), ...at(first, i)], [...at(last, 0), ...at(last, i), ...at(last, i + 1)]);
  }
  // Faces out: whichever way round the outline was given, the solid's volume comes out positive.
  let volume = 0;
  for (const t of tris) volume += t[0]! * (t[4]! * t[8]! - t[5]! * t[7]!) - t[1]! * (t[3]! * t[8]! - t[5]! * t[6]!) + t[2]! * (t[3]! * t[7]! - t[4]! * t[6]!);
  const pos: number[] = [];
  for (const t of tris) pos.push(...(volume >= 0 ? t : [t[0]!, t[1]!, t[2]!, t[6]!, t[7]!, t[8]!, t[3]!, t[4]!, t[5]!]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * A skiff: a closed hull with the bridge forward under a canopy, the drive aft, a turret pair in
 * each side and an airlock amidships. Nothing of a boat is left in her (ADR 0035): no mast, no
 * rails, no open deck.
 *
 * From outside she is shut. Aboard she is cut away like a model with its lid off: the roof, the
 * canopy and the side wall nearest the camera are not drawn, the far wall stands as the room's
 * back, and the deck is the floor of her one long room. The stations stand where a crew walks to
 * them: the helm and the nav console on the bridge, two steps up; the turrets against the walls
 * either side of the airlocks; the heat sinks to port and the patch bay to starboard; the drive
 * console at the core, aft.
 */
export function buildShip(kind: "yours" | "aboard" | "other", shadows = true): ShipModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(SHIP_SCALE);
  body.position.y = -SHIP_SINK;
  group.add(body);
  // The tub: everything that is there whether or not she is cut away.
  const b = new Batch();
  const P = PALETTE;
  const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt: number, rb: number, h: number, seg = 8): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);
  const ball = (r: number, w = 6, h = 5): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);
  const length = BOW_X - STERN_X;
  const midX = (BOW_X + STERN_X) / 2;

  // ---- the lower hull: a chamfered belly of painted plate under the deck, patched where she has been holed
  // Its top is closed under the deck's plates, not over them.
  const belly: Outline = [
    [-HULL_Z, DECK_Y - 0.012],
    [-HULL_Z, 0.17],
    [-0.15, 0.03],
    [0.15, 0.03],
    [HULL_Z, 0.17],
    [HULL_Z, DECK_Y - 0.012],
  ];
  b.add(loft([{ x: STERN_X - 0.03, pts: shrink(belly, 0.88, 0.2) }, { x: STERN_X + 0.05, pts: belly }, { x: BOW_X, pts: belly }]), P.hull);
  b.add(box(0.78, 0.012, 0.3), P.hullDark, { p: [midX - 0.02, 0.027, 0] });
  // Skids to stand on, on struts under the belly.
  for (const z of [-0.11, 0.11]) {
    b.add(box(0.5, 0.016, 0.026), P.keel, { p: [midX, -0.012, z] });
    for (const x of [-0.18, 0.18]) b.add(box(0.014, 0.04, 0.014), P.keel, { p: [midX + x, 0.008, z] });
  }
  // A painted band round her at the deck line, and seams down her sides.
  for (const side of [-1, 1]) b.add(box(length + 0.004, 0.03, 0.006), P.stripe, { p: [midX, 0.283, side * HULL_Z] });
  b.add(box(0.006, 0.03, HULL_Z * 2), P.stripe, { p: [STERN_X, 0.283, 0] });
  for (const x of [-0.3, -0.1, 0.1, 0.3]) b.add(box(0.005, 0.1, HULL_Z * 2 + 0.004), P.seam, { p: [x, 0.22, 0] });
  for (const [x, y, side, w, h, c, tilt] of [
    [0.31, 0.215, 1, 0.11, 0.07, P.patch, 0.08],
    [-0.21, 0.21, 1, 0.08, 0.06, P.patchWarm, -0.12],
    [0.2, 0.215, -1, 0.09, 0.07, P.patchWarm, 0.1],
    [-0.33, 0.22, -1, 0.1, 0.06, P.patch, -0.06],
  ] as const) {
    b.add(box(w, h, 0.006), c, { p: [x, y, side * (HULL_Z + 0.002)], r: [0, 0, tilt] });
    // A rivet at each corner of the patch.
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) b.add(box(0.007, 0.007, 0.008), P.iron, { p: [x + dx * (w / 2 - 0.008), y + dy * (h / 2 - 0.008), side * (HULL_Z + 0.003)], r: [0, 0, tilt] });
  }

  // ---- the nose: the hull's whole section drawn in to a painted tip, a probe out ahead of it
  const section: Outline = [
    [-HULL_Z, 0.17],
    [-0.15, 0.03],
    [0.15, 0.03],
    [HULL_Z, 0.17],
    [HULL_Z, WALL_TOP],
    [0.2, WALL_TOP + 0.015],
    [-0.2, WALL_TOP + 0.015],
    [-HULL_Z, WALL_TOP],
  ];
  b.add(loft([{ x: BOW_X, pts: section }, { x: 0.62, pts: shrink(section, 0.68, 0.21) }, { x: 0.77, pts: shrink(section, 0.28, 0.2) }]), P.hull);
  b.add(loft([{ x: 0.77, pts: shrink(section, 0.28, 0.2) }, { x: 0.84, pts: shrink(section, 0.1, 0.2) }]), P.stripe);
  b.add(cyl(0.005, 0.007, 0.16, 5), P.iron, { p: [0.92, 0.2, 0], r: [0, 0, -Math.PI / 2] });
  b.addGlow(ball(0.012), P.glow, { p: [1.0, 0.2, 0] });

  // ---- the engines: two bells in the stern, dark until she is under way
  const nozzles = [-0.12, 0.12];
  const NOZZLE_Y = 0.17;
  for (const z of nozzles) {
    b.add(cyl(0.078, 0.086, 0.05, 10), P.steel, { p: [STERN_X - 0.05, NOZZLE_Y, z], r: [0, 0, Math.PI / 2] });
    b.add(cyl(0.092, 0.06, 0.08, 10), P.iron, { p: [STERN_X - 0.105, NOZZLE_Y, z], r: [0, 0, Math.PI / 2] });
    b.addGlow(cyl(0.056, 0.056, 0.004, 10), 0x6a3a22, { p: [STERN_X - 0.146, NOZZLE_Y, z], r: [0, 0, Math.PI / 2] });
  }

  // ---- the deck: plates with a seam every so often, a strip of light along the foot of each wall
  b.add(box(length, 0.02, WALL_Z * 2), P.deck, { p: [midX, DECK_Y - 0.01, 0] });
  for (const side of [-1, 1]) b.add(box(length, 0.02, HULL_Z - WALL_Z), P.tinDark, { p: [midX, SILL_Y - 0.01, (side * (HULL_Z + WALL_Z)) / 2] });
  for (let i = 0; i < 7; i++) b.add(box(0.004, 0.004, WALL_Z * 2), P.deckSeam, { p: [STERN_X + 0.06 + i * 0.09, DECK_Y + 0.002, 0] });
  // A lighter walkway down the middle, from the core to the steps.
  b.add(box(STEPS_FOOT_X - DRIVE_X - 0.04, 0.003, 0.1), P.walkway, { p: [(STEPS_FOOT_X + DRIVE_X + 0.04) / 2, DECK_Y + 0.0015, 0] });
  for (const side of [-1, 1]) b.addGlow(box(BRIDGE_X - STERN_X - 0.06, 0.003, 0.006), P.glow, { p: [(BRIDGE_X + STERN_X) / 2, DECK_Y + 0.002, side * (WALL_Z - 0.012)] });
  // A grating amidships, and a mat of warning stripes inside each airlock.
  b.add(box(0.08, 0.006, 0.07), P.steel, { p: [-0.02, DECK_Y + 0.003, 0] });
  for (let i = 0; i < 4; i++) b.add(box(0.004, 0.003, 0.066), 0x1a1d22, { p: [-0.05 + i * 0.02, DECK_Y + 0.0065, 0] });
  for (const side of [-1, 1]) {
    b.add(box(0.07, 0.004, 0.04), P.iron, { p: [AIRLOCK_X, DECK_Y + 0.002, side * (WALL_Z - 0.03)] });
    for (let i = 0; i < 3; i++) b.add(box(0.012, 0.005, 0.04), P.patchWarm, { p: [AIRLOCK_X - 0.024 + i * 0.024, DECK_Y + 0.0025, side * (WALL_Z - 0.03)] });
  }
  // The stern bulkhead: the engine room's hatch in it, a lamp over the hatch.
  b.add(box(0.025, WALL_TOP - SILL_Y, HULL_Z * 2), P.hullDark, { p: [STERN_X + 0.0125, (WALL_TOP + SILL_Y) / 2, 0] });
  b.add(box(0.004, 0.085, 0.07), 0x1a1d22, { p: [STERN_X + 0.027, DECK_Y + 0.0425, 0.09] });
  b.addGlow(box(0.004, 0.008, 0.03), P.heat, { p: [STERN_X + 0.028, DECK_Y + 0.096, 0.09] });

  // ---- the bridge: two steps up, forward, a low screen across its aft edge either side of the steps
  const bridgeLen = BOW_X - BRIDGE_X;
  b.add(box(bridgeLen, BRIDGE_Y - DECK_Y, WALL_Z * 2), P.hullDark, { p: [BRIDGE_X + bridgeLen / 2, (DECK_Y + BRIDGE_Y) / 2, 0] });
  b.add(box(bridgeLen, 0.006, WALL_Z * 2), P.bridge, { p: [BRIDGE_X + bridgeLen / 2, BRIDGE_Y, 0] });
  for (let i = 0; i < 3; i++) b.add(box(0.003, 0.003, WALL_Z * 2), P.deckSeam, { p: [BRIDGE_X + 0.05 + i * 0.08, BRIDGE_Y + 0.004, 0] });
  const rise = (BRIDGE_Y - DECK_Y) / 3;
  const run = (BRIDGE_X - STEPS_FOOT_X) / 2;
  for (let i = 0; i < 2; i++) {
    const top = DECK_Y + rise * (i + 1);
    b.add(box(run, top - DECK_Y, STEPS_HALF * 2), i ? P.tinDark : P.tin, { p: [STEPS_FOOT_X + run * (i + 0.5), (top + DECK_Y) / 2, 0] });
  }
  for (const side of [-1, 1]) {
    // A handrail up the steps, and the screen across the bridge's edge with a strip of light on it.
    b.add(box(0.008, 0.06, 0.008), P.rail, { p: [STEPS_FOOT_X + 0.004, DECK_Y + 0.03, side * STEPS_HALF] });
    b.add(box(0.085, 0.007, 0.007), P.rail, { p: [(STEPS_FOOT_X + BRIDGE_X) / 2, DECK_Y + 0.085, side * STEPS_HALF], r: [0, 0, 0.75] });
    b.add(box(0.012, 0.045, WALL_Z - STEPS_HALF), P.tinDark, { p: [BRIDGE_X, BRIDGE_Y + 0.0225, (side * (WALL_Z + STEPS_HALF)) / 2] });
    b.addGlow(box(0.006, 0.004, WALL_Z - STEPS_HALF - 0.02), P.glow, { p: [BRIDGE_X, BRIDGE_Y + 0.047, (side * (WALL_Z + STEPS_HALF)) / 2] });
    b.addGlow(box(0.004, 0.006, 0.012), P.lamp, { p: [BRIDGE_X - 0.003, DECK_Y + 0.042, side * 0.12] });
  }
  // The dash under the windscreen: a bank of lit screens right across the nose.
  b.add(box(0.05, 0.05, WALL_Z * 2 - 0.04), P.steel, { p: [BOW_X - 0.025, BRIDGE_Y + 0.025, 0] });
  b.add(box(0.03, 0.012, WALL_Z * 2 - 0.05), P.iron, { p: [BOW_X - 0.04, BRIDGE_Y + 0.054, 0], r: [0, 0, 0.5] });
  for (const [z, c] of [
    [-0.13, P.glow],
    [-0.065, 0x2f86a8],
    [0.065, P.lamp],
    [0.13, P.glow],
  ] as const)
    b.addGlow(box(0.004, 0.02, 0.05), c, { p: [BOW_X - 0.052, BRIDGE_Y + 0.057, z], r: [0, 0, 0.5] });

  // ---- the helm and the nav console on the bridge
  const helmAt = new THREE.Vector3(HELM_X, BRIDGE_Y + 0.085, 0);
  // A pedestal with a lit panel facing the captain, and a yoke to steer by.
  b.add(box(0.02, 0.07, 0.07), P.steel, { p: [helmAt.x + 0.014, BRIDGE_Y + 0.035, 0] });
  b.add(box(0.026, 0.02, 0.086), P.iron, { p: [helmAt.x + 0.012, BRIDGE_Y + 0.078, 0], r: [0, 0, 0.5] });
  b.addGlow(box(0.004, 0.02, 0.07), P.glow, { p: [helmAt.x + 0.0, BRIDGE_Y + 0.081, 0], r: [0, 0, 0.5] });
  b.add(new THREE.TorusGeometry(0.036, 0.006, 5, 10, Math.PI), P.iron, { p: [helmAt.x - 0.012, helmAt.y - 0.012, 0], r: [0, Math.PI / 2, 0] });
  for (const z of [-0.036, 0.036]) b.add(ball(0.009), P.stripe, { p: [helmAt.x - 0.012, helmAt.y - 0.012, z] });
  // A console with a star chart glowing on its top, and a little globe of the system standing over it.
  b.add(box(0.075, 0.05, 0.055), P.steel, { p: [NAV.x, BRIDGE_Y + 0.025, NAV.z] });
  b.addGlow(box(0.066, 0.004, 0.046), 0x2f86a8, { p: [NAV.x, BRIDGE_Y + 0.052, NAV.z] });
  for (const [dx, dz] of [
    [-0.02, -0.012],
    [0.012, 0.01],
    [0.024, -0.014],
    [-0.006, 0.016],
  ] as const)
    b.addGlow(box(0.005, 0.002, 0.005), P.window, { p: [NAV.x + dx, BRIDGE_Y + 0.055, NAV.z + dz] });
  b.add(cyl(0.002, 0.002, 0.03, 4), P.iron, { p: [NAV.x + 0.026, BRIDGE_Y + 0.068, NAV.z + 0.016] });
  b.addGlow(ball(0.01, 7, 5), P.glow, { p: [NAV.x + 0.026, BRIDGE_Y + 0.09, NAV.z + 0.016] });

  // ---- the drive: the core in its cage aft, a conduit back to the engines, and the console that feeds it
  b.add(cyl(0.04, 0.045, 0.02, 10), P.steel, { p: [CORE_X, DECK_Y + 0.01, 0] });
  b.addGlow(cyl(0.022, 0.022, 0.1, 8), P.glow, { p: [CORE_X, DECK_Y + 0.07, 0] });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    b.add(box(0.006, 0.11, 0.006), P.steel, { p: [CORE_X + Math.cos(a) * 0.034, DECK_Y + 0.075, Math.sin(a) * 0.034] });
  }
  for (const y of [0.05, 0.095]) b.add(new THREE.TorusGeometry(0.034, 0.004, 4, 10), P.tinDark, { p: [CORE_X, DECK_Y + y, 0], r: [Math.PI / 2, 0, 0] });
  b.add(cyl(0.042, 0.036, 0.016, 10), P.iron, { p: [CORE_X, DECK_Y + 0.135, 0] });
  b.add(box(STERN_X + 0.025 - CORE_X + 0.12, 0.022, 0.034), P.iron, { p: [(CORE_X + STERN_X + 0.025) / 2, DECK_Y + 0.011, 0] });
  // The console: a bank with a sloped face of lit keys toward whoever works it, and two throttle levers.
  b.add(box(0.016, 0.05, 0.09), P.steel, { p: [DRIVE_X, DECK_Y + 0.025, 0] });
  b.add(box(0.024, 0.012, 0.09), P.iron, { p: [DRIVE_X + 0.003, DECK_Y + 0.054, 0], r: [0, 0, -0.45] });
  for (let i = 0; i < 4; i++) b.addGlow(box(0.006, 0.004, 0.01), i % 2 ? P.glow : P.lamp, { p: [DRIVE_X + 0.007, DECK_Y + 0.061, -0.03 + i * 0.02], r: [0, 0, -0.45] });
  for (const z of [-0.02, 0.015]) {
    b.add(cyl(0.003, 0.003, 0.034, 4), P.tin, { p: [DRIVE_X - 0.004, DECK_Y + 0.072, z], r: [0, 0, 0.3] });
    b.add(ball(0.006, 6, 4), P.stripe, { p: [DRIVE_X - 0.009, DECK_Y + 0.089, z] });
  }

  // ---- the heat sinks: a block with a row of fins standing out of it, a hot core between them, the vent lever and a coolant line
  b.add(box(0.06, 0.05, 0.06), P.iron, { p: [VENT.x, DECK_Y + 0.025, VENT.z] });
  for (let i = 0; i < 5; i++) b.add(box(0.05, 0.05, 0.005), P.tinDark, { p: [VENT.x, DECK_Y + 0.075, VENT.z - 0.024 + i * 0.012] });
  b.addGlow(box(0.04, 0.006, 0.05), P.heat, { p: [VENT.x, DECK_Y + 0.053, VENT.z] });
  b.add(cyl(0.006, 0.006, 0.13, 5), P.tin, { p: [VENT.x - 0.03, DECK_Y + 0.105, VENT.z], r: [0, 0, Math.PI / 2 - 0.25] });
  b.add(ball(0.009, 6, 4), P.stripe, { p: [VENT.x - 0.092, DECK_Y + 0.089, VENT.z] });
  b.add(cyl(0.006, 0.006, 0.05, 5), P.steel, { p: [VENT.x + 0.03, DECK_Y + 0.03, VENT.z + 0.035], r: [Math.PI / 2, 0, 0] });
  b.add(cyl(0.018, 0.018, 0.04, 7), P.blue, { p: [VENT.x + 0.05, DECK_Y + 0.02, VENT.z - 0.035] });

  // ---- the turrets: a ball in each wall, the gunner's side of it inside, twin barrels and a blister outside
  for (const side of [-1, 1]) {
    for (const x of TURRETS_X) {
      b.add(cyl(0.027, 0.03, 0.02, 8), P.steel, { p: [x, DECK_Y + 0.01, side * 0.168] });
      b.add(new THREE.SphereGeometry(0.025, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), P.tinDark, { p: [x, DECK_Y + 0.02, side * 0.168] });
      for (const dx of [-0.009, 0.009]) b.add(cyl(0.006, 0.007, 0.11, 6), P.iron, { p: [x + dx, DECK_Y + 0.035, side * 0.225], r: [Math.PI / 2, 0, 0] });
      b.addGlow(box(0.008, 0.005, 0.005), P.glow, { p: [x, DECK_Y + 0.046, side * 0.165] });
      b.add(new THREE.SphereGeometry(0.034, 8, 5), 0x1a1d22, { p: [x, DECK_Y + 0.035, side * (HULL_Z - 0.004)], s: [1, 0.8, 0.5] });
    }
  }
  // Slugs in a rack by the starboard aft turret.
  for (let i = 0; i < 3; i++) b.add(cyl(0.007, 0.007, 0.018, 6), P.brass, { p: [TURRETS_X[0] - 0.06 + i * 0.019, DECK_Y + 0.009, 0.185] });

  // ---- the patch bay: a bench with a hull plate on it and a welder beside the plate, spare plates stacked at its foot
  b.add(box(0.1, 0.045, 0.05), P.steel, { p: [PATCH.x, DECK_Y + 0.0225, PATCH.z] });
  b.add(box(0.12, 0.008, 0.03), P.tin, { p: [PATCH.x, DECK_Y + 0.05, PATCH.z], r: [0, 0.25, 0] });
  b.add(box(0.026, 0.016, 0.016), P.stripe, { p: [PATCH.x + 0.03, DECK_Y + 0.056, PATCH.z - 0.012] });
  b.add(cyl(0.003, 0.003, 0.02, 4), P.iron, { p: [PATCH.x + 0.012, DECK_Y + 0.056, PATCH.z - 0.012], r: [0, 0, Math.PI / 2] });
  b.addGlow(ball(0.004, 5, 4), P.glow, { p: [PATCH.x + 0.001, DECK_Y + 0.056, PATCH.z - 0.012] });
  for (let i = 0; i < 3; i++) b.add(box(0.1, 0.008, 0.016), i % 2 ? P.patch : P.tinDark, { p: [PATCH.x - 0.005, DECK_Y + 0.004 + i * 0.008, PATCH.z + 0.04] });

  // ---- stores in one corner aft, a locker in the other
  for (const [dx, dz, c] of [
    [-0.0125, -0.0125, P.stripe],
    [0.0125, 0.0125, P.patch],
  ] as const) {
    b.add(cyl(0.019, 0.019, 0.045, 8), c, { p: [STORES.x + dx, DECK_Y + 0.0225, STORES.z + dz] });
    b.add(cyl(0.0195, 0.0195, 0.004, 8), P.iron, { p: [STORES.x + dx, DECK_Y + 0.035, STORES.z + dz] });
  }
  b.add(box(0.05, 0.085, 0.038), P.blue, { p: [LOCKER.x, DECK_Y + 0.0425, LOCKER.z] });
  b.add(box(0.003, 0.07, 0.03), P.tinDark, { p: [LOCKER.x + 0.026, DECK_Y + 0.045, LOCKER.z] });
  b.addGlow(box(0.003, 0.006, 0.006), P.lamp, { p: [LOCKER.x + 0.027, DECK_Y + 0.07, LOCKER.z - 0.008] });
  body.add(b.build(shadows));

  // ---- the side walls: plate outside with lit ports and the airlock's frame; inside, what the crew looks at
  const wall = (side: number): THREE.Group => {
    const w = new Batch();
    const thick = HULL_Z - WALL_Z;
    const z = (side * (HULL_Z + WALL_Z)) / 2;
    const tall = WALL_TOP - SILL_Y;
    const y = (WALL_TOP + SILL_Y) / 2;
    const out = side * (HULL_Z + 0.001);
    const inn = side * (WALL_Z - 0.004);
    // Two runs of wall, either side of the airlock's doorway, and the lintel over it.
    const door = [AIRLOCK_X - 0.035, AIRLOCK_X + 0.035] as const;
    w.add(box(door[0] - STERN_X, tall, thick), P.hull, { p: [(door[0] + STERN_X) / 2, y, z] });
    w.add(box(BOW_X - door[1], tall, thick), P.hull, { p: [(door[1] + BOW_X) / 2, y, z] });
    w.add(box(0.07, 0.022, thick + 0.004), P.stripe, { p: [AIRLOCK_X, WALL_TOP - 0.011, z] });
    for (const x of door) w.add(box(0.012, tall, thick + 0.008), P.rail, { p: [x, y, z] });
    w.addGlow(box(0.026, 0.007, thick + 0.012), P.lamp, { p: [AIRLOCK_X, WALL_TOP - 0.028, z] });
    w.add(box(length, 0.008, thick + 0.004), P.seam, { p: [midX, WALL_TOP - 0.004, z] });
    // Lined inside in a darker plate, so the far wall reads as the back of a room.
    w.add(box(door[0] - STERN_X - 0.025, tall - 0.01, 0.003), P.lining, { p: [(door[0] + STERN_X + 0.025) / 2, y - 0.005, side * (WALL_Z - 0.001)] });
    w.add(box(BOW_X - door[1], tall - 0.01, 0.003), P.lining, { p: [(door[1] + BOW_X) / 2, y - 0.005, side * (WALL_Z - 0.001)] });
    // Ports: lit from within outside, black with the void inside.
    for (const x of [-0.39, -0.29, -0.13, 0.22, 0.31, 0.4]) {
      w.addGlow(cyl(0.017, 0.017, 0.004, 10), P.window, { p: [x, y + 0.006, out], r: [Math.PI / 2, 0, 0] });
      w.add(new THREE.TorusGeometry(0.019, 0.004, 4, 10), P.steel, { p: [x, y + 0.006, out] });
      w.addGlow(cyl(0.017, 0.017, 0.004, 10), 0x141c38, { p: [x, y + 0.006, inn], r: [Math.PI / 2, 0, 0] });
      w.add(new THREE.TorusGeometry(0.019, 0.004, 4, 10), P.rail, { p: [x, y + 0.006, inn] });
    }
    // Inside: a strip of light under the roof, a pipe along the foot of the wall, panels and a couple of screens.
    w.addGlow(box(BRIDGE_X - STERN_X - 0.05, 0.005, 0.004), P.glow, { p: [(BRIDGE_X + STERN_X) / 2, WALL_TOP - 0.012, inn] });
    w.add(cyl(0.006, 0.006, door[0] - STERN_X - 0.04, 5), P.rust, { p: [(door[0] + STERN_X) / 2, SILL_Y + 0.012, side * (WALL_Z - 0.007)], r: [0, 0, Math.PI / 2] });
    for (const x of [-0.34, -0.21, -0.06]) w.add(box(0.05, 0.05, 0.004), P.tinDark, { p: [x, y - 0.008, inn] });
    for (const [x, c] of [
      [-0.21, 0x2f86a8],
      [-0.06, P.lamp],
    ] as const)
      w.addGlow(box(0.03, 0.02, 0.005), c, { p: [x, y, side * (WALL_Z - 0.006)] });
    const g = w.build(shadows);
    body.add(g);
    return g;
  };
  const walls = { port: wall(-1), starboard: wall(1) };

  // ---- the roof and the canopy: everything over the walls, drawn only from outside
  const shell = new THREE.Group();
  const r = new Batch();
  const roofLine: Outline = [
    [-HULL_Z, WALL_TOP],
    [-0.17, ROOF_Y],
    [0.17, ROOF_Y],
    [HULL_Z, WALL_TOP],
  ];
  const windscreen: Outline = [
    [-HULL_Z, WALL_TOP],
    [-0.2, WALL_TOP + 0.015],
    [0.2, WALL_TOP + 0.015],
    [HULL_Z, WALL_TOP],
  ];
  r.add(loft([{ x: STERN_X, pts: roofLine }, { x: BRIDGE_X, pts: roofLine }]), P.hull);
  const roofLen = BRIDGE_X - STERN_X;
  r.add(box(roofLen - 0.04, 0.006, 0.3), P.tin, { p: [(BRIDGE_X + STERN_X) / 2, ROOF_Y + 0.002, 0] });
  for (const x of [-0.36, -0.2, -0.04, 0.12]) r.add(box(0.008, 0.008, 0.34), P.seam, { p: [x, ROOF_Y + 0.003, 0] });
  // The slope of the roof either side, at the angle its ribs and the flags lie at.
  const slope = Math.atan2(ROOF_Y - WALL_TOP, HULL_Z - 0.17);
  const slopeLen = Math.hypot(ROOF_Y - WALL_TOP, HULL_Z - 0.17);
  const onSlope = (side: number): Vec3 => [0, (ROOF_Y + WALL_TOP) / 2, (side * (HULL_Z + 0.17)) / 2];
  // The canopy's frame: a hoop where it meets the roof, one over the captain, and the windscreen's sill.
  for (const x of [BRIDGE_X, 0.32]) {
    r.add(box(0.014, 0.01, 0.35), P.steel, { p: [x, ROOF_Y, 0] });
    for (const side of [-1, 1]) r.add(box(0.014, 0.01, slopeLen), P.steel, { p: [x, onSlope(side)[1], onSlope(side)[2]], r: [side * slope, 0, 0] });
  }
  r.add(box(0.014, 0.012, 0.41), P.steel, { p: [BOW_X - 0.004, WALL_TOP + 0.018, 0] });
  // A hatch, two vents, a dish and a whip aerial; running lights at the stern, red to port and green to starboard.
  r.add(cyl(0.035, 0.038, 0.012, 10), P.steel, { p: [0.03, ROOF_Y + 0.008, 0] });
  r.add(box(0.03, 0.006, 0.008), P.iron, { p: [0.03, ROOF_Y + 0.017, 0] });
  for (const z of [-0.09, 0.09]) {
    r.add(box(0.06, 0.022, 0.034), P.tinDark, { p: [-0.24, ROOF_Y + 0.013, z] });
    r.addGlow(box(0.05, 0.004, 0.02), P.heat, { p: [-0.24, ROOF_Y + 0.025, z] });
  }
  r.add(cyl(0.004, 0.006, 0.05, 5), P.iron, { p: [-0.07, ROOF_Y + 0.027, 0.09] });
  r.add(new THREE.SphereGeometry(0.04, 9, 4, 0, Math.PI * 2, 0, 0.9), P.tin, { p: [-0.07, ROOF_Y + 0.085, 0.09], r: [Math.PI + 0.5, 0, 0.3] });
  r.add(cyl(0.002, 0.003, 0.2, 4), P.iron, { p: [0.1, ROOF_Y + 0.1, -0.1] });
  r.addGlow(ball(0.008), P.portLamp, { p: [0.1, ROOF_Y + 0.205, -0.1] });
  for (const side of [-1, 1]) r.addGlow(ball(0.012, 8, 6), side < 0 ? P.portLamp : P.starboardLamp, { p: [STERN_X + 0.03, WALL_TOP + 0.02, side * (HULL_Z - 0.015)] });
  // The fin's root.
  r.add(box(FIN[0][0] - FIN[1][0] + 0.03, 0.03, 0.03), P.steel, { p: [(FIN[0][0] + FIN[1][0]) / 2, ROOF_Y + 0.012, 0] });
  shell.add(r.build(shadows));
  const glassPane = new THREE.Mesh(
    loft([{ x: BRIDGE_X, pts: roofLine }, { x: 0.36, pts: roofLine }, { x: BOW_X, pts: windscreen }]),
    new THREE.MeshBasicMaterial({ color: P.canopy, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  glassPane.renderOrder = 2;
  shell.add(glassPane);

  // ---- the tail fin: a swept blade on the roof, painted with the crew's emblem when she flies their colors
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
  const fin = shaded(finGeo, mat(P.fin, { side: THREE.DoubleSide }));
  shell.add(fin);
  // A stripe along its leading edge, the hull's own.
  const edge = shaded(new THREE.BoxGeometry(Math.hypot(FIN[3][0] - FIN[0][0], FIN[3][1] - FIN[0][1]), 0.022, 0.008), mat(P.stripe));
  edge.position.set((FIN[0][0] + FIN[3][0]) / 2, (FIN[0][1] + FIN[3][1]) / 2, 0);
  edge.rotation.z = Math.atan2(FIN[3][1] - FIN[0][1], FIN[3][0] - FIN[0][0]);
  shell.add(edge);

  // ---- her colors: a panel painted on each slope of the roof, the crew's flag when she flies one
  const plainFlag = kind === "other" ? PALETTE.parchment : PALETTE.brass;
  const flagMat = new THREE.MeshBasicMaterial({ color: plainFlag });
  const flags = [-1, 1].map((side) => {
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.07), flagMat);
    const at = onSlope(side);
    const lift = 0.004;
    flag.position.set(-0.12, at[1] + Math.cos(slope) * lift, at[2] + side * Math.sin(slope) * lift);
    // Face out along the slope, reading the right way round from that side.
    flag.rotation.set(side > 0 ? slope - Math.PI / 2 : Math.PI / 2 - slope, side > 0 ? 0 : Math.PI, 0);
    shell.add(flag);
    return flag;
  });
  body.add(shell);

  // ---- the engines' glow: a lit throat and a plume from each nozzle, shown under way
  // The group sits at the nozzles' mouths, so stretching it along x lengthens the plumes from there.
  const engineGlow = new THREE.Group();
  engineGlow.position.set(STERN_X - 0.148, NOZZLE_Y, 0);
  for (const z of nozzles) {
    const throat = new THREE.Mesh(new THREE.CircleGeometry(0.056, 10), new THREE.MeshBasicMaterial({ color: 0xd8f6ff }));
    throat.rotation.y = -Math.PI / 2;
    throat.position.set(-0.001, 0, z);
    engineGlow.add(throat);
    // Two blades of light crossed, so the plume shows from above and from the side.
    for (const turn of [0, Math.PI / 2]) {
      const plume = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.15),
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
  marker.position.set(0, MARKER_Y, 0);
  marker.visible = kind !== "other";
  body.add(marker);

  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.95, 0.62), unseen());
  hit.position.set(0.19, 0.45, 0);
  body.add(hit);
  // Her hull's own shape, roof and nose and all, so a tap is on her only where she is drawn: a box
  // round her would take taps on the dock and the rock that show past her shoulders.
  const whole: Outline = [...belly.slice(1, 5), [HULL_Z, WALL_TOP], [0.17, ROOF_Y], [-0.17, ROOF_Y], [-HULL_Z, WALL_TOP]];
  const hullHit = new THREE.Mesh(
    mergeGeometries([loft([{ x: STERN_X - 0.14, pts: shrink(whole, 0.8, 0.22) }, { x: STERN_X, pts: whole }, { x: BOW_X, pts: whole }]), loft([{ x: BOW_X, pts: section }, { x: 0.84, pts: shrink(section, 0.1, 0.2) }])]),
    unseen(),
  );
  body.add(hullHit);
  const deckHit = new THREE.Mesh(new THREE.BoxGeometry(length, 0.02, WALL_Z * 2), unseen());
  deckHit.position.set(midX, DECK_Y, 0);
  body.add(deckHit);
  const stationHits: THREE.Mesh[] = [];
  const stationHit = (key: Station | "helm", x: number, y: number, z: number, w: number, h: number, d: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), unseen());
    m.position.set(x, y, z);
    m.userData.station = key;
    body.add(m);
    stationHits.push(m);
  };
  stationHit("cooling", VENT.x, DECK_Y + 0.06, VENT.z, 0.09, 0.12, 0.08);
  stationHit("engines", (CORE_X + DRIVE_X) / 2, DECK_Y + 0.075, 0, 0.14, 0.15, 0.1);
  stationHit("plating", PATCH.x, DECK_Y + 0.04, PATCH.z, 0.12, 0.08, 0.08);
  stationHit("gunnery", TURRETS_X[0], DECK_Y + 0.04, 0.17, 0.08, 0.08, 0.08);
  stationHit("navigation", NAV.x, BRIDGE_Y + 0.04, NAV.z, 0.09, 0.08, 0.07);
  stationHit("helm", helmAt.x, helmAt.y, 0, 0.04, 0.12, 0.12);

  const anchors: Record<Station, THREE.Vector3> = {
    cooling: new THREE.Vector3(VENT.x, DECK_Y + 0.12, VENT.z),
    engines: new THREE.Vector3(CORE_X, DECK_Y + 0.16, 0),
    plating: new THREE.Vector3(PATCH.x, DECK_Y + 0.07, PATCH.z),
    gunnery: new THREE.Vector3(TURRETS_X[0], DECK_Y + 0.07, 0.18),
    navigation: new THREE.Vector3(NAV.x, BRIDGE_Y + 0.08, NAV.z),
  };
  const cutaway = (side: number | null): void => {
    shell.visible = side === null;
    walls.port.visible = side === null || side > 0;
    walls.starboard.visible = side === null || side < 0;
  };
  return { group, body, hit, hullHit, deckHit, stationHits, fin, flags, plainFlag, dressed: "", cutaway, engineGlow, marker, anchors, helm: helmAt, deck: skiffDeck() };
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
 * Dress a ship in its owner's crew colors (M6): the crew's flag painted on each slope of her roof
 * and its emblem on the tail fin, in the flag's field color, so a crew's ships read as one fleet on
 * the chart. Null strikes the colors. Painted with the same Canvas 2D code as the flags in the cards.
 */
export function dressShip(model: ShipModel, colors: CrewFlagWire | null): void {
  const key = colors ? flagKey(colors) : "";
  if (model.dressed === key) return;
  model.dressed = key;
  // The two panels share a material, so one map dresses both.
  const panel = model.flags[0]!;
  if (!colors) {
    setMap(panel, null, model.plainFlag);
    for (const f of model.flags) f.scale.set(1, 1, 1);
    setMap(model.fin, null, PALETTE.fin);
    return;
  }
  setMap(panel, canvasTexture(96, 64, (ctx) => drawFlag(ctx, colors, 96, 64)), model.plainFlag);
  // A panel is two by one; a crew flag is three by two.
  for (const f of model.flags) f.scale.set(1, 4 / 3, 1);
  const finHex = `#${PALETTE.fin.toString(16).padStart(6, "0")}`;
  setMap(
    model.fin,
    // The canvas is the shape of the fin's own box, so the emblem is not stretched.
    canvasTexture(164, 120, (ctx) => {
      ctx.fillStyle = finHex;
      ctx.fillRect(0, 0, 164, 120);
      // The middle of the blade, clear of its swept edges.
      drawEmblem(ctx, colors.emblem, 66, 60, 62, flagColor(colors.field), finHex);
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
