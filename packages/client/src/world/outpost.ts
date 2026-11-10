/**
 * An outpost you can walk on (M5, ADR 0032): an open-air rock hanging in the void (ADR 0034). The
 * ground is a low-poly heightfield: a rise of regolith, a ring of dust round it, and a crater rim
 * that drops away into the void, with the rock's underside hanging below. On it, laid out from the
 * dock inland: the dock, a gantry run out over the void with berths for ships either side, the
 * shipyard and the notice board at its foot, a path up to a paved plaza with a water tank, the
 * cantina on the plaza, hab pods with their hydroponic beds, the landmark the content names at the
 * back, and the small things that make a place: antenna palms, a solar sail on its rack, a shuttle
 * up on blocks, lamps, rock mites along the rim. Everything is placed from a PRNG seeded by the
 * outpost's id, so every device builds the same outpost, the same walk grid, the same doors.
 *
 * The outpost is built in its *dock frame*: u runs out along the dock toward the lanes, w across
 * it, y up. Walk positions on the wire are in this frame. The frame is turned on the outpost so the
 * dock faces the other outposts.
 *
 * What stands where is settled by the dice, and the order they are rolled in is part of the layout:
 * a prop may be redrawn freely, but adding or dropping a roll moves everything placed after it.
 */
import * as THREE from "three";
import type { OutpostLandmark } from "@openseas/content";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";
import { Batch, unseen, type Put } from "./batch.js";
import { WalkGrid, type Obstacle, type Spot } from "./walk.js";

export type Building = "dock" | "cantina" | "notice-board";

export const OUTPOST_PALETTE = {
  tin: 0xc3ccd4,
  tinDark: 0x8a94a0,
  steel: 0x5d6673,
  iron: 0x2e3238,
  cream: 0xe6dcc3,
  creamDark: 0xb8ad93,
  rust: 0xc8663a,
  rustDark: 0x8f4526,
  teal: 0x2f8f8a,
  tealDark: 0x216a66,
  blue: 0x3e6f9a,
  blueDark: 0x2c5277,
  panel: 0x24507a,
  panelLight: 0x2f6a9e,
  rock: 0x8a8399,
  rockLight: 0xa7a0b8,
  rockDark: 0x4c465c,
  paving: 0xb9b4c4,
  pavingDark: 0x9590a4,
  cable: 0x3a3f4a,
  foil: 0xe8c56a,
  foilLight: 0xf2dc9a,
  brass: 0xd4a548,
  parchment: 0xefe3c6,
  lamp: 0xffd36b,
  lampOff: 0x6b5a2a,
  window: 0xffe9a8,
  glow: 0x7fe3ff,
  grow: 0xd68cff,
  heat: 0xff8a3d,
  ice: 0xd7f1ff,
  iceBlue: 0x8fd0f0,
  iceDeep: 0x4f9fca,
  vapor: 0xeaf7ff,
  leaf: 0x4aa874,
  leafDark: 0x2f7a55,
  crystal: 0x8fe0e8,
  crystalViolet: 0xb79cf0,
  mite: 0x5f5478,
  miteDark: 0x3f3852,
} as const;
const C = OUTPOST_PALETTE;
const FROST = new THREE.Color(OUTPOST_PALETTE.iceBlue);

/** What an outpost's ground is made of: the rise, the ring of dust round it, the rim's lip, the rock under it, the paths. */
interface Ground {
  rise: readonly [number, number, number];
  dust: readonly [number, number, number];
  lip: number;
  under: readonly [number, number, number];
  path: number;
  pebble: readonly [number, number];
}
const GROUNDS: Record<"plain" | "ochre" | "frost", Ground> = {
  // Lilac-grey regolith inside a ring of pale dust.
  plain: { rise: [0x8e88a6, 0x847e9c, 0x9891b0], dust: [0xd3cdbf, 0xcac4b5, 0xdcd6c8], lip: 0xb3ad9f, under: [0x5a5470, 0x4e4963, 0x66607c], path: 0xbdb6c9, pebble: [0x6f6a85, 0xa9a2bd] },
  // Ochre regolith inside a ring of rust dust.
  ochre: { rise: [0xc9a24e, 0xbf9645, 0xd3ad5a], dust: [0xb9764a, 0xae6c42, 0xc48253], lip: 0x9c5f3a, under: [0x6b4a3a, 0x5c3f32, 0x7a5644], path: 0xe0bf74, pebble: [0x9c7a3a, 0x9c7a3a] },
  // Frozen blue-grey ground inside a ring of black dust.
  frost: { rise: [0x5d667e, 0x545c73, 0x68728c], dust: [0x2f2d38, 0x353340, 0x292731], lip: 0x23212b, under: [0x2a2833, 0x23212b, 0x33313d], path: 0x6b7388, pebble: [0x6b7388, 0x6b7388] },
};

