/**
 * The pieces of the world: islands, ships, crew, clouds and gulls as chunky low-poly groups built
 * from primitives. No art files; everything is geometry and flat color, so it stays placeholder-art
 * honest (DESIGN.md 3.10) while reading as a toy diorama. Islands are decorated from a seeded PRNG
 * so the same island always looks the same on every device, and each carries the landmark its
 * content file names so the three read apart at a glance.
 */
import * as THREE from "three";
import type { IslandLandmark } from "@openseas/content";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";

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

export type Building = "dock" | "tavern" | "notice-board";

export interface IslandModel {
  group: THREE.Group;
  /** Flat disc under the island that widens the tap target. */
  hit: THREE.Mesh;
  ring: THREE.Mesh;
  reachRing: THREE.Mesh;
  flag: THREE.Group;
  /** Where each building's label hangs, in the island's local frame. */
  anchors: Record<Building, THREE.Vector3>;
  /** Direction from the island center to its dock, in the xz plane. */
  dockDir: THREE.Vector2;
  /** Per-frame life: the lamp blinks, the mill turns, the volcano smokes. */
  animate(t: number, dt: number): void;
}

/** An organic outline: a ring of points whose radius wobbles, so no two islands share a coast. */
function coast(dice: Dice, radius: number, points: number): THREE.Shape {
  const shape = new THREE.Shape();
  const radii: number[] = [];
  for (let i = 0; i < points; i++) radii.push(radius * (0.86 + dice.range(0, 0.28)));
  for (let i = 0; i < points; i++) {
    // Smooth the wobble so the coast curves rather than jags.
    const r = (radii[(i + points - 1) % points]! + radii[i]! * 2 + radii[(i + 1) % points]!) / 4;
    const a = (i / points) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function slab(shape: THREE.Shape, depth: number, bevel: number, color: number): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  const m = shaded(geo, mat(color));
  return m;
}

function tree(dice: Dice, kind: "palm" | "round" | "pine"): THREE.Group {
  const g = new THREE.Group();
  if (kind === "palm") {
    const height = 0.55 + dice.range(0, 0.35);
    const trunk = shaded(new THREE.CylinderGeometry(0.035, 0.06, height, 5), mat(PALETTE.trunk));
    trunk.position.y = height / 2;
    g.add(trunk);
    const crown = new THREE.Group();
    crown.position.y = height;
    const fronds = 5 + dice.int(2);
    for (let f = 0; f < fronds; f++) {
      const frond = shaded(new THREE.BoxGeometry(0.44, 0.025, 0.12), mat(PALETTE.frond));
      frond.position.x = 0.2;
      const holder = new THREE.Group();
      holder.rotation.y = (f / fronds) * Math.PI * 2 + dice.range(0, 0.4);
      holder.rotation.z = -0.35 - dice.range(0, 0.25);
      holder.add(frond);
      crown.add(holder);
    }
    const nuts = shaded(new THREE.SphereGeometry(0.035, 5, 4), mat(PALETTE.trunk));
    nuts.position.y = height - 0.03;
    g.add(nuts);
    g.add(crown);
    g.rotation.z = dice.range(-0.18, 0.18);
  } else if (kind === "round") {
    const height = 0.2 + dice.range(0, 0.12);
    const trunk = shaded(new THREE.CylinderGeometry(0.03, 0.04, height, 5), mat(PALETTE.trunk));
    trunk.position.y = height / 2;
    g.add(trunk);
    const r = 0.16 + dice.range(0, 0.1);
    const canopy = shaded(new THREE.IcosahedronGeometry(r, 0), mat(dice.int(2) ? PALETTE.frond : PALETTE.grassDark));
    canopy.position.y = height + r * 0.7;
    canopy.rotation.set(dice.range(0, 3), dice.range(0, 3), 0);
    g.add(canopy);
  } else {
    const height = 0.3 + dice.range(0, 0.2);
    const trunk = shaded(new THREE.CylinderGeometry(0.02, 0.03, height, 5), mat(PALETTE.trunk));
    trunk.position.y = height / 2;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const tier = shaded(new THREE.ConeGeometry(0.16 - i * 0.04, 0.2, 6), mat(PALETTE.grassDark));
      tier.position.y = height * 0.5 + i * 0.12;
      g.add(tier);
    }
  }
  return g;
}

