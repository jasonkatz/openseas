/**
 * An outpost you can walk on (M5, ADR 0032): a rock hanging in the void with a settlement bolted
 * to it (ADR 0034). Nothing of an island is left in it (ADR 0035): no beach, no trees, no pier.
 * The ground is a low-poly heightfield: a flat floor of regolith inside a raised crater rim that
 * drops sheer into the void, cut through where the dock comes in, with the rock's underside
 * hanging below. On it, laid out from the dock inland: the dock, an arm run out over the void with
 * berths for ships either side; the shipyard and the notice board at its foot; a walkway up to a
 * round pad with a holo-globe turning over it; the cantina on the pad; hab pods with their grow
 * tunnels; the landmark the content names at the back; and the plant that keeps a place like this
 * alive: tanks, vents and cargo on the floor, light masts, dishes and solar panels round the rim,
 * warning lamps along its lip. Everything is placed from a PRNG seeded by the outpost's id, so
 * every device builds the same outpost, the same walk grid, the same doors. What is built never
 * depends on the renderer; only how it is drawn does.
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
import { Batch, unseen, type Put, type Vec3 } from "./batch.js";
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
  rockDark: 0x4c465c,
  paving: 0xb9b4c4,
  pavingDark: 0x9590a4,
  cable: 0x3a3f4a,
  foil: 0xe8c56a,
  foilLight: 0xf2dc9a,
  brass: 0xd4a548,
  parchment: 0xefe3c6,
  walk: 0x7c8494,
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
  beacon: 0xff5a4a,
  holo: 0x7fe3ff,
} as const;
const C = OUTPOST_PALETTE;
const FROST = new THREE.Color(OUTPOST_PALETTE.iceBlue);

/** What an outpost's ground is made of: its floor, the rim round it, the rim's lip, the rock under it, its pebbles. */
interface Ground {
  floor: readonly [number, number, number];
  rim: readonly [number, number, number];
  lip: number;
  under: readonly [number, number, number];
  pebble: readonly [number, number];
}
const GROUNDS: Record<"plain" | "ochre" | "frost", Ground> = {
  // Lilac-grey regolith inside a rim of darker slate.
  plain: { floor: [0x8e88a6, 0x847e9c, 0x9891b0], rim: [0x6d6887, 0x645f7d, 0x767191], lip: 0x9a94b2, under: [0x5a5470, 0x4e4963, 0x66607c], pebble: [0x6f6a85, 0xa9a2bd] },
  // Burnt-ochre regolith inside a rim of rust.
  ochre: { floor: [0xc48d52, 0xb8824a, 0xcd985c], rim: [0x9c5f3a, 0x915634, 0xa76942], lip: 0xbf7b4c, under: [0x6b4a3a, 0x5c3f32, 0x7a5644], pebble: [0x8f6238, 0x8f6238] },
  // Frozen blue-grey ground inside a rim of black rock.
  frost: { floor: [0x5d667e, 0x545c73, 0x68728c], rim: [0x2f2d38, 0x353340, 0x292731], lip: 0x3d3a4a, under: [0x2a2833, 0x23212b, 0x33313d], pebble: [0x6b7388, 0x6b7388] },
};

/** The outpost's floor, and how far the crater's rim stands over it. */
const FLOOR = 0.225;
const LIP = 0.05;
/** The rim is walked up to its crest, no further. */
const WALK_S = 0.95;

