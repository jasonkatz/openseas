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

export function buildIsland(id: string, dockToward: THREE.Vector2, landmark: IslandLandmark): IslandModel {
  const dice = new Dice(`island:${id}`);
  const group = new THREE.Group();
  const sides = 7;
  const volcanic = landmark === "volcano";
  const golden = landmark === "windmill";

  const base = shaded(new THREE.CylinderGeometry(1.35, 1.7, 0.34, sides), mat(volcanic ? PALETTE.sandDark : PALETTE.sand));
  base.position.y = 0.07;
  base.rotation.y = dice.range(0, Math.PI);
  group.add(base);

  const turf = shaded(new THREE.CylinderGeometry(1.0, 1.24, 0.26, sides), mat(volcanic ? PALETTE.grassDark : golden ? PALETTE.grassGold : PALETTE.grass));
  turf.position.y = 0.36;
  turf.rotation.y = dice.range(0, Math.PI);
  group.add(turf);

  const hillAngle = dice.range(0, Math.PI * 2);
  if (!volcanic) {
    const hill = shaded(new THREE.CylinderGeometry(0.3, 0.72, 0.5 + dice.range(0, 0.3), 6), mat(golden ? PALETTE.grass : PALETTE.grassDark));
    hill.position.set(Math.cos(hillAngle) * 0.4, 0.55, Math.sin(hillAngle) * 0.4);
    group.add(hill);
  }

  for (let i = 0; i < 2 + dice.int(3); i++) {
    const rock = shaded(new THREE.DodecahedronGeometry(0.08 + dice.range(0, 0.1)), mat(volcanic ? PALETTE.basalt : PALETTE.rock));
    const a = dice.range(0, Math.PI * 2);
    rock.position.set(Math.cos(a) * 1.3, 0.26, Math.sin(a) * 1.3);
    rock.rotation.set(dice.range(0, 3), dice.range(0, 3), 0);
    group.add(rock);
  }

  // Palms lean out from the turf's edge; the volcano keeps fewer.
  const palms = (volcanic ? 2 : 3) + dice.int(3);
  for (let i = 0; i < palms; i++) {
    const a = dice.range(0, Math.PI * 2);
    const r = 0.55 + dice.range(0, 0.4);
    const palm = new THREE.Group();
    const height = 0.55 + dice.range(0, 0.35);
    const trunk = shaded(new THREE.CylinderGeometry(0.035, 0.06, height, 5), mat(PALETTE.trunk));
    trunk.position.y = height / 2;
    palm.add(trunk);
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
    palm.add(crown);
    palm.position.set(Math.cos(a) * r, 0.48, Math.sin(a) * r);
    palm.rotation.z = (Math.cos(a) > 0 ? -1 : 1) * dice.range(0.05, 0.22);
    palm.rotation.x = (Math.sin(a) > 0 ? 1 : -1) * dice.range(0.0, 0.15);
    group.add(palm);
  }

  // The dock reaches out toward the sea lanes, with the notice board at its foot.
  const dockDir = dockToward.clone().normalize();
  const dockAngle = Math.atan2(dockDir.y, dockDir.x);
  const dock = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const plank = shaded(new THREE.BoxGeometry(0.3, 0.05, 0.26), mat(PALETTE.wood));
    plank.position.set(1.2 + i * 0.31, 0.3, 0);
    dock.add(plank);
    if (i % 2 === 1) {
      for (const side of [-1, 1]) {
        const post = shaded(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 5), mat(PALETTE.trunk));
        post.position.set(1.2 + i * 0.31, 0.16, side * 0.15);
        dock.add(post);
      }
    }
  }
  const lanternPost = shaded(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5), mat(PALETTE.trunk));
  lanternPost.position.set(2.1, 0.5, 0.14);
  dock.add(lanternPost);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
  lantern.position.set(2.1, 0.68, 0.14);
  dock.add(lantern);
  const boardPost = shaded(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), mat(PALETTE.trunk));
  boardPost.position.set(0.98, 0.52, -0.26);
  dock.add(boardPost);
  const board = shaded(new THREE.BoxGeometry(0.03, 0.14, 0.2), mat(PALETTE.parchment));
  board.position.set(0.98, 0.62, -0.26);
  dock.add(board);
  const pin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: PALETTE.roof }));
  pin.position.set(0.985, 0.63, -0.24);
  dock.add(pin);
  dock.rotation.y = -dockAngle;
  group.add(dock);

  // The tavern: a cottage with a steep roof, a chimney and a swinging sign.
  const cottage = new THREE.Group();
  const walls = shaded(new THREE.BoxGeometry(0.46, 0.3, 0.38), mat(PALETTE.wall));
  walls.position.y = 0.15;
  cottage.add(walls);
  const roof = shaded(new THREE.ConeGeometry(0.37, 0.26, 4), mat(golden ? PALETTE.roofBlue : PALETTE.roof));
  roof.position.y = 0.43;
  roof.rotation.y = Math.PI / 4;
  cottage.add(roof);
  const chimney = shaded(new THREE.BoxGeometry(0.06, 0.16, 0.06), mat(PALETTE.rock));
  chimney.position.set(0.13, 0.46, 0.09);
  cottage.add(chimney);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.02), new THREE.MeshBasicMaterial({ color: PALETTE.trunk }));
  door.position.set(0.05, 0.07, 0.2);
  cottage.add(door);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.015), new THREE.MeshBasicMaterial({ color: PALETTE.brass }));
  sign.position.set(-0.12, 0.26, 0.21);
  cottage.add(sign);
  const cottageAngle = dockAngle + Math.PI + dice.range(-0.7, 0.7);
  cottage.position.set(Math.cos(cottageAngle) * 0.5, 0.49, Math.sin(cottageAngle) * 0.5);
  cottage.rotation.y = -cottageAngle + Math.PI / 2;
  group.add(cottage);

  // The landmark sits across from the tavern.
  const landmarkAngle = cottageAngle + Math.PI * 0.55;
  const landmarkPos = new THREE.Vector3(Math.cos(landmarkAngle) * 0.7, 0.48, Math.sin(landmarkAngle) * 0.7);
  let animateLandmark: (t: number, dt: number) => void = () => {};
  if (landmark === "lighthouse") {
    const tower = new THREE.Group();
    const body = shaded(new THREE.CylinderGeometry(0.09, 0.13, 0.7, 8), mat(PALETTE.lightTower));
    body.position.y = 0.35;
    tower.add(body);
    for (const y of [0.2, 0.5]) {
      const band = shaded(new THREE.CylinderGeometry(0.115 - y * 0.05, 0.12 - y * 0.05, 0.08, 8), mat(PALETTE.lightBand));
      band.position.y = y;
      tower.add(band);
    }
    const cap = shaded(new THREE.ConeGeometry(0.13, 0.14, 8), mat(PALETTE.lightBand));
    cap.position.y = 0.84;
    tower.add(cap);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
    lamp.position.y = 0.74;
    tower.add(lamp);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 12, 1, true), new THREE.MeshBasicMaterial({ color: PALETTE.lamp, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0.8, 0.74, 0);
    const beamHolder = new THREE.Group();
    beamHolder.position.y = 0;
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
    const body = shaded(new THREE.CylinderGeometry(0.11, 0.17, 0.6, 7), mat(PALETTE.wall));
    body.position.y = 0.3;
    mill.add(body);
    const cap = shaded(new THREE.ConeGeometry(0.16, 0.16, 7), mat(PALETTE.roofBlue));
    cap.position.y = 0.68;
    mill.add(cap);
    const hub = new THREE.Group();
    hub.position.set(0, 0.6, 0.17);
    for (let i = 0; i < 4; i++) {
      const blade = shaded(new THREE.BoxGeometry(0.06, 0.42, 0.015), mat(PALETTE.sail));
      blade.position.y = 0.22;
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(blade);
      hub.add(arm);
    }
    mill.add(hub);
    mill.position.copy(landmarkPos);
    mill.rotation.y = -landmarkAngle + Math.PI / 2;
    group.add(mill);
    animateLandmark = (_t, dt) => {
      hub.rotation.z += dt * 0.9;
    };
  } else if (landmark === "volcano") {
    const cone = shaded(new THREE.CylinderGeometry(0.22, 0.75, 0.95, 7), mat(PALETTE.basalt));
    cone.position.set(Math.cos(hillAngle) * 0.3, 0.84, Math.sin(hillAngle) * 0.3);
    group.add(cone);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 7), new THREE.MeshBasicMaterial({ color: PALETTE.lava }));
    crater.position.set(cone.position.x, 1.32, cone.position.z);
    group.add(crater);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat(PALETTE.smoke, { transparent: true, opacity: 0.6 }));
      puff.position.copy(crater.position);
      puff.userData.phase = i / 5;
      group.add(puff);
      puffs.push(puff);
    }
    animateLandmark = (t) => {
      (crater.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 3) > 0 ? PALETTE.lava : 0xc9502a);
      for (const p of puffs) {
        const k = (((t * 0.25) + (p.userData.phase as number)) % 1);
        p.position.set(crater.position.x + Math.sin(k * 6 + (p.userData.phase as number) * 9) * 0.12 * k, crater.position.y + 0.1 + k * 0.9, crater.position.z + 0.15 * k);
        const s = 0.6 + k * 1.6;
        p.scale.setScalar(s);
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

  // Selection and reach rings sit on the water; the flag marks where the player stands.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.05, 6, 48), new THREE.MeshBasicMaterial({ color: PALETTE.brass, transparent: true, opacity: 0.95 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  ring.visible = false;
  group.add(ring);
  const reachRing = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: PALETTE.parchment, transparent: true, opacity: 0.6 }));
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
  const flagPos = volcanic ? new THREE.Vector3(Math.cos(cottageAngle + 0.9) * 0.9, 0.5, Math.sin(cottageAngle + 0.9) * 0.9) : new THREE.Vector3(Math.cos(hillAngle) * 0.4, 1.0, Math.sin(hillAngle) * 0.4);
  flag.position.copy(flagPos);
  flag.visible = false;
  group.add(flag);

  const hit = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.rotation.x = -Math.PI / 2;
  hit.position.y = 0.05;
  group.add(hit);

  const dockEnd = new THREE.Vector3(Math.cos(dockAngle) * 2.0, 0.55, Math.sin(dockAngle) * 2.0);
  const boardSpot = new THREE.Vector3(Math.cos(dockAngle) * 0.98 + Math.sin(dockAngle) * 0.26, 0.95, Math.sin(dockAngle) * 0.98 - Math.cos(dockAngle) * 0.26);
  const anchors: Record<Building, THREE.Vector3> = {
    dock: dockEnd,
    tavern: cottage.position.clone().add(new THREE.Vector3(0, 0.55, 0)),
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
    },
  };
}