function cottage(dice: Dice, roofColor: number, size = 1): THREE.Group {
  const c = new THREE.Group();
  const w = 0.36 * size;
  const d = 0.3 * size;
  const h = 0.26 * size;
  const walls = shaded(new THREE.BoxGeometry(w, h, d), mat(PALETTE.wall));
  walls.position.y = h / 2;
  c.add(walls);
  const roof = shaded(new THREE.CylinderGeometry(0, w * 0.78, h * 0.9, 4, 1), mat(roofColor));
  roof.scale.z = d / w;
  roof.position.y = h + h * 0.45;
  roof.rotation.y = Math.PI / 4;
  c.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.07 * size, 0.12 * size, 0.02), new THREE.MeshBasicMaterial({ color: PALETTE.trunk }));
  door.position.set(0, 0.06 * size, d / 2 + 0.005);
  c.add(door);
  for (const x of [-0.11, 0.11]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.06 * size, 0.06 * size, 0.02), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    win.position.set(x * size, h * 0.55, d / 2 + 0.005);
    c.add(win);
  }
  if (dice.int(2)) {
    const chimney = shaded(new THREE.BoxGeometry(0.05 * size, 0.14 * size, 0.05 * size), mat(PALETTE.rock));
    chimney.position.set(w * 0.3, h + 0.08 * size, 0);
    c.add(chimney);
  }
  return c;
}

function barrel(): THREE.Mesh {
  return shaded(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 7), mat(PALETTE.wood));
}
function crate(): THREE.Mesh {
  return shaded(new THREE.BoxGeometry(0.07, 0.06, 0.07), mat(PALETTE.deck));
}

