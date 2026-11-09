/**
 * An outpost you can walk on (M5, ADR 0032). The ground is a low-poly heightfield: a grassy rise,
 * a ring of beach, a wet edge sloping under the sea. On it, laid out from the dock inland: the dock
 * on its pilings with berths for ships either side, the shipwright's and the notice board at its
 * foot, a path up to a cobbled plaza with a well, the cantina on the plaza, cottages with their
 * gardens, the landmark the content names at the back, and the small things that make a place: palms,
 * nets, a beached boat, lanterns, crabs on the sand. Everything is placed from a PRNG seeded by the
 * outpost's id, so every device builds the same outpost, the same walk grid, the same doors.
 *
 * The outpost is built in its *dock frame*: u runs out along the dock toward the sea lanes, w across
 * it, y up. Walk positions on the wire are in this frame. The frame is turned on the outpost so the
 * dock faces the other outposts.
 */
import * as THREE from "three";
import type { OutpostLandmark } from "@openseas/content";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";
import { Batch, type Put } from "./batch.js";
import { WalkGrid, type Obstacle, type Spot } from "./walk.js";

export type Building = "dock" | "cantina" | "notice-board";

export const OUTPOST_PALETTE = {
  sand: 0xeadc9f,
  sandWet: 0xcdbb80,
  sandDark: 0x5a5460,
  sandDarkWet: 0x46424c,
  grass: 0x63b35d,
  grassDark: 0x3f8f49,
  grassGold: 0xc9b454,
  basalt: 0x3b3640,
  rock: 0x8d8372,
  rockLight: 0xa69c88,
  path: 0xd8c48a,
  cobble: 0xc4b79a,
  cobbleDark: 0xa99c80,
  trunk: 0x8a5a2b,
  frond: 0x3c9a4e,
  wood: 0x9a6a3a,
  woodDark: 0x6b4423,
  plank: 0xb5844e,
  wall: 0xf2e6c8,
  timber: 0x5c3c1f,
  roof: 0xb84a3c,
  roofBlue: 0x3e6f9a,
  roofDark: 0x7a3229,
  iron: 0x2e3238,
  brass: 0xd4a548,
  parchment: 0xefe3c6,
  lamp: 0xffd36b,
  lampOff: 0x6b5a2a,
  window: 0xffe9a8,
  lava: 0xff7a3d,
  smoke: 0x9aa0a8,
  canvas: 0xf4f1e6,
  crab: 0xd9573a,
  flowerPink: 0xf2c4d8,
  flowerWhite: 0xf6f2e6,
  flowerYellow: 0xf2cf4a,
  lightTower: 0xf7f1e4,
  lightBand: 0xc94a3d,
} as const;
const C = OUTPOST_PALETTE;

/** The dock's deck: from the beach out over the water, and how wide. */
export const DOCK = { from: 1.16, to: 2.95, half: 0.13, top: 0.22 } as const;
/** Where a ship lies along the dock, and how far off its centerline the first two berths are. */
const BERTH_U = 2.22;
const BERTH_W = 0.53;
const BERTH_ROW = 0.7;
/** Ship-local x of the airlock amidships, scaled to the world (see models.ts). */
export const AIRLOCK_OFFSET = 0.056;
/** Feet clear an obstacle by this much. */
const BODY = 0.026;

export interface Berth {
  /** The ship's center in the dock frame. */
  u: number;
  w: number;
  /** Which way the bow points, as an angle in the dock frame. */
  heading: number;
  /** The boarding tube's foot on the dock, for a ship lying against it; null for one rafted further out. */
  foot: Spot | null;
  /** Which of her sides (in her own frame: +1 starboard, -1 port) faces the dock. */
  dockSide: number;
}

export interface Door {
  /** Where a pirate stands to use the building, in the dock frame: outside its door. */
  at: Spot;
  /** The way they face there. */
  face: number;
  /** Just inside the door, where a pirate who goes in ends up out of sight; null for a building nobody enters (a notice board). */
  inside: Spot | null;
}

/** A door that swings open on its hinge as a pirate passes through. */
export interface Doorway {
  pivot: THREE.Group;
  /** The hinge's turn when shut. */
  yaw: number;
  /** How far open it is now, 0 to 1. */
  open: number;
}

export interface OutpostModel {
  group: THREE.Group;
  /** Turned so its +x runs out along the dock; walkers and everything else of the outpost hang here. */
  frame: THREE.Group;
  /** Flat disc under the outpost that widens the tap target on the chart. */
  hit: THREE.Mesh;
  /** What a tap to walk lands on: the ground and the dock's deck. */
  walkable: THREE.Object3D[];
  /** Invisible boxes over each building, for taps on the building itself. */
  buildingHits: THREE.Mesh[];
  ring: THREE.Mesh;
  reachRing: THREE.Mesh;
  flag: THREE.Group;
  /** Where each building's label hangs, in the outpost group's frame. */
  anchors: Record<Building, THREE.Vector3>;
  /** Direction from the outpost center to its dock, in the world's xz plane. */
  dockDir: THREE.Vector2;
  dockAngle: number;
  grid: WalkGrid;
  /** The height of the ground (or the dock) under a spot in the dock frame. */
  heightAt(u: number, w: number): number;
  doors: Record<Building, Door>;
  /** The doors that open, by building. */
  doorways: Partial<Record<Building, Doorway>>;
  /** Where a pirate who came on the outpost without walking off a ship first stands. */
  arrival: Spot;
  berth(n: number): Berth;
  /** Per-frame life: lamps, the landmark, smoke, crabs. */
  animate(t: number, dt: number): void;
}

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
  range(lo: number, hi: number): number {
    return lo + ((hi - lo) * this.int(1000)) / 1000;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)]!;
  }
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 7): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);
const ball = (r: number, w = 7, h = 5): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);
const cone = (r: number, h: number, seg = 6): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);

/** The rotation that turns a building's front (+z) to face `heading` in the dock frame. */
const yawFacing = (heading: number): number => Math.PI / 2 - heading;

/** A point in a building's own frame (x along its front, z out of it), in the dock frame. */
const onBuilding = (center: Spot, yaw: number, lx: number, lz: number): Spot => ({
  x: center.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
  z: center.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
});