export type Station = "bilging" | "sailing" | "carpentry" | "gunnery" | "navigation";
export const STATION_ORDER: readonly Station[] = ["bilging", "sailing", "carpentry", "gunnery", "navigation"];

export interface ShipModel {
  group: THREE.Group;
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

/** A chunky sloop with its stations laid out on deck. The flag's color says whose it is. */
export function buildShip(kind: "yours" | "aboard" | "other"): ShipModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(0.85);
  group.add(body);

  const hull = shaded(new THREE.BoxGeometry(0.9, 0.24, 0.36), mat(PALETTE.hull));
  hull.position.y = 0.12;
  body.add(hull);
  const bow = shaded(new THREE.ConeGeometry(0.18, 0.4, 4), mat(PALETTE.hull));
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  bow.scale.z = 0.66;
  bow.position.set(0.64, 0.12, 0);
  body.add(bow);
  const stripe = shaded(new THREE.BoxGeometry(0.92, 0.04, 0.37), mat(PALETTE.brass));
  stripe.position.y = 0.2;
  body.add(stripe);
  const gunwale = shaded(new THREE.BoxGeometry(0.92, 0.05, 0.4), mat(PALETTE.gunwale));
  gunwale.position.y = 0.26;
  body.add(gunwale);
  const deck = shaded(new THREE.BoxGeometry(0.84, 0.03, 0.3), mat(PALETTE.deck));
  deck.position.y = 0.285;
  body.add(deck);
  const cabin = shaded(new THREE.BoxGeometry(0.2, 0.12, 0.22), mat(PALETTE.wood));
  cabin.position.set(-0.3, 0.36, 0);
  body.add(cabin);
  // The wheel stands on the cabin roof.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 10), mat(PALETTE.trunk));
  wheel.position.set(-0.17, 0.42, 0);
  wheel.rotation.y = Math.PI / 2;
  body.add(wheel);
  // Chart table beside the wheel.
  const table = shaded(new THREE.BoxGeometry(0.08, 0.05, 0.08), mat(PALETTE.deck));
  table.position.set(-0.3, 0.45, 0.06);
  body.add(table);
  const chart = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.005, 0.06), new THREE.MeshBasicMaterial({ color: PALETTE.parchment }));
  chart.position.set(-0.3, 0.478, 0.06);
  body.add(chart);
  // The pump amidships, a little box with a handle.
  const pump = shaded(new THREE.BoxGeometry(0.08, 0.07, 0.08), mat(PALETTE.iron));
  pump.position.set(0.22, 0.33, -0.07);
  body.add(pump);
  const handle = shaded(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5), mat(PALETTE.trunk));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.22, 0.4, -0.07);
  body.add(handle);
  // The carpenter's bench forward, with a plank on it.
  const bench = shaded(new THREE.BoxGeometry(0.1, 0.05, 0.06), mat(PALETTE.wood));
  bench.position.set(0.42, 0.32, 0.08);
  body.add(bench);
  const plank = shaded(new THREE.BoxGeometry(0.12, 0.012, 0.03), mat(PALETTE.deck));
  plank.position.set(0.42, 0.355, 0.08);
  plank.rotation.y = 0.3;
  body.add(plank);
  // Two cannons a side at the gunwale.
  const cannons: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    for (const x of [0.05, -0.1]) {
      const cannon = shaded(new THREE.CylinderGeometry(0.02, 0.025, 0.14, 6), mat(PALETTE.iron));
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(x, 0.31, side * 0.2);
      body.add(cannon);
      cannons.push(cannon);
    }
  }

  const mast = shaded(new THREE.CylinderGeometry(0.022, 0.03, 1.0, 6), mat(PALETTE.trunk));
  mast.position.set(0.08, 0.78, 0);
  body.add(mast);
  const boom = shaded(new THREE.CylinderGeometry(0.015, 0.015, 0.62, 5), mat(PALETTE.trunk));
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-0.2, 0.42, 0.03);
  body.add(boom);

  const sailGeo = new THREE.PlaneGeometry(0.56, 0.62, 5, 5);
  const pos = sailGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Billow: the cloth bellies out toward -z, most in the middle.
    pos.setZ(i, -0.1 * Math.cos((x / 0.56) * Math.PI) * Math.cos((y / 0.62) * Math.PI));
  }
  sailGeo.computeVertexNormals();
  const sail = shaded(sailGeo, mat(PALETTE.sail, { side: THREE.DoubleSide }));
  sail.position.set(-0.2, 0.76, 0.03);
  body.add(sail);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09, 3, 1),
    new THREE.MeshBasicMaterial({ color: kind === "other" ? PALETTE.parchment : PALETTE.brass, side: THREE.DoubleSide }),
  );
  flag.position.set(0.0, 1.26, 0);
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
    bilging: local(0.22, 0.5, -0.07),
    sailing: local(0.08, 1.35, 0),
    carpentry: local(0.42, 0.5, 0.08),
    gunnery: local(-0.03, 0.5, 0.22),
    navigation: local(-0.3, 0.62, 0.06),
  };
  const standing: Record<Station, THREE.Vector3> = {
    bilging: local(0.22, 0.3, 0.06),
    sailing: local(0.12, 0.3, -0.1),
    carpentry: local(0.3, 0.3, 0.08),
    gunnery: local(-0.03, 0.3, 0.12),
    navigation: local(-0.3, 0.42, -0.06),
  };
  const idleSpots = [local(0.0, 0.3, -0.08), local(-0.1, 0.3, 0.06), local(0.32, 0.3, -0.06), local(0.1, 0.3, 0.1), local(-0.14, 0.3, -0.1), local(0.44, 0.3, -0.04)];
  return { group, hit, sail, flag, wake, marker, anchors, standing, idleSpots, wheel: local(-0.17, 0.42, 0), cannons };
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
