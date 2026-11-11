/**
 * An outpost as a place to walk (ADR 0032, ADR 0035): the shape of its ground, where everything on
 * it stands, and from what stands in the way the walk grid, the doors, the berths and the spot a
 * pirate arrives at. Layout only. Nothing here is drawn and nothing here needs three.js, so
 * `outpost.ts` draws the outpost round these numbers and a test can walk it without a renderer.
 *
 * The layout is in the outpost's *dock frame*: u runs out along the dock toward the lanes, w across
 * it, y up. Walk positions on the wire are in this frame.
 *
 * Everything is placed from dice seeded by the outpost's id, so every device lays out the same
 * outpost, the same walk grid, the same doors, whatever draws it. Only the layout rolls these dice.
 * The drawing rolls dice of its own, so a prop may be redrawn, added or dropped without moving
 * anything a pirate walks round. The order the dice are rolled in here is part of the layout:
 * adding or dropping a roll moves everything placed after it.
 */
import type { OutpostLandmark } from "@openseas/content";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";
import { WalkGrid, type Obstacle, type Spot } from "./walk.js";

export type Building = "dock" | "cantina" | "notice-board";

/** The outpost's floor, and how far the crater's rim stands over it. */
const FLOOR = 0.225;
const LIP = 0.05;
/** The rim is walked up to its crest, no further. */
const WALK_S = 0.95;
/** How far out the rim stands from the middle, before it wobbles. */
export const RIM = 1.5;

/** The dock's deck: from the rim out over the void, and how wide. */
export const DOCK = { from: 1.16, to: 2.95, half: 0.13, top: 0.22 } as const;
/** The gate where the dock leaves the rock. */
export const GATE_U = DOCK.from + 0.05;
/** Where a ship lies along the dock, how far off its centerline the first two berths are, and how far apart the berths rafted outside them. */
export const BERTH_U = 2.3;
const BERTH_W = 0.56;
const BERTH_ROW = 0.86;
/** Ship-local x of the airlock amidships, scaled to the world (see models.ts). */
export const AIRLOCK_OFFSET = 0.056;
/** Feet clear an obstacle by this much. */
const BODY = 0.026;

/** What stands at the root of the dock and at its end: u along it, w across it before the layout is mirrored, and what it is. */
export const DOCK_CARGO = [
  [DOCK.from + 0.16, 0.08, "crate"],
  [DOCK.from + 0.16, 0.08, "crate2"],
  [DOCK.from + 0.25, 0.09, "drum"],
  [DOCK.to - 0.1, -0.08, "cell"],
] as const;
export type DockCargo = (typeof DOCK_CARGO)[number][2];

/** The shipyard's footprint (its front along x, its depth along z) and where its door is along its front. */
export const YARD = { w: 0.3, d: 0.22, doorX: -0.06 } as const;

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

/** Where a piece of the outpost stands, and the yaw it is turned by about its middle (a three.js turn about y). */
export interface Site {
  at: Spot;
  yaw: number;
}

/** A walkway of plate: points along it a few paces apart from end to end, and the way it runs at each. */
export interface Walkway {
  points: Spot[];
  along: Spot[];
}

/** What stands round the rim: light masts, dishes on posts, solar panels. */
export type RimPropKind = "mast" | "dish" | "panel";
/** The outpost's plant on the floor: tanks, cargo, vent stacks, stands of crystal (ice, on frozen ground). */
export type FloorPropKind = "tanks" | "cargo" | "vent" | "crystal";

export interface OutpostLayout {
  id: string;
  landmark: OutpostLandmark;
  /** +1 or -1: which side of the dock the settlement is laid out on. */
  mirror: number;

  /** How far the rim stands from the middle at angle `a` in the dock frame (0 out along the dock). */
  rimR(a: number): number;
  /** The spot `s` of the way out from the middle to the rim, at angle `a`. */
  rimSpot(a: number, s: number): Spot;
  /** How far out a spot is as a share of the rim there: the rock ends at 1. */
  sOf(u: number, w: number): number;
  /** The rock's own surface under a spot, without the dock or the pad laid on it. */
  groundAt(u: number, w: number): number;
  onDock(u: number, w: number): boolean;
  /** The height of the ground (or the dock, or the pad) under a spot. */
  heightAt(u: number, w: number): number;