export function buildOutpost(id: string, dockToward: THREE.Vector2, landmark: OutpostLandmark, opts: { lowQuality: boolean }): OutpostModel {
  const dice = new Dice(`outpost:${id}`);
  const volcanic = landmark === "geyser";
  const golden = landmark === "dish";
  const mirror = dice.int(2) ? 1 : -1;
  const group = new THREE.Group();
  const frame = new THREE.Group();
  const dockDir = dockToward.clone().normalize();
  const dockAngle = Math.atan2(dockDir.y, dockDir.x);
  frame.rotation.y = -dockAngle;
  group.add(frame);

  // ---- the coast: a wobbling radius, held steady where the dock comes ashore
  const COAST = 1.5;
  const knots: number[] = [];
  for (let i = 0; i < 14; i++) knots.push(0.88 + dice.range(0, 0.24));
  const coastR = (a: number): number => {
    const f = (((a / (Math.PI * 2)) % 1) + 1) % 1;
    const x = f * knots.length;
    const i = Math.floor(x);
    const k = (1 - Math.cos((x - i) * Math.PI)) / 2;
    const wob = knots[i % knots.length]! * (1 - k) + knots[(i + 1) % knots.length]! * k;
    const near = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    return COAST * (1 + (wob - 1) * smooth(0.25, 0.75, near));
  };
  const phases = [dice.range(0, 6), dice.range(0, 6), dice.range(0, 6)];
  const landmarkAt: Spot = volcanic ? { x: -0.78, z: -0.08 * mirror } : { x: -0.74, z: -0.26 * mirror };
  const mound = landmark === "beacon" || landmark === "dish" || landmark === "fort";
  const profile = (s: number): number => {
    if (s < 0.58) return 0.3 + 0.055 * (1 - (s / 0.58) ** 2);
    if (s < 0.7) return 0.3 - 0.075 * smooth(0.58, 0.7, s);
    if (s < 0.92) return 0.225 - (0.03 * (s - 0.7)) / 0.22;
    if (s < 1) return 0.195 - 0.135 * smooth(0.92, 1, s);
    return Math.max(-0.32, 0.06 - (s - 1) * 3.2);
  };
  const sOf = (u: number, w: number): number => Math.hypot(u, w) / coastR(Math.atan2(w, u));
  const groundAt = (u: number, w: number): number => {
    const s = sOf(u, w);
    let h = profile(s);
    if (s < 0.68) h += (0.006 * Math.sin(u * 5.1 + phases[0]!) + 0.005 * Math.sin(w * 6.3 + phases[1]!) + 0.004 * Math.sin((u + w) * 8.7 + phases[2]!)) * (1 - smooth(0.5, 0.68, s));
    if (mound) h += 0.07 * Math.exp(-((u - landmarkAt.x) ** 2 + (w - landmarkAt.z) ** 2) / 0.09);
    return h;
  };
  const onDock = (u: number, w: number): boolean => u >= DOCK.from && u <= DOCK.to && Math.abs(w) <= DOCK.half;
  // The plaza is paved level, a little proud of the grass.
  const plaza: Spot = { x: 0.42, z: 0 };
  const plazaR = 0.25;
  const plazaTop = groundAt(plaza.x, plaza.z) + 0.011;
  const heightAt = (u: number, w: number): number => (onDock(u, w) ? DOCK.top : Math.hypot(u - plaza.x, w - plaza.z) < plazaR ? plazaTop : groundAt(u, w));

  // ---- the ground mesh: faceted, colored face by face
  const ground = buildGround(coastR, groundAt, sOf, dice, { volcanic, golden });
  frame.add(ground);

  const b = new Batch();
  const obstacles: Obstacle[] = [];
  const keepClear: { x: number; z: number; r: number }[] = [];
  const at = (u: number, w: number, lift = 0): [number, number, number] => [u, heightAt(u, w) + lift, w];
  const solidAt = (geometry: THREE.BufferGeometry, color: number, put: Put): void => b.add(geometry, color, put);
  const circle = (x: number, z: number, r: number): void => void obstacles.push({ kind: "circle", x, z, r });
  /** A box obstacle for a thing turned by three.js yaw `yaw` about its center. */
  const block = (x: number, z: number, hw: number, hd: number, yaw: number): void => void obstacles.push({ kind: "box", x, z, hw, hd, angle: -yaw });

  // ---- the dock
  const dockTop = DOCK.top;
  for (let u = DOCK.from + 0.04; u < DOCK.to; u += 0.075) {
    const shade = dice.int(4) === 0 ? C.woodDark : dice.int(2) ? C.plank : C.wood;
    solidAt(box(0.07, 0.025, DOCK.half * 2 + dice.range(-0.01, 0.015)), shade, { p: [u, dockTop - 0.0125, dice.range(-0.006, 0.006)], r: [0, dice.range(-0.03, 0.03), 0] });
  }
  for (let u = DOCK.from + 0.1; u <= DOCK.to; u += 0.3) {
    for (const side of [-1, 1]) {
      solidAt(cyl(0.022, 0.026, 0.62, 6), C.woodDark, { p: [u, dockTop - 0.3, side * (DOCK.half + 0.005)] });
      // Bollards at the edge where ships make fast.
      if (Math.abs(u - BERTH_U) < 0.6) {
        solidAt(cyl(0.014, 0.016, 0.03, 7), C.iron, { p: [u, dockTop + 0.015, side * (DOCK.half - 0.02)] });
        solidAt(cyl(0.019, 0.019, 0.006, 7), C.iron, { p: [u, dockTop + 0.032, side * (DOCK.half - 0.02)] });
        circle(u, side * (DOCK.half - 0.02), 0.015);
      }
    }
  }
  // Cross-beams along both edges.
  for (const side of [-1, 1]) solidAt(box(DOCK.to - DOCK.from, 0.03, 0.02), C.woodDark, { p: [(DOCK.from + DOCK.to) / 2, dockTop - 0.04, side * DOCK.half] });
  // Crates, barrels and a coil of rope at the root of the dock; a lantern at its end.
  const cargo = [
    [DOCK.from + 0.12, 0.08, "crate"],
    [DOCK.from + 0.12, 0.08, "crate2"],
    [DOCK.from + 0.21, 0.09, "barrel"],
    [DOCK.to - 0.1, -0.08, "coil"],
  ] as const;
  for (const [u, w0, kind] of cargo) {
    const w = w0 * mirror;
    if (kind === "crate") solidAt(box(0.06, 0.05, 0.06), C.plank, { p: [u, dockTop + 0.025, w], r: [0, 0.2, 0] });
    else if (kind === "crate2") solidAt(box(0.045, 0.04, 0.045), C.wood, { p: [u, dockTop + 0.07, w], r: [0, -0.3, 0] });
    else if (kind === "barrel") barrel(b, [u, dockTop, w]);
    else {
      solidAt(new THREE.TorusGeometry(0.022, 0.008, 5, 12), 0xb8945a, { p: [u, dockTop + 0.006, w], r: [Math.PI / 2, 0, 0] });
      solidAt(new THREE.TorusGeometry(0.013, 0.007, 5, 10), 0xb8945a, { p: [u, dockTop + 0.014, w], r: [Math.PI / 2, 0, 0] });
    }
    circle(u, w, kind === "coil" ? 0.03 : 0.04);
  }
  solidAt(cyl(0.012, 0.014, 0.17, 6), C.woodDark, { p: [DOCK.to - 0.04, dockTop + 0.085, 0.1 * mirror] });
  solidAt(box(0.03, 0.01, 0.03), C.iron, { p: [DOCK.to - 0.04, dockTop + 0.175, 0.1 * mirror] });
  const lantern = new THREE.Mesh(ball(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: C.lamp }));
  lantern.position.set(DOCK.to - 0.04, dockTop + 0.155, 0.1 * mirror);
  frame.add(lantern);
  circle(DOCK.to - 0.04, 0.1 * mirror, 0.015);
  // A ladder down to the water at the end.
  for (let i = 0; i < 4; i++) solidAt(box(0.006, 0.006, 0.05), C.woodDark, { p: [DOCK.to + 0.005, dockTop - 0.05 - i * 0.045, 0] });
  // A rowing boat tied up under the dock's root.
  solidAt(cyl(0.05, 0.028, 0.2, 7), C.timber, { p: [DOCK.from + 0.22, 0.02, -0.22 * mirror], r: [0, 0, Math.PI / 2], s: [1, 1, 0.6] });

  // ---- the path inland, the plaza and its well
  const cantinaAt: Spot = { x: 0.02, z: 0.6 * mirror };
  const stallAt: Spot = { x: 0.98, z: -0.38 * mirror };
  const noticeAt: Spot = { x: 0.98, z: 0.3 * mirror };
  const cottageA: Spot = { x: 0.12, z: -0.64 * mirror };
  const cottageB: Spot | null = volcanic ? null : { x: -0.34, z: 0.44 * mirror };
  const towardPlaza = (p: Spot): number => Math.atan2(plaza.z - p.z, plaza.x - p.x);
  const cantinaFace = towardPlaza(cantinaAt);
  const cantinaDoor: Spot = { x: cantinaAt.x + Math.cos(cantinaFace) * 0.25, z: cantinaAt.z + Math.sin(cantinaFace) * 0.25 };
  const cantinaInside: Spot = { x: cantinaAt.x + Math.cos(cantinaFace) * 0.07, z: cantinaAt.z + Math.sin(cantinaFace) * 0.07 };

  const paths: Spot[][] = [
    [{ x: DOCK.from + 0.02, z: 0 }, { x: 0.86, z: 0.01 }, { x: plaza.x + plazaR, z: 0 }],
    [{ x: plaza.x - plazaR * Math.cos(cantinaFace), z: plaza.z - plazaR * Math.sin(cantinaFace) }, cantinaDoor],
    [
      { x: plaza.x - plazaR * 0.8, z: -0.1 * mirror },
      { x: (plaza.x + landmarkAt.x) / 2, z: (landmarkAt.z - 0.05 * mirror) * 0.6 },
      { x: landmarkAt.x + (volcanic ? 0.68 : 0.17), z: landmarkAt.z + (volcanic ? 0.12 * mirror : 0.03 * mirror) },
    ],
    [{ x: plaza.x - 0.1, z: -plazaR * mirror }, { x: cottageA.x + 0.12, z: cottageA.z + 0.2 * mirror }],
  ];
  if (cottageB) paths.push([{ x: plaza.x - plazaR, z: 0.05 * mirror }, { x: cottageB.x + 0.2, z: cottageB.z - 0.12 * mirror }]);
  for (const line of paths) {
    const curve = new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(p.x, 0, p.z)));
    const length = curve.getLength();
    const steps = Math.max(2, Math.ceil(length / 0.04));
    ribbon(b, curve, steps, 0.085, (u, w) => heightAt(u, w) + 0.004, volcanic ? C.rock : C.path);
    for (let i = 0; i <= steps; i += 2) {
      const p = curve.getPointAt(i / steps);
      for (const side of [-1, 1]) {
        if (dice.int(3) === 0) continue;
        const tan = curve.getTangentAt(i / steps);
        const ox = -tan.z * side * dice.range(0.01, 0.028);
        const oz = tan.x * side * dice.range(0.01, 0.028);
        solidAt(cyl(dice.range(0.012, 0.02), dice.range(0.014, 0.022), 0.006, 6), dice.int(2) ? C.cobble : C.cobbleDark, { p: at(p.x + ox, p.z + oz, 0.006), r: [0, dice.range(0, 3), 0] });
      }
      keepClear.push({ x: p.x, z: p.z, r: 0.09 });
    }
  }
  // Cobbles: a paved disc, then stones on it.
  const plazaY = plazaTop - 0.011;
  solidAt(cyl(plazaR, plazaR + 0.012, 0.03, 20), C.cobbleDark, { p: [plaza.x, plazaY - 0.008, plaza.z] });
  for (let i = 0; i < 46; i++) {
    const a = dice.range(0, Math.PI * 2);
    const r = Math.sqrt(dice.range(0.02, 1)) * (plazaR - 0.02);
    solidAt(cyl(0.02, 0.022, 0.008, 6), dice.int(3) ? C.cobble : C.rockLight, { p: [plaza.x + Math.cos(a) * r, plazaY + 0.008, plaza.z + Math.sin(a) * r], r: [0, a, 0] });
  }
  keepClear.push({ x: plaza.x, z: plaza.z, r: plazaR + 0.12 });
  // The well.
  b.frame({ p: [plaza.x, plazaY, plaza.z] }, () => {
    b.add(cyl(0.055, 0.06, 0.06, 10), C.rockLight, { p: [0, 0.03, 0] });
    b.add(cyl(0.042, 0.042, 0.004, 10), 0x2a5a6a, { p: [0, 0.055, 0] });
    for (const side of [-1, 1]) b.add(box(0.01, 0.1, 0.01), C.woodDark, { p: [0, 0.1, side * 0.05] });
    b.add(cyl(0.006, 0.006, 0.11, 5), C.woodDark, { p: [0, 0.135, 0], r: [Math.PI / 2, 0, 0] });
    b.add(box(0.09, 0.006, 0.13), C.roofDark, { p: [0.025, 0.165, 0], r: [0, 0, 0.5] });
    b.add(box(0.09, 0.006, 0.13), C.roofDark, { p: [-0.025, 0.165, 0], r: [0, 0, -0.5] });
    b.add(cyl(0.014, 0.011, 0.02, 7), C.wood, { p: [0, 0.095, 0] });
  });
  circle(plaza.x, plaza.z, 0.065);
  // Lamp posts at the plaza and along the path.
  const lamps: THREE.Mesh[] = [];
  for (const [u, w] of [
    [plaza.x + 0.18, 0.18 * mirror],
    [plaza.x - 0.18, -0.18 * mirror],
    [0.84, -0.1 * mirror],
  ] as const) {
    const y = heightAt(u, w);
    solidAt(cyl(0.007, 0.01, 0.16, 6), C.iron, { p: [u, y + 0.08, w] });
    solidAt(box(0.026, 0.006, 0.026), C.iron, { p: [u, y + 0.181, w] });
    const glow = new THREE.Mesh(box(0.018, 0.022, 0.018), new THREE.MeshBasicMaterial({ color: C.lamp }));
    glow.position.set(u, y + 0.166, w);
    frame.add(glow);
    lamps.push(glow);
    circle(u, w, 0.012);
  }

  // ---- the notice board at the dock's foot: a pillar papered all round, so it reads from any side
  const noticeY = heightAt(noticeAt.x, noticeAt.z);
  const noticeYaw = yawFacing(-Math.PI / 2 * mirror);
  const NOTICE_H = 0.24;
  b.frame({ p: [noticeAt.x, noticeY, noticeAt.z] }, () => {
    b.add(cyl(0.07, 0.078, 0.03, 10), C.rock, { p: [0, 0.008, 0] });
    b.add(cyl(0.05, 0.052, NOTICE_H, 12), 0x6b4a2e, { p: [0, NOTICE_H / 2 + 0.02, 0] });
    for (const y of [0.04, NOTICE_H + 0.012]) b.add(cyl(0.056, 0.056, 0.014, 12), C.woodDark, { p: [0, y, 0] });
    // Bills and notices pasted round it, some half over others.
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + dice.range(-0.15, 0.15);
      const y = 0.08 + (i % 3) * 0.05 + dice.range(0, 0.02);
      const c = dice.pick([C.parchment, C.parchment, C.parchment, 0xf2e2b8, C.roof, C.roofBlue]);
      b.add(box(0.004, 0.05, 0.034), c, { p: [Math.cos(a) * 0.052, y, Math.sin(a) * 0.052], r: [0, -a, dice.range(-0.12, 0.12)] });
    }
    b.add(cone(0.085, 0.07, 12), C.roofDark, { p: [0, NOTICE_H + 0.055, 0] });
    b.add(ball(0.014, 8, 6), C.brass, { p: [0, NOTICE_H + 0.1, 0] });
  });
  circle(noticeAt.x, noticeAt.z, 0.075);
  const noticeDoor: Door = { at: { x: noticeAt.x, z: noticeAt.z - 0.14 * mirror }, face: (Math.PI / 2) * mirror, inside: null };
  keepClear.push({ x: noticeAt.x, z: noticeAt.z, r: 0.2 });

  // ---- the shipwright's: the dock's office, where ships are bought, with a hull on trestles outside
  const stallY = heightAt(stallAt.x, stallAt.z);
  const stallYaw = yawFacing((Math.PI / 2) * mirror);
  const SW = 0.3;
  const SD = 0.22;
  const SH = 0.16;
  const stallDoorX = -0.06;
  b.frame({ p: [stallAt.x, stallY, stallAt.z], r: [0, stallYaw, 0] }, () => {
    b.add(box(SW + 0.03, 0.05, SD + 0.03), C.rock, { p: [0, -0.012, 0] });
    b.add(box(SW, SH, SD), 0xa87c4c, { p: [0, SH / 2, 0] });
    // Clapboards on the front and sides.
    for (let i = 1; i < 6; i++) {
      b.add(box(SW + 0.002, 0.004, 0.004), 0x7d5a35, { p: [0, i * (SH / 6), SD / 2 + 0.001] });
      for (const side of [-1, 1]) b.add(box(0.004, 0.004, SD + 0.002), 0x7d5a35, { p: [side * (SW / 2 + 0.001), i * (SH / 6), 0] });
    }
    for (const x of [-SW / 2, SW / 2]) b.add(box(0.016, SH, 0.016), C.woodDark, { p: [x, SH / 2, SD / 2] });
    for (const side of [-1, 1]) b.add(box(SW + 0.05, 0.014, SD * 0.66), C.roofBlue, { p: [0, SH + 0.055, side * SD * 0.26], r: [side * 0.55, 0, 0] });
    b.add(box(SW + 0.06, 0.018, 0.018), 0x2c5277, { p: [0, SH + 0.1, 0] });
    for (const side of [-1, 1]) {
      const gable = new THREE.Shape();
      gable.moveTo(-SD / 2, 0);
      gable.lineTo(SD / 2, 0);
      gable.lineTo(0, 0.095);
      gable.closePath();
      b.add(new THREE.ShapeGeometry(gable), 0xa87c4c, { p: [side * (SW / 2 + 0.001), SH, 0], r: [0, (side * Math.PI) / 2, 0] });
    }
    // The doorway (its door swings, below), and a wide window onto the yard.
    b.add(box(0.068, 0.112, 0.004), 0x1d140c, { p: [stallDoorX, 0.056, SD / 2 + 0.002] });
    b.add(box(0.08, 0.012, 0.012), C.woodDark, { p: [stallDoorX, 0.117, SD / 2 + 0.004] });
    b.addGlow(box(0.08, 0.05, 0.006), C.window, { p: [0.07, 0.085, SD / 2 + 0.002] });
    b.add(box(0.09, 0.008, 0.016), C.woodDark, { p: [0.07, 0.057, SD / 2 + 0.008] });
    b.add(box(0.004, 0.05, 0.008), C.woodDark, { p: [0.07, 0.085, SD / 2 + 0.005] });
    // A model ship hung over the door for a sign.
    b.add(box(0.05, 0.004, 0.004), C.iron, { p: [stallDoorX + 0.01, 0.145, SD / 2 + 0.025] });
    b.add(box(0.05, 0.016, 0.018), 0x5c3c1f, { p: [stallDoorX + 0.01, 0.13, SD / 2 + 0.04] });
    b.add(box(0.003, 0.04, 0.003), C.woodDark, { p: [stallDoorX + 0.01, 0.155, SD / 2 + 0.04] });
    b.add(box(0.026, 0.03, 0.002), C.canvas, { p: [stallDoorX + 0.004, 0.16, SD / 2 + 0.04] });
    // Timber stacked against one side.
    for (let i = 0; i < 4; i++) b.add(box(0.03, 0.025, 0.2), C.plank, { p: [SW / 2 + 0.03 + (i % 2) * 0.03, 0.012 + Math.floor(i / 2) * 0.025, 0], r: [0, 0.05 * i, 0] });
    // A boat in frame on trestles by the other: a keel, its ribs, and the first strakes.
    b.frame({ p: [-SW / 2 - 0.1, 0, 0.02] }, () => {
      for (const z of [-0.06, 0.06]) {
        for (const lean of [-0.3, 0.3]) b.add(box(0.008, 0.06, 0.008), C.woodDark, { p: [lean * 0.06, 0.028, z], r: [0, 0, lean] });
        b.add(box(0.05, 0.006, 0.01), C.woodDark, { p: [0, 0.056, z] });
      }
      b.add(box(0.012, 0.012, 0.2), C.timber, { p: [0, 0.064, 0] });
      for (let i = 0; i < 5; i++) b.add(new THREE.TorusGeometry(0.035, 0.0035, 4, 10, Math.PI), C.plank, { p: [0, 0.1, -0.08 + i * 0.04], r: [Math.PI, 0, 0] });
      for (const side of [-1, 1]) b.add(box(0.006, 0.012, 0.16), C.plank, { p: [side * 0.03, 0.09, 0] });
    });
  });
  block(stallAt.x, stallAt.z, SW / 2 + 0.01, SD / 2 + 0.01, stallYaw);
  {
    const timber = onBuilding(stallAt, stallYaw, SW / 2 + 0.045, 0);
    block(timber.x, timber.z, 0.035, 0.11, stallYaw);
    const boat = onBuilding(stallAt, stallYaw, -SW / 2 - 0.1, 0.02);
    block(boat.x, boat.z, 0.045, 0.11, stallYaw);
  }
  const stallDoor: Door = {
    at: onBuilding(stallAt, stallYaw, stallDoorX, SD / 2 + 0.1),
    face: (-Math.PI / 2) * mirror,
    inside: onBuilding(stallAt, stallYaw, stallDoorX, SD / 2 - 0.07),
  };
  keepClear.push({ x: stallAt.x, z: stallAt.z, r: 0.32 });

  // ---- the cantina
  const cantinaY = heightAt(cantinaAt.x, cantinaAt.z);
  const cantinaYaw = yawFacing(cantinaFace);
  const sign = new THREE.Group();
  const smokeTop = new THREE.Vector3();
  b.frame({ p: [cantinaAt.x, cantinaY, cantinaAt.z], r: [0, cantinaYaw, 0] }, () => {
    const W = 0.42;
    const D = 0.3;
    const H = 0.2;
    b.add(box(W + 0.03, 0.05, D + 0.03), C.rock, { p: [0, -0.01, 0] });
    b.add(box(W, H, D), C.wall, { p: [0, H / 2, 0] });
    // Timber framing on the front.
    for (const x of [-W / 2 + 0.005, -0.07, 0.07, W / 2 - 0.005]) b.add(box(0.014, H, 0.01), C.timber, { p: [x, H / 2, D / 2 + 0.002] });
    b.add(box(W, 0.014, 0.01), C.timber, { p: [0, H * 0.55, D / 2 + 0.002] });
    b.add(box(W, 0.014, 0.01), C.timber, { p: [0, H - 0.007, D / 2 + 0.002] });
    // A gabled roof, its ridge along the front.
    for (const side of [-1, 1]) b.add(box(W + 0.06, 0.016, D * 0.62), C.roof, { p: [0, H + 0.07, side * D * 0.25], r: [side * 0.62, 0, 0] });
    b.add(box(W + 0.07, 0.02, 0.02), C.roofDark, { p: [0, H + 0.125, 0] });
    for (const side of [-1, 1]) {
      const gable = new THREE.Shape();
      gable.moveTo(-D / 2, 0);
      gable.lineTo(D / 2, 0);
      gable.lineTo(0, 0.12);
      gable.closePath();
      b.add(new THREE.ShapeGeometry(gable), C.wall, { p: [side * (W / 2 + 0.001), H, 0], r: [0, (side * Math.PI) / 2, 0] });
    }
    b.add(box(0.05, 0.12, 0.05), C.rock, { p: [W * 0.3, H + 0.1, -0.06] });
    // The doorway (its door swings, below), lit windows and lanterns either side of it.
    b.add(box(0.075, 0.122, 0.004), 0x1d140c, { p: [0, 0.061, D / 2 + 0.002] });
    b.add(box(0.088, 0.012, 0.014), C.timber, { p: [0, 0.128, D / 2 + 0.006] });
    for (const x of [-0.14, 0.14]) {
      b.addGlow(box(0.06, 0.05, 0.008), C.window, { p: [x, 0.08, D / 2 + 0.004] });
      b.add(box(0.07, 0.008, 0.014), C.timber, { p: [x, 0.052, D / 2 + 0.008] });
      b.addGlow(box(0.055, 0.04, 0.008), C.window, { p: [x * 0.9, 0.15, D / 2 + 0.004] });
    }
    for (const side of [-1, 1]) b.addGlow(box(0.014, 0.02, 0.014), C.lamp, { p: [side * 0.055, 0.13, D / 2 + 0.02] });
    // A bench and barrels outside.
    b.add(box(0.12, 0.012, 0.03), C.wood, { p: [-0.16, 0.032, D / 2 + 0.06] });
    for (const x of [-0.21, -0.11]) b.add(box(0.01, 0.03, 0.025), C.woodDark, { p: [x, 0.015, D / 2 + 0.06] });
    barrel(b, [0.17, 0, D / 2 + 0.05]);
    barrel(b, [0.2, 0, D / 2 + 0.09]);
    smokeTop.copy(b.point(W * 0.3, H + 0.17, -0.06));
  });
  {
    // The sign hangs from a bracket and swings in the breeze.
    const yawM = new THREE.Matrix4().makeRotationY(cantinaYaw);
    const bracket = new THREE.Vector3(0.12, 0.2, 0.17).applyMatrix4(yawM);
    sign.position.set(cantinaAt.x + bracket.x, cantinaY + bracket.y, cantinaAt.z + bracket.z);
    sign.rotation.y = cantinaYaw;
    const board = new THREE.Mesh(box(0.07, 0.045, 0.008), new THREE.MeshLambertMaterial({ color: C.woodDark }));
    board.position.y = -0.03;
    const mug = new THREE.Mesh(cyl(0.01, 0.009, 0.018, 8), new THREE.MeshBasicMaterial({ color: C.brass }));
    mug.position.set(0, -0.03, 0.006);
    mug.rotation.x = Math.PI / 2;
    sign.add(board, mug);
    frame.add(sign);
    b.frame({ p: [cantinaAt.x, cantinaY, cantinaAt.z], r: [0, cantinaYaw, 0] }, () => b.add(box(0.07, 0.008, 0.008), C.iron, { p: [0.12, 0.205, 0.15] }));
  }
  block(cantinaAt.x, cantinaAt.z, 0.24, 0.17, cantinaYaw);
  // The bench and barrels in front stand in the way too.
  for (const [lx, lz] of [
    [-0.16, 0.21],
    [0.185, 0.22],
  ] as const) {
    const c = Math.cos(cantinaYaw);
    const s = Math.sin(cantinaYaw);
    circle(cantinaAt.x + lx * c + lz * s, cantinaAt.z - lx * s + lz * c, 0.045);
  }
  keepClear.push({ x: cantinaAt.x, z: cantinaAt.z, r: 0.38 });
  const smokes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(ball(0.02, 6, 4), new THREE.MeshLambertMaterial({ color: 0xdde3ea, transparent: true, opacity: 0.5, depthWrite: false }));
    puff.userData.phase = i / 4;
    frame.add(puff);
    smokes.push(puff);
  }

  // ---- doors that swing: hung on their hinge at the left of the doorway, opening inward
  const doorLeaf = (center: Spot, baseY: number, yaw: number, lx: number, front: number, w: number, h: number, color: number): Doorway => {
    const hinge = onBuilding(center, yaw, lx - w / 2, front + 0.006);
    const pivot = new THREE.Group();
    pivot.position.set(hinge.x, baseY, hinge.z);
    pivot.rotation.y = yaw;
    const leaf = new THREE.Mesh(box(w, h, 0.008), new THREE.MeshLambertMaterial({ color }));
    leaf.position.set(w / 2, h / 2, 0);
    leaf.castShadow = !opts.lowQuality;
    const knob = new THREE.Mesh(ball(0.0045, 6, 4), new THREE.MeshBasicMaterial({ color: C.brass }));
    knob.position.set(w - 0.012, h * 0.48, 0.006);
    for (let i = 1; i < 3; i++) {
      const plank = new THREE.Mesh(box(0.002, h, 0.009), new THREE.MeshLambertMaterial({ color: 0x3a2414 }));
      plank.position.set((i * w) / 3, h / 2, 0);
      pivot.add(plank);
    }
    pivot.add(leaf, knob);
    frame.add(pivot);
    return { pivot, yaw, open: 0 };
  };
  const doorways: Partial<Record<Building, Doorway>> = {
    cantina: doorLeaf(cantinaAt, cantinaY, cantinaYaw, 0, 0.15, 0.072, 0.118, C.woodDark),
    dock: doorLeaf(stallAt, stallY, stallYaw, stallDoorX, SD / 2, 0.066, 0.11, 0x5a3a1e),
  };

  // ---- cottages, with a garden fence and a vegetable patch
  for (const [i, home] of [cottageA, cottageB].entries()) {
    if (!home) continue;
    const y = heightAt(home.x, home.z);
    const yaw = yawFacing(towardPlaza(home));
    const roof = dice.int(2) ? C.roof : C.roofBlue;
    b.frame({ p: [home.x, y, home.z], r: [0, yaw, 0] }, () => {
      b.add(box(0.26, 0.05, 0.22), C.rock, { p: [0, -0.012, 0] });
      b.add(box(0.24, 0.15, 0.2), C.wall, { p: [0, 0.075, 0] });
      b.add(cyl(0, 0.2, 0.13, 4), roof, { p: [0, 0.215, 0], r: [0, Math.PI / 4, 0], s: [1, 1, 0.85] });
      b.add(box(0.05, 0.09, 0.01), C.woodDark, { p: [0.04, 0.045, 0.104] });
      b.addGlow(box(0.045, 0.04, 0.008), C.window, { p: [-0.06, 0.09, 0.102] });
      if (i === 0) b.add(box(0.035, 0.08, 0.035), C.rock, { p: [-0.08, 0.24, -0.04] });
      // A picket fence round a patch to one side.
      const fx = 0.2;
      for (let k = 0; k < 6; k++) b.add(box(0.008, 0.045, 0.008), C.wood, { p: [fx + (k % 3) * 0.06, 0.022, k < 3 ? 0.1 : -0.1] });
      for (const z of [0.1, -0.1]) b.add(box(0.13, 0.006, 0.004), C.wood, { p: [fx + 0.06, 0.03, z] });
      b.add(box(0.13, 0.006, 0.004), C.wood, { p: [fx + 0.125, 0.03, 0], r: [0, Math.PI / 2, 0], s: [1.55, 1, 1] });
      for (let k = 0; k < 6; k++) b.add(ball(0.014, 5, 4), k % 2 ? C.grassDark : 0x7ab34a, { p: [fx + 0.025 + (k % 3) * 0.04, 0.012, k < 3 ? 0.045 : -0.045] });
    });
    block(home.x, home.z, 0.14, 0.12, yaw);
    {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      block(home.x + 0.26 * c, home.z - 0.26 * s, 0.075, 0.11, yaw);
    }
    keepClear.push({ x: home.x, z: home.z, r: 0.3 });
  }

  // ---- a fruit stall at the plaza's edge
  {
    const a = Math.atan2(0.3 * mirror, 0.1);
    const u = plaza.x + Math.cos(a) * (plazaR + 0.05);
    const w = plaza.z + Math.sin(a) * (plazaR + 0.05);
    const yaw = yawFacing(a + Math.PI);
    const y = heightAt(u, w);
    b.frame({ p: [u, y, w], r: [0, yaw, 0] }, () => {
      b.add(box(0.14, 0.045, 0.06), C.wood, { p: [0, 0.022, 0] });
      for (const [x, c] of [
        [-0.045, 0xe0702a],
        [0, 0xd8c040],
        [0.045, 0xb83a3a],
      ] as const)
        for (let k = 0; k < 3; k++) b.add(ball(0.011, 6, 4), c, { p: [x + (k - 1) * 0.012, 0.052, (k % 2) * 0.01 - 0.005] });
      for (const side of [-1, 1]) b.add(box(0.008, 0.13, 0.008), C.woodDark, { p: [side * 0.065, 0.065, -0.025] });
      b.add(box(0.17, 0.006, 0.09), dice.int(2) ? C.roof : 0xdba53a, { p: [0, 0.13, 0.005], r: [0.28, 0, 0] });
    });
    block(u, w, 0.08, 0.04, yaw);
    keepClear.push({ x: u, z: w, r: 0.12 });
  }

  // ---- the landmark at the back
  const landmarkY = heightAt(landmarkAt.x, landmarkAt.z);
  let animateLandmark: (t: number, dt: number) => void = () => {};
  if (landmark === "beacon") {
    const tower = new THREE.Group();
    tower.position.set(landmarkAt.x, landmarkY, landmarkAt.z);
    b.frame({ p: [landmarkAt.x, landmarkY, landmarkAt.z] }, () => {
      b.add(cyl(0.14, 0.17, 0.05, 9), C.rock, { p: [0, 0.0, 0] });
      b.add(cyl(0.075, 0.11, 0.62, 10), C.lightTower, { p: [0, 0.31, 0] });
      for (const y of [0.16, 0.42]) b.add(cyl(0.104 - y * 0.05, 0.106 - y * 0.05, 0.07, 10), C.lightBand, { p: [0, y, 0] });
      b.add(cyl(0.11, 0.09, 0.03, 10), C.iron, { p: [0, 0.63, 0] });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        b.add(box(0.005, 0.04, 0.005), C.iron, { p: [Math.cos(a) * 0.1, 0.665, Math.sin(a) * 0.1] });
      }
      b.add(cone(0.09, 0.11, 10), C.lightBand, { p: [0, 0.76, 0] });
      const face = towardPlaza(landmarkAt);
      b.add(box(0.05, 0.09, 0.01), C.woodDark, { p: [Math.cos(face) * 0.105, 0.05, Math.sin(face) * 0.105], r: [0, yawFacing(face), 0] });
    });
    const lamp = new THREE.Mesh(ball(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: C.lamp }));
    lamp.position.y = 0.69;
    tower.add(lamp);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 12, 1, true), new THREE.MeshBasicMaterial({ color: C.lamp, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0.55, 0.69, 0);
    const beamHolder = new THREE.Group();
    beamHolder.add(beam);
    tower.add(beamHolder);
    frame.add(tower);
    circle(landmarkAt.x, landmarkAt.z, 0.17);
    animateLandmark = (t) => {
      const on = Math.sin(t * 2.2) > 0.2;
      (lamp.material as THREE.MeshBasicMaterial).color.setHex(on ? C.lamp : C.lampOff);
      beamHolder.rotation.y = t * 0.7;
      (beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.1 : 0.02;
    };
  } else if (landmark === "dish") {
    const yaw = yawFacing(towardPlaza(landmarkAt));
    b.frame({ p: [landmarkAt.x, landmarkY, landmarkAt.z], r: [0, yaw, 0] }, () => {
      b.add(cyl(0.11, 0.17, 0.5, 8), C.wall, { p: [0, 0.25, 0] });
      b.add(cone(0.15, 0.16, 8), C.roofBlue, { p: [0, 0.58, 0] });
      b.add(box(0.06, 0.1, 0.01), C.woodDark, { p: [0, 0.05, 0.155] });
      b.addGlow(box(0.04, 0.04, 0.008), C.window, { p: [0, 0.3, 0.13] });
    });
    // Fields of grain beside it.
    const fieldC = Math.cos(yaw);
    const fieldS = Math.sin(yaw);
    const fx = landmarkAt.x + 0.32 * fieldC;
    const fz = landmarkAt.z - 0.32 * fieldS;
    b.frame({ p: [fx, heightAt(fx, fz), fz], r: [0, yaw, 0] }, () => {
      for (let i = 0; i < 6; i++) b.add(box(0.24, 0.035, 0.032), i % 2 ? 0xdcc46a : 0xc9ae4f, { p: [0, 0.012, -0.13 + i * 0.052] });
    });
    block(fx, fz, 0.13, 0.17, yaw);
    const hub = new THREE.Group();
    const local = new THREE.Vector3(0, 0.46, 0.18).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    hub.position.set(landmarkAt.x + local.x, landmarkY + local.y, landmarkAt.z + local.z);
    hub.rotation.y = yaw;
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      const blade = new THREE.Mesh(box(0.06, 0.36, 0.01), new THREE.MeshLambertMaterial({ color: C.canvas }));
      blade.position.y = 0.19;
      blade.castShadow = true;
      const spar = new THREE.Mesh(box(0.012, 0.4, 0.012), new THREE.MeshLambertMaterial({ color: C.woodDark }));
      spar.position.y = 0.2;
      arm.add(blade, spar);
      hub.add(arm);
    }
    frame.add(hub);
    circle(landmarkAt.x, landmarkAt.z, 0.18);
    animateLandmark = (_t, dt) => {
      hub.rotation.z += dt * 0.9;
    };
  } else if (landmark === "geyser") {
    b.frame({ p: [landmarkAt.x, landmarkY - 0.06, landmarkAt.z] }, () => {
      b.add(cyl(0.17, 0.6, 0.78, 9), C.basalt, { p: [0, 0.39, 0] });
      b.add(cyl(0.6, 0.66, 0.06, 9), 0x2e2a33, { p: [0, 0.03, 0] });
      for (let i = 0; i < 3; i++) b.add(box(0.05, 0.42, 0.025), C.lava, { p: [0.2 + i * 0.04, 0.42, 0.15 - i * 0.14], r: [0.1 * i, 0.4 + i * 0.6, 0.55] });
    });
    const crater = new THREE.Mesh(cyl(0.15, 0.15, 0.03, 9), new THREE.MeshBasicMaterial({ color: C.lava }));
    crater.position.set(landmarkAt.x, landmarkY + 0.7, landmarkAt.z);
    frame.add(crater);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(ball(0.08, 6, 5), new THREE.MeshLambertMaterial({ color: C.smoke, transparent: true, opacity: 0.6, depthWrite: false }));
      puff.userData.phase = i / 6;
      frame.add(puff);
      puffs.push(puff);
    }
    circle(landmarkAt.x, landmarkAt.z, 0.6);
    animateLandmark = (t) => {
      (crater.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 3) > 0 ? C.lava : 0xc9502a);
      for (const p of puffs) {
        const k = (t * 0.25 + (p.userData.phase as number)) % 1;
        p.position.set(crater.position.x + Math.sin(k * 6 + (p.userData.phase as number) * 9) * 0.12 * k, crater.position.y + 0.08 + k * 0.9, crater.position.z + 0.15 * k);
        p.scale.setScalar(0.6 + k * 1.8);
        (p.material as THREE.MeshLambertMaterial).opacity = 0.55 * (1 - k);
      }
    };
  } else if (landmark === "fort") {
    b.frame({ p: [landmarkAt.x, landmarkY, landmarkAt.z] }, () => {
      b.add(box(0.36, 0.26, 0.36), C.rock, { p: [0, 0.13, 0] });
      for (const [x, z] of [
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ] as const)
        b.add(cyl(0.065, 0.075, 0.36, 7), C.rock, { p: [x, 0.18, z] });
    });
    block(landmarkAt.x, landmarkAt.z, 0.25, 0.25, 0);
  }
  keepClear.push({ x: landmarkAt.x, z: landmarkAt.z, r: volcanic ? 0.7 : 0.32 });

  // ---- the beach: a boat drawn up, a net on its rack, driftwood, a fire ring, shells
  const beachSpot = (a: number, s: number): Spot => {
    const r = coastR(a) * s;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };
  {
    const p = beachSpot(-0.95 * mirror, 0.86);
    const yaw = yawFacing(-0.95 * mirror) + Math.PI / 2;
    b.frame({ p: at(p.x, p.z, 0.01), r: [0, yaw, 0.12] }, () => {
      b.add(cyl(0.045, 0.025, 0.2, 7), C.timber, { p: [0, 0.02, 0], r: [0, 0, Math.PI / 2], s: [1, 1, 0.62] });
      b.add(box(0.01, 0.006, 0.05), C.wood, { p: [0.02, 0.04, 0] });
      b.add(box(0.16, 0.004, 0.008), C.wood, { p: [0.0, 0.045, 0.04], r: [0, 0.3, 0] });
    });
    circle(p.x, p.z, 0.11);
    keepClear.push({ x: p.x, z: p.z, r: 0.18 });
  }
  {
    // A heap of net drying on the sand, its floats on top, a pair of oars and a lobster pot beside it.
    const p = beachSpot(1.05 * mirror, 0.82);
    const yaw = yawFacing(1.05 * mirror);
    b.frame({ p: at(p.x, p.z), r: [0, yaw, 0] }, () => {
      b.add(new THREE.IcosahedronGeometry(0.06, 0), 0x8c7a5a, { p: [0, 0.012, 0], s: [1.3, 0.35, 1] });
      b.add(new THREE.IcosahedronGeometry(0.04, 0), 0x7a6a4c, { p: [0.045, 0.016, 0.02], s: [1, 0.4, 1] });
      for (let k = 0; k < 4; k++) b.add(ball(0.009, 6, 4), k % 2 ? 0xc9a24a : 0xd9573a, { p: [-0.05 + k * 0.032, 0.03, (k % 2) * 0.02 - 0.01] });
      for (const z of [-0.075, -0.09]) b.add(box(0.17, 0.006, 0.012), C.wood, { p: [0.0, 0.004, z], r: [0, z * 3, 0] });
      b.add(box(0.05, 0.04, 0.04), C.woodDark, { p: [-0.11, 0.02, 0.04], r: [0, 0.4, 0] });
      b.add(cyl(0.02, 0.02, 0.05, 8), C.woodDark, { p: [-0.11, 0.04, 0.04], r: [Math.PI / 2, 0.4, 0], s: [1, 1, 0.6] });
    });
    circle(p.x, p.z, 0.08);
    circle(p.x - 0.1, p.z + 0.04, 0.03);
    keepClear.push({ x: p.x, z: p.z, r: 0.16 });
  }
  const fireAt = beachSpot(Math.PI * 0.72 * mirror, 0.78);
  const ember = new THREE.Mesh(cone(0.022, 0.05, 5), new THREE.MeshBasicMaterial({ color: 0xff9a3d }));
  {
    const y = heightAt(fireAt.x, fireAt.z);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      b.add(ball(0.014, 5, 4), C.rock, { p: [fireAt.x + Math.cos(a) * 0.04, y + 0.006, fireAt.z + Math.sin(a) * 0.04] });
    }
    for (let k = 0; k < 3; k++) b.add(cyl(0.006, 0.006, 0.06, 5), C.woodDark, { p: [fireAt.x, y + 0.01, fireAt.z], r: [Math.PI / 2, (k * Math.PI) / 3, 0] });
    ember.position.set(fireAt.x, y + 0.03, fireAt.z);
    frame.add(ember);
    // Logs to sit on.
    for (const a of [0.4, 2.6]) {
      const lx = fireAt.x + Math.cos(a) * 0.1;
      const lz = fireAt.z + Math.sin(a) * 0.1;
      b.add(cyl(0.012, 0.012, 0.08, 6), C.trunk, { p: [lx, heightAt(lx, lz) + 0.01, lz], r: [Math.PI / 2, 0, a], s: 1 });
      circle(lx, lz, 0.03);
    }
    circle(fireAt.x, fireAt.z, 0.05);
    keepClear.push({ x: fireAt.x, z: fireAt.z, r: 0.18 });
  }
  for (let i = 0; i < 2; i++) {
    const a = dice.range(-Math.PI, Math.PI);
    if (Math.abs(a) < 0.5) continue;
    const p = beachSpot(a, dice.range(0.84, 0.9));
    b.add(cyl(0.012, 0.014, 0.16, 6), 0xb3a58a, { p: at(p.x, p.z, 0.008), r: [Math.PI / 2, 0, dice.range(0, 3)] });
    circle(p.x, p.z, 0.04);
  }
  for (let i = 0; i < 16; i++) {
    const a = dice.range(0, Math.PI * 2);
    const p = beachSpot(a, dice.range(0.74, 0.95));
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.2) continue;
    const kind = dice.int(3);
    if (kind === 0) b.add(cyl(0.008, 0.01, 0.004, 5), dice.pick([0xf2d6c8, 0xf6eee0, 0xe8b8a0]), { p: at(p.x, p.z, 0.002) });
    else if (kind === 1) b.add(cyl(0.012, 0.012, 0.003, 5), 0xe07a4a, { p: at(p.x, p.z, 0.002), r: [0, dice.range(0, 3), 0] });
    else b.add(new THREE.DodecahedronGeometry(0.014 + dice.range(0, 0.02)), volcanic ? C.basalt : C.rock, { p: at(p.x, p.z, 0.004), r: [dice.range(0, 3), dice.range(0, 3), 0] });
  }
  // Rocks in the shallows.
  for (let i = 0; i < 6 + dice.int(4); i++) {
    const a = dice.range(0, Math.PI * 2);
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.45) continue;
    const p = beachSpot(a, dice.range(1.0, 1.08));
    b.add(new THREE.DodecahedronGeometry(0.04 + dice.range(0, 0.07)), volcanic ? C.basalt : C.rock, { p: [p.x, 0.01, p.z], r: [dice.range(0, 3), dice.range(0, 3), 0] });
  }

  // ---- trees: palms along the beach, round trees and pines inland, never on a path or a building
  const clearOf = (x: number, z: number, r: number): boolean => keepClear.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + r);
  const placed: Spot[] = [];
  const palms = volcanic ? 5 : 8;
  for (let tries = 0, n = 0; tries < 60 && n < palms; tries++) {
    const a = dice.range(0, Math.PI * 2);
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5) continue;
    const p = beachSpot(a, dice.range(0.72, 0.86));
    if (!clearOf(p.x, p.z, 0.06) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.22)) continue;
    palm(b, dice, at(p.x, p.z, -0.01), a);
    circle(p.x, p.z, 0.035);
    placed.push(p);
    n++;
  }
  const inland = volcanic ? 5 : 11;
  for (let tries = 0, n = 0; tries < 90 && n < inland; tries++) {
    const a = dice.range(0, Math.PI * 2);
    const p = beachSpot(a, Math.sqrt(dice.range(0.04, 1)) * 0.6);
    if (!clearOf(p.x, p.z, 0.08) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.17)) continue;
    const pine = volcanic || dice.int(3) === 0;
    if (pine) pineTree(b, dice, at(p.x, p.z, -0.005));
    else roundTree(b, dice, at(p.x, p.z, -0.005), volcanic);
    circle(p.x, p.z, 0.04);
    placed.push(p);
    n++;
  }
  // Tufts, flowers and bushes on the grass; reeds of dune grass on the sand. Small enough to walk through.
  for (let i = 0; i < (opts.lowQuality ? 40 : 90); i++) {
    const a = dice.range(0, Math.PI * 2);
    const s = Math.sqrt(dice.range(0.02, 1)) * 0.9;
    const p = beachSpot(a, s);
    if (!clearOf(p.x, p.z, 0.0) || onDock(p.x, p.z)) continue;
    const y = heightAt(p.x, p.z);
    if (s < 0.62) {
      const kind = dice.int(5);
      if (kind < 3) {
        const tuft = volcanic ? 0x4d5e3c : golden ? 0xb7a43f : dice.int(2) ? C.grassDark : 0x56a64f;
        for (let k = 0; k < 3; k++) b.add(cone(0.008, 0.035, 3), tuft, { p: [p.x + (k - 1) * 0.008, y + 0.014, p.z + ((k % 2) - 0.5) * 0.008], r: [dice.range(-0.3, 0.3), 0, dice.range(-0.3, 0.3)] });
      } else if (kind === 3 && !volcanic) {
        const c = dice.pick([C.flowerPink, C.flowerWhite, C.flowerYellow, C.roof]);
        for (let k = 0; k < 3; k++) b.add(ball(0.007, 5, 3), c, { p: [p.x + dice.range(-0.015, 0.015), y + 0.012, p.z + dice.range(-0.015, 0.015)] });
      } else {
        b.add(ball(0.026 + dice.range(0, 0.02), 6, 5), volcanic ? 0x4a5a40 : C.frond, { p: [p.x, y + 0.012, p.z], s: [1, 0.75, 1] });
        circle(p.x, p.z, 0.03);
      }
    } else if (s > 0.74 && dice.int(2) === 0) {
      for (let k = 0; k < 4; k++) b.add(cone(0.005, 0.05, 3), volcanic ? 0x6f7a55 : 0xb8b26a, { p: [p.x + (k - 1.5) * 0.007, y + 0.02, p.z], r: [0, 0, (k - 1.5) * 0.2] });
    }
  }

  const statics = b.build(!opts.lowQuality);
  frame.add(statics);

  // ---- crabs, scuttling sideways along the waterline
  const crabs: { g: THREE.Group; a: number; span: number; phase: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(ball(0.014, 7, 5), new THREE.MeshLambertMaterial({ color: C.crab }));
    shell.scale.set(1, 0.55, 1.25);
    shell.position.y = 0.008;
    g.add(shell);
    for (const side of [-1, 1]) {
      const claw = new THREE.Mesh(ball(0.006, 5, 4), new THREE.MeshLambertMaterial({ color: C.crab }));
      claw.position.set(0.014, 0.008, side * 0.012);
      g.add(claw);
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.Mesh(box(0.003, 0.003, 0.012), new THREE.MeshLambertMaterial({ color: 0xb8442a }));
        leg.position.set(-0.006 + k * 0.006, 0.004, side * 0.016);
        g.add(leg);
      }
    }
    frame.add(g);
    crabs.push({ g, a: dice.range(0.7, Math.PI * 2 - 0.7), span: dice.range(0.15, 0.35), phase: dice.range(0, 6) });
  }

  // ---- the walk grid
  const grid = new WalkGrid(-1.72, -1.72, DOCK.to + 0.06, 1.72, 0.04).fill((u, w) => onDock(u, w) || sOf(u, w) <= 0.965);
  for (const o of obstacles) grid.block(o, BODY);

  // ---- rings, the "you are here" flag, the chart's hit disc
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.05, 6, 48), new THREE.MeshBasicMaterial({ color: C.brass, transparent: true, opacity: 0.95 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  ring.visible = false;
  group.add(ring);
  const reachRing = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: C.parchment, transparent: true, opacity: 0.6 }));
  reachRing.rotation.x = -Math.PI / 2;
  reachRing.position.y = 0.3;
  reachRing.visible = false;
  group.add(reachRing);
  const flag = new THREE.Group();
  const flagAt: Spot = { x: plaza.x + 0.2, z: -0.22 * mirror };
  flag.position.set(flagAt.x, heightAt(flagAt.x, flagAt.z), flagAt.z);
  const pole = new THREE.Mesh(cyl(0.008, 0.01, 0.4, 5), new THREE.MeshLambertMaterial({ color: C.parchment }));
  pole.position.y = 0.2;
  flag.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshBasicMaterial({ color: C.brass, side: THREE.DoubleSide }));
  cloth.position.set(0.08, 0.34, 0);
  flag.add(cloth);
  flag.visible = false;
  frame.add(flag);
  circle(flagAt.x, flagAt.z, 0.012);
  grid.block({ kind: "circle", x: flagAt.x, z: flagAt.z, r: 0.012 }, BODY);

  const hit = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.rotation.x = -Math.PI / 2;
  hit.position.y = 0.05;
  group.add(hit);
  const dockHit = new THREE.Mesh(box(DOCK.to - DOCK.from, 0.02, DOCK.half * 2 + 0.02), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  dockHit.position.set((DOCK.from + DOCK.to) / 2, DOCK.top - 0.01, 0);
  frame.add(dockHit);

  // Invisible boxes over the buildings, so tapping the building itself walks to it.
  const buildingHits: THREE.Mesh[] = [];
  const hitBox = (building: Building, p: Spot, w: number, h: number, d: number, yaw: number): void => {
    const m = new THREE.Mesh(box(w, h, d), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    m.position.set(p.x, heightAt(p.x, p.z) + h / 2, p.z);
    m.rotation.y = yaw;
    m.userData.building = building;
    frame.add(m);
    buildingHits.push(m);
  };
  hitBox("cantina", cantinaAt, 0.46, 0.36, 0.34, cantinaYaw);
  hitBox("dock", stallAt, SW + 0.04, SH + 0.12, SD + 0.04, stallYaw);
  hitBox("notice-board", noticeAt, 0.16, NOTICE_H + 0.12, 0.16, noticeYaw);

  const toGroup = (u: number, y: number, w: number): THREE.Vector3 => new THREE.Vector3(u * Math.cos(dockAngle) - w * Math.sin(dockAngle), y, u * Math.sin(dockAngle) + w * Math.cos(dockAngle));
  const anchors: Record<Building, THREE.Vector3> = {
    dock: toGroup(stallAt.x, stallY + SH + 0.16, stallAt.z),
    cantina: toGroup(cantinaAt.x, cantinaY + 0.38, cantinaAt.z),
    "notice-board": toGroup(noticeAt.x, noticeY + NOTICE_H + 0.13, noticeAt.z),
  };
  const doors: Record<Building, Door> = {
    dock: stallDoor,
    cantina: { at: cantinaDoor, face: cantinaFace + Math.PI, inside: cantinaInside },
    "notice-board": noticeDoor,
  };

  const berth = (n: number): Berth => {
    const side = n % 2 === 0 ? 1 : -1;
    const row = Math.floor(n / 2);
    // Every ship lies bow out to sea, ready to sail; her stern clears the beach.
    const heading = 0;
    const w = side * (BERTH_W + row * BERTH_ROW);
    const gangU = BERTH_U + AIRLOCK_OFFSET;
    // Bow out, her starboard side (+z) faces +w: so the dock is to port for a ship at +w, to starboard at -w.
    return { u: BERTH_U, w, heading, foot: row === 0 ? { x: gangU, z: side * (DOCK.half - 0.035) } : null, dockSide: -side };
  };

  const chimney = smokeTop;
  return {
    group,
    frame,
    hit,
    walkable: [ground, dockHit],
    buildingHits,
    ring,
    reachRing,
    flag,
    anchors,
    dockDir,
    dockAngle,
    grid,
    heightAt,
    doors,
    doorways,
    arrival: { x: plaza.x + plazaR + 0.08, z: 0.04 * mirror },
    berth,
    animate(t, dt) {
      animateLandmark(t, dt);
      if (flag.visible) cloth.rotation.y = Math.sin(t * 4) * 0.25;
      (lantern.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 7) > -0.6 ? C.lamp : 0xd9b25a);
      for (const [i, l] of lamps.entries()) (l.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 9 + i * 2.3) > -0.85 ? C.lamp : 0xe8c060);
      sign.rotation.x = Math.sin(t * 1.3) * 0.18;
      ember.scale.set(1 + Math.sin(t * 13) * 0.15, 0.8 + Math.abs(Math.sin(t * 9)) * 0.5, 1 + Math.cos(t * 11) * 0.15);
      for (const p of smokes) {
        const k = (t * 0.3 + (p.userData.phase as number)) % 1;
        p.position.set(chimney.x + Math.sin(k * 5) * 0.03, chimney.y + k * 0.3, chimney.z + k * 0.06);
        p.scale.setScalar(0.6 + k * 1.4);
        (p.material as THREE.MeshLambertMaterial).opacity = 0.45 * (1 - k);
      }
      for (const c of crabs) {
        // Out a little and back along the shore, a pause at each end.
        const k = Math.sin(t * 0.45 + c.phase);
        const a = c.a + Math.max(-1, Math.min(1, k * 1.4)) * c.span * 0.5;
        const r = coastR(a) * 0.93;
        const u = Math.cos(a) * r;
        const w = Math.sin(a) * r;
        c.g.position.set(u, heightAt(u, w), w);
        c.g.rotation.y = -a;
        c.g.position.y += Math.abs(Math.sin(t * 18 + c.phase)) * 0.002 * (Math.abs(k) < 0.7 ? 1 : 0);
      }
      void dt;
    },
  };
}