/** The dock's deck: from the rim out over the void, and how wide. */
export const DOCK = { from: 1.16, to: 2.95, half: 0.13, top: 0.22 } as const;
/** Where a ship lies along the dock, how far off its centerline the first two berths are, and how far apart the berths rafted outside them. */
const BERTH_U = 2.3;
const BERTH_W = 0.56;
const BERTH_ROW = 0.86;
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
  /** Per-frame life: lamps, the landmark, the holo-globe, steam, rovers. */
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
  // The floor is all but flat, with a little crown to it.
  const crown = (s: number): number => (s < 0.84 ? 0.012 * (1 - (s / 0.84) ** 2) : 0);
  // Round most of the rock the floor ends in a crater rim: up to a crest, then sheer down to the lip.
  const rimmed = (s: number): number => (s < 0.84 ? FLOOR + crown(s) : s < WALK_S ? FLOOR + LIP * smooth(0.84, WALK_S, s) : FLOOR + LIP - (FLOOR + LIP - 0.06) * smooth(WALK_S, 1, s));
  // Where the dock comes in the rim is cut through: the floor runs down a little to meet the dock's deck.
  const cut = (s: number): number => (s < 0.92 ? FLOOR + crown(s) - 0.03 * smooth(0.7, 0.92, s) : 0.195 - 0.135 * smooth(0.92, 1, s));
  const profile = (s: number, a: number): number => {
    // Past the lip the ground is gone: the rock's side drops into the void (drawn by buildUnderside).
    if (s >= 1) return Math.max(-0.32, 0.06 - (s - 1) * 3.2);
    const clearOfDock = smooth(0.14, 0.34, Math.abs(Math.atan2(Math.sin(a), Math.cos(a))));
    return cut(s) + (rimmed(s) - cut(s)) * clearOfDock;
  };
  const sOf = (u: number, w: number): number => Math.hypot(u, w) / rimR(Math.atan2(w, u));
  const groundAt = (u: number, w: number): number => {
    const s = sOf(u, w);
    let h = profile(s, Math.atan2(w, u));
    if (s < 0.68) h += (0.004 * Math.sin(u * 5.1 + phases[0]!) + 0.003 * Math.sin(w * 6.3 + phases[1]!) + 0.003 * Math.sin((u + w) * 8.7 + phases[2]!)) * (1 - smooth(0.5, 0.68, s));
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

  // ---- the dock: an arm run out over the void, a box girder with a deck on it, braced back to the rock
  const dockTop = DOCK.top;
  const dockLen = DOCK.to - DOCK.from;
  const dockMid = (DOCK.from + DOCK.to) / 2;
  solidAt(box(dockLen, 0.035, DOCK.half * 2 - 0.03), C.tinDark, { p: [dockMid, dockTop - 0.03, 0] });
  solidAt(box(dockLen, 0.012, DOCK.half * 2), C.tin, { p: [dockMid, dockTop - 0.006, 0] });
  for (let u = DOCK.from + 0.15; u < DOCK.to - 0.05; u += 0.15) solidAt(box(0.005, 0.004, DOCK.half * 2), C.steel, { p: [u, dockTop + 0.0005, 0] });
  for (const side of [-1, 1]) {
    // A warning stripe down each edge, and a light every so often along it.
    solidAt(box(dockLen, 0.003, 0.016), C.foil, { p: [dockMid, dockTop + 0.001, side * (DOCK.half - 0.008)] });
    for (let u = DOCK.from + 0.12; u < DOCK.to; u += 0.24) b.addGlow(box(0.016, 0.007, 0.008), C.glow, { p: [u, dockTop + 0.004, side * (DOCK.half - 0.008)] });
    // Clamps reach out from the edge to hold a ship at the berth: an arm, a pad on its end, a lamp on the pad.
    for (const du of [-0.45, 0.5]) {
      const u = BERTH_U + du;
      solidAt(box(0.03, 0.022, 0.08), C.iron, { p: [u, dockTop - 0.025, side * (DOCK.half + 0.03)] });
      solidAt(box(0.06, 0.06, 0.012), C.rust, { p: [u, dockTop - 0.01, side * (DOCK.half + 0.072)] });
      b.addGlow(box(0.012, 0.012, 0.014), C.lamp, { p: [u, dockTop + 0.028, side * (DOCK.half + 0.072)] });
    }
  }
  for (let u = DOCK.from + 0.1; u <= DOCK.to; u += 0.3) solidAt(box(0.02, 0.02, DOCK.half * 2 + 0.03), C.steel, { p: [u, dockTop - 0.058, 0] });
  solidAt(box(dockLen - 0.1, 0.035, 0.035), C.steel, { p: [dockMid, dockTop - 0.09, 0] });
  // Struts from the rock's face up to the arm, and a lift pod under its far end holding it level.
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
  // A gate where the arm leaves the rock: two posts and a beam, with a bar of light under the beam.
  const gateU = DOCK.from + 0.05;
  for (const side of [-1, 1]) {
    solidAt(box(0.018, 0.2, 0.018), C.steel, { p: [gateU, dockTop + 0.1, side * (DOCK.half + 0.014)] });
    solidAt(box(0.032, 0.02, 0.032), C.iron, { p: [gateU, dockTop + 0.01, side * (DOCK.half + 0.014)] });
    circle(gateU, side * (DOCK.half + 0.014), 0.012);
  }
  solidAt(box(0.024, 0.022, DOCK.half * 2 + 0.06), C.rust, { p: [gateU, dockTop + 0.205, 0] });
  b.addGlow(box(0.008, 0.006, DOCK.half * 2 - 0.02), C.glow, { p: [gateU, dockTop + 0.191, 0] });
  // Cargo boxes, a drum and a power cell at the root of the dock; a beacon at its end.
  const cargo = [
    [DOCK.from + 0.16, 0.08, "crate"],
    [DOCK.from + 0.16, 0.08, "crate2"],
    [DOCK.from + 0.25, 0.09, "drum"],
    [DOCK.to - 0.1, -0.08, "cell"],
  ] as const;
  for (const [u, w0, kind] of cargo) {
    const w = w0 * mirror;
    if (kind === "crate") {
      solidAt(box(0.06, 0.05, 0.06), C.teal, { p: [u, dockTop + 0.025, w], r: [0, 0.2, 0] });
      solidAt(box(0.062, 0.008, 0.062), C.tealDark, { p: [u, dockTop + 0.026, w], r: [0, 0.2, 0] });
    } else if (kind === "crate2") solidAt(box(0.045, 0.04, 0.045), C.rust, { p: [u, dockTop + 0.07, w], r: [0, -0.3, 0] });
    else if (kind === "drum") drum(b, [u, dockTop, w], C.blue);
    else {
      solidAt(box(0.044, 0.034, 0.034), C.steel, { p: [u, dockTop + 0.017, w] });
      b.addGlow(box(0.03, 0.012, 0.036), C.glow, { p: [u, dockTop + 0.02, w] });
    }
    circle(u, w, kind === "cell" ? 0.03 : 0.04);
  }
  solidAt(cyl(0.012, 0.014, 0.17, 6), C.steel, { p: [DOCK.to - 0.04, dockTop + 0.085, 0.1 * mirror] });
  solidAt(box(0.03, 0.01, 0.03), C.iron, { p: [DOCK.to - 0.04, dockTop + 0.175, 0.1 * mirror] });
  const dockBeacon = new THREE.Mesh(ball(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: C.lamp }));
  dockBeacon.position.set(DOCK.to - 0.04, dockTop + 0.155, 0.1 * mirror);
  frame.add(dockBeacon);
  circle(DOCK.to - 0.04, 0.1 * mirror, 0.015);

  // ---- the walkways inland, the pad and the holo-globe over it
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
    // A walkway of plate laid over the regolith, a stud of light either side every few paces.
    const curve = new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(p.x, 0, p.z)));
    const length = curve.getLength();
    const steps = Math.max(2, Math.ceil(length / 0.04));
    ribbon(b, curve, steps, 0.085, (u, w) => heightAt(u, w) + 0.004, C.walk);
    for (let i = 0; i <= steps; i++) {
      const p = curve.getPointAt(i / steps);
      if (i % 3 === 1) {
        const tan = curve.getTangentAt(i / steps);
        for (const side of [-1, 1]) b.addGlow(box(0.012, 0.005, 0.008), C.glow, { p: at(p.x - tan.z * side * 0.05, p.z + tan.x * side * 0.05, 0.004), r: [0, -Math.atan2(tan.z, tan.x), 0] });
      }
      if (i % 2 === 0) keepClear.push({ x: p.x, z: p.z, r: 0.09 });
    }
  }
  // The pad: a round deck of plates with a ring painted on it and a light at each point of its edge.
  const plazaY = plazaTop - 0.011;
  solidAt(cyl(plazaR, plazaR + 0.012, 0.03, 20), C.steel, { p: [plaza.x, plazaY - 0.008, plaza.z] });
  solidAt(cyl(plazaR - 0.012, plazaR - 0.012, 0.006, 20), C.paving, { p: [plaza.x, plazaY + 0.008, plaza.z] });
  for (let k = 0; k < 3; k++) solidAt(box((plazaR - 0.012) * 2, 0.003, 0.005), C.pavingDark, { p: [plaza.x, plazaY + 0.0105, plaza.z], r: [0, (k * Math.PI) / 3, 0] });
  solidAt(new THREE.RingGeometry(plazaR * 0.6, plazaR * 0.66, 24), C.foil, { p: [plaza.x, plazaY + 0.0125, plaza.z], r: [-Math.PI / 2, 0, 0] });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.39;
    b.addGlow(box(0.014, 0.006, 0.014), C.glow, { p: [plaza.x + Math.cos(a) * (plazaR - 0.004), plazaY + 0.012, plaza.z + Math.sin(a) * (plazaR - 0.004)], r: [0, -a, 0] });
  }
  keepClear.push({ x: plaza.x, z: plaza.z, r: plazaR + 0.12 });
  // The holo-globe: a projector in the middle of the pad, and a chart of the Reach turning in the light over it.
  b.frame({ p: [plaza.x, plazaTop, plaza.z] }, () => {
    b.add(cyl(0.05, 0.058, 0.02, 10), C.steel, { p: [0, 0.01, 0] });
    b.add(cyl(0.03, 0.04, 0.032, 10), C.iron, { p: [0, 0.036, 0] });
    b.addGlow(cyl(0.024, 0.024, 0.004, 10), C.holo, { p: [0, 0.054, 0] });
    for (let k = 0; k < 3; k++) b.add(box(0.014, 0.012, 0.008), C.brass, { p: [Math.cos(k * 2.1 + 0.4) * 0.046, 0.026, Math.sin(k * 2.1 + 0.4) * 0.046], r: [0, -(k * 2.1 + 0.4) + Math.PI / 2, 0] });
  });
  const globe = new THREE.Group();
  globe.position.set(plaza.x, plazaTop + 0.125, plaza.z);
  globe.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.046, 1), new THREE.MeshBasicMaterial({ color: C.holo, wireframe: true, transparent: true, opacity: 0.9 })));
  globe.add(new THREE.Mesh(ball(0.042, 10, 8), new THREE.MeshBasicMaterial({ color: C.holo, transparent: true, opacity: 0.18, depthWrite: false })));
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.003, 4, 24), new THREE.MeshBasicMaterial({ color: C.lamp }));
  orbit.rotation.x = Math.PI / 2 - 0.4;
  globe.add(orbit);
  frame.add(globe);
  circle(plaza.x, plaza.z, 0.065);
  // Lamp posts at the pad and along the walkway.
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

  // ---- the shipyard: the dock's office and workshop, where ships are bought, a hull in frame under its crane outside
  const yardY = heightAt(yardAt.x, yardAt.z);
  const yardYaw = yawFacing((Math.PI / 2) * mirror);
  const SW = 0.3;
  const SD = 0.22;
  const SH = 0.16;
  const yardDoorX = -0.06;
  b.frame({ p: [yardAt.x, yardY, yardAt.z], r: [0, yardYaw, 0] }, () => {
    b.add(box(SW + 0.03, 0.05, SD + 0.03), C.pavingDark, { p: [0, -0.012, 0] });
    b.add(box(SW, SH, SD), C.tin, { p: [0, SH / 2, 0] });
    // Ribbed panels on the front and sides.
    for (let i = 1; i < 6; i++) {
      b.add(box(SW + 0.002, 0.004, 0.004), C.tinDark, { p: [0, i * (SH / 6), SD / 2 + 0.001] });
      for (const side of [-1, 1]) b.add(box(0.004, 0.004, SD + 0.002), C.tinDark, { p: [side * (SW / 2 + 0.001), i * (SH / 6), 0] });
    }
    for (const x of [-SW / 2, SW / 2]) b.add(box(0.016, SH, 0.016), C.steel, { p: [x, SH / 2, SD / 2] });
    // A flat roof with a painted edge, and what stands on it: a vent unit, a skylight, a dish.
    b.add(box(SW + 0.03, 0.014, SD + 0.03), C.blueDark, { p: [0, SH + 0.007, 0] });
    b.add(box(SW - 0.01, 0.006, SD - 0.01), C.tinDark, { p: [0, SH + 0.016, 0] });
    b.add(box(0.07, 0.035, 0.06), C.steel, { p: [-0.09, SH + 0.036, -0.04] });
    for (let i = 0; i < 3; i++) b.add(box(0.06, 0.003, 0.004), C.iron, { p: [-0.09, SH + 0.026 + i * 0.008, -0.009] });
    b.addGlow(box(0.11, 0.004, 0.05), C.window, { p: [0.06, SH + 0.021, 0.03] });
    b.add(cyl(0.004, 0.005, 0.04, 5), C.iron, { p: [0.11, SH + 0.04, -0.06] });
    b.add(cyl(0.035, 0.008, 0.016, 10), C.tin, { p: [0.11, SH + 0.066, -0.06], r: [0.5, 0, 0.3] });
    // The doorway (its door swings, below), and the workshop's shutter beside it, half up.
    b.add(box(0.068, 0.112, 0.004), 0x14181d, { p: [yardDoorX, 0.056, SD / 2 + 0.002] });
    b.add(box(0.08, 0.012, 0.012), C.steel, { p: [yardDoorX, 0.117, SD / 2 + 0.004] });
    b.add(box(0.1, 0.1, 0.004), 0x14181d, { p: [0.075, 0.05, SD / 2 + 0.002] });
    for (let i = 0; i < 4; i++) b.add(box(0.1, 0.012, 0.006), i % 2 ? C.steel : C.tinDark, { p: [0.075, 0.094 - i * 0.013, SD / 2 + 0.004] });
    b.add(box(0.1, 0.008, 0.007), C.foil, { p: [0.075, 0.041, SD / 2 + 0.005] });
    b.addGlow(box(0.07, 0.012, 0.004), C.heat, { p: [0.075, 0.012, SD / 2 + 0.003] });
    b.add(box(0.112, 0.01, 0.012), C.steel, { p: [0.075, 0.106, SD / 2 + 0.005] });
    // A little rocket hung over the door for a sign.
    b.add(box(0.05, 0.004, 0.004), C.iron, { p: [yardDoorX + 0.01, 0.145, SD / 2 + 0.025] });
    b.add(cyl(0.009, 0.009, 0.034, 7), C.cream, { p: [yardDoorX + 0.008, 0.13, SD / 2 + 0.04], r: [0, 0, Math.PI / 2] });
    b.add(cone(0.009, 0.018, 7), C.rust, { p: [yardDoorX + 0.034, 0.13, SD / 2 + 0.04], r: [0, 0, -Math.PI / 2] });
    b.add(box(0.012, 0.03, 0.003), C.rust, { p: [yardDoorX - 0.008, 0.13, SD / 2 + 0.04] });
    // Hull plates stacked against one side.
    for (let i = 0; i < 4; i++) b.add(box(0.03, 0.025, 0.2), i % 2 ? C.tinDark : C.rust, { p: [SW / 2 + 0.03 + (i % 2) * 0.03, 0.012 + Math.floor(i / 2) * 0.025, 0], r: [0, 0.05 * i, 0] });
    // A hull in frame on stands by the other: a spine, its ribs and the first plates, under a crane with its hook down.
    b.frame({ p: [-SW / 2 - 0.1, 0, 0.02] }, () => {
      for (const z of [-0.06, 0.06]) {
        for (const lean of [-0.3, 0.3]) b.add(box(0.008, 0.06, 0.008), C.steel, { p: [lean * 0.06, 0.028, z], r: [0, 0, lean] });
        b.add(box(0.05, 0.006, 0.01), C.steel, { p: [0, 0.056, z] });
      }
      b.add(box(0.012, 0.012, 0.2), C.iron, { p: [0, 0.064, 0] });
      for (let i = 0; i < 5; i++) b.add(new THREE.TorusGeometry(0.035, 0.0035, 4, 10), C.tinDark, { p: [0, 0.1, -0.08 + i * 0.04] });
      for (const side of [-1, 1]) b.add(box(0.006, 0.012, 0.16), C.cream, { p: [side * 0.035, 0.1, 0] });
      for (const z of [-0.105, 0.105]) b.add(box(0.012, 0.22, 0.012), C.rust, { p: [0.055, 0.11, z] });
      b.add(box(0.016, 0.016, 0.24), C.rust, { p: [0.055, 0.224, 0] });
      b.add(box(0.07, 0.012, 0.014), C.steel, { p: [0.025, 0.21, 0.02] });
      b.add(cyl(0.002, 0.002, 0.05, 4), C.iron, { p: [0.0, 0.18, 0.02] });
      b.add(new THREE.TorusGeometry(0.008, 0.003, 4, 8, Math.PI), C.iron, { p: [0.0, 0.152, 0.02], r: [0, 0, Math.PI] });
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

  // ---- the cantina: a hall of painted panels under a barrel roof of tin, round ports, a vent stack, a lit sign
  const cantinaY = heightAt(cantinaAt.x, cantinaAt.z);
  const cantinaYaw = yawFacing(cantinaFace);
  const sign = new THREE.Group();
  const steamTop = new THREE.Vector3();
  b.frame({ p: [cantinaAt.x, cantinaY, cantinaAt.z], r: [0, cantinaYaw, 0] }, () => {
    const W = 0.42;
    const D = 0.3;
    const H = 0.2;
    b.add(box(W + 0.03, 0.05, D + 0.03), C.pavingDark, { p: [0, -0.01, 0] });
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
      // Round ports either side of the door, a slit of light above each.
      b.addGlow(cyl(0.026, 0.026, 0.008, 12), C.window, { p: [x, 0.085, D / 2 + 0.004], r: [Math.PI / 2, 0, 0] });
      b.add(new THREE.TorusGeometry(0.028, 0.005, 4, 12), C.rustDark, { p: [x, 0.085, D / 2 + 0.006] });
      b.addGlow(box(0.06, 0.012, 0.008), C.window, { p: [x * 0.9, 0.16, D / 2 + 0.004] });
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

  // ---- hab pods, each with a grow tunnel beside it
  for (const [i, home] of [podA, podB].entries()) {
    if (!home) continue;
    const y = heightAt(home.x, home.z);
    const yaw = yawFacing(towardPlaza(home));
    const paint = dice.int(2) ? C.rust : C.blue;
    // Tinwick's roofs are bare tin; elsewhere they are painted.
    const roof = landmark === "beacon" ? C.tin : paint;
    b.frame({ p: [home.x, y, home.z], r: [0, yaw, 0] }, () => {
      b.add(box(0.26, 0.05, 0.22), C.pavingDark, { p: [0, -0.012, 0] });
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
      // A grow tunnel to one side: two troughs of greens under hoops, a grow light along the ridge.
      const fx = 0.2;
      for (const z of [0.045, -0.045]) b.add(box(0.13, 0.022, 0.05), C.tinDark, { p: [fx + 0.06, 0.011, z] });
      for (let k = 0; k < 6; k++) b.add(ball(0.014, 5, 4), k % 2 ? C.leafDark : C.leaf, { p: [fx + 0.025 + (k % 3) * 0.04, 0.028, k < 3 ? 0.045 : -0.045] });
      for (const x of [fx - 0.008, fx + 0.06, fx + 0.128]) b.add(new THREE.TorusGeometry(0.082, 0.004, 4, 12, Math.PI), C.steel, { p: [x, 0.004, 0], r: [0, Math.PI / 2, 0] });
      b.add(box(0.14, 0.006, 0.012), C.steel, { p: [fx + 0.06, 0.086, 0] });
      b.addGlow(box(0.12, 0.004, 0.012), C.grow, { p: [fx + 0.06, 0.08, 0] });
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
    // A beacon tower: a lattice mast on four legs, a gallery round the lamp at its head, dishes up its
    // side, an aerial on its cap, and a beam that sweeps.
    const tower = new THREE.Group();
    tower.position.set(landmarkAt.x, landmarkY, landmarkAt.z);
    b.frame({ p: [landmarkAt.x, landmarkY, landmarkAt.z] }, () => {
      const H = 0.62;
      const foot = 0.115;
      const head = 0.042;
      const corner = (k: number, y: number): Vec3 => {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const r = foot + (head - foot) * (y / H);
        return [Math.cos(a) * r, y, Math.sin(a) * r];
      };
      b.add(cyl(0.17, 0.19, 0.04, 8), C.pavingDark, { p: [0, 0.0, 0] });
      const levels = [0, 0.13, 0.26, 0.39, 0.51, H];
      for (let k = 0; k < 4; k++) {
        strut(b, corner(k, 0), corner(k, H), 0.014, C.tin);
        b.add(box(0.03, 0.02, 0.03), C.iron, { p: [corner(k, 0)[0], 0.03, corner(k, 0)[2]] });
        for (let i = 1; i < levels.length; i++) {
          // A ring at each level, and a brace across each face leaning the other way level by level.
          strut(b, corner(k, levels[i]!), corner(k + 1, levels[i]!), 0.008, i % 2 ? C.rust : C.tinDark);
          strut(b, corner(k + (i % 2), levels[i - 1]!), corner(k + 1 - (i % 2), levels[i]!), 0.006, C.steel);
        }
      }
      // The gallery and the lamp's housing.
      b.add(cyl(0.085, 0.07, 0.02, 8), C.iron, { p: [0, H + 0.01, 0] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.add(box(0.005, 0.035, 0.005), C.iron, { p: [Math.cos(a) * 0.08, H + 0.037, Math.sin(a) * 0.08] });
      }
      b.add(new THREE.TorusGeometry(0.08, 0.003, 4, 16), C.iron, { p: [0, H + 0.055, 0], r: [Math.PI / 2, 0, 0] });
      b.add(cyl(0.045, 0.06, 0.03, 8), C.tinDark, { p: [0, H + 0.135, 0] });
      b.add(cyl(0.004, 0.005, 0.16, 5), C.iron, { p: [0, H + 0.23, 0] });
      b.add(box(0.07, 0.005, 0.005), C.iron, { p: [0, H + 0.25, 0] });
      b.addGlow(ball(0.012, 6, 5), C.beacon, { p: [0, H + 0.315, 0] });
      // Two dishes on its side, and the hut at its foot with its door toward the pad.
      const face = towardPlaza(landmarkAt);
      for (const [y, turn] of [
        [0.34, 1.9],
        [0.46, -2.3],
      ] as const) {
        const a = face + turn;
        const r = foot + (head - foot) * (y / H) + 0.03;
        b.add(cyl(0.04, 0.01, 0.018, 10), C.cream, { p: [Math.cos(a) * r, y, Math.sin(a) * r], r: [0, -a, -Math.PI / 2 + 0.3] });
      }
      b.add(box(0.09, 0.07, 0.07), C.tin, { p: [Math.cos(face) * 0.03, 0.055, Math.sin(face) * 0.03], r: [0, yawFacing(face), 0] });
      b.add(box(0.1, 0.01, 0.08), C.blueDark, { p: [Math.cos(face) * 0.03, 0.095, Math.sin(face) * 0.03], r: [0, yawFacing(face), 0] });
      b.addGlow(box(0.03, 0.045, 0.006), C.window, { p: [Math.cos(face) * 0.067, 0.045, Math.sin(face) * 0.067], r: [0, yawFacing(face), 0] });
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
    // A radar dish turning on a column over a squat drum of a station, with a field of solar panels beside it.
    const yaw = yawFacing(towardPlaza(landmarkAt));
    b.frame({ p: [landmarkAt.x, landmarkY, landmarkAt.z], r: [0, yaw, 0] }, () => {
      b.add(cyl(0.16, 0.17, 0.2, 8), C.cream, { p: [0, 0.1, 0] });
      b.add(cyl(0.163, 0.166, 0.03, 8), C.rust, { p: [0, 0.14, 0] });
      b.add(cyl(0.13, 0.165, 0.03, 8), C.tinDark, { p: [0, 0.215, 0] });
      b.add(cyl(0.05, 0.06, 0.28, 8), C.steel, { p: [0, 0.37, 0] });
      for (let k = 0; k < 3; k++) {
        const a = k * 2.094 + 0.5;
        strut(b, [Math.cos(a) * 0.12, 0.23, Math.sin(a) * 0.12], [Math.cos(a) * 0.045, 0.44, Math.sin(a) * 0.045], 0.012, C.tinDark);
      }
      b.add(cyl(0.11, 0.07, 0.04, 8), C.tinDark, { p: [0, 0.52, 0] });
      b.add(box(0.06, 0.1, 0.01), C.steel, { p: [0, 0.05, 0.168] });
      b.addGlow(box(0.05, 0.03, 0.008), C.window, { p: [0.08, 0.12, 0.148], r: [0, 0.39, 0] });
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

  // ---- the rim: a shuttle up on blocks, a solar sail on its rack, a telescope, space junk, pebbles
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
  // A telescope on its tripod, looking out over the rim, and a crate to sit on at its eyepiece.
  {
    const a = Math.PI * 0.72 * mirror;
    const p = rimSpot(a, 0.78);
    b.frame({ p: at(p.x, p.z), r: [0, -a, 0] }, () => {
      for (let k = 0; k < 3; k++) strut(b, [0, 0.07, 0], [Math.cos(k * 2.094) * 0.035, 0, Math.sin(k * 2.094) * 0.035], 0.006, C.steel);
      b.add(ball(0.01, 6, 5), C.iron, { p: [0, 0.072, 0] });
      b.add(cyl(0.014, 0.017, 0.11, 8), C.cream, { p: [0.012, 0.092, 0], r: [0, 0, -0.95] });
      b.add(cyl(0.019, 0.019, 0.014, 8), C.brass, { p: [0.052, 0.12, 0], r: [0, 0, -0.95] });
      b.add(cyl(0.006, 0.006, 0.024, 5), C.iron, { p: [-0.04, 0.056, 0], r: [0, 0, -0.95] });
      b.add(box(0.045, 0.026, 0.032), C.teal, { p: [-0.09, 0.013, 0.01], r: [0, 0.3, 0] });
    });
    circle(p.x, p.z, 0.045);
    circle(p.x - Math.cos(a) * 0.09, p.z - Math.sin(a) * 0.09, 0.03);
    keepClear.push({ x: p.x, z: p.z, r: 0.18 });
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
    const p = rimSpot(a, dice.range(0.74, 0.93));
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

  // ---- warning lamps along the rim's lip, either side of the dock's gap: a post and a red light, beyond where anyone walks
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.4) continue;
    const p = rimSpot(a, 0.962);
    const y = groundAt(p.x, p.z);
    b.add(box(0.008, 0.036, 0.008), C.iron, { p: [p.x, y + 0.016, p.z] });
    b.addGlow(box(0.013, 0.011, 0.013), C.beacon, { p: [p.x, y + 0.04, p.z] });
  }

  // ---- what stands on the ground: masts, dishes and panels round the rim, the outpost's plant on the floor, never on a walkway or a building
  const clearOf = (x: number, z: number, r: number): boolean => keepClear.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + r);
  const placed: Spot[] = [];
  const rimThings = frozen ? 6 : 9;
  for (let tries = 0, n = 0; tries < 70 && n < rimThings; tries++) {
    const a = dice.range(0, Math.PI * 2);
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5) continue;
    const p = rimSpot(a, dice.range(0.72, 0.84));
    if (!clearOf(p.x, p.z, 0.06) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.22)) continue;
    // Mostly light masts; now and then a dish or a panel.
    const kind = n % 3;
    if (kind === 1) dishPost(b, dice, at(p.x, p.z, -0.004));
    else if (kind === 2) solarStand(b, dice, at(p.x, p.z, -0.004), a);
    else lightMast(b, dice, at(p.x, p.z, -0.004), a);
    circle(p.x, p.z, kind === 2 ? 0.045 : 0.03);
    placed.push(p);
    n++;
  }
  const inland = frozen ? 5 : 10;
  for (let tries = 0, n = 0; tries < 90 && n < inland; tries++) {
    const a = dice.range(0, Math.PI * 2);
    const p = rimSpot(a, Math.sqrt(dice.range(0.04, 1)) * 0.62);
    if (!clearOf(p.x, p.z, 0.09) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.19)) continue;
    // Tanks, cargo and vents, and here and there the crystal that grows out of the rock. Ice, on frozen ground.
    const kind = frozen ? (n % 2 ? 3 : n % 3) : n % 4;
    if (kind === 0) tankCluster(b, dice, at(p.x, p.z, -0.004));
    else if (kind === 1) cargoStack(b, dice, at(p.x, p.z, -0.002));
    else if (kind === 2) ventStack(b, dice, at(p.x, p.z, -0.004));
    else crystalSpire(b, dice, at(p.x, p.z, -0.005), frozen);
    circle(p.x, p.z, kind < 2 ? 0.055 : 0.04);
    placed.push(p);
    n++;
  }
  // Craters in the floor where nothing was built: a dark pit and its raised ring. Shallow enough to walk through.
  for (let tries = 0, n = 0; tries < 40 && n < (frozen ? 3 : 5); tries++) {
    const a = dice.range(0, Math.PI * 2);
    const p = rimSpot(a, Math.sqrt(dice.range(0.05, 1)) * 0.8);
    const r = dice.range(0.035, 0.075);
    if (!clearOf(p.x, p.z, r) || onDock(p.x, p.z) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < r + 0.09)) continue;
    const y = heightAt(p.x, p.z);
    b.add(cyl(r, r * 0.8, 0.004, 10), tones.rim[1], { p: [p.x, y + 0.001, p.z] });
    b.add(new THREE.TorusGeometry(r, r * 0.16, 4, 12), tones.lip, { p: [p.x, y + 0.001, p.z], r: [Math.PI / 2, 0, dice.range(0, 3)], s: [1, 1, 0.55] });
    placed.push(p);
    n++;
  }
  // Pebbles, glints of crystal and boulders on the floor. Small enough to walk through, but for the boulders:
  // every renderer lays out the same ones, or two clients would walk different grids.
  for (let i = 0; i < 80; i++) {
    const a = dice.range(0, Math.PI * 2);
    const s = Math.sqrt(dice.range(0.02, 1)) * 0.9;
    const p = rimSpot(a, s);
    if (!clearOf(p.x, p.z, 0.0) || onDock(p.x, p.z)) continue;
    const y = heightAt(p.x, p.z);
    const kind = dice.int(5);
    if (kind < 3) {
      const pebble = dice.int(2) ? tones.pebble[0] : tones.pebble[1];
      for (let k = 0; k < 3; k++) b.add(new THREE.DodecahedronGeometry(0.006 + k * 0.002), pebble, { p: [p.x + (k - 1) * 0.012, y + 0.004, p.z + ((k % 2) - 0.5) * 0.012], r: [dice.range(-0.3, 0.3), 0, dice.range(-0.3, 0.3)] });
    } else if (kind === 3 && !frozen) {
      const c = dice.pick([C.crystal, C.crystalViolet, C.lamp, C.heat]);
      for (let k = 0; k < 3; k++) b.addGlow(new THREE.OctahedronGeometry(0.006), c, { p: [p.x + dice.range(-0.015, 0.015), y + 0.008, p.z + dice.range(-0.015, 0.015)] });
    } else if (s < 0.8) {
      b.add(new THREE.DodecahedronGeometry(0.026 + dice.range(0, 0.02)), frozen ? C.rockDark : tones.under[2], { p: [p.x, y + 0.012, p.z], s: [1, 0.75, 1] });
      circle(p.x, p.z, 0.03);
    }
  }

  const statics = b.build(!opts.lowQuality);
  frame.add(statics);

  // ---- survey rovers, trundling out along the rim and back
  const rovers: { g: THREE.Group; a: number; span: number; phase: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(box(0.03, 0.008, 0.02), new THREE.MeshLambertMaterial({ color: C.tin }));
    deck.position.y = 0.012;
    g.add(deck);
    const dark = new THREE.MeshLambertMaterial({ color: C.iron });
    for (const x of [-0.011, 0.011]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(cyl(0.006, 0.006, 0.005, 7), dark);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.006, side * 0.012);
        g.add(wheel);
      }
    }
    // A mast with a lamp for an eye, and a panel on its back.
    const mast = new THREE.Mesh(box(0.003, 0.016, 0.003), dark);
    mast.position.set(0.008, 0.024, 0);
    const eye = new THREE.Mesh(box(0.008, 0.006, 0.01), new THREE.MeshBasicMaterial({ color: C.glow }));
    eye.position.set(0.009, 0.034, 0);
    const panel = new THREE.Mesh(box(0.016, 0.002, 0.018), new THREE.MeshLambertMaterial({ color: C.panel }));
    panel.position.set(-0.006, 0.018, 0);
    g.add(mast, eye, panel);
    frame.add(g);
    rovers.push({ g, a: dice.range(0.7, Math.PI * 2 - 0.7), span: dice.range(0.15, 0.35), phase: dice.range(0, 6) });
  }

  // ---- the walk grid
  const grid = new WalkGrid(-1.72, -1.72, DOCK.to + 0.06, 1.72, 0.04).fill((u, w) => onDock(u, w) || sOf(u, w) <= WALK_S);
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
  // A marker for the chart: a pylon, and a brass diamond turning over it.
  const pole = new THREE.Mesh(cyl(0.008, 0.01, 0.3, 5), new THREE.MeshLambertMaterial({ color: C.parchment }));
  pole.position.y = 0.15;
  flag.add(pole);
  const cloth = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: C.brass }));
  cloth.scale.set(0.7, 1, 0.7);
  cloth.position.set(0, 0.39, 0);
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
      if (flag.visible) cloth.rotation.y = t * 1.6;
      // The dock's beacon blinks: two short flashes and a rest.
      (dockBeacon.material as THREE.MeshBasicMaterial).color.setHex((t * 1.2) % 1 < 0.12 || ((t * 1.2) % 1 > 0.24 && (t * 1.2) % 1 < 0.36) ? C.lamp : C.lampOff);
      for (const [i, l] of lamps.entries()) (l.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 9 + i * 2.3) > -0.85 ? C.lamp : 0xe8c060);
      sign.rotation.x = Math.sin(t * 1.3) * 0.18;
      globe.rotation.y = t * 0.45;
      orbit.rotation.z = t * 0.9;
      for (const p of steam) {
        const k = (t * 0.3 + (p.userData.phase as number)) % 1;
        p.position.set(stack.x + Math.sin(k * 5) * 0.03, stack.y + k * 0.3, stack.z + k * 0.06);
        p.scale.setScalar(0.6 + k * 1.4);
        (p.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      }
      for (const c of rovers) {
        // Out a little and back along the rim, a pause at each end, nose the way it goes.
        const k = Math.sin(t * 0.45 + c.phase);
        const a = c.a + Math.max(-1, Math.min(1, k * 1.4)) * c.span * 0.5;
        const r = rimR(a) * 0.9;
        const u = Math.cos(a) * r;
        const w = Math.sin(a) * r;
        c.g.position.set(u, heightAt(u, w), w);
        c.g.rotation.y = -a - (Math.cos(t * 0.45 + c.phase) >= 0 ? 1 : -1) * (Math.PI / 2);
      }
      void dt;
    },
  };
}