  /** Where a pirate may stand. */
  grid: WalkGrid;
  doors: Record<Building, Door>;
  /** Where a pirate who came on the outpost without walking off a ship first stands. */
  arrival: Spot;
  berth(n: number): Berth;

  /** The pad, its radius and the height of its deck. */
  plaza: { at: Spot; r: number; top: number };
  walkways: Walkway[];
  /** Lamp posts at the pad and along the walkway. */
  lamps: Spot[];
  dockCargo: { at: Spot; kind: DockCargo }[];
  /** The post at the dock's end with the beacon on it. */
  dockBeacon: Spot;
  notice: Site;
  yard: Site;
  cantina: Site;
  /** Hab pods, each with a grow tunnel to its side. */
  pods: Site[];
  /** The noodle stall at the pad's edge. */
  stall: Site;
  /** The landmark at the back, turned to face the pad. */
  landmarkSite: Site;
  /** The dish's field of solar panels beside it; null at any other landmark. */
  field: Site | null;
  /** The set pieces on the rim: a shuttle up on blocks, a solar sail on its rack, a telescope looking out. */
  shuttle: Site;
  sail: Site;
  telescope: Site;
  /** Space junk lying where it came down. */
  junk: Spot[];
  rimProps: { at: Spot; kind: RimPropKind; outward: number }[];
  floorProps: { at: Spot; kind: FloorPropKind }[];
  /** Boulders on the floor, too big to walk through. */
  boulders: Spot[];
  /** Where the chart's "you are here" marker stands. */
  flag: Spot;
  /** Whether something of radius `r` at a spot stands clear of the walkways, the buildings and the set pieces. */
  isClear(u: number, w: number, r: number): boolean;
}

