/**
 * The pieces of the world besides the islands (island.ts): ships, clouds, gulls and buoys as chunky
 * low-poly groups built from primitives. No art files; everything is geometry and flat color, so it
 * stays placeholder-art honest (DESIGN.md 3.10) while reading as a toy diorama. A ship's static
 * timbers are merged into one mesh (batch.ts); the parts that move or change stay their own.
 */
import * as THREE from "three";
import type { CrewFlagWire } from "@openseas/protocol";
import { drawEmblem, drawFlag, flagColor, flagKey } from "../crew/flag.js";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";
import { Batch } from "./batch.js";
import { WalkGrid, type Obstacle, type Spot } from "./walk.js";

export type { Building } from "./island.js";

export const PALETTE = {
  seaDeep: 0x0e4a63,
  seaShallow: 0x2aa3a8,
  foam: 0xe4f7f1,
  sand: 0xeadc9f,
  sandDark: 0x5a5460,
  grass: 0x63b35d,
  grassDark: 0x3f8f49,
  grassGold: 0xc9b454,
  rock: 0x8d8372,
  basalt: 0x3b3640,
  trunk: 0x8a5a2b,
  frond: 0x3c9a4e,
  wood: 0x9a6a3a,
  woodDark: 0x6b4423,
  wall: 0xf2e6c8,
  roof: 0xb84a3c,
  roofBlue: 0x3e6f9a,
  hull: 0x5c3c1f,
  gunwale: 0x8a5a2b,
  deck: 0xcaa36e,
  sail: 0xf4f1e6,
  brass: 0xd4a548,
  iron: 0x2e3238,
  parchment: 0xefe3c6,
  cloud: 0xffffff,
  lightTower: 0xf7f1e4,
  lightBand: 0xc94a3d,
  lamp: 0xffd36b,
  lampOff: 0x6b5a2a,
  lava: 0xff7a3d,
  smoke: 0x9aa0a8,
  pirate: 0xe08a5a,
  pirateCoat: 0x2f4b8f,
  mateSmock: 0xd9cfae,
  mateKerchief: 0x7a3b3b,
  rope: 0xb8945a,
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

export type Station = "bilging" | "sailing" | "carpentry" | "gunnery" | "navigation";
export const STATION_ORDER: readonly Station[] = ["bilging", "sailing", "carpentry", "gunnery", "navigation"];

/** A sloop's size in the world: big enough that a crew of pirates can walk its deck. */
export const SHIP_SCALE = 1.15;
/** How far the hull sits down in the water. */
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
  /** Behind the wheel, the captain's place. */
  helm: DeckPost;
  /** Where hands with nothing to do stand about, by index. */
  idle: Spot[];
  /** The gap in the rail amidships on the given side (+1 starboard, -1 port), where the gangplank comes aboard. */
  gangway(side: number): Spot;
}

export interface ShipModel {
  group: THREE.Group;
  /** The hull and everything on it; the bob is applied here so the group's frame stays steady for labels. */
  body: THREE.Group;
  /** A generous box round the whole ship, for picking her out on the chart. */
  hit: THREE.Mesh;
  /** Just the hull and deck, for taps up close where the ground around her must stay walkable. */
  hullHit: THREE.Mesh;
  /** The deck's top, for taps to walk. */
  deckHit: THREE.Mesh;
  /** Invisible boxes over each station's gear and the wheel, for taps on the thing itself. */
  stationHits: THREE.Mesh[];
  sail: THREE.Mesh;
  /** The canvas: main, jib and seams. On deck it goes to glass so it never hides a station. */
  canvas: THREE.Mesh[];
  flag: THREE.Mesh;
  /** The flag's own color when the ship flies no crew's colors. */
  plainFlag: number;
  /** The colors the ship is dressed in now, by flag key, or "" for none. */
  dressed: string;
  wake: THREE.Mesh;
  marker: THREE.Mesh;
  /** Where each station's label hangs, in the body's frame. */
  anchors: Record<Station, THREE.Vector3>;
  /** The wheel, in the body's frame. */
  wheel: THREE.Vector3;
  deck: ShipDeck;
}