/** The faceted ground: rings of the coast's shape from the middle out under the sea, colored by what each face is. */
function buildGround(
  coastR: (a: number) => number,
  groundAt: (u: number, w: number) => number,
  sOf: (u: number, w: number) => number,
  dice: Dice,
  look: { volcanic: boolean; golden: boolean },
): THREE.Mesh {
  const rings = [0, 0.1, 0.2, 0.3, 0.4, 0.48, 0.56, 0.62, 0.67, 0.72, 0.78, 0.84, 0.9, 0.95, 0.985, 1.02, 1.07, 1.13];
  const segs = 64;
  const verts: THREE.Vector3[][] = rings.map((s) =>
    Array.from({ length: segs }, (_, j) => {
      const a = (j / segs) * Math.PI * 2 + (s > 0 ? (rings.indexOf(s) % 2) * (Math.PI / segs) : 0);
      const r = s * coastR(a);
      const u = Math.cos(a) * r;
      const w = Math.sin(a) * r;
      return new THREE.Vector3(u, groundAt(u, w), w);
    }),
  );
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const grass = look.volcanic ? [0x4a5a40, 0x3e4d36, 0x55644a] : look.golden ? [0xc9b454, 0xbfa94a, 0xd3be5e] : [0x63b35d, 0x5aa955, 0x6fbd62];
  const sand = look.volcanic ? [0x5a5460, 0x625c68, 0x534d59] : [0xeadc9f, 0xe3d495, 0xf0e3a8];
  const wet = look.volcanic ? 0x46424c : 0xcdbb80;
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    const cu = (a.x + b.x + c.x) / 3;
    const cw = (a.z + b.z + c.z) / 3;
    const s = sOf(cu, cw);
    let hex: number;
    if (s < 0.64) hex = grass[dice.int(3)]!;
    else if (s < 0.68) hex = dice.int(2) ? grass[dice.int(3)]! : sand[dice.int(3)]!;
    else if (s < 0.95) hex = sand[dice.int(3)]!;
    else if (s < 1.01) hex = wet;
    else hex = look.volcanic ? 0x3a3640 : 0xb8a873;
    color.setHex(hex);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  };
  const center = new THREE.Vector3(0, groundAt(0, 0), 0);
  for (let j = 0; j < segs; j++) tri(center, verts[1]![j]!, verts[1]![(j + 1) % segs]!);
  for (let i = 1; i < rings.length - 1; i++) {
    const inner = verts[i]!;
    const outer = verts[i + 1]!;
    const shift = (i + 1) % 2 === 1;
    for (let j = 0; j < segs; j++) {
      const a0 = inner[j]!;
      const a1 = inner[(j + 1) % segs]!;
      const b0 = outer[j]!;
      const b1 = outer[(j + 1) % segs]!;
      if (shift) {
        tri(a0, b0, a1);
        tri(a1, b0, b1);
      } else {
        tri(a0, b0, b1);
        tri(a0, b1, a1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

/** A strip laid along a curve on the ground. */
function ribbon(b: Batch, curve: THREE.Curve<THREE.Vector3>, steps: number, width: number, y: (u: number, w: number) => number, color: number): void {
  const pos: number[] = [];
  let prevL: THREE.Vector3 | null = null;
  let prevR: THREE.Vector3 | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nx = -tan.z;
    const nz = tan.x;
    const half = (width / 2) * (i === 0 || i === steps ? 0.7 : 1);
    const l = new THREE.Vector3(p.x + nx * half, 0, p.z + nz * half);
    const r = new THREE.Vector3(p.x - nx * half, 0, p.z - nz * half);
    l.y = y(l.x, l.z);
    r.y = y(r.x, r.z);
    if (prevL && prevR) pos.push(prevL.x, prevL.y, prevL.z, l.x, l.y, l.z, prevR.x, prevR.y, prevR.z, prevR.x, prevR.y, prevR.z, l.x, l.y, l.z, r.x, r.y, r.z);
    prevL = l;
    prevR = r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  b.add(geo, color);
}

function barrel(b: Batch, p: readonly [number, number, number]): void {
  b.add(cyl(0.022, 0.022, 0.05, 8), 0x9a6a3a, { p: [p[0], p[1] + 0.025, p[2]] });
  for (const y of [0.012, 0.038]) b.add(cyl(0.0235, 0.0235, 0.005, 8), 0x2e3238, { p: [p[0], p[1] + y, p[2]] });
}

function palm(b: Batch, dice: Dice, p: [number, number, number], lean: number): void {
  const height = 0.32 + dice.range(0, 0.18);
  const tilt = 0.12 + dice.range(0, 0.12);
  b.frame({ p, r: [0, -lean, tilt] }, () => {
    // A trunk of stacked rings, so it reads as a palm close up.
    const rings = 6;
    for (let i = 0; i < rings; i++) b.add(cyl(0.017 - i * 0.0012, 0.02 - i * 0.0012, height / rings + 0.004, 6), i % 2 ? 0x8a5a2b : 0x7a4e24, { p: [0, (i + 0.5) * (height / rings), 0] });
    const fronds = 6 + dice.int(2);
    for (let f = 0; f < fronds; f++) {
      b.frame({ p: [0, height, 0], r: [0, (f / fronds) * Math.PI * 2 + dice.range(0, 0.4), -0.4 - dice.range(0, 0.3)] }, () => {
        b.add(box(0.2, 0.008, 0.055), f % 2 ? 0x3c9a4e : 0x348a45, { p: [0.095, 0, 0] });
        b.add(box(0.07, 0.008, 0.035), 0x3c9a4e, { p: [0.2, -0.02, 0], r: [0, 0, -0.4] });
      });
    }
    for (let k = 0; k < 3; k++) b.add(ball(0.012, 5, 4), 0x6b4a22, { p: [Math.cos(k * 2.1) * 0.014, height - 0.012, Math.sin(k * 2.1) * 0.014] });
  });
}

function roundTree(b: Batch, dice: Dice, p: [number, number, number], volcanic: boolean): void {
  const height = 0.09 + dice.range(0, 0.06);
  b.frame({ p, r: [0, dice.range(0, 6), 0] }, () => {
    b.add(cyl(0.012, 0.018, height, 6), 0x8a5a2b, { p: [0, height / 2, 0] });
    const r = 0.07 + dice.range(0, 0.04);
    const leaf = volcanic ? 0x4a5a40 : dice.int(2) ? 0x3c9a4e : 0x3f8f49;
    b.add(new THREE.IcosahedronGeometry(r, 0), leaf, { p: [0, height + r * 0.75, 0], r: [dice.range(0, 3), dice.range(0, 3), 0] });
    b.add(new THREE.IcosahedronGeometry(r * 0.65, 0), leaf, { p: [r * 0.55, height + r * 0.5, r * 0.2], r: [dice.range(0, 3), dice.range(0, 3), 0] });
  });
}

function pineTree(b: Batch, dice: Dice, p: [number, number, number]): void {
  const height = 0.08 + dice.range(0, 0.05);
  b.frame({ p }, () => {
    b.add(cyl(0.009, 0.013, height, 5), 0x7a4e24, { p: [0, height / 2, 0] });
    for (let i = 0; i < 3; i++) b.add(cone(0.075 - i * 0.018, 0.1, 7), i % 2 ? 0x2f7a3e : 0x3f8f49, { p: [0, height + 0.02 + i * 0.055, 0] });
  });
}