/**
 * The faceted ground: rings of the rim's shape from the middle out to its lip, colored by what each
 * face is. It rolls the dice for every face, so what it draws is part of the layout that follows.
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
  const rings = [0, 0.1, 0.2, 0.3, 0.4, 0.48, 0.56, 0.62, 0.67, 0.72, 0.78, 0.84, 0.9, 0.95, 0.975, 1.0];
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
    // The floor, then the rim's slope up to its crest, then the lip catching the light.
    if (s < 0.8) hex = tones.floor[dice.int(3)]!;
    else if (s < 0.86) hex = dice.int(2) ? tones.floor[dice.int(3)]! : tones.rim[dice.int(3)]!;
    else if (s < 0.94) hex = tones.rim[dice.int(3)]!;
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

/** A bar from one point to another: what a lattice is made of. */
function strut(b: Batch, from: Vec3, to: Vec3, thick: number, color: number): void {
  const a = new THREE.Vector3(...from);
  const along = new THREE.Vector3(...to).sub(a);
  const length = along.length();
  const turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize()));
  b.add(box(thick, length, thick), color, { p: [a.x + along.x / 2, a.y + along.y / 2, a.z + along.z / 2], r: [turn.x, turn.y, turn.z] });
}

/** A light mast on the rim: a slim pole, two floodlights at its head turned in on the settlement, a red lamp on its tip. */
function lightMast(b: Batch, dice: Dice, p: [number, number, number], outward: number): void {
  const height = 0.3 + dice.range(0, 0.16);
  b.frame({ p, r: [0, -outward, 0] }, () => {
    b.add(cyl(0.02, 0.026, 0.02, 6), C.steel, { p: [0, 0.01, 0] });
    b.add(cyl(0.006, 0.009, height, 5), C.tinDark, { p: [0, height / 2, 0] });
    b.add(box(0.012, 0.01, 0.1), C.iron, { p: [0, height - 0.02, 0] });
    for (const z of [-0.04, 0.04]) {
      b.add(box(0.03, 0.022, 0.03), C.iron, { p: [-0.012, height - 0.03, z], r: [0, 0, 0.5] });
      b.addGlow(box(0.006, 0.018, 0.024), C.lamp, { p: [-0.027, height - 0.039, z], r: [0, 0, 0.5] });
    }
    b.addGlow(ball(0.008, 5, 4), C.beacon, { p: [0, height + 0.008, 0] });
  });
}