export function buildIsland(id: string, dockToward: THREE.Vector2, landmark: IslandLandmark): IslandModel {
  const dice = new Dice(`island:${id}`);
  const group = new THREE.Group();
  const volcanic = landmark === "volcano";
  const golden = landmark === "windmill";

  // A shelf of sand under a cap of turf, each with its own coast.
  const beach = slab(coast(dice, 1.55, 14), 0.22, 0.12, volcanic ? PALETTE.sandDark : PALETTE.sand);
  beach.position.y = 0.0;
  group.add(beach);
  const turf = slab(coast(dice, 1.12, 12), 0.2, 0.1, volcanic ? PALETTE.grassDark : golden ? PALETTE.grassGold : PALETTE.grass);
  turf.position.y = 0.3;
  group.add(turf);
  const meadow = slab(coast(dice, 0.6, 9), 0.08, 0.06, golden ? PALETTE.grass : volcanic ? PALETTE.basalt : PALETTE.grassDark);
  meadow.position.set(dice.range(-0.3, 0.3), 0.5, dice.range(-0.3, 0.3));
  group.add(meadow);

  const dockDir = dockToward.clone().normalize();
  const dockAngle = Math.atan2(dockDir.y, dockDir.x);
  const hillAngle = dockAngle + Math.PI + dice.range(-0.5, 0.5);

  // Pebbles on the beach and rocks in the shallows.
  for (let i = 0; i < 4 + dice.int(4); i++) {
    const rock = shaded(new THREE.DodecahedronGeometry(0.05 + dice.range(0, 0.1)), mat(volcanic ? PALETTE.basalt : PALETTE.rock));
    const a = dice.range(0, Math.PI * 2);
    const r = 1.25 + dice.range(0, 0.6);
    rock.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    rock.rotation.set(dice.range(0, 3), dice.range(0, 3), 0);
    group.add(rock);
  }

  // Trees: palms by the shore, round trees inland, pines on the cold side.
  const trees = (volcanic ? 4 : 7) + dice.int(4);
  for (let i = 0; i < trees; i++) {
    const a = dice.range(0, Math.PI * 2);
    if (Math.abs(((a - dockAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5) continue; // keep the dock approach clear
    const r = 0.5 + dice.range(0, 0.55);
    const kind = r > 0.85 ? "palm" : dice.int(3) === 0 ? "pine" : "round";
    const t = tree(dice, kind);
    t.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r);
    t.rotation.y = dice.range(0, Math.PI * 2);
    group.add(t);
  }
  // Bushes and flowers.
  for (let i = 0; i < 6 + dice.int(5); i++) {
    const a = dice.range(0, Math.PI * 2);
    const r = 0.3 + dice.range(0, 0.7);
    const bush = shaded(new THREE.SphereGeometry(0.04 + dice.range(0, 0.04), 6, 5), mat(dice.int(3) === 0 ? PALETTE.roof : dice.int(2) ? PALETTE.frond : 0xf2c4d8));
    bush.position.set(Math.cos(a) * r, 0.52, Math.sin(a) * r);
    group.add(bush);
  }

  // A path from the dock to the tavern.
  const tavernAngle = dockAngle + Math.PI * (0.55 + dice.range(0, 0.25)) * (dice.int(2) ? 1 : -1);
  const tavernPos = new THREE.Vector3(Math.cos(tavernAngle) * 0.55, 0.5, Math.sin(tavernAngle) * 0.55);
  const dockFoot = new THREE.Vector3(Math.cos(dockAngle) * 1.0, 0.5, Math.sin(dockAngle) * 1.0);
  const pathPoints = [dockFoot, dockFoot.clone().lerp(tavernPos, 0.5).add(new THREE.Vector3(dice.range(-0.15, 0.15), 0, dice.range(-0.15, 0.15))), tavernPos];
  const pathCurve = new THREE.CatmullRomCurve3(pathPoints);
  for (let i = 0; i <= 8; i++) {
    const p = pathCurve.getPoint(i / 8);
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 6), mat(volcanic ? PALETTE.rock : PALETTE.sand));
    stone.position.set(p.x, 0.505, p.z);
    stone.receiveShadow = true;
    group.add(stone);
  }

  // The tavern, a cottage or two beside it, and a lamp post.
  const tavern = cottage(dice, golden ? PALETTE.roofBlue : PALETTE.roof, 1.25);
  tavern.position.copy(tavernPos);
  tavern.rotation.y = -Math.atan2(dockFoot.z - tavernPos.z, dockFoot.x - tavernPos.x) + Math.PI / 2;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.015), new THREE.MeshBasicMaterial({ color: PALETTE.brass }));
  sign.position.set(-0.17, 0.3, 0.2);
  tavern.add(sign);
  group.add(tavern);
  for (let i = 0; i < 1 + dice.int(2); i++) {
    const a = tavernAngle + (i ? -0.9 : 0.9) + dice.range(-0.2, 0.2);
    const h = cottage(dice, dice.int(2) ? PALETTE.roof : PALETTE.roofBlue, 0.8);
    h.position.set(Math.cos(a) * 0.72, 0.5, Math.sin(a) * 0.72);
    h.rotation.y = -a + Math.PI / 2;
    group.add(h);
  }
  const lampPost = shaded(new THREE.CylinderGeometry(0.012, 0.015, 0.32, 5), mat(PALETTE.iron));
  const lampAt = pathCurve.getPoint(0.5);
  lampPost.position.set(lampAt.x + 0.08, 0.66, lampAt.z + 0.08);
  group.add(lampPost);
  const lampGlow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
  lampGlow.position.set(lampAt.x + 0.08, 0.84, lampAt.z + 0.08);
  group.add(lampGlow);

  // The dock reaches out toward the sea lanes: planks, posts, a stall with crates and barrels, the notice board at its foot.
  const dock = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const plank = shaded(new THREE.BoxGeometry(0.3, 0.05, 0.3), mat(PALETTE.wood));
    plank.position.set(1.15 + i * 0.31, 0.3, 0);
    dock.add(plank);
    if (i % 2 === 1) {
      for (const side of [-1, 1]) {
        const post = shaded(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 5), mat(PALETTE.trunk));
        post.position.set(1.15 + i * 0.31, 0.16, side * 0.17);
        dock.add(post);
      }
    }
  }
  const b1 = barrel();
  b1.position.set(1.5, 0.36, 0.1);
  dock.add(b1);
  const b2 = barrel();
  b2.position.set(1.56, 0.36, 0.03);
  dock.add(b2);
  const c1 = crate();
  c1.position.set(1.85, 0.355, -0.1);
  dock.add(c1);
  const c2 = crate();
  c2.position.set(1.85, 0.415, -0.1);
  c2.rotation.y = 0.4;
  dock.add(c2);
  const lanternPost = shaded(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5), mat(PALETTE.trunk));
  lanternPost.position.set(2.4, 0.5, 0.12);
  dock.add(lanternPost);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
  lantern.position.set(2.4, 0.68, 0.12);
  dock.add(lantern);
  const boardPost = shaded(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), mat(PALETTE.trunk));
  boardPost.position.set(0.98, 0.62, -0.3);
  dock.add(boardPost);
  const board = shaded(new THREE.BoxGeometry(0.03, 0.16, 0.22), mat(PALETTE.parchment));
  board.position.set(0.98, 0.72, -0.3);
  dock.add(board);
  for (const [y, z] of [
    [0.75, -0.34],
    [0.69, -0.26],
  ]) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: dice.int(2) ? PALETTE.roof : PALETTE.roofBlue }));
    pin.position.set(0.985, y!, z!);
    dock.add(pin);
  }
  // A rowing boat tied up beside the dock.
  const boat = shaded(new THREE.CylinderGeometry(0.06, 0.03, 0.2, 6), mat(PALETTE.hull));
  boat.rotation.z = Math.PI / 2;
  boat.scale.set(1, 1, 0.6);
  boat.position.set(1.0, 0.02, 0.34);
  dock.add(boat);
  dock.rotation.y = -dockAngle;
  group.add(dock);

  // The landmark sits across from the tavern.
  const landmarkAngle = tavernAngle + Math.PI * 0.6 * (dice.int(2) ? 1 : -1);
  const landmarkPos = new THREE.Vector3(Math.cos(landmarkAngle) * 0.75, 0.5, Math.sin(landmarkAngle) * 0.75);
  let animateLandmark: (t: number, dt: number) => void = () => {};
  if (landmark === "lighthouse") {
    const tower = new THREE.Group();
    const body = shaded(new THREE.CylinderGeometry(0.09, 0.14, 0.8, 8), mat(PALETTE.lightTower));
    body.position.y = 0.4;
    tower.add(body);
    for (const y of [0.22, 0.56]) {
      const band = shaded(new THREE.CylinderGeometry(0.12 - y * 0.05, 0.125 - y * 0.05, 0.08, 8), mat(PALETTE.lightBand));
      band.position.y = y;
      tower.add(band);
    }
    const gallery = shaded(new THREE.CylinderGeometry(0.13, 0.11, 0.04, 8), mat(PALETTE.iron));
    gallery.position.y = 0.8;
    tower.add(gallery);
    const cap = shaded(new THREE.ConeGeometry(0.12, 0.14, 8), mat(PALETTE.lightBand));
    cap.position.y = 0.95;
    tower.add(cap);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
    lamp.position.y = 0.86;
    tower.add(lamp);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 12, 1, true), new THREE.MeshBasicMaterial({ color: PALETTE.lamp, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0.9, 0.86, 0);
    const beamHolder = new THREE.Group();
    beamHolder.add(beam);
    tower.add(beamHolder);
    tower.position.copy(landmarkPos);
    group.add(tower);
    animateLandmark = (t) => {
      const on = Math.sin(t * 2.2) > 0.2;
      (lamp.material as THREE.MeshBasicMaterial).color.setHex(on ? PALETTE.lamp : PALETTE.lampOff);
      beamHolder.rotation.y = t * 0.7;
      (beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.14 : 0.03;
    };
  } else if (landmark === "windmill") {
    const mill = new THREE.Group();
    const body = shaded(new THREE.CylinderGeometry(0.12, 0.19, 0.66, 7), mat(PALETTE.wall));
    body.position.y = 0.33;
    mill.add(body);
    const cap = shaded(new THREE.ConeGeometry(0.17, 0.17, 7), mat(PALETTE.roofBlue));
    cap.position.y = 0.74;
    mill.add(cap);
    const hub = new THREE.Group();
    hub.position.set(0, 0.64, 0.19);
    for (let i = 0; i < 4; i++) {
      const blade = shaded(new THREE.BoxGeometry(0.07, 0.46, 0.015), mat(PALETTE.sail));
      blade.position.y = 0.24;
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(blade);
      hub.add(arm);
    }
    mill.add(hub);
    // Fields of grain around it.
    for (let i = 0; i < 5; i++) {
      const row = shaded(new THREE.BoxGeometry(0.3, 0.03, 0.05), mat(0xdcc46a));
      row.position.set(0.3 + (i % 2) * 0.05, 0.02, -0.2 + i * 0.1);
      mill.add(row);
    }
    mill.position.copy(landmarkPos);
    mill.rotation.y = -landmarkAngle + Math.PI / 2;
    group.add(mill);
    animateLandmark = (_t, dt) => {
      hub.rotation.z += dt * 0.9;
    };
  } else if (landmark === "volcano") {
    const cone = shaded(new THREE.CylinderGeometry(0.24, 0.8, 1.0, 8), mat(PALETTE.basalt));
    cone.position.set(Math.cos(hillAngle) * 0.3, 0.9, Math.sin(hillAngle) * 0.3);
    group.add(cone);
    const streak = shaded(new THREE.BoxGeometry(0.06, 0.6, 0.03), mat(PALETTE.lava));
    streak.position.set(cone.position.x + 0.25, 1.05, cone.position.z + 0.2);
    streak.rotation.z = 0.5;
    streak.rotation.y = 0.5;
    group.add(streak);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), new THREE.MeshBasicMaterial({ color: PALETTE.lava }));
    crater.position.set(cone.position.x, 1.4, cone.position.z);
    group.add(crater);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat(PALETTE.smoke, { transparent: true, opacity: 0.6 }));
      puff.position.copy(crater.position);
      puff.userData.phase = i / 6;
      group.add(puff);
      puffs.push(puff);
    }
    animateLandmark = (t) => {
      (crater.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 3) > 0 ? PALETTE.lava : 0xc9502a);
      for (const p of puffs) {
        const k = (t * 0.25 + (p.userData.phase as number)) % 1;
        p.position.set(crater.position.x + Math.sin(k * 6 + (p.userData.phase as number) * 9) * 0.12 * k, crater.position.y + 0.1 + k * 1.0, crater.position.z + 0.15 * k);
        const sc = 0.6 + k * 1.8;
        p.scale.setScalar(sc);
        (p.material as THREE.MeshLambertMaterial).opacity = 0.55 * (1 - k);
      }
    };
  } else if (landmark === "fort") {
    const fort = new THREE.Group();
    const keep = shaded(new THREE.BoxGeometry(0.4, 0.3, 0.4), mat(PALETTE.rock));
    keep.position.y = 0.15;
    fort.add(keep);
    for (const [x, z] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [-0.2, 0.2],
      [0.2, 0.2],
    ]) {
      const tower = shaded(new THREE.CylinderGeometry(0.07, 0.08, 0.42, 6), mat(PALETTE.rock));
      tower.position.set(x!, 0.21, z!);
      fort.add(tower);
    }
    fort.position.copy(landmarkPos);
    group.add(fort);
  }

  // Chimney smoke from the tavern.
  const smokes: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), mat(0xdde3ea, { transparent: true, opacity: 0.5 }));
    puff.userData.phase = i / 3;
    group.add(puff);
    smokes.push(puff);
  }
  const chimneyTop = tavernPos.clone().add(new THREE.Vector3(0.13, 0.46, 0));

  // Selection and reach rings sit on the water; the flag marks where the player stands.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.05, 6, 48), new THREE.MeshBasicMaterial({ color: PALETTE.brass, transparent: true, opacity: 0.95 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  ring.visible = false;
  group.add(ring);
  const reachRing = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: PALETTE.parchment, transparent: true, opacity: 0.6 }));
  reachRing.rotation.x = -Math.PI / 2;
  reachRing.position.y = 0.3;
  reachRing.visible = false;
  group.add(reachRing);

  const flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), mat(PALETTE.parchment));
  pole.position.y = 0.25;
  flag.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.13), new THREE.MeshBasicMaterial({ color: PALETTE.brass, side: THREE.DoubleSide }));
  cloth.position.set(0.11, 0.42, 0);
  flag.add(cloth);
  flag.position.set(Math.cos(dockAngle) * 0.95 - Math.sin(dockAngle) * 0.3, 0.5, Math.sin(dockAngle) * 0.95 + Math.cos(dockAngle) * 0.3);
  flag.visible = false;
  group.add(flag);

  const hit = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.rotation.x = -Math.PI / 2;
  hit.position.y = 0.05;
  group.add(hit);

  const dockEnd = new THREE.Vector3(Math.cos(dockAngle) * 1.85, 0.36, Math.sin(dockAngle) * 1.85);
  const boardSpot = new THREE.Vector3(Math.cos(dockAngle) * 0.98 + Math.sin(dockAngle) * 0.3, 0.8, Math.sin(dockAngle) * 0.98 - Math.cos(dockAngle) * 0.3);
  const anchors: Record<Building, THREE.Vector3> = {
    dock: dockEnd,
    tavern: tavernPos.clone().add(new THREE.Vector3(0, 0.5, 0)),
    "notice-board": boardSpot,
  };

  return {
    group,
    hit,
    ring,
    reachRing,
    flag,
    anchors,
    dockDir,
    animate: (t, dt) => {
      animateLandmark(t, dt);
      if (flag.visible) cloth.rotation.y = Math.sin(t * 4) * 0.25;
      (lantern.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 7) > -0.6 ? PALETTE.lamp : 0xd9b25a);
      for (const p of smokes) {
        const k = (t * 0.3 + (p.userData.phase as number)) % 1;
        p.position.set(chimneyTop.x + Math.sin(k * 5) * 0.04, chimneyTop.y + k * 0.35, chimneyTop.z + k * 0.08);
        p.scale.setScalar(0.6 + k * 1.4);
        (p.material as THREE.MeshLambertMaterial).opacity = 0.45 * (1 - k);
      }
    },
  };
}