/** The dock's deck: from the rim out over the void, and how wide. */
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
  /** Per-frame life: lamps, the landmark, steam, rock mites. */
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
  // The geyser's outpost is frozen ground in black dust; the dish's is ochre.
  const frozen = landmark === "geyser";
  const ochre = landmark === "dish";
  const tones = GROUNDS[frozen ? "frost" : ochre ? "ochre" : "plain"];
  const mirror = dice.int(2) ? 1 : -1;
  const group = new THREE.Group();
  const frame = new THREE.Group();
  const dockDir = dockToward.clone().normalize();
  const dockAngle = Math.atan2(dockDir.y, dockDir.x);
  frame.rotation.y = -dockAngle;
  group.add(frame);

  // ---- the rim: a wobbling radius, held steady where the dock comes in
  const RIM = 1.5;
  const knots: number[] = [];
  for (let i = 0; i < 14; i++) knots.push(0.88 + dice.range(0, 0.24));
  const rimR = (a: number): number => {
    const f = (((a / (Math.PI * 2)) % 1) + 1) % 1;
    const x = f * knots.length;
    const i = Math.floor(x);
    const k = (1 - Math.cos((x - i) * Math.PI)) / 2;
    const wob = knots[i % knots.length]! * (1 - k) + knots[(i + 1) % knots.length]! * k;
    const near = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    return RIM * (1 + (wob - 1) * smooth(0.25, 0.75, near));
  };
  const phases = [dice.range(0, 6), dice.range(0, 6), dice.range(0, 6)];
  const landmarkAt: Spot = frozen ? { x: -0.78, z: -0.08 * mirror } : { x: -0.74, z: -0.26 * mirror };
  const mound = landmark === "beacon" || landmark === "dish" || landmark === "fort";
  const profile = (s: number): number => {
    if (s < 0.58) return 0.3 + 0.055 * (1 - (s / 0.58) ** 2);
    if (s < 0.7) return 0.3 - 0.075 * smooth(0.58, 0.7, s);
    if (s < 0.92) return 0.225 - (0.03 * (s - 0.7)) / 0.22;
    if (s < 1) return 0.195 - 0.135 * smooth(0.92, 1, s);
    // Past the rim the ground is gone: the rock's side drops into the void (drawn by buildUnderside).
    return Math.max(-0.32, 0.06 - (s - 1) * 3.2);
  };
  const sOf = (u: number, w: number): number => Math.hypot(u, w) / rimR(Math.atan2(w, u));
  const groundAt = (u: number, w: number): number => {
    const s = sOf(u, w);
    let h = profile(s);
    if (s < 0.68) h += (0.006 * Math.sin(u * 5.1 + phases[0]!) + 0.005 * Math.sin(w * 6.3 + phases[1]!) + 0.004 * Math.sin((u + w) * 8.7 + phases[2]!)) * (1 - smooth(0.5, 0.68, s));
    if (mound) h += 0.07 * Math.exp(-((u - landmarkAt.x) ** 2 + (w - landmarkAt.z) ** 2) / 0.09);
    return h;
  };
  const onDock = (u: number, w: number): boolean => u >= DOCK.from && u <= DOCK.to && Math.abs(w) <= DOCK.half;
  // The plaza is paved level, a little proud of the ground.
  const plaza: Spot = { x: 0.42, z: 0 };
  const plazaR = 0.25;
  const plazaTop = groundAt(plaza.x, plaza.z) + 0.011;
  const heightAt = (u: number, w: number): number => (onDock(u, w) ? DOCK.top : Math.hypot(u - plaza.x, w - plaza.z) < plazaR ? plazaTop : groundAt(u, w));

  // ---- the ground mesh: faceted, colored face by face
  const ground = buildGround(rimR, groundAt, sOf, dice, tones, frozen ? landmarkAt : null);
  frame.add(ground);
  frame.add(buildUnderside(id, rimR, tones));

  const b = new Batch();
  const obstacles: Obstacle[] = [];
  const keepClear: { x: number; z: number; r: number }[] = [];
  const at = (u: number, w: number, lift = 0): [number, number, number] => [u, heightAt(u, w) + lift, w];
  const solidAt = (geometry: THREE.BufferGeometry, color: number, put: Put): void => b.add(geometry, color, put);
  const circle = (x: number, z: number, r: number): void => void obstacles.push({ kind: "circle", x, z, r });
  /** A box obstacle for a thing turned by three.js yaw `yaw` about its center. */
  const block = (x: number, z: number, hw: number, hd: number, yaw: number): void => void obstacles.push({ kind: "box", x, z, hw, hd, angle: -yaw });

  // ---- the dock: a gantry of deck plates run out over the void, braced back to the rock
  const dockTop = DOCK.top;
  for (let u = DOCK.from + 0.04; u < DOCK.to; u += 0.075) {
    const shade = dice.int(4) === 0 ? C.steel : dice.int(2) ? C.tin : C.tinDark;
    solidAt(box(0.07, 0.025, DOCK.half * 2 + dice.range(-0.01, 0.015)), shade, { p: [u, dockTop - 0.0125, dice.range(-0.006, 0.006)], r: [0, dice.range(-0.03, 0.03), 0] });
  }
  for (let u = DOCK.from + 0.1; u <= DOCK.to; u += 0.3) {
    // A cross-beam under the plates, a hanger at each end of it and a marker light on its tip.
    solidAt(box(0.02, 0.02, DOCK.half * 2 + 0.03), C.steel, { p: [u, dockTop - 0.06, 0] });
    for (const side of [-1, 1]) {
      solidAt(cyl(0.012, 0.012, 0.1, 6), C.steel, { p: [u, dockTop - 0.075, side * (DOCK.half + 0.005)] });
      b.addGlow(box(0.014, 0.01, 0.014), C.lamp, { p: [u, dockTop - 0.022, side * (DOCK.half + 0.016)] });
      // Clamps at the edge where ships make fast.
      if (Math.abs(u - BERTH_U) < 0.6) {
        solidAt(cyl(0.014, 0.016, 0.03, 7), C.iron, { p: [u, dockTop + 0.015, side * (DOCK.half - 0.02)] });
        solidAt(cyl(0.019, 0.019, 0.006, 7), C.iron, { p: [u, dockTop + 0.032, side * (DOCK.half - 0.02)] });
        circle(u, side * (DOCK.half - 0.02), 0.015);
      }
    }
  }
  // Girders along both edges and a keel beam under the middle.
  for (const side of [-1, 1]) solidAt(box(DOCK.to - DOCK.from, 0.03, 0.02), C.tinDark, { p: [(DOCK.from + DOCK.to) / 2, dockTop - 0.04, side * DOCK.half] });
  solidAt(box(DOCK.to - DOCK.from - 0.1, 0.035, 0.035), C.steel, { p: [(DOCK.from + DOCK.to) / 2, dockTop - 0.09, 0] });
  // Struts from the rock's face up to the gantry, and a lift pod under its far end holding it level.
  for (const side of [-1, 1]) {
    for (const reach of [2.0, 2.62]) {
      const from = { u: RIM + 0.03, y: -0.3 };
      const dx = reach - from.u;
      const dy = dockTop - 0.1 - from.y;
      solidAt(cyl(0.011, 0.014, Math.hypot(dx, dy), 5), C.steel, { p: [from.u + dx / 2, from.y + dy / 2, side * 0.075], r: [0, 0, Math.atan2(dy, dx) - Math.PI / 2] });
    }
  }
  solidAt(cyl(0.05, 0.06, 0.05, 8), C.tinDark, { p: [DOCK.to - 0.16, dockTop - 0.13, 0] });
  b.addGlow(cyl(0.04, 0.03, 0.012, 8), C.glow, { p: [DOCK.to - 0.16, dockTop - 0.16, 0] });
  // Cargo boxes, a drum and a coil of cable at the root of the dock; a lamp at its end.
  const cargo = [
    [DOCK.from + 0.12, 0.08, "crate"],
    [DOCK.from + 0.12, 0.08, "crate2"],
    [DOCK.from + 0.21, 0.09, "barrel"],
    [DOCK.to - 0.1, -0.08, "coil"],
  ] as const;
  for (const [u, w0, kind] of cargo) {
    const w = w0 * mirror;
    if (kind === "crate") {
      solidAt(box(0.06, 0.05, 0.06), C.teal, { p: [u, dockTop + 0.025, w], r: [0, 0.2, 0] });
      solidAt(box(0.062, 0.008, 0.062), C.tealDark, { p: [u, dockTop + 0.026, w], r: [0, 0.2, 0] });
    } else if (kind === "crate2") solidAt(box(0.045, 0.04, 0.045), C.rust, { p: [u, dockTop + 0.07, w], r: [0, -0.3, 0] });
    else if (kind === "barrel") drum(b, [u, dockTop, w], C.blue);
    else {
      solidAt(new THREE.TorusGeometry(0.022, 0.008, 5, 12), C.cable, { p: [u, dockTop + 0.006, w], r: [Math.PI / 2, 0, 0] });
      solidAt(new THREE.TorusGeometry(0.013, 0.007, 5, 10), C.cable, { p: [u, dockTop + 0.014, w], r: [Math.PI / 2, 0, 0] });
    }
    circle(u, w, kind === "coil" ? 0.03 : 0.04);
  }
  solidAt(cyl(0.012, 0.014, 0.17, 6), C.steel, { p: [DOCK.to - 0.04, dockTop + 0.085, 0.1 * mirror] });
  solidAt(box(0.03, 0.01, 0.03), C.iron, { p: [DOCK.to - 0.04, dockTop + 0.175, 0.1 * mirror] });
  const lantern = new THREE.Mesh(ball(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: C.lamp }));
  lantern.position.set(DOCK.to - 0.04, dockTop + 0.155, 0.1 * mirror);
  frame.add(lantern);
  circle(DOCK.to - 0.04, 0.1 * mirror, 0.015);

  // ---- the path inland, the plaza and its water tank
  const cantinaAt: Spot = { x: 0.02, z: 0.6 * mirror };
  const yardAt: Spot = { x: 0.98, z: -0.38 * mirror };
  const noticeAt: Spot = { x: 0.98, z: 0.3 * mirror };
  const podA: Spot = { x: 0.12, z: -0.64 * mirror };
  const podB: Spot | null = frozen ? null : { x: -0.34, z: 0.44 * mirror };
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
      { x: landmarkAt.x + (frozen ? 0.68 : 0.17), z: landmarkAt.z + (frozen ? 0.12 * mirror : 0.03 * mirror) },
    ],
    [{ x: plaza.x - 0.1, z: -plazaR * mirror }, { x: podA.x + 0.12, z: podA.z + 0.2 * mirror }],
  ];
  if (podB) paths.push([{ x: plaza.x - plazaR, z: 0.05 * mirror }, { x: podB.x + 0.2, z: podB.z - 0.12 * mirror }]);
  for (const line of paths) {
    const curve = new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(p.x, 0, p.z)));
    const length = curve.getLength();
    const steps = Math.max(2, Math.ceil(length / 0.04));
    ribbon(b, curve, steps, 0.085, (u, w) => heightAt(u, w) + 0.004, tones.path);
    for (let i = 0; i <= steps; i += 2) {
      const p = curve.getPointAt(i / steps);
      for (const side of [-1, 1]) {
        if (dice.int(3) === 0) continue;
        const tan = curve.getTangentAt(i / steps);
        const ox = -tan.z * side * dice.range(0.01, 0.028);
        const oz = tan.x * side * dice.range(0.01, 0.028);
        solidAt(cyl(dice.range(0.012, 0.02), dice.range(0.014, 0.022), 0.006, 6), dice.int(2) ? C.paving : C.pavingDark, { p: at(p.x + ox, p.z + oz, 0.006), r: [0, dice.range(0, 3), 0] });
      }
      keepClear.push({ x: p.x, z: p.z, r: 0.09 });
    }
  }
  // Paving: a level disc, then slabs on it.
  const plazaY = plazaTop - 0.011;
  solidAt(cyl(plazaR, plazaR + 0.012, 0.03, 20), C.pavingDark, { p: [plaza.x, plazaY - 0.008, plaza.z] });
  for (let i = 0; i < 46; i++) {
    const a = dice.range(0, Math.PI * 2);
    const r = Math.sqrt(dice.range(0.02, 1)) * (plazaR - 0.02);
    solidAt(cyl(0.02, 0.022, 0.008, 6), dice.int(3) ? C.paving : C.rockLight, { p: [plaza.x + Math.cos(a) * r, plazaY + 0.008, plaza.z + Math.sin(a) * r], r: [0, a, 0] });
  }
  keepClear.push({ x: plaza.x, z: plaza.z, r: plazaR + 0.12 });
  // The water tank: a drum on three legs over a stone ring, a filler cap, a pipe down to a tap and a gauge.
  b.frame({ p: [plaza.x, plazaY, plaza.z] }, () => {
    b.add(cyl(0.055, 0.06, 0.02, 10), C.rockLight, { p: [0, 0.01, 0] });
    for (let k = 0; k < 3; k++) b.add(box(0.009, 0.045, 0.009), C.steel, { p: [Math.cos(k * 2.1) * 0.036, 0.04, Math.sin(k * 2.1) * 0.036] });
    b.add(cyl(0.046, 0.046, 0.075, 12), C.tin, { p: [0, 0.098, 0] });
    b.add(cyl(0.0475, 0.0475, 0.012, 12), C.blue, { p: [0, 0.098, 0] });
    b.add(cyl(0.02, 0.046, 0.02, 12), C.tinDark, { p: [0, 0.1455, 0] });
    b.add(cyl(0.012, 0.012, 0.012, 8), C.rust, { p: [0, 0.16, 0] });
    b.add(cyl(0.005, 0.005, 0.1, 5), C.steel, { p: [0.051, 0.07, 0] });
    b.add(box(0.016, 0.006, 0.006), C.brass, { p: [0.058, 0.03, 0] });
    b.addGlow(box(0.005, 0.05, 0.01), C.glow, { p: [0, 0.098, 0.0465] });
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

  // ---- the notice board at the dock's foot: a pillar of bills and screens all round, so it reads from any side
  const noticeY = heightAt(noticeAt.x, noticeAt.z);
  const noticeYaw = yawFacing(-Math.PI / 2 * mirror);
  const NOTICE_H = 0.24;
  b.frame({ p: [noticeAt.x, noticeY, noticeAt.z] }, () => {
    b.add(cyl(0.07, 0.078, 0.03, 10), C.rock, { p: [0, 0.008, 0] });
    b.add(cyl(0.05, 0.052, NOTICE_H, 12), C.steel, { p: [0, NOTICE_H / 2 + 0.02, 0] });
    for (const y of [0.04, NOTICE_H + 0.012]) b.add(cyl(0.056, 0.056, 0.014, 12), C.iron, { p: [0, y, 0] });
    // Bills pasted round it and a few lit screens among them, some half over others.
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + dice.range(-0.15, 0.15);
      const y = 0.08 + (i % 3) * 0.05 + dice.range(0, 0.02);
      const c = dice.pick([C.parchment, C.parchment, C.glow, 0xf2e2b8, C.rust, C.window]);
      const put: Put = { p: [Math.cos(a) * 0.052, y, Math.sin(a) * 0.052], r: [0, -a, dice.range(-0.12, 0.12)] };
      if (c === C.glow || c === C.window) b.addGlow(box(0.004, 0.05, 0.034), c, put);
      else b.add(box(0.004, 0.05, 0.034), c, put);
    }
    // A cap like an upturned dish, and an aerial with a light on it.
    b.add(cone(0.085, 0.07, 12), C.tinDark, { p: [0, NOTICE_H + 0.055, 0] });
    b.add(cyl(0.004, 0.004, 0.07, 5), C.iron, { p: [0, NOTICE_H + 0.12, 0] });
    b.addGlow(ball(0.011, 8, 6), C.lamp, { p: [0, NOTICE_H + 0.16, 0] });
  });
  circle(noticeAt.x, noticeAt.z, 0.075);
  const noticeDoor: Door = { at: { x: noticeAt.x, z: noticeAt.z - 0.14 * mirror }, face: (Math.PI / 2) * mirror, inside: null };
  keepClear.push({ x: noticeAt.x, z: noticeAt.z, r: 0.2 });

  // ---- the shipyard: the dock's office, where ships are bought, with a hull in frame on stands outside
  const yardY = heightAt(yardAt.x, yardAt.z);
  const yardYaw = yawFacing((Math.PI / 2) * mirror);
  const SW = 0.3;
  const SD = 0.22;
  const SH = 0.16;
  const yardDoorX = -0.06;
  b.frame({ p: [yardAt.x, yardY, yardAt.z], r: [0, yardYaw, 0] }, () => {
    b.add(box(SW + 0.03, 0.05, SD + 0.03), C.rock, { p: [0, -0.012, 0] });
    b.add(box(SW, SH, SD), C.tin, { p: [0, SH / 2, 0] });
    // Corrugations on the front and sides.
    for (let i = 1; i < 6; i++) {
      b.add(box(SW + 0.002, 0.004, 0.004), C.tinDark, { p: [0, i * (SH / 6), SD / 2 + 0.001] });
      for (const side of [-1, 1]) b.add(box(0.004, 0.004, SD + 0.002), C.tinDark, { p: [side * (SW / 2 + 0.001), i * (SH / 6), 0] });
    }
    for (const x of [-SW / 2, SW / 2]) b.add(box(0.016, SH, 0.016), C.steel, { p: [x, SH / 2, SD / 2] });
    for (const side of [-1, 1]) b.add(box(SW + 0.05, 0.014, SD * 0.66), C.blue, { p: [0, SH + 0.055, side * SD * 0.26], r: [side * 0.55, 0, 0] });
    b.add(box(SW + 0.06, 0.018, 0.018), C.blueDark, { p: [0, SH + 0.1, 0] });
    for (const side of [-1, 1]) {
      const gable = new THREE.Shape();
      gable.moveTo(-SD / 2, 0);
      gable.lineTo(SD / 2, 0);
      gable.lineTo(0, 0.095);
      gable.closePath();
      b.add(new THREE.ShapeGeometry(gable), C.tin, { p: [side * (SW / 2 + 0.001), SH, 0], r: [0, (side * Math.PI) / 2, 0] });
    }
    // The doorway (its door swings, below), and a wide window onto the yard.
    b.add(box(0.068, 0.112, 0.004), 0x14181d, { p: [yardDoorX, 0.056, SD / 2 + 0.002] });
    b.add(box(0.08, 0.012, 0.012), C.steel, { p: [yardDoorX, 0.117, SD / 2 + 0.004] });
    b.addGlow(box(0.08, 0.05, 0.006), C.window, { p: [0.07, 0.085, SD / 2 + 0.002] });
    b.add(box(0.09, 0.008, 0.016), C.steel, { p: [0.07, 0.057, SD / 2 + 0.008] });
    b.add(box(0.004, 0.05, 0.008), C.steel, { p: [0.07, 0.085, SD / 2 + 0.005] });
    // A little rocket hung over the door for a sign.
    b.add(box(0.05, 0.004, 0.004), C.iron, { p: [yardDoorX + 0.01, 0.145, SD / 2 + 0.025] });
    b.add(cyl(0.009, 0.009, 0.034, 7), C.cream, { p: [yardDoorX + 0.008, 0.13, SD / 2 + 0.04], r: [0, 0, Math.PI / 2] });
    b.add(cone(0.009, 0.018, 7), C.rust, { p: [yardDoorX + 0.034, 0.13, SD / 2 + 0.04], r: [0, 0, -Math.PI / 2] });
    b.add(box(0.012, 0.03, 0.003), C.rust, { p: [yardDoorX - 0.008, 0.13, SD / 2 + 0.04] });
    // Hull plates stacked against one side.
    for (let i = 0; i < 4; i++) b.add(box(0.03, 0.025, 0.2), i % 2 ? C.tinDark : C.rust, { p: [SW / 2 + 0.03 + (i % 2) * 0.03, 0.012 + Math.floor(i / 2) * 0.025, 0], r: [0, 0.05 * i, 0] });
    // A hull in frame on stands by the other: a keel, its ribs, and the first plates.
    b.frame({ p: [-SW / 2 - 0.1, 0, 0.02] }, () => {
      for (const z of [-0.06, 0.06]) {
        for (const lean of [-0.3, 0.3]) b.add(box(0.008, 0.06, 0.008), C.steel, { p: [lean * 0.06, 0.028, z], r: [0, 0, lean] });
        b.add(box(0.05, 0.006, 0.01), C.steel, { p: [0, 0.056, z] });
      }
      b.add(box(0.012, 0.012, 0.2), C.iron, { p: [0, 0.064, 0] });
      for (let i = 0; i < 5; i++) b.add(new THREE.TorusGeometry(0.035, 0.0035, 4, 10, Math.PI), C.tinDark, { p: [0, 0.1, -0.08 + i * 0.04], r: [Math.PI, 0, 0] });
      for (const side of [-1, 1]) b.add(box(0.006, 0.012, 0.16), C.cream, { p: [side * 0.03, 0.09, 0] });
    });
  });
  block(yardAt.x, yardAt.z, SW / 2 + 0.01, SD / 2 + 0.01, yardYaw);
  {
    const plates = onBuilding(yardAt, yardYaw, SW / 2 + 0.045, 0);
    block(plates.x, plates.z, 0.035, 0.11, yardYaw);
    const hull = onBuilding(yardAt, yardYaw, -SW / 2 - 0.1, 0.02);
    block(hull.x, hull.z, 0.045, 0.11, yardYaw);
  }
  const yardDoor: Door = {
    at: onBuilding(yardAt, yardYaw, yardDoorX, SD / 2 + 0.1),
    face: (-Math.PI / 2) * mirror,
    inside: onBuilding(yardAt, yardYaw, yardDoorX, SD / 2 - 0.07),
  };
  keepClear.push({ x: yardAt.x, z: yardAt.z, r: 0.32 });

  // ---- the cantina: painted panels under a barrel roof of tin, a vent stack, a lit sign
  const cantinaY = heightAt(cantinaAt.x, cantinaAt.z);
  const cantinaYaw = yawFacing(cantinaFace);
  const sign = new THREE.Group();
  const steamTop = new THREE.Vector3();
  b.frame({ p: [cantinaAt.x, cantinaY, cantinaAt.z], r: [0, cantinaYaw, 0] }, () => {
    const W = 0.42;
    const D = 0.3;
    const H = 0.2;
    b.add(box(W + 0.03, 0.05, D + 0.03), C.rock, { p: [0, -0.01, 0] });
    b.add(box(W, H, D), C.cream, { p: [0, H / 2, 0] });
    // Ribs on the front.
    for (const x of [-W / 2 + 0.005, -0.07, 0.07, W / 2 - 0.005]) b.add(box(0.014, H, 0.01), C.rustDark, { p: [x, H / 2, D / 2 + 0.002] });
    b.add(box(W, 0.014, 0.01), C.rustDark, { p: [0, H * 0.55, D / 2 + 0.002] });
    b.add(box(W, 0.014, 0.01), C.rustDark, { p: [0, H - 0.007, D / 2 + 0.002] });
    // A barrel roof, its ridge along the front: half a drum on its side, hoops over it, a half-moon wall at each end.
    const arch = D / 2 + 0.02;
    const rise = 0.72;
    b.add(new THREE.CylinderGeometry(arch, arch, W + 0.06, 12, 1, false, 0, Math.PI), C.tin, { p: [0, H, 0], r: [0, 0, Math.PI / 2], s: [rise, 1, 1] });
    for (const x of [-W / 2 - 0.02, -0.105, 0, 0.105, W / 2 + 0.02]) b.add(new THREE.CylinderGeometry(arch + 0.006, arch + 0.006, 0.016, 12, 1, false, 0, Math.PI), C.tinDark, { p: [x, H, 0], r: [0, 0, Math.PI / 2], s: [rise, 1, 1] });
    for (const side of [-1, 1]) b.add(new THREE.CircleGeometry(arch - 0.02, 12, 0, Math.PI), C.cream, { p: [side * (W / 2 + 0.001), H, 0], r: [0, (side * Math.PI) / 2, 0], s: [1, rise, 1] });
    // The vent stack, through the roof.
    b.add(cyl(0.02, 0.024, 0.15, 8), C.steel, { p: [W * 0.3, H + 0.1, -0.06] });
    b.add(cyl(0.028, 0.028, 0.012, 8), C.iron, { p: [W * 0.3, H + 0.17, -0.06] });
    // The doorway (its door swings, below), lit windows and lamps either side of it, a strip of light over it.
    b.add(box(0.075, 0.122, 0.004), 0x14181d, { p: [0, 0.061, D / 2 + 0.002] });
    b.add(box(0.088, 0.012, 0.014), C.rustDark, { p: [0, 0.128, D / 2 + 0.006] });
    b.addGlow(box(0.1, 0.006, 0.006), C.glow, { p: [0, 0.142, D / 2 + 0.008] });
    for (const x of [-0.14, 0.14]) {
      b.addGlow(box(0.06, 0.05, 0.008), C.window, { p: [x, 0.08, D / 2 + 0.004] });
      b.add(box(0.07, 0.008, 0.014), C.rustDark, { p: [x, 0.052, D / 2 + 0.008] });
      b.addGlow(box(0.055, 0.04, 0.008), C.window, { p: [x * 0.9, 0.15, D / 2 + 0.004] });
    }
    for (const side of [-1, 1]) b.addGlow(box(0.014, 0.02, 0.014), C.lamp, { p: [side * 0.055, 0.13, D / 2 + 0.02] });
    // A bench and drums outside.
    b.add(box(0.12, 0.012, 0.03), C.tinDark, { p: [-0.16, 0.032, D / 2 + 0.06] });
    for (const x of [-0.21, -0.11]) b.add(box(0.01, 0.03, 0.025), C.steel, { p: [x, 0.015, D / 2 + 0.06] });
    drum(b, [0.17, 0, D / 2 + 0.05], C.rust);
    drum(b, [0.2, 0, D / 2 + 0.09], C.teal);
    steamTop.copy(b.point(W * 0.3, H + 0.17, -0.06));
  });
  {
    // The sign hangs from a bracket and swings a little.
    const yawM = new THREE.Matrix4().makeRotationY(cantinaYaw);
    const bracket = new THREE.Vector3(0.12, 0.2, 0.17).applyMatrix4(yawM);
    sign.position.set(cantinaAt.x + bracket.x, cantinaY + bracket.y, cantinaAt.z + bracket.z);
    sign.rotation.y = cantinaYaw;
    const board = new THREE.Mesh(box(0.07, 0.045, 0.008), new THREE.MeshLambertMaterial({ color: C.iron }));
    board.position.y = -0.03;
    const mug = new THREE.Mesh(cyl(0.01, 0.009, 0.018, 8), new THREE.MeshBasicMaterial({ color: C.lamp }));
    mug.position.set(0, -0.03, 0.006);
    mug.rotation.x = Math.PI / 2;
    sign.add(board, mug);
    frame.add(sign);
    b.frame({ p: [cantinaAt.x, cantinaY, cantinaAt.z], r: [0, cantinaYaw, 0] }, () => b.add(box(0.07, 0.008, 0.008), C.iron, { p: [0.12, 0.205, 0.15] }));
  }
  block(cantinaAt.x, cantinaAt.z, 0.24, 0.17, cantinaYaw);
  // The bench and drums in front stand in the way too.
  for (const [lx, lz] of [
    [-0.16, 0.21],
    [0.185, 0.22],
  ] as const) {
    const c = Math.cos(cantinaYaw);
    const s = Math.sin(cantinaYaw);
    circle(cantinaAt.x + lx * c + lz * s, cantinaAt.z - lx * s + lz * c, 0.045);
  }
  keepClear.push({ x: cantinaAt.x, z: cantinaAt.z, r: 0.38 });
  // Steam off the vent stack.
  const steam: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(ball(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: C.vapor, transparent: true, opacity: 0.5, depthWrite: false }));
    puff.userData.phase = i / 4;
    frame.add(puff);
    steam.push(puff);
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
    // A porthole in it, and a seam across.
    const port = new THREE.Mesh(cyl(0.011, 0.011, 0.01, 10), new THREE.MeshBasicMaterial({ color: C.window }));
    port.rotation.x = Math.PI / 2;
    port.position.set(w / 2, h * 0.72, 0);
    const seam = new THREE.Mesh(box(w, 0.003, 0.009), new THREE.MeshLambertMaterial({ color: 0x1f2329 }));
    seam.position.set(w / 2, h * 0.42, 0);
    pivot.add(leaf, knob, port, seam);
    frame.add(pivot);
    return { pivot, yaw, open: 0 };
  };
  const doorways: Partial<Record<Building, Doorway>> = {
    cantina: doorLeaf(cantinaAt, cantinaY, cantinaYaw, 0, 0.15, 0.072, 0.118, C.rustDark),
    dock: doorLeaf(yardAt, yardY, yardYaw, yardDoorX, SD / 2, 0.066, 0.11, C.steel),
  };

  // ---- hab pods, each with a hydroponic bed under a grow light
  for (const [i, home] of [podA, podB].entries()) {
    if (!home) continue;
    const y = heightAt(home.x, home.z);
    const yaw = yawFacing(towardPlaza(home));
    const paint = dice.int(2) ? C.rust : C.blue;
    // Tinwick's roofs are bare tin; elsewhere they are painted.
    const roof = landmark === "beacon" ? C.tin : paint;
    b.frame({ p: [home.x, y, home.z], r: [0, yaw, 0] }, () => {
      b.add(box(0.26, 0.05, 0.22), C.rock, { p: [0, -0.012, 0] });
      // The pod: a drum of painted panels under a dome.
      b.add(cyl(0.105, 0.11, 0.11, 12), C.cream, { p: [0, 0.055, 0] });
      b.add(cyl(0.109, 0.109, 0.014, 12), paint, { p: [0, 0.03, 0] });
      b.add(new THREE.SphereGeometry(0.106, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), roof, { p: [0, 0.11, 0], s: [1, 0.78, 1] });
      b.add(cyl(0.02, 0.02, 0.012, 8), C.tinDark, { p: [0, 0.195, 0] });
      b.add(box(0.05, 0.086, 0.012), C.steel, { p: [0.04, 0.043, 0.098] });
      b.addGlow(cyl(0.02, 0.02, 0.008, 10), C.window, { p: [-0.062, 0.07, 0.086], r: [Math.PI / 2, 0, 0.62] });
      // The first one has an aerial.
      if (i === 0) {
        b.add(cyl(0.004, 0.004, 0.1, 5), C.iron, { p: [-0.06, 0.22, -0.04] });
        b.add(box(0.05, 0.004, 0.004), C.iron, { p: [-0.06, 0.25, -0.04] });
      }
      // Two troughs of greens to one side, a grow light on a frame over them.
      const fx = 0.2;
      for (const z of [0.045, -0.045]) b.add(box(0.13, 0.022, 0.05), C.tinDark, { p: [fx + 0.06, 0.011, z] });
      for (let k = 0; k < 6; k++) b.add(ball(0.014, 5, 4), k % 2 ? C.leafDark : C.leaf, { p: [fx + 0.025 + (k % 3) * 0.04, 0.028, k < 3 ? 0.045 : -0.045] });
      for (const x of [fx - 0.005, fx + 0.125]) b.add(box(0.007, 0.085, 0.007), C.steel, { p: [x, 0.042, 0] });
      b.add(box(0.14, 0.008, 0.02), C.steel, { p: [fx + 0.06, 0.088, 0] });
      b.addGlow(box(0.12, 0.004, 0.012), C.grow, { p: [fx + 0.06, 0.082, 0] });
    });
    block(home.x, home.z, 0.14, 0.12, yaw);
    {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      block(home.x + 0.26 * c, home.z - 0.26 * s, 0.075, 0.11, yaw);
    }
    keepClear.push({ x: home.x, z: home.z, r: 0.3 });
  }

  // ---- a noodle stall at the plaza's edge
  {
    const a = Math.atan2(0.3 * mirror, 0.1);
    const u = plaza.x + Math.cos(a) * (plazaR + 0.05);
    const w = plaza.z + Math.sin(a) * (plazaR + 0.05);
    const yaw = yawFacing(a + Math.PI);
    const y = heightAt(u, w);
    b.frame({ p: [u, y, w], r: [0, yaw, 0] }, () => {
      b.add(box(0.14, 0.045, 0.06), C.tinDark, { p: [0, 0.022, 0] });
      b.add(box(0.15, 0.006, 0.07), C.steel, { p: [0, 0.047, 0] });
      // Three bowls on the counter and a pot on the boil behind them.
      for (const x of [-0.045, 0, 0.045]) {
        b.add(cyl(0.013, 0.008, 0.01, 8), C.cream, { p: [x, 0.055, 0.012] });
        b.add(cyl(0.011, 0.011, 0.003, 8), 0xe8c56a, { p: [x, 0.061, 0.012] });
      }
      b.add(cyl(0.016, 0.014, 0.022, 8), C.iron, { p: [-0.03, 0.061, -0.016] });
      b.add(ball(0.012, 6, 4), C.vapor, { p: [-0.03, 0.085, -0.016] });
      for (const side of [-1, 1]) b.add(box(0.008, 0.13, 0.008), C.steel, { p: [side * 0.065, 0.065, -0.025] });
      b.add(box(0.17, 0.006, 0.09), dice.int(2) ? C.rust : 0xdba53a, { p: [0, 0.13, 0.005], r: [0.28, 0, 0] });
      // A paper lantern off the awning's corner.
      b.addGlow(ball(0.012, 7, 5), C.heat, { p: [0.07, 0.1, 0.04] });
    });
    block(u, w, 0.08, 0.04, yaw);
    keepClear.push({ x: u, z: w, r: 0.12 });
  }

  // ---- the landmark at the back
  const landmarkY = heightAt(landmarkAt.x, landmarkAt.z);
  let animateLandmark: (t: number, dt: number) => void = () => {};
  if (landmark === "beacon") {
    // A beacon tower: banded tin, a gallery round the lamp, an aerial on its cap, and a beam that sweeps.
    const tower = new THREE.Group();
    tower.position.set(landmarkAt.x, landmarkY, landmarkAt.z);
    b.frame({ p: [landmarkAt.x, landmarkY, landmarkAt.z] }, () => {
      b.add(cyl(0.14, 0.17, 0.05, 9), C.rock, { p: [0, 0.0, 0] });
      b.add(cyl(0.075, 0.11, 0.62, 10), C.tin, { p: [0, 0.31, 0] });
      for (const y of [0.16, 0.42]) b.add(cyl(0.104 - y * 0.05, 0.106 - y * 0.05, 0.07, 10), C.rust, { p: [0, y, 0] });
      b.add(cyl(0.11, 0.09, 0.03, 10), C.iron, { p: [0, 0.63, 0] });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        b.add(box(0.005, 0.04, 0.005), C.iron, { p: [Math.cos(a) * 0.1, 0.665, Math.sin(a) * 0.1] });
      }
      b.add(cyl(0.05, 0.095, 0.035, 10), C.tinDark, { p: [0, 0.745, 0] });
      b.add(cyl(0.005, 0.005, 0.16, 5), C.iron, { p: [0, 0.84, 0] });
      b.add(box(0.07, 0.005, 0.005), C.iron, { p: [0, 0.86, 0] });
      b.addGlow(ball(0.012, 6, 5), C.rust, { p: [0, 0.925, 0] });
      const face = towardPlaza(landmarkAt);
      b.add(box(0.05, 0.09, 0.01), C.steel, { p: [Math.cos(face) * 0.105, 0.05, Math.sin(face) * 0.105], r: [0, yawFacing(face), 0] });
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
      (beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.12 : 0.03;
    };
  } else if (landmark === "dish") {
    // A radar dish on a squat tower, turning, with a field of solar panels beside it.
    const yaw = yawFacing(towardPlaza(landmarkAt));
    b.frame({ p: [landmarkAt.x, landmarkY, landmarkAt.z], r: [0, yaw, 0] }, () => {
      b.add(cyl(0.11, 0.17, 0.5, 8), C.cream, { p: [0, 0.25, 0] });
      b.add(cyl(0.135, 0.145, 0.05, 8), C.rust, { p: [0, 0.2, 0] });
      b.add(cyl(0.13, 0.115, 0.04, 8), C.tinDark, { p: [0, 0.52, 0] });
      b.add(box(0.06, 0.1, 0.01), C.steel, { p: [0, 0.05, 0.155] });
      b.addGlow(box(0.04, 0.04, 0.008), C.window, { p: [0, 0.3, 0.13] });
    });
    // Rows of panels tilted to the sun.
    const fieldC = Math.cos(yaw);
    const fieldS = Math.sin(yaw);
    const fx = landmarkAt.x + 0.32 * fieldC;
    const fz = landmarkAt.z - 0.32 * fieldS;
    b.frame({ p: [fx, heightAt(fx, fz), fz], r: [0, yaw, 0] }, () => {
      for (let i = 0; i < 6; i++) {
        const z = -0.13 + i * 0.052;
        b.add(box(0.24, 0.006, 0.04), i % 2 ? C.panelLight : C.panel, { p: [0, 0.035, z], r: [0.5, 0, 0] });
        for (const x of [-0.1, 0.1]) b.add(box(0.006, 0.035, 0.006), C.steel, { p: [x, 0.017, z] });
      }
    });
    block(fx, fz, 0.13, 0.17, yaw);
    // The dish rides a turntable on the tower's cap: a bowl open to the sky, its feed on a strut.
    const turntable = new THREE.Group();
    turntable.position.set(landmarkAt.x, landmarkY + 0.54, landmarkAt.z);
    const lift = 0.62;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 5, 0, Math.PI * 2, 0, 0.72), new THREE.MeshLambertMaterial({ color: C.tin, side: THREE.DoubleSide }));
    bowl.geometry.translate(0, -0.3, 0);
    bowl.castShadow = !opts.lowQuality;
    const head = new THREE.Group();
    head.position.y = 0.11;
    // The bowl's own up runs back along the way it points, so it opens toward the sky ahead.
    head.rotation.z = Math.PI / 2 + lift;
    head.add(bowl);
    const feed = new THREE.Mesh(cyl(0.005, 0.005, 0.2, 5), new THREE.MeshLambertMaterial({ color: C.iron }));
    feed.position.y = -0.1;
    const horn = new THREE.Mesh(ball(0.02, 7, 5), new THREE.MeshLambertMaterial({ color: C.rust }));
    horn.position.y = -0.2;
    head.add(feed, horn);
    const yoke = new THREE.Mesh(box(0.05, 0.11, 0.07), new THREE.MeshLambertMaterial({ color: C.steel }));
    yoke.position.y = 0.055;
    turntable.add(yoke, head);
    frame.add(turntable);
    circle(landmarkAt.x, landmarkAt.z, 0.18);
    animateLandmark = (_t, dt) => {
      turntable.rotation.y += dt * 0.45;
    };
  } else if (landmark === "geyser") {
    // An ice geyser: a cone of dark rock sheathed in ice toward the top, lit fissures, and a plume of vapor.
    b.frame({ p: [landmarkAt.x, landmarkY - 0.06, landmarkAt.z] }, () => {
      b.add(cyl(0.4, 0.6, 0.36, 9), 0x3d3a4a, { p: [0, 0.18, 0] });
      b.add(cyl(0.17, 0.4, 0.42, 9), C.iceBlue, { p: [0, 0.57, 0] });
      b.add(cyl(0.2, 0.17, 0.03, 9), C.ice, { p: [0, 0.78, 0] });
      b.add(cyl(0.6, 0.66, 0.06, 9), 0x26242e, { p: [0, 0.03, 0] });
      for (let i = 0; i < 3; i++) b.addGlow(box(0.035, 0.42, 0.02), C.glow, { p: [0.2 + i * 0.04, 0.42, 0.15 - i * 0.14], r: [0.1 * i, 0.4 + i * 0.6, 0.55] });
      // Shards of ice standing round its shoulders and its foot.
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + 0.3;
        const r = i % 2 ? 0.33 : 0.52;
        b.add(cone(0.035, 0.16 + (i % 3) * 0.04, 5), i % 2 ? C.ice : C.iceBlue, { p: [Math.cos(a) * r, i % 2 ? 0.5 : 0.14, Math.sin(a) * r], r: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
      }
    });
    const crater = new THREE.Mesh(cyl(0.15, 0.15, 0.03, 9), new THREE.MeshBasicMaterial({ color: C.ice }));
    crater.position.set(landmarkAt.x, landmarkY + 0.74, landmarkAt.z);
    frame.add(crater);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(ball(0.07, 10, 7), new THREE.MeshBasicMaterial({ color: C.vapor, transparent: true, opacity: 0.6, depthWrite: false }));
      puff.userData.phase = i / 6;
      frame.add(puff);
      puffs.push(puff);
    }
    circle(landmarkAt.x, landmarkAt.z, 0.6);
    animateLandmark = (t) => {
      (crater.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 3) > 0 ? C.ice : C.iceBlue);
      // It vents in a column: straight up fast, thinning and spreading only near the top.
      for (const p of puffs) {
        const phase = p.userData.phase as number;
        const k = (t * 0.4 + phase) % 1;
        p.position.set(crater.position.x + Math.sin(k * 5 + phase * 9) * 0.1 * k * k, crater.position.y + 0.06 + k * 1.25, crater.position.z + Math.cos(k * 4 + phase * 7) * 0.1 * k * k);
        p.scale.setScalar(0.45 + k * 1.3);
        (p.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k) ** 0.8;
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
  keepClear.push({ x: landmarkAt.x, z: landmarkAt.z, r: frozen ? 0.7 : 0.32 });

  // ---- the rim: a shuttle up on blocks, a solar sail on its rack, space junk, a heater ring, pebbles
  const rimSpot = (a: number, s: number): Spot => {
    const r = rimR(a) * s;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };
  {
    const p = rimSpot(-0.95 * mirror, 0.86);
    const yaw = yawFacing(-0.95 * mirror) + Math.PI / 2;
    b.frame({ p: at(p.x, p.z, 0.01), r: [0, yaw, 0] }, () => {
      for (const x of [-0.05, 0.05]) b.add(box(0.03, 0.022, 0.08), C.steel, { p: [x, 0.011, 0] });
      b.add(cyl(0.04, 0.04, 0.19, 8), C.cream, { p: [0, 0.062, 0], r: [0, 0, Math.PI / 2] });
      b.add(cyl(0.0405, 0.0405, 0.02, 8), C.rust, { p: [-0.03, 0.062, 0], r: [0, 0, Math.PI / 2] });
      b.add(cone(0.04, 0.075, 8), C.rust, { p: [0.132, 0.062, 0], r: [0, 0, -Math.PI / 2] });
      b.add(cyl(0.022, 0.032, 0.03, 8), C.iron, { p: [-0.11, 0.062, 0], r: [0, 0, Math.PI / 2] });
      b.addGlow(box(0.04, 0.014, 0.034), C.glow, { p: [0.055, 0.096, 0] });
      for (const side of [-1, 1]) b.add(box(0.06, 0.006, 0.05), C.tinDark, { p: [-0.06, 0.055, side * 0.058], r: [0, side * -0.35, 0] });
      b.add(box(0.05, 0.05, 0.006), C.rust, { p: [-0.075, 0.115, 0], r: [0, 0, 0.3] });
    });
    circle(p.x, p.z, 0.11);
    keepClear.push({ x: p.x, z: p.z, r: 0.18 });
  }
  {
    // A solar sail folded over its rack, coils of cable under it, spare spars and a crate beside it.
    const p = rimSpot(1.05 * mirror, 0.82);
    const yaw = yawFacing(1.05 * mirror);
    b.frame({ p: at(p.x, p.z), r: [0, yaw, 0] }, () => {
      for (const x of [-0.07, 0.07]) b.add(box(0.008, 0.1, 0.008), C.steel, { p: [x, 0.05, 0] });
      b.add(box(0.16, 0.008, 0.008), C.steel, { p: [0, 0.1, 0] });
      b.add(box(0.13, 0.075, 0.004), C.foil, { p: [0, 0.062, 0.012], r: [0.16, 0, 0] });
      b.add(box(0.13, 0.06, 0.004), C.foilLight, { p: [0, 0.07, -0.012], r: [-0.16, 0, 0] });
      for (let k = 0; k < 4; k++) b.add(box(0.004, 0.07, 0.006), C.steel, { p: [-0.05 + k * 0.032, 0.064, 0.016], r: [0.16, 0, 0] });
      b.add(new THREE.TorusGeometry(0.022, 0.007, 5, 12), C.cable, { p: [0.045, 0.008, 0.05], r: [Math.PI / 2, 0, 0] });
      b.add(new THREE.TorusGeometry(0.014, 0.006, 5, 10), C.cable, { p: [0.045, 0.018, 0.05], r: [Math.PI / 2, 0, 0] });
      for (const z of [-0.075, -0.09]) b.add(box(0.17, 0.006, 0.008), C.tinDark, { p: [0.0, 0.004, z], r: [0, z * 3, 0] });
      b.add(box(0.05, 0.04, 0.04), C.teal, { p: [-0.11, 0.02, 0.04], r: [0, 0.4, 0] });
      b.add(box(0.052, 0.006, 0.042), C.tealDark, { p: [-0.11, 0.022, 0.04], r: [0, 0.4, 0] });
    });
    circle(p.x, p.z, 0.08);
    circle(p.x - 0.1, p.z + 0.04, 0.03);
    keepClear.push({ x: p.x, z: p.z, r: 0.16 });
  }
  // The heater ring: a glowing element in a guard of plates, and two crates to sit on.
  const heaterAt = rimSpot(Math.PI * 0.72 * mirror, 0.78);
  const element = new THREE.Mesh(cyl(0.012, 0.018, 0.04, 7), new THREE.MeshBasicMaterial({ color: C.heat }));
  {
    const y = heightAt(heaterAt.x, heaterAt.z);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      b.add(box(0.008, 0.02, 0.022), C.steel, { p: [heaterAt.x + Math.cos(a) * 0.04, y + 0.01, heaterAt.z + Math.sin(a) * 0.04], r: [0, -a, 0] });
    }
    b.add(cyl(0.03, 0.034, 0.008, 9), C.iron, { p: [heaterAt.x, y + 0.004, heaterAt.z] });
    element.position.set(heaterAt.x, y + 0.028, heaterAt.z);
    frame.add(element);
    for (const a of [0.4, 2.6]) {
      const lx = heaterAt.x + Math.cos(a) * 0.1;
      const lz = heaterAt.z + Math.sin(a) * 0.1;
      b.add(box(0.045, 0.026, 0.032), a < 1 ? C.rust : C.teal, { p: [lx, heightAt(lx, lz) + 0.013, lz], r: [0, -a, 0] });
      circle(lx, lz, 0.03);
    }
    circle(heaterAt.x, heaterAt.z, 0.05);
    keepClear.push({ x: heaterAt.x, z: heaterAt.z, r: 0.18 });
  }
  // Space junk: a buckled panel or two, lying where it came down.
  for (let i = 0; i < 2; i++) {
    const a = dice.range(-Math.PI, Math.PI);
    if (Math.abs(a) < 0.5) continue;
    const p = rimSpot(a, dice.range(0.84, 0.9));
    b.add(box(0.15, 0.055, 0.006), i ? C.tinDark : C.rustDark, { p: at(p.x, p.z, 0.008), r: [Math.PI / 2, 0, dice.range(0, 3)] });
    circle(p.x, p.z, 0.04);
  }
  // Pebbles, lost washers and stones round the rim.
  for (let i = 0; i < 16; i++) {
    const a = dice.range(0, Math.PI * 2);
    const p = rimSpot(a, dice.range(0.74, 0.95));
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.2) continue;
    const kind = dice.int(3);
    if (kind === 0) b.add(cyl(0.008, 0.01, 0.004, 5), dice.pick([0xd9d2e6, 0xc9c2d9, 0xb8b0cc]), { p: at(p.x, p.z, 0.002) });
    else if (kind === 1) b.add(new THREE.TorusGeometry(0.008, 0.003, 4, 8), C.brass, { p: at(p.x, p.z, 0.003), r: [Math.PI / 2, 0, dice.range(0, 3)] });
    else b.add(new THREE.DodecahedronGeometry(0.014 + dice.range(0, 0.02)), frozen ? C.rockDark : C.rock, { p: at(p.x, p.z, 0.004), r: [dice.range(0, 3), dice.range(0, 3), 0] });
  }
  // Rocks adrift just off the rim, some a little below it.
  for (let i = 0; i < 6 + dice.int(4); i++) {
    const a = dice.range(0, Math.PI * 2);
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.45) continue;
    const p = rimSpot(a, dice.range(1.0, 1.08) + 0.09);
    b.add(new THREE.DodecahedronGeometry(0.04 + dice.range(0, 0.07)), frozen ? C.rockDark : C.rock, { p: [p.x, 0.04 - (i % 3) * 0.16, p.z], r: [dice.range(0, 3), dice.range(0, 3), 0] });
  }

  // ---- what stands on the ground: antenna palms round the rim, potted trees and crystal spires inland, never on a path or a building
  const clearOf = (x: number, z: number, r: number): boolean => keepClear.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + r);
  const placed: Spot[] = [];
  const palms = frozen ? 5 : 8;
  for (let tries = 0, n = 0; tries < 60 && n < palms; tries++) {
    const a = dice.range(0, Math.PI * 2);
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5) continue;
    const p = rimSpot(a, dice.range(0.72, 0.86));
    if (!clearOf(p.x, p.z, 0.06) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.22)) continue;
    antennaPalm(b, dice, at(p.x, p.z, -0.01), a);
    circle(p.x, p.z, 0.035);
    placed.push(p);
    n++;
  }
  const inland = frozen ? 5 : 11;
  for (let tries = 0, n = 0; tries < 90 && n < inland; tries++) {
    const a = dice.range(0, Math.PI * 2);
    const p = rimSpot(a, Math.sqrt(dice.range(0.04, 1)) * 0.6);
    if (!clearOf(p.x, p.z, 0.08) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.17)) continue;
    const spire = frozen || dice.int(3) === 0;
    if (spire) crystalSpire(b, dice, at(p.x, p.z, -0.005), frozen);
    else pottedTree(b, dice, at(p.x, p.z, -0.005), frozen);
    circle(p.x, p.z, 0.04);
    placed.push(p);
    n++;
  }
  // Pebbles, glints of crystal and boulders on the rise; mineral needles in the dust. Small enough to walk through.
  for (let i = 0; i < (opts.lowQuality ? 40 : 90); i++) {
    const a = dice.range(0, Math.PI * 2);
    const s = Math.sqrt(dice.range(0.02, 1)) * 0.9;
    const p = rimSpot(a, s);
    if (!clearOf(p.x, p.z, 0.0) || onDock(p.x, p.z)) continue;
    const y = heightAt(p.x, p.z);
    if (s < 0.62) {
      const kind = dice.int(5);
      if (kind < 3) {
        const pebble = frozen ? tones.pebble[0] : ochre ? tones.pebble[0] : dice.int(2) ? tones.pebble[0] : tones.pebble[1];
        for (let k = 0; k < 3; k++) b.add(new THREE.DodecahedronGeometry(0.006 + k * 0.002), pebble, { p: [p.x + (k - 1) * 0.012, y + 0.004, p.z + ((k % 2) - 0.5) * 0.012], r: [dice.range(-0.3, 0.3), 0, dice.range(-0.3, 0.3)] });
      } else if (kind === 3 && !frozen) {
        const c = dice.pick([C.crystal, C.crystalViolet, C.lamp, C.heat]);
        for (let k = 0; k < 3; k++) b.addGlow(new THREE.OctahedronGeometry(0.006), c, { p: [p.x + dice.range(-0.015, 0.015), y + 0.008, p.z + dice.range(-0.015, 0.015)] });
      } else {
        b.add(new THREE.DodecahedronGeometry(0.026 + dice.range(0, 0.02)), frozen ? C.rockDark : tones.under[2], { p: [p.x, y + 0.012, p.z], s: [1, 0.75, 1] });
        circle(p.x, p.z, 0.03);
      }
    } else if (s > 0.74 && dice.int(2) === 0) {
      for (let k = 0; k < 4; k++) b.add(cone(0.005, 0.05, 3), frozen ? C.ice : 0xc9c2d9, { p: [p.x + (k - 1.5) * 0.007, y + 0.02, p.z], r: [0, 0, (k - 1.5) * 0.2] });
    }
  }

  const statics = b.build(!opts.lowQuality);
  frame.add(statics);

  // ---- rock mites, scuttling sideways along the rim
  const mites: { g: THREE.Group; a: number; span: number; phase: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(ball(0.014, 7, 5), new THREE.MeshLambertMaterial({ color: C.mite }));
    shell.scale.set(1, 0.55, 1.25);
    shell.position.y = 0.008;
    g.add(shell);
    for (const side of [-1, 1]) {
      // A lit eye each side of its front, and three legs.
      const eye = new THREE.Mesh(ball(0.004, 5, 4), new THREE.MeshBasicMaterial({ color: C.glow }));
      eye.position.set(0.012, 0.011, side * 0.007);
      g.add(eye);
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.Mesh(box(0.003, 0.003, 0.012), new THREE.MeshLambertMaterial({ color: C.miteDark }));
        leg.position.set(-0.006 + k * 0.006, 0.004, side * 0.016);
        g.add(leg);
      }
    }
    frame.add(g);
    mites.push({ g, a: dice.range(0.7, Math.PI * 2 - 0.7), span: dice.range(0.15, 0.35), phase: dice.range(0, 6) });
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

  const hit = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), unseen());
  hit.rotation.x = -Math.PI / 2;
  hit.position.y = 0.05;
  group.add(hit);
  const dockHit = new THREE.Mesh(box(DOCK.to - DOCK.from, 0.02, DOCK.half * 2 + 0.02), unseen());
  dockHit.position.set((DOCK.from + DOCK.to) / 2, DOCK.top - 0.01, 0);
  frame.add(dockHit);

  // Invisible boxes over the buildings, so tapping the building itself walks to it.
  const buildingHits: THREE.Mesh[] = [];
  const hitBox = (building: Building, p: Spot, w: number, h: number, d: number, yaw: number): void => {
    const m = new THREE.Mesh(box(w, h, d), unseen());
    m.position.set(p.x, heightAt(p.x, p.z) + h / 2, p.z);
    m.rotation.y = yaw;
    m.userData.building = building;
    frame.add(m);
    buildingHits.push(m);
  };
  hitBox("cantina", cantinaAt, 0.46, 0.36, 0.34, cantinaYaw);
  hitBox("dock", yardAt, SW + 0.04, SH + 0.12, SD + 0.04, yardYaw);
  hitBox("notice-board", noticeAt, 0.16, NOTICE_H + 0.12, 0.16, noticeYaw);

  const toGroup = (u: number, y: number, w: number): THREE.Vector3 => new THREE.Vector3(u * Math.cos(dockAngle) - w * Math.sin(dockAngle), y, u * Math.sin(dockAngle) + w * Math.cos(dockAngle));
  const anchors: Record<Building, THREE.Vector3> = {
    dock: toGroup(yardAt.x, yardY + SH + 0.16, yardAt.z),
    cantina: toGroup(cantinaAt.x, cantinaY + 0.38, cantinaAt.z),
    "notice-board": toGroup(noticeAt.x, noticeY + NOTICE_H + 0.13, noticeAt.z),
  };
  const doors: Record<Building, Door> = {
    dock: yardDoor,
    cantina: { at: cantinaDoor, face: cantinaFace + Math.PI, inside: cantinaInside },
    "notice-board": noticeDoor,
  };

  const berth = (n: number): Berth => {
    const side = n % 2 === 0 ? 1 : -1;
    const row = Math.floor(n / 2);
    // Every ship lies bow out to the lanes, ready to launch; her stern clears the rim.
    const heading = 0;
    const w = side * (BERTH_W + row * BERTH_ROW);
    const gangU = BERTH_U + AIRLOCK_OFFSET;
    // Bow out, her starboard side (+z) faces +w: so the dock is to port for a ship at +w, to starboard at -w.
    return { u: BERTH_U, w, heading, foot: row === 0 ? { x: gangU, z: side * (DOCK.half - 0.035) } : null, dockSide: -side };
  };

  const stack = steamTop;
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
      // The heater's element breathes; it does not dance like a flame.
      element.scale.set(1 + Math.sin(t * 3.1) * 0.06, 0.92 + Math.abs(Math.sin(t * 1.7)) * 0.16, 1 + Math.sin(t * 3.1) * 0.06);
      for (const p of steam) {
        const k = (t * 0.3 + (p.userData.phase as number)) % 1;
        p.position.set(stack.x + Math.sin(k * 5) * 0.03, stack.y + k * 0.3, stack.z + k * 0.06);
        p.scale.setScalar(0.6 + k * 1.4);
        (p.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      }
      for (const c of mites) {
        // Out a little and back along the rim, a pause at each end.
        const k = Math.sin(t * 0.45 + c.phase);
        const a = c.a + Math.max(-1, Math.min(1, k * 1.4)) * c.span * 0.5;
        const r = rimR(a) * 0.93;
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

/**
 * The faceted ground: rings of the rim's shape from the middle out to its lip, colored by what each
 * face is. Rolls the dice exactly as it always did for every face inside the lip, so everything
 * placed after it lands where it always has.
 */
function buildGround(
  rimR: (a: number) => number,
  groundAt: (u: number, w: number) => number,
  sOf: (u: number, w: number) => number,
  dice: Dice,
  tones: Ground,
  /** Where frost spreads from, on frozen ground. */
  frostFrom: Spot | null,
): THREE.Mesh {
  const rings = [0, 0.1, 0.2, 0.3, 0.4, 0.48, 0.56, 0.62, 0.67, 0.72, 0.78, 0.84, 0.9, 0.95, 0.985, 1.0];
  const segs = 64;
  const verts: THREE.Vector3[][] = rings.map((s) =>
    Array.from({ length: segs }, (_, j) => {
      const a = (j / segs) * Math.PI * 2 + (s > 0 ? (rings.indexOf(s) % 2) * (Math.PI / segs) : 0);
      const r = s * rimR(a);
      const u = Math.cos(a) * r;
      const w = Math.sin(a) * r;
      return new THREE.Vector3(u, groundAt(u, w), w);
    }),
  );
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    const cu = (a.x + b.x + c.x) / 3;
    const cw = (a.z + b.z + c.z) / 3;
    const s = sOf(cu, cw);
    let hex: number;
    if (s < 0.64) hex = tones.rise[dice.int(3)]!;
    else if (s < 0.68) hex = dice.int(2) ? tones.rise[dice.int(3)]! : tones.dust[dice.int(3)]!;
    else if (s < 0.95) hex = tones.dust[dice.int(3)]!;
    else hex = tones.lip;
    color.setHex(hex);
    if (frostFrom && s < 0.9) {
      // Frost lies thick by the geyser and thins away from it. Which faces carry it, and how much,
      // comes from where they are and never from the dice.
      const near = 1 - Math.min(1, Math.hypot(cu - frostFrom.x, cw - frostFrom.z) / 1.05);
      const speck = Math.abs(Math.sin(cu * 91.7 + cw * 47.3) * 43758.5453) % 1;
      if (speck < near * 1.3) color.lerp(FROST, Math.min(0.85, 0.25 + near * 0.7 * (0.5 + speck)));
    }
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

/**
 * The rock under the rim: its face dropping away from the lip, then narrowing to a ragged keel far
 * below. Nothing walks on it and no tap lands on it, so it rolls dice of its own and may change
 * freely.
 */
function buildUnderside(id: string, rimR: (a: number) => number, tones: Ground): THREE.Mesh {
  const dice = new Dice(`underside:${id}`);
  // Each ring: how far out it stands as a share of the rim, and how far down.
  const rings: readonly (readonly [number, number])[] = [
    [1.0, 0.06],
    [1.035, -0.04],
    [1.03, -0.24],
    [0.96, -0.5],
    [0.82, -0.78],
    [0.6, -1.06],
    [0.36, -1.28],
    [0.14, -1.43],
  ];
  const segs = 32;
  const verts: THREE.Vector3[][] = rings.map(([s, y], i) =>
    Array.from({ length: segs }, (_, j) => {
      const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
      // The lip follows the rim exactly; below it the rock is rough.
      const rough = i === 0 ? 0 : 1;
      const r = rimR(a) * s * (1 + rough * dice.range(-0.07, 0.07));
      return new THREE.Vector3(Math.cos(a) * r, y + rough * dice.range(-0.05, 0.05), Math.sin(a) * r);
    }),
  );
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, band: number): void => {
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    // The top band is the lip's own dust spilling over; under it, strata of the rock, darker toward the keel.
    color.setHex(band === 0 ? tones.lip : tones.under[dice.int(3)]!);
    if (band > 0) color.multiplyScalar(1 - Math.min(0.45, (band - 1) * 0.085) - (band % 2) * 0.06);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < rings.length - 1; i++) {
    const upper = verts[i]!;
    const lower = verts[i + 1]!;
    const shift = (i + 1) % 2 === 1;
    for (let j = 0; j < segs; j++) {
      const a0 = upper[j]!;
      const a1 = upper[(j + 1) % segs]!;
      const b0 = lower[j]!;
      const b1 = lower[(j + 1) % segs]!;
      if (shift) {
        tri(a0, b0, a1, i);
        tri(a1, b0, b1, i);
      } else {
        tri(a0, b0, b1, i);
        tri(a0, b1, a1, i);
      }
    }
  }
  const tip = new THREE.Vector3(dice.range(-0.08, 0.08), -1.55, dice.range(-0.08, 0.08));
  const last = verts[rings.length - 1]!;
  for (let j = 0; j < segs; j++) tri(last[j]!, tip, last[(j + 1) % segs]!, rings.length - 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
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

function drum(b: Batch, p: readonly [number, number, number], color: number): void {
  b.add(cyl(0.022, 0.022, 0.05, 8), color, { p: [p[0], p[1] + 0.025, p[2]] });
  for (const y of [0.012, 0.038]) b.add(cyl(0.0235, 0.0235, 0.005, 8), C.iron, { p: [p[0], p[1] + y, p[2]] });
}

/**
 * An antenna palm: a ringed mast leaning like a palm's trunk, and where the fronds were, aerials
 * drooping from its head, each a boom with cross pieces down its length.
 */
function antennaPalm(b: Batch, dice: Dice, p: [number, number, number], lean: number): void {
  const height = 0.32 + dice.range(0, 0.18);
  const tilt = 0.12 + dice.range(0, 0.12);
  b.frame({ p, r: [0, -lean, tilt] }, () => {
    const rings = 6;
    for (let i = 0; i < rings; i++) b.add(cyl(0.015 - i * 0.0012, 0.018 - i * 0.0012, height / rings + 0.004, 6), i % 2 ? C.tin : C.tinDark, { p: [0, (i + 0.5) * (height / rings), 0] });
    const fronds = 6 + dice.int(2);
    for (let f = 0; f < fronds; f++) {
      b.frame({ p: [0, height, 0], r: [0, (f / fronds) * Math.PI * 2 + dice.range(0, 0.4), -0.4 - dice.range(0, 0.3)] }, () => {
        b.add(box(0.2, 0.006, 0.008), C.steel, { p: [0.1, 0, 0] });
        for (let k = 0; k < 4; k++) b.add(box(0.006, 0.005, 0.07 - k * 0.012), f % 2 ? C.teal : C.tealDark, { p: [0.05 + k * 0.045, 0.001, 0] });
        b.add(box(0.07, 0.006, 0.008), C.steel, { p: [0.228, -0.014, 0], r: [0, 0, -0.4] });
      });
    }
    b.add(ball(0.02, 7, 5), C.rust, { p: [0, height, 0] });
    b.addGlow(ball(0.008, 5, 4), C.lamp, { p: [0, height + 0.024, 0] });
  });
}

/** A tree in a tub: somebody carried it here and waters it. */
function pottedTree(b: Batch, dice: Dice, p: [number, number, number], frozen: boolean): void {
  const height = 0.09 + dice.range(0, 0.06);
  b.frame({ p, r: [0, dice.range(0, 6), 0] }, () => {
    b.add(cyl(0.034, 0.027, 0.034, 8), C.rust, { p: [0, 0.019, 0] });
    b.add(cyl(0.036, 0.036, 0.006, 8), C.rustDark, { p: [0, 0.035, 0] });
    b.add(cyl(0.01, 0.014, height, 6), 0x7a5a3a, { p: [0, height / 2 + 0.01, 0] });
    const r = 0.07 + dice.range(0, 0.04);
    const leaf = frozen ? 0x3d6f6a : dice.int(2) ? C.leaf : C.leafDark;
    b.add(new THREE.IcosahedronGeometry(r, 0), leaf, { p: [0, height + r * 0.75, 0], r: [dice.range(0, 3), dice.range(0, 3), 0] });
    b.add(new THREE.IcosahedronGeometry(r * 0.65, 0), leaf, { p: [r * 0.55, height + r * 0.5, r * 0.2], r: [dice.range(0, 3), dice.range(0, 3), 0] });
  });
}

/** A stand of crystal growing out of the rock: three spires leaning apart. Ice, on frozen ground. */
function crystalSpire(b: Batch, dice: Dice, p: [number, number, number], frozen: boolean): void {
  const height = 0.08 + dice.range(0, 0.05);
  b.frame({ p }, () => {
    b.add(new THREE.DodecahedronGeometry(0.034, 0), C.rockDark, { p: [0, 0.008, 0], s: [1, 0.5, 1] });
    for (let i = 0; i < 3; i++) {
      const tone = frozen ? (i % 2 ? C.ice : C.iceBlue) : i % 2 ? C.crystalViolet : C.crystal;
      const tall = height * (1.9 - i * 0.45);
      b.add(cone(0.024 - i * 0.004, tall, 5), tone, { p: [(i - 1) * 0.022, tall / 2 + 0.006, (i % 2) * 0.02 - 0.01], r: [(i % 2 ? 1 : -1) * 0.12, i * 1.3, (i - 1) * -0.24] });
    }
  });
}