/** A dish on a post, cocked at the sky. */
function dishPost(b: Batch, dice: Dice, p: [number, number, number]): void {
  const height = 0.11 + dice.range(0, 0.06);
  b.frame({ p, r: [0, dice.range(0, 6), 0] }, () => {
    b.add(cyl(0.02, 0.026, 0.02, 6), C.steel, { p: [0, 0.01, 0] });
    b.add(cyl(0.007, 0.009, height, 5), C.tinDark, { p: [0, height / 2, 0] });
    b.frame({ p: [0, height + 0.012, 0], r: [0, 0, -0.75] }, () => {
      b.add(cyl(0.06, 0.012, 0.022, 10), C.cream, { p: [0, 0.011, 0] });
      b.add(cyl(0.062, 0.062, 0.004, 10), C.tinDark, { p: [0, 0.023, 0] });
      b.add(cyl(0.003, 0.003, 0.05, 4), C.iron, { p: [0, 0.047, 0] });
      b.add(ball(0.008, 6, 4), C.rust, { p: [0, 0.074, 0] });
    });
  });
}

/** A solar panel on a stand, tipped up toward the void outside the rim. */
function solarStand(b: Batch, dice: Dice, p: [number, number, number], outward: number): void {
  const tip = 0.45 + dice.range(0, 0.25);
  b.frame({ p, r: [0, -outward, 0] }, () => {
    b.add(box(0.03, 0.012, 0.11), C.steel, { p: [0, 0.006, 0] });
    for (const z of [-0.04, 0.04]) b.add(box(0.008, 0.07, 0.008), C.steel, { p: [0, 0.04, z] });
    b.frame({ p: [0, 0.078, 0], r: [0, 0, -tip] }, () => {
      b.add(box(0.1, 0.006, 0.16), C.panel, { p: [0, 0, 0] });
      for (const z of [-0.04, 0, 0.04]) b.add(box(0.1, 0.007, 0.004), C.panelLight, { p: [0, 0.0005, z] });
      b.add(box(0.004, 0.008, 0.164), C.tin, { p: [0.05, 0, 0] });
      b.add(box(0.004, 0.008, 0.164), C.tin, { p: [-0.05, 0, 0] });
    });
  });
}