const DECK_Y = 0.3;
const QUARTER_Y = 0.37;
/** The quarterdeck's forward edge and the foot of its steps. */
const QUARTER_X = -0.17;
const STEPS_FOOT_X = -0.1;
const STEPS_HALF = 0.05;
const GANGWAY_X = 0.04;
/** The masthead: short enough that a docked sloop does not tower over the town. */
const MAST_TOP = 1.05;

/**
 * A sloop with its stations laid out on a deck a crew can walk: a raised quarterdeck aft with the
 * wheel and the chart table, steps down to the main deck, the mast and its pin rail amidships, the
 * pump to port, a gun pair each side, the carpenter's bench forward, and a gangway port in each rail.
 * The flag's color says whose it is.
 */
export function buildShip(kind: "yours" | "aboard" | "other", shadows = true): ShipModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(SHIP_SCALE);
  body.position.y = -SHIP_SINK;
  group.add(body);
  const b = new Batch();

  // ---- the hull
  b.add(new THREE.BoxGeometry(0.9, 0.24, 0.36), PALETTE.hull, { p: [0, 0.12, 0] });
  for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.91, 0.006, 0.365), 0x3f2814, { p: [0, 0.05 + i * 0.06, 0] });
  b.add(new THREE.ConeGeometry(0.18, 0.4, 4), PALETTE.hull, { p: [0.64, 0.12, 0], r: [Math.PI / 4, 0, -Math.PI / 2], s: [1, 1, 0.66] });
  b.add(new THREE.CylinderGeometry(0.012, 0.018, 0.4, 5), PALETTE.trunk, { p: [0.9, 0.32, 0], r: [0, 0, -Math.PI / 2 + 0.25] });
  b.add(new THREE.SphereGeometry(0.035, 6, 5), PALETTE.brass, { p: [0.84, 0.25, 0] });
  b.add(new THREE.BoxGeometry(0.03, 0.18, 0.08), PALETTE.trunk, { p: [-0.47, 0.06, 0] });
  b.add(new THREE.BoxGeometry(0.92, 0.04, 0.37), PALETTE.brass, { p: [0, 0.2, 0] });
  b.add(new THREE.BoxGeometry(0.92, 0.05, 0.4), PALETTE.gunwale, { p: [0, 0.26, 0] });
  b.add(new THREE.BoxGeometry(0.84, 0.03, 0.3), PALETTE.deck, { p: [0, 0.285, 0] });
  for (let i = 0; i < 5; i++) b.add(new THREE.BoxGeometry(0.84, 0.004, 0.004), 0x9a7a4c, { p: [0, 0.302, -0.12 + i * 0.06] });
  // Gun ports on the hull sides.
  for (const side of [-1, 1]) for (const x of [-0.05, 0.17]) b.add(new THREE.BoxGeometry(0.06, 0.05, 0.01), 0x1b1208, { p: [x, 0.16, side * 0.183] });

  // ---- the quarterdeck: raised aft, a door either side of the steps, windows in the transom
  const qLen = QUARTER_X + 0.42;
  b.add(new THREE.BoxGeometry(qLen, QUARTER_Y - DECK_Y, 0.3), PALETTE.wood, { p: [QUARTER_X - qLen / 2, (DECK_Y + QUARTER_Y) / 2, 0] });
  b.add(new THREE.BoxGeometry(qLen, 0.006, 0.3), PALETTE.deck, { p: [QUARTER_X - qLen / 2, QUARTER_Y, 0] });
  for (let i = 0; i < 4; i++) b.add(new THREE.BoxGeometry(qLen, 0.003, 0.003), 0x9a7a4c, { p: [QUARTER_X - qLen / 2, QUARTER_Y + 0.004, -0.09 + i * 0.06] });
  for (const z of [-0.1, 0.1]) {
    b.add(new THREE.BoxGeometry(0.006, 0.05, 0.036), 0x3a2414, { p: [QUARTER_X + 0.003, DECK_Y + 0.026, z] });
    b.add(new THREE.BoxGeometry(0.004, 0.004, 0.004), PALETTE.brass, { p: [QUARTER_X + 0.007, DECK_Y + 0.026, z + 0.01] });
  }
  for (const z of [-0.08, 0.0, 0.08]) b.addGlow(new THREE.BoxGeometry(0.008, 0.035, 0.04), 0xffe9a8, { p: [-0.452, 0.2, z] });
  // Three steps up, with a banister each side.
  const rise = (QUARTER_Y - DECK_Y) / 3;
  const run = (STEPS_FOOT_X - QUARTER_X) / 2;
  for (let i = 0; i < 2; i++) {
    const top = DECK_Y + rise * (i + 1);
    const x0 = STEPS_FOOT_X - run * (i + 1);
    b.add(new THREE.BoxGeometry(run, top - DECK_Y, STEPS_HALF * 2), i ? PALETTE.wood : PALETTE.deck, { p: [x0 + run / 2, (top + DECK_Y) / 2, 0] });
  }
  for (const side of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.008, 0.06, 0.008), PALETTE.trunk, { p: [STEPS_FOOT_X - 0.004, DECK_Y + 0.03, side * STEPS_HALF] });
    b.add(new THREE.BoxGeometry(0.085, 0.007, 0.007), PALETTE.trunk, { p: [(STEPS_FOOT_X + QUARTER_X) / 2, DECK_Y + 0.085, side * STEPS_HALF], r: [0, 0, -0.75] });
  }
  // The quarterdeck's rail: across its front either side of the steps, and along its sides.
  for (const side of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.008, 0.012, 0.1), PALETTE.trunk, { p: [QUARTER_X, QUARTER_Y + 0.055, side * 0.1] });
    for (const z of [0.055, 0.145]) b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.055, 4), PALETTE.trunk, { p: [QUARTER_X, QUARTER_Y + 0.027, side * z] });
    for (const x of [-0.41, -0.33, -0.25, QUARTER_X]) b.add(new THREE.CylinderGeometry(0.007, 0.007, 0.06, 4), PALETTE.trunk, { p: [x, QUARTER_Y + 0.03, side * 0.19] });
    b.add(new THREE.BoxGeometry(qLen, 0.012, 0.012), PALETTE.trunk, { p: [QUARTER_X - qLen / 2, QUARTER_Y + 0.06, side * 0.19] });
    // The main deck's rail, with the gangway port left open amidships.
    for (const x of [QUARTER_X + 0.02, -0.08, GANGWAY_X - 0.035, GANGWAY_X + 0.035, 0.16, 0.27, 0.38]) b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 4), PALETTE.trunk, { p: [x, 0.32, side * 0.19] });
    const aftLen = GANGWAY_X - 0.035 - (QUARTER_X + 0.02);
    b.add(new THREE.BoxGeometry(aftLen, 0.012, 0.012), PALETTE.trunk, { p: [QUARTER_X + 0.02 + aftLen / 2, 0.355, side * 0.19] });
    const foreLen = 0.4 - (GANGWAY_X + 0.035);
    b.add(new THREE.BoxGeometry(foreLen, 0.012, 0.012), PALETTE.trunk, { p: [GANGWAY_X + 0.035 + foreLen / 2, 0.355, side * 0.19] });
    // Stern lanterns.
    b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 4), PALETTE.iron, { p: [-0.41, QUARTER_Y + 0.04, side * 0.13] });
    b.addGlow(new THREE.SphereGeometry(0.016, 6, 5), PALETTE.lamp, { p: [-0.41, QUARTER_Y + 0.09, side * 0.13] });
  }

  // ---- the wheel and the chart table on the quarterdeck
  const wheelAt = new THREE.Vector3(-0.24, QUARTER_Y + 0.085, 0);
  b.add(new THREE.CylinderGeometry(0.009, 0.012, 0.08, 6), PALETTE.trunk, { p: [wheelAt.x + 0.012, QUARTER_Y + 0.04, 0] });
  b.add(new THREE.TorusGeometry(0.042, 0.007, 5, 12), PALETTE.trunk, { p: [wheelAt.x, wheelAt.y, 0], r: [0, Math.PI / 2, 0] });
  for (let i = 0; i < 4; i++) b.add(new THREE.BoxGeometry(0.004, 0.1, 0.004), PALETTE.trunk, { p: [wheelAt.x, wheelAt.y, 0], r: [(i * Math.PI) / 4, 0, 0] });
  b.add(new THREE.SphereGeometry(0.008, 6, 5), PALETTE.brass, { p: [wheelAt.x, wheelAt.y, 0] });
  const tableAt = { x: -0.37, z: 0.095 };
  b.add(new THREE.BoxGeometry(0.075, 0.05, 0.055), PALETTE.wood, { p: [tableAt.x, QUARTER_Y + 0.025, tableAt.z] });
  b.add(new THREE.BoxGeometry(0.07, 0.004, 0.05), PALETTE.parchment, { p: [tableAt.x, QUARTER_Y + 0.052, tableAt.z], r: [0, 0.1, 0] });
  b.add(new THREE.CylinderGeometry(0.01, 0.01, 0.006, 8), PALETTE.brass, { p: [tableAt.x + 0.02, QUARTER_Y + 0.056, tableAt.z + 0.012] });
  b.add(new THREE.BoxGeometry(0.03, 0.003, 0.004), 0x3a2414, { p: [tableAt.x - 0.01, QUARTER_Y + 0.056, tableAt.z - 0.01], r: [0, 0.6, 0] });

  // ---- the main deck: the mast's pin rail, the pump, the guns, the bench, a hatch, stores
  const mastX = 0.1;
  // The fife rail aft of the mast: two posts, a rail of belaying pins, coils of line hung on it.
  for (const z of [-0.045, 0.045]) b.add(new THREE.BoxGeometry(0.012, 0.05, 0.012), PALETTE.trunk, { p: [mastX - 0.04, DECK_Y + 0.025, z] });
  b.add(new THREE.BoxGeometry(0.016, 0.01, 0.11), PALETTE.wood, { p: [mastX - 0.04, DECK_Y + 0.05, 0] });
  for (let i = 0; i < 5; i++) b.add(new THREE.CylinderGeometry(0.003, 0.003, 0.026, 4), PALETTE.brass, { p: [mastX - 0.04, DECK_Y + 0.055, -0.04 + i * 0.02] });
  for (const z of [-0.03, 0.01]) b.add(new THREE.TorusGeometry(0.011, 0.003, 4, 8), PALETTE.rope, { p: [mastX - 0.048, DECK_Y + 0.035, z], r: [0, Math.PI / 2, 0] });
  for (const side of [-1, 1]) b.add(new THREE.CylinderGeometry(0.02, 0.022, 0.035, 8), PALETTE.rope, { p: [mastX + 0.035, 0.318, side * 0.06] });
  const pumpAt = { x: 0.25, z: -0.085 };
  b.add(new THREE.BoxGeometry(0.06, 0.06, 0.06), PALETTE.iron, { p: [pumpAt.x, DECK_Y + 0.03, pumpAt.z] });
  b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 7), PALETTE.iron, { p: [pumpAt.x, DECK_Y + 0.085, pumpAt.z] });
  b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 5), PALETTE.trunk, { p: [pumpAt.x - 0.03, DECK_Y + 0.105, pumpAt.z], r: [0, 0, Math.PI / 2 - 0.25] });
  b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 5), PALETTE.iron, { p: [pumpAt.x + 0.03, DECK_Y + 0.03, pumpAt.z + 0.035], r: [Math.PI / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.02, 0.016, 0.034, 7), PALETTE.wood, { p: [pumpAt.x + 0.055, DECK_Y + 0.017, pumpAt.z + 0.03] });
  const guns = [-0.05, 0.17];
  for (const side of [-1, 1]) {
    for (const x of guns) {
      b.add(new THREE.BoxGeometry(0.055, 0.025, 0.05), PALETTE.wood, { p: [x, DECK_Y + 0.0125, side * 0.118] });
      for (const dx of [-0.02, 0.02]) b.add(new THREE.CylinderGeometry(0.01, 0.01, 0.006, 7), PALETTE.woodDark, { p: [x + dx, DECK_Y + 0.008, side * 0.096], r: [Math.PI / 2, 0, 0] });
      b.add(new THREE.CylinderGeometry(0.015, 0.02, 0.11, 8), PALETTE.iron, { p: [x, DECK_Y + 0.04, side * 0.14], r: [Math.PI / 2, 0, 0] });
    }
  }
  // A shot rack and rammer by the starboard aft gun, where the gunner stands.
  for (let i = 0; i < 3; i++) b.add(new THREE.SphereGeometry(0.009, 6, 4), PALETTE.iron, { p: [-0.1 + i * 0.019, DECK_Y + 0.009, 0.085] });
  const benchAt = { x: 0.37, z: 0.075 };
  b.add(new THREE.BoxGeometry(0.1, 0.045, 0.05), PALETTE.wood, { p: [benchAt.x, DECK_Y + 0.0225, benchAt.z] });
  b.add(new THREE.BoxGeometry(0.12, 0.01, 0.028), PALETTE.deck, { p: [benchAt.x, DECK_Y + 0.05, benchAt.z], r: [0, 0.25, 0] });
  b.add(new THREE.BoxGeometry(0.026, 0.016, 0.016), PALETTE.iron, { p: [benchAt.x + 0.03, DECK_Y + 0.055, benchAt.z - 0.012] });
  b.add(new THREE.BoxGeometry(0.004, 0.004, 0.03), PALETTE.trunk, { p: [benchAt.x + 0.03, DECK_Y + 0.055, benchAt.z + 0.008] });
  for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.1, 0.008, 0.02), i % 2 ? PALETTE.deck : PALETTE.wood, { p: [benchAt.x - 0.005, DECK_Y + 0.004 + i * 0.008, benchAt.z + 0.045] });
  // The hatch.
  b.add(new THREE.BoxGeometry(0.08, 0.006, 0.07), PALETTE.trunk, { p: [0.24, DECK_Y + 0.003, 0.045] });
  for (let i = 0; i < 4; i++) b.add(new THREE.BoxGeometry(0.004, 0.003, 0.066), 0x3a2414, { p: [0.21 + i * 0.02, DECK_Y + 0.0065, 0.045] });
  // Stores.
  for (const [x, z] of [
    [0.31, -0.122],
    [0.335, -0.1],
  ] as const) {
    b.add(new THREE.CylinderGeometry(0.019, 0.019, 0.045, 8), PALETTE.wood, { p: [x, DECK_Y + 0.0225, z] });
    b.add(new THREE.CylinderGeometry(0.0195, 0.0195, 0.004, 8), PALETTE.iron, { p: [x, DECK_Y + 0.035, z] });
  }
  b.add(new THREE.BoxGeometry(0.045, 0.04, 0.045), PALETTE.deck, { p: [-0.12, DECK_Y + 0.02, -0.11], r: [0, 0.3, 0] });

  // ---- mast, boom, gaff and rigging
  b.add(new THREE.CylinderGeometry(0.018, 0.027, MAST_TOP - 0.28, 6), PALETTE.trunk, { p: [mastX, (MAST_TOP + 0.28) / 2, 0] });
  b.add(new THREE.CylinderGeometry(0.032, 0.032, 0.018, 6), PALETTE.wood, { p: [mastX, MAST_TOP - 0.06, 0] });
  b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.5, 5), PALETTE.trunk, { p: [-0.15, 0.5, 0.02], r: [0, 0, Math.PI / 2] });
  b.add(new THREE.CylinderGeometry(0.009, 0.009, 0.44, 5), PALETTE.trunk, { p: [-0.11, MAST_TOP - 0.06, 0.02], r: [0, 0, Math.PI / 2 + 0.3] });
  const solid = b.build(shadows);
  body.add(solid);

  const ropeMat = new THREE.LineBasicMaterial({ color: 0x3a2a18 });
  const rigging: THREE.Vector3[] = [];
  for (const side of [-1, 1]) for (const x of [-0.06, 0.06]) rigging.push(new THREE.Vector3(mastX, MAST_TOP - 0.06, 0), new THREE.Vector3(mastX + x, 0.32, side * 0.19));
  rigging.push(new THREE.Vector3(mastX, MAST_TOP - 0.02, 0), new THREE.Vector3(1.05, 0.38, 0));
  rigging.push(new THREE.Vector3(mastX, MAST_TOP - 0.1, 0), new THREE.Vector3(-0.42, QUARTER_Y + 0.06, 0));
  body.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rigging), ropeMat));

  // ---- the sails: main and jib, and the seams across the main
  const sailH = MAST_TOP - 0.06 - 0.52;
  const sailGeo = new THREE.PlaneGeometry(0.46, sailH, 6, 6);
  const pos = sailGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, -0.09 * Math.cos((x / 0.46) * Math.PI) * Math.cos((y / sailH) * Math.PI));
  }
  sailGeo.computeVertexNormals();
  const sail = shaded(sailGeo, mat(PALETTE.sail, { side: THREE.DoubleSide, transparent: true }));
  sail.position.set(-0.14, 0.52 + sailH / 2, 0.02);
  body.add(sail);
  const canvas: THREE.Mesh[] = [sail];
  for (let i = 1; i < 4; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.004, 0.002), new THREE.MeshBasicMaterial({ color: 0xcfc6ad, transparent: true }));
    seam.position.set(-0.14, 0.52 + (i * sailH) / 4, 0.07);
    body.add(seam);
    canvas.push(seam);
  }
  const jibShape = new THREE.Shape();
  jibShape.moveTo(0, 0);
  jibShape.lineTo(0.5, 0);
  jibShape.lineTo(0, MAST_TOP - 0.52);
  jibShape.closePath();
  const jib = shaded(new THREE.ShapeGeometry(jibShape), mat(PALETTE.sail, { side: THREE.DoubleSide, transparent: true }));
  jib.position.set(mastX + 0.06, 0.46, -0.02);
  jib.rotation.y = -0.15;
  body.add(jib);
  canvas.push(jib);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09, 3, 1),
    new THREE.MeshBasicMaterial({ color: kind === "other" ? PALETTE.parchment : PALETTE.brass, side: THREE.DoubleSide }),
  );
  flag.position.set(mastX - 0.09, MAST_TOP + 0.08, 0);
  body.add(flag);

  const wake = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.55), new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, opacity: 0.55, depthWrite: false }));
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(-0.95, 0.09, 0);
  wake.visible = false;
  body.add(wake);

  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), new THREE.MeshBasicMaterial({ color: PALETTE.brass }));
  marker.rotation.x = Math.PI;
  marker.position.set(mastX, MAST_TOP + 0.38, 0);
  marker.visible = kind !== "other";
  body.add(marker);

  const invisible = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.4, 0.55), invisible());
  hit.position.y = 0.7;
  body.add(hit);
  const hullHit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.42, 0.4), invisible());
  hullHit.position.set(0.02, 0.21, 0);
  body.add(hullHit);
  const deckHit = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.02, 0.32), invisible());
  deckHit.position.y = DECK_Y;
  body.add(deckHit);
  const stationHits: THREE.Mesh[] = [];
  const stationHit = (key: Station | "wheel", x: number, y: number, z: number, w: number, h: number, d: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), invisible());
    m.position.set(x, y, z);
    m.userData.station = key;
    body.add(m);
    stationHits.push(m);
  };
  stationHit("bilging", pumpAt.x, DECK_Y + 0.06, pumpAt.z, 0.09, 0.12, 0.08);
  stationHit("sailing", mastX, DECK_Y + 0.1, 0, 0.12, 0.2, 0.12);
  stationHit("carpentry", benchAt.x, DECK_Y + 0.04, benchAt.z, 0.12, 0.08, 0.08);
  stationHit("gunnery", guns[0]!, DECK_Y + 0.04, 0.12, 0.08, 0.08, 0.08);
  stationHit("navigation", tableAt.x, QUARTER_Y + 0.04, tableAt.z, 0.09, 0.08, 0.07);
  stationHit("wheel", wheelAt.x, wheelAt.y, 0, 0.04, 0.12, 0.12);

  // ---- where a pirate may walk on deck
  const PAD = 0.016;
  const heightAt = (x: number, z: number): number => {
    if (x < QUARTER_X) return QUARTER_Y;
    if (x < STEPS_FOOT_X && Math.abs(z) < STEPS_HALF) return DECK_Y + ((QUARTER_Y - DECK_Y) * (STEPS_FOOT_X - x)) / (STEPS_FOOT_X - QUARTER_X);
    return DECK_Y;
  };
  const grid = new WalkGrid(-0.44, -0.16, 0.44, 0.16, 0.011).fill((x, z) => (x >= QUARTER_X && x <= 0.41 && Math.abs(z) <= 0.135) || (x >= -0.41 && x < QUARTER_X && Math.abs(z) <= 0.13));
  const obstacles: Obstacle[] = [
    // The quarterdeck's front, but for the steps, and the banisters beside them.
    { kind: "box", x: QUARTER_X, z: 0.1, hw: 0.006, hd: 0.05, angle: 0 },
    { kind: "box", x: QUARTER_X, z: -0.1, hw: 0.006, hd: 0.05, angle: 0 },
    { kind: "box", x: (QUARTER_X + STEPS_FOOT_X) / 2, z: STEPS_HALF, hw: (STEPS_FOOT_X - QUARTER_X) / 2, hd: 0.004, angle: 0 },
    { kind: "box", x: (QUARTER_X + STEPS_FOOT_X) / 2, z: -STEPS_HALF, hw: (STEPS_FOOT_X - QUARTER_X) / 2, hd: 0.004, angle: 0 },
    { kind: "circle", x: mastX, z: 0, r: 0.03 },
    { kind: "box", x: mastX - 0.04, z: 0, hw: 0.01, hd: 0.055, angle: 0 },
    { kind: "circle", x: mastX + 0.035, z: 0.06, r: 0.022 },
    { kind: "circle", x: mastX + 0.035, z: -0.06, r: 0.022 },
    { kind: "box", x: pumpAt.x + 0.01, z: pumpAt.z + 0.005, hw: 0.045, hd: 0.035, angle: 0 },
    { kind: "box", x: benchAt.x, z: benchAt.z + 0.01, hw: 0.05, hd: 0.04, angle: 0 },
    { kind: "circle", x: 0.32, z: -0.11, r: 0.03 },
    { kind: "box", x: -0.12, z: -0.11, hw: 0.025, hd: 0.025, angle: 0.3 },
    { kind: "box", x: wheelAt.x + 0.006, z: 0, hw: 0.01, hd: 0.045, angle: 0 },
    { kind: "box", x: tableAt.x, z: tableAt.z, hw: 0.04, hd: 0.03, angle: 0 },
    { kind: "circle", x: -0.41, z: 0.13, r: 0.008 },
    { kind: "circle", x: -0.41, z: -0.13, r: 0.008 },
  ];
  for (const side of [-1, 1]) for (const x of guns) obstacles.push({ kind: "box", x, z: side * 0.125, hw: 0.03, hd: 0.03, angle: 0 });
  for (const o of obstacles) grid.block(o, PAD);

  const anchors: Record<Station, THREE.Vector3> = {
    bilging: new THREE.Vector3(pumpAt.x, DECK_Y + 0.12, pumpAt.z),
    sailing: new THREE.Vector3(mastX, 0.55, 0),
    carpentry: new THREE.Vector3(benchAt.x, DECK_Y + 0.07, benchAt.z),
    gunnery: new THREE.Vector3(guns[0]!, DECK_Y + 0.07, 0.13),
    navigation: new THREE.Vector3(tableAt.x, QUARTER_Y + 0.08, tableAt.z),
  };
  const deck: ShipDeck = {
    grid,
    heightAt,
    stations: {
      bilging: { at: { x: pumpAt.x - 0.064, z: pumpAt.z }, face: 0 },
      sailing: { at: { x: mastX, z: -0.081 }, face: Math.PI / 2 },
      carpentry: { at: { x: benchAt.x, z: benchAt.z - 0.062 }, face: Math.PI / 2 },
      gunnery: { at: { x: guns[0]!, z: 0.07 }, face: Math.PI / 2 },
      navigation: { at: { x: tableAt.x, z: tableAt.z - 0.058 }, face: Math.PI / 2 },
    },
    helm: { at: { x: wheelAt.x - 0.06, z: 0 }, face: 0 },
    idle: [
      { x: 0.0, z: 0.0 },
      { x: 0.2, z: 0.05 },
      { x: -0.12, z: 0.05 },
      { x: 0.3, z: -0.02 },
      { x: -0.05, z: -0.07 },
      { x: 0.03, z: 0.06 },
    ],
    gangway: (side) => ({ x: GANGWAY_X, z: side * 0.118 }),
  };
  const plainFlag = kind === "other" ? PALETTE.parchment : PALETTE.brass;
  return { group, body, hit, hullHit, deckHit, stationHits, sail, canvas, flag, plainFlag, dressed: "", wake, marker, anchors, wheel: wheelAt, deck };
}