/** A tiny deterministic random source. */
export class Dice {
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

/** The yaw that turns a building's front (+z) to face `heading` in the dock frame. */
export const yawFacing = (heading: number): number => Math.PI / 2 - heading;

/** A point in a building's own frame (x along its front, z out of it), in the dock frame. */
export const onBuilding = (center: Spot, yaw: number, lx: number, lz: number): Spot => ({
  x: center.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
  z: center.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
});

/** How far an angle round the outpost is from the dock's, 0 to π. */
const fromDock = (a: number): number => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

export function outpostLayout(id: string, landmark: OutpostLandmark): OutpostLayout {
  const dice = new Dice(`outpost:${id}`);
  const frozen = landmark === "geyser";
  const mirror = dice.int(2) ? 1 : -1;

  // ---- the rim: a wobbling radius, held steady where the dock comes in
  const knots: number[] = [];
  for (let i = 0; i < 14; i++) knots.push(0.88 + dice.range(0, 0.24));
  const rimR = (a: number): number => {
    const f = (((a / (Math.PI * 2)) % 1) + 1) % 1;
    const x = f * knots.length;
    const i = Math.floor(x);
    const k = (1 - Math.cos((x - i) * Math.PI)) / 2;
    const wob = knots[i % knots.length]! * (1 - k) + knots[(i + 1) % knots.length]! * k;
    const near = fromDock(a);
    return RIM * (1 + (wob - 1) * smooth(0.25, 0.75, near));
  };
  const rimSpot = (a: number, s: number): Spot => {
    const r = rimR(a) * s;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
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
    // Past the lip the ground is gone: the rock's side drops into the void (drawn under the rim).
    if (s >= 1) return Math.max(-0.32, 0.06 - (s - 1) * 3.2);
    const clearOfDock = smooth(0.14, 0.34, fromDock(a));
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
  // The pad is paved level, a little proud of the ground.
  const plaza: Spot = { x: 0.42, z: 0 };
  const plazaR = 0.25;
  const plazaTop = groundAt(plaza.x, plaza.z) + 0.011;
  const heightAt = (u: number, w: number): number => (onDock(u, w) ? DOCK.top : Math.hypot(u - plaza.x, w - plaza.z) < plazaR ? plazaTop : groundAt(u, w));

  // What stands in a walker's way, and what the props scattered by the dice keep off: walkways, buildings, set pieces.
  const obstacles: Obstacle[] = [];
  const keepClear: { x: number; z: number; r: number }[] = [];
  const circle = (x: number, z: number, r: number): void => void obstacles.push({ kind: "circle", x, z, r });
  /** A box obstacle for a thing turned by yaw `yaw` about its center. */
  const block = (x: number, z: number, hw: number, hd: number, yaw: number): void => void obstacles.push({ kind: "box", x, z, hw, hd, angle: -yaw });
  const isClear = (x: number, z: number, r: number): boolean => keepClear.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + r);

  // ---- the dock: the posts of the gate at its root, the cargo there, the beacon's post at its end
  for (const side of [-1, 1]) circle(GATE_U, side * (DOCK.half + 0.014), 0.012);
  const dockCargo = DOCK_CARGO.map(([u, w, kind]) => ({ at: { x: u, z: w * mirror }, kind }));
  for (const c of dockCargo) circle(c.at.x, c.at.z, c.kind === "cell" ? 0.03 : 0.04);
  const dockBeacon: Spot = { x: DOCK.to - 0.04, z: 0.1 * mirror };
  circle(dockBeacon.x, dockBeacon.z, 0.015);

  // ---- the walkways inland, the pad and the holo-globe's projector in the middle of it
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
  const walkways = paths.map(walkway);
  for (const way of walkways) for (const [i, p] of way.points.entries()) if (i % 2 === 0) keepClear.push({ x: p.x, z: p.z, r: 0.09 });
  keepClear.push({ x: plaza.x, z: plaza.z, r: plazaR + 0.12 });
  circle(plaza.x, plaza.z, 0.065);
  const lamps: Spot[] = [
    { x: plaza.x + 0.18, z: 0.18 * mirror },
    { x: plaza.x - 0.18, z: -0.18 * mirror },
    { x: 0.84, z: -0.1 * mirror },
  ];
  for (const l of lamps) circle(l.x, l.z, 0.012);

  // ---- the notice board at the dock's foot
  circle(noticeAt.x, noticeAt.z, 0.075);
  keepClear.push({ x: noticeAt.x, z: noticeAt.z, r: 0.2 });

  // ---- the shipyard, with hull plates stacked against one side and a hull in frame by the other
  const yardYaw = yawFacing((Math.PI / 2) * mirror);
  block(yardAt.x, yardAt.z, YARD.w / 2 + 0.01, YARD.d / 2 + 0.01, yardYaw);
  {
    const plates = onBuilding(yardAt, yardYaw, YARD.w / 2 + 0.045, 0);
    block(plates.x, plates.z, 0.035, 0.11, yardYaw);
    const hull = onBuilding(yardAt, yardYaw, -YARD.w / 2 - 0.1, 0.02);
    block(hull.x, hull.z, 0.045, 0.11, yardYaw);
  }
  keepClear.push({ x: yardAt.x, z: yardAt.z, r: 0.32 });

  // ---- the cantina, with a bench and drums out front
  const cantinaYaw = yawFacing(cantinaFace);
  block(cantinaAt.x, cantinaAt.z, 0.24, 0.17, cantinaYaw);
  for (const [lx, lz] of [
    [-0.16, 0.21],
    [0.185, 0.22],
  ] as const) {
    const c = Math.cos(cantinaYaw);
    const s = Math.sin(cantinaYaw);
    circle(cantinaAt.x + lx * c + lz * s, cantinaAt.z - lx * s + lz * c, 0.045);
  }
  keepClear.push({ x: cantinaAt.x, z: cantinaAt.z, r: 0.38 });

  // ---- hab pods, each with a grow tunnel beside it
  const pods: Site[] = [];
  for (const home of [podA, podB]) {
    if (!home) continue;
    const yaw = yawFacing(towardPlaza(home));
    pods.push({ at: home, yaw });
    block(home.x, home.z, 0.14, 0.12, yaw);
    {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      block(home.x + 0.26 * c, home.z - 0.26 * s, 0.075, 0.11, yaw);
    }
    keepClear.push({ x: home.x, z: home.z, r: 0.3 });
  }

  // ---- a noodle stall at the pad's edge
  let stall: Site;
  {
    const a = Math.atan2(0.3 * mirror, 0.1);
    const u = plaza.x + Math.cos(a) * (plazaR + 0.05);
    const w = plaza.z + Math.sin(a) * (plazaR + 0.05);
    stall = { at: { x: u, z: w }, yaw: yawFacing(a + Math.PI) };
    block(u, w, 0.08, 0.04, stall.yaw);
    keepClear.push({ x: u, z: w, r: 0.12 });
  }

  // ---- the landmark at the back
  const landmarkSite: Site = { at: landmarkAt, yaw: yawFacing(towardPlaza(landmarkAt)) };
  let field: Site | null = null;
  if (landmark === "beacon") circle(landmarkAt.x, landmarkAt.z, 0.17);
  else if (landmark === "dish") {
    // Rows of solar panels beside the dish.
    const yaw = landmarkSite.yaw;
    field = { at: { x: landmarkAt.x + 0.32 * Math.cos(yaw), z: landmarkAt.z - 0.32 * Math.sin(yaw) }, yaw };
    block(field.at.x, field.at.z, 0.13, 0.17, yaw);
    circle(landmarkAt.x, landmarkAt.z, 0.18);
  } else if (landmark === "geyser") circle(landmarkAt.x, landmarkAt.z, 0.6);
  else if (landmark === "fort") block(landmarkAt.x, landmarkAt.z, 0.25, 0.25, 0);
  keepClear.push({ x: landmarkAt.x, z: landmarkAt.z, r: frozen ? 0.7 : 0.32 });

  // ---- the set pieces on the rim: a shuttle up on blocks, a solar sail on its rack, a telescope and the crate at its eyepiece
  const shuttle: Site = { at: rimSpot(-0.95 * mirror, 0.86), yaw: yawFacing(-0.95 * mirror) + Math.PI / 2 };
  circle(shuttle.at.x, shuttle.at.z, 0.11);
  keepClear.push({ x: shuttle.at.x, z: shuttle.at.z, r: 0.18 });
  const sail: Site = { at: rimSpot(1.05 * mirror, 0.82), yaw: yawFacing(1.05 * mirror) };
  circle(sail.at.x, sail.at.z, 0.08);
  circle(sail.at.x - 0.1, sail.at.z + 0.04, 0.03);
  keepClear.push({ x: sail.at.x, z: sail.at.z, r: 0.16 });
  const telescopeA = Math.PI * 0.72 * mirror;
  const telescope: Site = { at: rimSpot(telescopeA, 0.78), yaw: -telescopeA };
  circle(telescope.at.x, telescope.at.z, 0.045);
  circle(telescope.at.x - Math.cos(telescopeA) * 0.09, telescope.at.z - Math.sin(telescopeA) * 0.09, 0.03);
  keepClear.push({ x: telescope.at.x, z: telescope.at.z, r: 0.18 });

  // ---- space junk: a buckled panel or two
  const junk: Spot[] = [];
  for (let i = 0; i < 2; i++) {
    const a = dice.range(-Math.PI, Math.PI);
    if (Math.abs(a) < 0.5) continue;
    const p = rimSpot(a, dice.range(0.84, 0.9));
    junk.push(p);
    circle(p.x, p.z, 0.04);
  }

  // ---- what stands on the ground: masts, dishes and panels round the rim, the outpost's plant on the floor, never on a walkway or a building
  const placed: Spot[] = [];
  const rimProps: OutpostLayout["rimProps"] = [];
  const rimKinds: readonly RimPropKind[] = ["mast", "dish", "panel"];
  const rimThings = frozen ? 6 : 9;
  for (let tries = 0, n = 0; tries < 70 && n < rimThings; tries++) {
    const a = dice.range(0, Math.PI * 2);
    if (fromDock(a) < 0.5) continue;
    const p = rimSpot(a, dice.range(0.72, 0.84));
    if (!isClear(p.x, p.z, 0.06) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.22)) continue;
    // Mostly light masts; now and then a dish or a panel.
    const kind = rimKinds[n % 3]!;
    rimProps.push({ at: p, kind, outward: a });
    circle(p.x, p.z, kind === "panel" ? 0.045 : 0.03);
    placed.push(p);
    n++;
  }
  const floorProps: OutpostLayout["floorProps"] = [];
  const floorKinds: readonly FloorPropKind[] = ["tanks", "cargo", "vent", "crystal"];
  const inland = frozen ? 5 : 10;
  for (let tries = 0, n = 0; tries < 90 && n < inland; tries++) {
    const a = dice.range(0, Math.PI * 2);
    const p = rimSpot(a, Math.sqrt(dice.range(0.04, 1)) * 0.62);
    if (!isClear(p.x, p.z, 0.09) || placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.19)) continue;
    // Tanks, cargo and vents, and here and there the crystal that grows out of the rock. Ice, on frozen ground.
    const kind = floorKinds[frozen ? (n % 2 ? 3 : n % 3) : n % 4]!;
    floorProps.push({ at: p, kind });
    circle(p.x, p.z, kind === "tanks" || kind === "cargo" ? 0.055 : 0.04);
    placed.push(p);
    n++;
  }
  // Boulders on the floor, well in from the rim: one try in five lays one, two in five on frozen
  // ground. The pebbles and glints of crystal round them are the drawing's, and walked through.
  const boulders: Spot[] = [];
  for (let i = 0; i < 80; i++) {
    const a = dice.range(0, Math.PI * 2);
    const s = Math.sqrt(dice.range(0.02, 1)) * 0.9;
    const p = rimSpot(a, s);
    if (!isClear(p.x, p.z, 0.0) || onDock(p.x, p.z)) continue;
    if (dice.int(5) < (frozen ? 3 : 4) || s >= 0.8) continue;
    boulders.push(p);
    circle(p.x, p.z, 0.03);
  }

  // ---- the chart's marker by the pad
  const flag: Spot = { x: plaza.x + 0.2, z: -0.22 * mirror };
  circle(flag.x, flag.z, 0.012);

  // ---- the walk grid
  const grid = new WalkGrid(-1.72, -1.72, DOCK.to + 0.06, 1.72, 0.04).fill((u, w) => onDock(u, w) || sOf(u, w) <= WALK_S);
  for (const o of obstacles) grid.block(o, BODY);

  const doors: Record<Building, Door> = {
    dock: {
      at: onBuilding(yardAt, yardYaw, YARD.doorX, YARD.d / 2 + 0.1),
      face: (-Math.PI / 2) * mirror,
      inside: onBuilding(yardAt, yardYaw, YARD.doorX, YARD.d / 2 - 0.07),
    },
    cantina: { at: cantinaDoor, face: cantinaFace + Math.PI, inside: cantinaInside },
    "notice-board": { at: { x: noticeAt.x, z: noticeAt.z - 0.14 * mirror }, face: (Math.PI / 2) * mirror, inside: null },
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

  return {
    id,
    landmark,
    mirror,
    rimR,
    rimSpot,
    sOf,
    groundAt,
    onDock,
    heightAt,
    grid,
    doors,
    arrival: { x: plaza.x + plazaR + 0.08, z: 0.04 * mirror },
    berth,
    plaza: { at: plaza, r: plazaR, top: plazaTop },
    walkways,
    lamps,
    dockCargo,
    dockBeacon,
    notice: { at: noticeAt, yaw: yawFacing((-Math.PI / 2) * mirror) },
    yard: { at: yardAt, yaw: yardYaw },
    cantina: { at: cantinaAt, yaw: cantinaYaw },
    pods,
    stall,
    landmarkSite,
    field,
    shuttle,
    sail,
    telescope,
    junk,
    rimProps,
    floorProps,
    boulders,
    flag,
    isClear,
  };
}