/** A tank farm: two or three pressure tanks on a skid, piped together, with a gauge. */
function tankCluster(b: Batch, dice: Dice, p: [number, number, number]): void {
  const n = 2 + dice.int(2);
  b.frame({ p, r: [0, dice.range(0, 6), 0] }, () => {
    b.add(box(0.05 * n + 0.02, 0.012, 0.06), C.steel, { p: [0, 0.006, 0] });
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.05;
      const tall = 0.08 + dice.range(0, 0.05);
      const paint = dice.pick([C.tin, C.cream, C.blue, C.teal]);
      b.add(cyl(0.021, 0.021, tall, 8), paint, { p: [x, 0.012 + tall / 2, 0] });
      b.add(cyl(0.011, 0.021, 0.014, 8), paint, { p: [x, 0.019 + tall, 0] });
      b.add(cyl(0.006, 0.006, 0.012, 6), C.rust, { p: [x, 0.032 + tall, 0] });
      b.add(cyl(0.0225, 0.0225, 0.008, 8), C.iron, { p: [x, 0.012 + tall * 0.4, 0] });
    }
    b.add(cyl(0.005, 0.005, 0.05 * n, 5), C.rust, { p: [0, 0.03, -0.026], r: [0, 0, Math.PI / 2] });
    b.addGlow(box(0.01, 0.01, 0.004), C.glow, { p: [(n - 1) * 0.025 + 0.02, 0.022, 0.028] });
  });
}