/** A gangplank from the dock's edge up to a ship's gangway, built in the island's dock frame. */
export function buildGangplank(from: THREE.Vector3, to: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const span = to.clone().sub(from);
  const length = span.length();
  const plank = shaded(new THREE.BoxGeometry(length, 0.012, 0.06), mat(PALETTE.wood));
  plank.position.copy(from).addScaledVector(span, 0.5);
  plank.rotation.order = "YZX";
  plank.rotation.y = -Math.atan2(span.z, span.x);
  plank.rotation.z = Math.atan2(span.y, Math.hypot(span.x, span.z));
  g.add(plank);
  for (let i = 1; i < 4; i++) {
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.058), mat(PALETTE.trunk));
    cleat.position.copy(from).addScaledVector(span, i / 4);
    cleat.position.y += 0.008;
    cleat.rotation.y = plank.rotation.y;
    g.add(cleat);
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
 * Dress a ship in its owner's crew colors (M6): the crew's flag at the masthead and its emblem
 * across the mainsail, in the flag's field color, so a crew's ships read as one fleet on the chart.
 * Null strikes the colors. Painted with the same Canvas 2D code as the flags in the cards.
 */
export function dressShip(model: ShipModel, colors: CrewFlagWire | null): void {
  const key = colors ? flagKey(colors) : "";
  if (model.dressed === key) return;
  model.dressed = key;
  if (!colors) {
    setMap(model.flag, null, model.plainFlag);
    model.flag.scale.set(1, 1, 1);
    setMap(model.sail, null, PALETTE.sail);
    return;
  }
  setMap(model.flag, canvasTexture(96, 64, (ctx) => drawFlag(ctx, colors, 96, 64)), model.plainFlag);
  // The flag's plane is two by one; a crew flag is three by two.
  model.flag.scale.set(1, 4 / 3, 1);
  const sailHex = `#${PALETTE.sail.toString(16).padStart(6, "0")}`;
  setMap(
    model.sail,
    canvasTexture(112, 124, (ctx) => {
      ctx.fillStyle = sailHex;
      ctx.fillRect(0, 0, 112, 124);
      drawEmblem(ctx, colors.emblem, 56, 64, 78, flagColor(colors.field), sailHex);
    }),
    PALETTE.sail,
  );
}