/**
 * A walkway through its points: a centripetal Catmull-Rom curve on the ground, cut every 0.04 or so
 * along its length. It reckons exactly as three.js's `CatmullRomCurve3` with `getPointAt` and
 * `getTangentAt` does, so walkways laid out here are where the M7 outposts drew theirs.
 */
function walkway(line: readonly Spot[]): Walkway {
  const n = line.length;
  const pointAt = (t: number): Spot => {
    const p = (n - 1) * t;
    let i = Math.floor(p);
    let weight = p - i;
    if (weight === 0 && i === n - 1) {
      i = n - 2;
      weight = 1;
    }
    // The ends are extended straight on, a span past the first and last points.
    const p0 = i > 0 ? line[i - 1]! : { x: line[0]!.x - line[1]!.x + line[0]!.x, z: line[0]!.z - line[1]!.z + line[0]!.z };
    const p1 = line[i]!;
    const p2 = line[i + 1]!;
    const p3 = i + 2 < n ? line[i + 2]! : { x: line[n - 1]!.x - line[n - 2]!.x + line[n - 1]!.x, z: line[n - 1]!.z - line[n - 2]!.z + line[n - 1]!.z };
    const span = (a: Spot, b: Spot): number => Math.pow((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z), 0.25);
    let dt0 = span(p0, p1);
    let dt1 = span(p1, p2);
    let dt2 = span(p2, p3);
    if (dt1 < 1e-4) dt1 = 1.0;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const along = (x0: number, x1: number, x2: number, x3: number): number => {
      const t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1;
      const t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1;
      const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
      const c3 = 2 * x1 - 2 * x2 + t1 + t2;
      const w2 = weight * weight;
      return x1 + t1 * weight + c2 * w2 + c3 * (w2 * weight);
    };
    return { x: along(p0.x, p1.x, p2.x, p3.x), z: along(p0.z, p1.z, p2.z, p3.z) };
  };
  // Lengths along the curve at 200 even steps of its parameter, to walk it at an even pace.
  const DIVISIONS = 200;
  const lengths = [0];
  let last = pointAt(0);
  for (let d = 1; d <= DIVISIONS; d++) {
    const here = pointAt(d / DIVISIONS);
    lengths.push(lengths[d - 1]! + Math.sqrt((here.x - last.x) * (here.x - last.x) + (here.z - last.z) * (here.z - last.z)));
    last = here;
  }
  const length = lengths[DIVISIONS]!;
  /** The curve's parameter a share `u` of the way along its length. */
  const paramAt = (u: number): number => {
    const target = u * length;
    let low = 0;
    let high = DIVISIONS;
    while (low <= high) {
      const i = Math.floor(low + (high - low) / 2);
      const cmp = lengths[i]! - target;
      if (cmp < 0) low = i + 1;
      else if (cmp > 0) high = i - 1;
      else {
        high = i;
        break;
      }
    }
    const i = high;
    if (lengths[i] === target) return i / DIVISIONS;
    return (i + (target - lengths[i]!) / (lengths[i + 1]! - lengths[i]!)) / DIVISIONS;
  };
  const steps = Math.max(2, Math.ceil(length / 0.04));
  const points: Spot[] = [];
  const along: Spot[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = paramAt(k / steps);
    points.push(pointAt(t));
    const a = pointAt(Math.max(0, t - 0.0001));
    const b = pointAt(Math.min(1, t + 0.0001));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const inv = 1 / (Math.sqrt(dx * dx + dz * dz) || 1);
    along.push({ x: dx * inv, z: dz * inv });
  }
  return { points, along };
}