/** Cargo left where it was unloaded: containers stacked two high, none square to another. */
function cargoStack(b: Batch, dice: Dice, p: [number, number, number]): void {
  const paints = [C.rust, C.teal, C.blue, C.foil] as const;
  const container = (x: number, y: number, z: number, yaw: number): void => {
    b.add(box(0.09, 0.045, 0.045), dice.pick(paints), { p: [x, y + 0.0225, z], r: [0, yaw, 0] });
    for (const dx of [-0.03, 0.03]) b.add(box(0.006, 0.047, 0.047), C.iron, { p: [x + dx * Math.cos(yaw), y + 0.0225, z - dx * Math.sin(yaw)], r: [0, yaw, 0] });
  };
  b.frame({ p, r: [0, dice.range(0, 6), 0] }, () => {
    container(0, 0, -0.026, dice.range(-0.15, 0.15));
    container(0.008, 0, 0.026, dice.range(-0.15, 0.15));
    if (dice.int(3)) container(-0.004, 0.045, 0, dice.range(-0.5, 0.5));
  });
}

/** A vent stack off the workings under the floor: a hooded pipe with heat in its throat, a junction box at its foot. */
function ventStack(b: Batch, dice: Dice, p: [number, number, number]): void {
  const tall = 0.09 + dice.range(0, 0.06);
  b.frame({ p, r: [0, dice.range(0, 6), 0] }, () => {
    b.add(box(0.06, 0.02, 0.06), C.steel, { p: [0, 0.01, 0] });
    b.add(cyl(0.016, 0.02, tall, 7), C.tinDark, { p: [0, tall / 2 + 0.02, 0] });
    b.add(cyl(0.027, 0.02, 0.016, 7), C.iron, { p: [0, tall + 0.028, 0] });
    b.addGlow(cyl(0.015, 0.015, 0.004, 7), C.heat, { p: [0, tall + 0.037, 0] });
    b.add(box(0.03, 0.034, 0.022), C.rust, { p: [0.034, 0.037, 0] });
    b.addGlow(box(0.004, 0.008, 0.008), C.lamp, { p: [0.05, 0.042, 0] });
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