export type Station = "bilging" | "sailing" | "carpentry" | "gunnery" | "navigation";
export const STATION_ORDER: readonly Station[] = ["bilging", "sailing", "carpentry", "gunnery", "navigation"];

export interface ShipModel {
  group: THREE.Group;
  /** The hull and everything on it; the bob is applied here so the group's frame stays steady for labels. */
  body: THREE.Group;
  hit: THREE.Mesh;
  sail: THREE.Mesh;
  flag: THREE.Mesh;
  wake: THREE.Mesh;
  marker: THREE.Mesh;
  /** Where each station's spot is on the deck, in the ship's local frame. */
  anchors: Record<Station, THREE.Vector3>;
  /** Where a crew peg stands when working each station. */
  standing: Record<Station, THREE.Vector3>;
  /** Where a crew member with no station stands, by index. */
  idleSpots: THREE.Vector3[];
  /** The wheel at the stern, the captain's spot. */
  wheel: THREE.Vector3;
  cannons: THREE.Mesh[];
}

/** A sloop with its stations laid out on deck, built to be looked at up close. The flag's color says whose it is. */
export function buildShip(kind: "yours" | "aboard" | "other"): ShipModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(0.85);
  group.add(body);

  // Hull: a tapered box with plank stripes, a bow, a stern transom and a rudder.
  const hull = shaded(new THREE.BoxGeometry(0.9, 0.24, 0.36), mat(PALETTE.hull));
  hull.position.y = 0.12;
  body.add(hull);
  for (let i = 0; i < 3; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.91, 0.006, 0.365), new THREE.MeshBasicMaterial({ color: 0x3f2814 }));
    seam.position.y = 0.05 + i * 0.06;
    body.add(seam);
  }
  const bow = shaded(new THREE.ConeGeometry(0.18, 0.4, 4), mat(PALETTE.hull));
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  bow.scale.z = 0.66;
  bow.position.set(0.64, 0.12, 0);
  body.add(bow);
  const bowsprit = shaded(new THREE.CylinderGeometry(0.012, 0.018, 0.4, 5), mat(PALETTE.trunk));
  bowsprit.rotation.z = -Math.PI / 2 + 0.25;
  bowsprit.position.set(0.9, 0.32, 0);
  body.add(bowsprit);
  const figurehead = shaded(new THREE.SphereGeometry(0.035, 6, 5), mat(PALETTE.brass));
  figurehead.position.set(0.84, 0.25, 0);
  body.add(figurehead);
  const rudder = shaded(new THREE.BoxGeometry(0.03, 0.18, 0.08), mat(PALETTE.trunk));
  rudder.position.set(-0.47, 0.06, 0);
  body.add(rudder);
  const stripe = shaded(new THREE.BoxGeometry(0.92, 0.04, 0.37), mat(PALETTE.brass));
  stripe.position.y = 0.2;
  body.add(stripe);
  const gunwale = shaded(new THREE.BoxGeometry(0.92, 0.05, 0.4), mat(PALETTE.gunwale));
  gunwale.position.y = 0.26;
  body.add(gunwale);
  const deck = shaded(new THREE.BoxGeometry(0.84, 0.03, 0.3), mat(PALETTE.deck));
  deck.position.y = 0.285;
  body.add(deck);
  for (let i = 0; i < 5; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: 0x9a7a4c }));
    plank.position.set(0, 0.302, -0.12 + i * 0.06);
    body.add(plank);
  }
  // Railing posts along the gunwale.
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      const post = shaded(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 4), mat(PALETTE.trunk));
      post.position.set(-0.4 + i * 0.13, 0.32, side * 0.19);
      body.add(post);
    }
  }
  for (const side of [-1, 1]) {
    const rail = shaded(new THREE.BoxGeometry(0.8, 0.012, 0.012), mat(PALETTE.trunk));
    rail.position.set(0, 0.355, side * 0.19);
    body.add(rail);
  }
  // Gun ports on the hull sides.
  for (const side of [-1, 1]) {
    for (const x of [0.05, -0.1]) {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.01), new THREE.MeshBasicMaterial({ color: 0x1b1208 }));
      port.position.set(x, 0.14, side * 0.183);
      body.add(port);
    }
  }
  // Stern cabin with the wheel on its roof, lanterns and a chart table.
  const cabin = shaded(new THREE.BoxGeometry(0.22, 0.12, 0.24), mat(PALETTE.wood));
  cabin.position.set(-0.3, 0.36, 0);
  body.add(cabin);
  for (const z of [-0.07, 0.07]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    win.position.set(-0.415, 0.37, z);
    body.add(win);
  }
  const wheel = shaded(new THREE.TorusGeometry(0.05, 0.009, 5, 10), mat(PALETTE.trunk));
  wheel.position.set(-0.17, 0.42, 0);
  wheel.rotation.y = Math.PI / 2;
  body.add(wheel);
  for (let i = 0; i < 4; i++) {
    const spoke = shaded(new THREE.BoxGeometry(0.005, 0.1, 0.005), mat(PALETTE.trunk));
    spoke.position.set(-0.17, 0.42, 0);
    spoke.rotation.x = (i * Math.PI) / 4;
    body.add(spoke);
  }
  const wheelPost = shaded(new THREE.CylinderGeometry(0.01, 0.012, 0.1, 5), mat(PALETTE.trunk));
  wheelPost.position.set(-0.17, 0.35, 0);
  body.add(wheelPost);
  for (const z of [-0.1, 0.1]) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
    lantern.position.set(-0.42, 0.46, z);
    body.add(lantern);
  }
  const table = shaded(new THREE.BoxGeometry(0.09, 0.05, 0.09), mat(PALETTE.deck));
  table.position.set(-0.3, 0.445, 0.07);
  body.add(table);
  const chart = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.005, 0.07), new THREE.MeshBasicMaterial({ color: PALETTE.parchment }));
  chart.position.set(-0.3, 0.473, 0.07);
  body.add(chart);
  const compass = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 8), new THREE.MeshBasicMaterial({ color: PALETTE.brass }));
  compass.position.set(-0.27, 0.478, 0.09);
  body.add(compass);
  // The pump amidships, a box with a handle and a bucket.
  const pump = shaded(new THREE.BoxGeometry(0.08, 0.07, 0.08), mat(PALETTE.iron));
  pump.position.set(0.22, 0.33, -0.07);
  body.add(pump);
  const handle = shaded(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), mat(PALETTE.trunk));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.22, 0.4, -0.07);
  body.add(handle);
  const bucket = shaded(new THREE.CylinderGeometry(0.025, 0.02, 0.04, 7), mat(PALETTE.wood));
  bucket.position.set(0.3, 0.32, -0.11);
  body.add(bucket);
  // The carpenter's bench forward, with planks and a mallet.
  const bench = shaded(new THREE.BoxGeometry(0.11, 0.05, 0.06), mat(PALETTE.wood));
  bench.position.set(0.42, 0.32, 0.08);
  body.add(bench);
  const plank = shaded(new THREE.BoxGeometry(0.13, 0.012, 0.03), mat(PALETTE.deck));
  plank.position.set(0.42, 0.355, 0.08);
  plank.rotation.y = 0.3;
  body.add(plank);
  const mallet = shaded(new THREE.BoxGeometry(0.03, 0.02, 0.02), mat(PALETTE.iron));
  mallet.position.set(0.46, 0.36, 0.1);
  body.add(mallet);
  // Barrels and a crate on deck.
  for (const [x, z] of [
    [0.05, -0.12],
    [-0.02, -0.13],
  ]) {
    const b = barrel();
    b.scale.setScalar(0.8);
    b.position.set(x!, 0.33, z!);
    body.add(b);
  }
  const box = crate();
  box.scale.setScalar(0.8);
  box.position.set(0.12, 0.33, 0.12);
  body.add(box);
  // Two cannons a side at the gunwale, on carriages.
  const cannons: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    for (const x of [0.05, -0.1]) {
      const carriage = shaded(new THREE.BoxGeometry(0.06, 0.03, 0.06), mat(PALETTE.wood));
      carriage.position.set(x, 0.315, side * 0.15);
      body.add(carriage);
      const cannon = shaded(new THREE.CylinderGeometry(0.018, 0.024, 0.15, 7), mat(PALETTE.iron));
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(x, 0.345, side * 0.18);
      body.add(cannon);
      cannons.push(cannon);
    }
  }

  // Mast, boom, gaff, shrouds and two sails.
  const mast = shaded(new THREE.CylinderGeometry(0.02, 0.03, 1.05, 6), mat(PALETTE.trunk));
  mast.position.set(0.08, 0.8, 0);
  body.add(mast);
  const top = shaded(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 6), mat(PALETTE.wood));
  top.position.set(0.08, 1.1, 0);
  body.add(top);
  const boom = shaded(new THREE.CylinderGeometry(0.014, 0.014, 0.64, 5), mat(PALETTE.trunk));
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-0.2, 0.44, 0.03);
  body.add(boom);
  const gaff = shaded(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 5), mat(PALETTE.trunk));
  gaff.rotation.z = Math.PI / 2 + 0.35;
  gaff.position.set(-0.18, 1.12, 0.03);
  body.add(gaff);
  const ropeMat = new THREE.LineBasicMaterial({ color: 0x3a2a18 });
  for (const side of [-1, 1]) {
    for (const x of [-0.05, 0.05]) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.08, 1.05, 0), new THREE.Vector3(0.08 + x, 0.3, side * 0.19)]);
      body.add(new THREE.Line(geo, ropeMat));
    }
  }
  const stay = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.08, 1.1, 0), new THREE.Vector3(1.05, 0.38, 0)]);
  body.add(new THREE.Line(stay, ropeMat));

  const sailGeo = new THREE.PlaneGeometry(0.56, 0.62, 6, 6);
  const pos = sailGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, -0.1 * Math.cos((x / 0.56) * Math.PI) * Math.cos((y / 0.62) * Math.PI));
  }
  sailGeo.computeVertexNormals();
  const sail = shaded(sailGeo, mat(PALETTE.sail, { side: THREE.DoubleSide }));
  sail.position.set(-0.2, 0.76, 0.03);
  body.add(sail);
  for (let i = 1; i < 4; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.004, 0.002), new THREE.MeshBasicMaterial({ color: 0xcfc6ad }));
    seam.position.set(-0.2, 0.47 + i * 0.15, 0.09);
    body.add(seam);
  }
  const jibShape = new THREE.Shape();
  jibShape.moveTo(0, 0);
  jibShape.lineTo(0.5, 0);
  jibShape.lineTo(0, 0.6);
  jibShape.closePath();
  const jib = shaded(new THREE.ShapeGeometry(jibShape), mat(PALETTE.sail, { side: THREE.DoubleSide }));
  jib.position.set(0.14, 0.42, -0.02);
  jib.rotation.y = -0.15;
  body.add(jib);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09, 3, 1),
    new THREE.MeshBasicMaterial({ color: kind === "other" ? PALETTE.parchment : PALETTE.brass, side: THREE.DoubleSide }),
  );
  flag.position.set(0.0, 1.3, 0);
  body.add(flag);

  const wake = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.55), new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, opacity: 0.55, depthWrite: false }));
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(-0.95, 0.06, 0);
  wake.visible = false;
  body.add(wake);

  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), new THREE.MeshBasicMaterial({ color: PALETTE.brass }));
  marker.rotation.x = Math.PI;
  marker.position.set(0.08, 1.75, 0);
  marker.visible = kind !== "other";
  body.add(marker);

  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 0.9), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.position.y = 0.7;
  body.add(hit);

  const s = 0.85;
  const local = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x * s, y * s, z * s);
  const anchors: Record<Station, THREE.Vector3> = {
    bilging: local(0.22, 0.4, -0.07),
    sailing: local(-0.2, 0.76, 0.03),
    carpentry: local(0.42, 0.36, 0.08),
    gunnery: local(0.05, 0.35, 0.18),
    navigation: local(-0.3, 0.48, 0.07),
  };
  const standing: Record<Station, THREE.Vector3> = {
    bilging: local(0.22, 0.3, 0.05),
    sailing: local(0.0, 0.3, -0.08),
    carpentry: local(0.3, 0.3, 0.08),
    gunnery: local(-0.03, 0.3, 0.1),
    navigation: local(-0.3, 0.42, -0.07),
  };
  const idleSpots = [local(0.0, 0.3, 0.06), local(-0.12, 0.3, 0.08), local(0.32, 0.3, -0.05), local(0.12, 0.3, -0.02), local(-0.14, 0.3, -0.1), local(0.44, 0.3, -0.04)];
  return { group, body, hit, sail, flag, wake, marker, anchors, standing, idleSpots, wheel: local(-0.17, 0.42, 0), cannons };
}

export interface CrewPeg {
  group: THREE.Group;
  hat: THREE.Mesh;
}

/** A pirate as a peg: coat, head, hat. The player's own peg wears brass. */
export function buildCrewPeg(mine: boolean, captain: boolean): CrewPeg {
  const group = new THREE.Group();
  const coat = shaded(new THREE.CylinderGeometry(0.03, 0.038, 0.09, 7), mat(mine ? PALETTE.brass : PALETTE.pirateCoat));
  coat.position.y = 0.045;
  group.add(coat);
  const head = shaded(new THREE.SphereGeometry(0.028, 7, 6), mat(PALETTE.pirate));
  head.position.y = 0.11;
  group.add(head);
  const hat = shaded(captain ? new THREE.BoxGeometry(0.09, 0.02, 0.05) : new THREE.CylinderGeometry(0.032, 0.036, 0.015, 7), mat(captain ? PALETTE.iron : PALETTE.roof));
  hat.position.y = 0.135;
  group.add(hat);
  return { group, hat };
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