let wakeTex: THREE.Texture | null = null;
function wakeTexture(): THREE.Texture {
  if (wakeTex) return wakeTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(128, 0, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(128, 20);
  g.lineTo(0, 2);
  g.lineTo(0, 46);
  g.lineTo(128, 28);
  g.closePath();
  g.fill();
  wakeTex = new THREE.CanvasTexture(c);
  wakeTex.colorSpace = THREE.SRGBColorSpace;
  return wakeTex;
}

export function buildCloud(seed: string): THREE.Group {
  const dice = new Dice(`cloud:${seed}`);
  const g = new THREE.Group();
  const puffs = 3 + dice.int(3);
  for (let i = 0; i < puffs; i++) {
    const r = 0.3 + dice.range(0, 0.4);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat(PALETTE.cloud, { transparent: true, opacity: 0.92 }));
    puff.scale.y = 0.55;
    puff.position.set(i * 0.42 - (puffs * 0.42) / 2 + dice.range(-0.1, 0.1), dice.range(-0.08, 0.08), dice.range(-0.15, 0.15));
    puff.castShadow = true;
    g.add(puff);
  }
  return g;
}

export interface GullModel {
  group: THREE.Group;
  left: THREE.Mesh;
  right: THREE.Mesh;
}

export function buildGull(): GullModel {
  const group = new THREE.Group();
  const wing = (): THREE.Mesh => new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), new THREE.MeshBasicMaterial({ color: PALETTE.cloud, side: THREE.DoubleSide }));
  const left = wing();
  left.position.x = -0.08;
  const right = wing();
  right.position.x = 0.08;
  group.add(left, right);
  return { group, left, right };
}

/** A buoy marking a sea lane's midpoint. */
export function buildBuoy(): THREE.Group {
  const g = new THREE.Group();
  const body = shaded(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 7), mat(PALETTE.lightBand));
  body.position.y = 0.08;
  g.add(body);
  const post = shaded(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5), mat(PALETTE.iron));
  post.position.y = 0.23;
  g.add(post);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
  lamp.position.y = 0.33;
  g.add(lamp);
  return g;
}
