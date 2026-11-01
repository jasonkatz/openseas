/**
 * The pieces of the chart: islands, ships, clouds and gulls as chunky low-poly groups built from
 * primitives. No art files; everything is geometry and flat color, so it stays placeholder-art
 * honest (DESIGN.md 3.10) while reading as a toy diorama. Islands are decorated from a seeded
 * PRNG so the same island always looks the same on every device.
 */
import * as THREE from "three";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";

export const PALETTE = {
  seaDeep: 0x0f4f66,
  seaShallow: 0x2aa3a8,
  foam: 0xe4f7f1,
  sand: 0xeadc9f,
  grass: 0x63b35d,
  grassDark: 0x3f8f49,
  rock: 0x8d8372,
  trunk: 0x8a5a2b,
  frond: 0x3c9a4e,
  wood: 0x9a6a3a,
  wall: 0xf2e6c8,
  roof: 0xb84a3c,
  hull: 0x5c3c1f,
  gunwale: 0x8a5a2b,
  deck: 0xcaa36e,
  sail: 0xf4f1e6,
  brass: 0xd4a548,
  parchment: 0xefe3c6,
  cloud: 0xffffff,
  lightTower: 0xf7f1e4,
  lightBand: 0xc94a3d,
  lamp: 0xffd36b,
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

export interface IslandModel {
  group: THREE.Group;
  /** Flat disc under the island that widens the tap target. */
  hit: THREE.Mesh;
  ring: THREE.Mesh;
  reachRing: THREE.Mesh;
  flag: THREE.Group;
  lamp: THREE.Mesh | null;
  /** Direction from the island center to its dock, in the xz plane. */
  dockDir: THREE.Vector2;
}

export function buildIsland(id: string, dockToward: THREE.Vector2, lighthouse: boolean): IslandModel {
  const dice = new Dice(`island:${id}`);
  const group = new THREE.Group();
  const sides = 7;

  const base = shaded(new THREE.CylinderGeometry(1.35, 1.65, 0.34, sides), mat(PALETTE.sand));
  base.position.y = 0.07;
  base.rotation.y = dice.range(0, Math.PI);
  group.add(base);

  const turf = shaded(new THREE.CylinderGeometry(1.0, 1.22, 0.26, sides), mat(PALETTE.grass));
  turf.position.y = 0.36;
  turf.rotation.y = dice.range(0, Math.PI);
  group.add(turf);

  const hill = shaded(new THREE.CylinderGeometry(0.3, 0.72, 0.5 + dice.range(0, 0.3), 6), mat(PALETTE.grassDark));
  const hillAngle = dice.range(0, Math.PI * 2);
  hill.position.set(Math.cos(hillAngle) * 0.4, 0.55, Math.sin(hillAngle) * 0.4);
  group.add(hill);

  for (let i = 0; i < 2 + dice.int(2); i++) {
    const rock = shaded(new THREE.DodecahedronGeometry(0.08 + dice.range(0, 0.08)), mat(PALETTE.rock));
    const a = dice.range(0, Math.PI * 2);
    rock.position.set(Math.cos(a) * 1.25, 0.26, Math.sin(a) * 1.25);
    rock.rotation.set(dice.range(0, 3), dice.range(0, 3), 0);
    group.add(rock);
  }

  // Palms lean out from the turf's edge.
  const palms = 3 + dice.int(3);
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

  // The tavern: a cottage with a steep roof and a chimney.
  const cottage = new THREE.Group();
  const walls = shaded(new THREE.BoxGeometry(0.42, 0.28, 0.36), mat(PALETTE.wall));
  walls.position.y = 0.14;
  cottage.add(walls);
  const roof = shaded(new THREE.ConeGeometry(0.34, 0.24, 4), mat(PALETTE.roof));
  roof.position.y = 0.4;
  roof.rotation.y = Math.PI / 4;
  cottage.add(roof);
  const chimney = shaded(new THREE.BoxGeometry(0.06, 0.14, 0.06), mat(PALETTE.rock));
  chimney.position.set(0.12, 0.42, 0.08);
  cottage.add(chimney);
  const cottageAngle = hillAngle + Math.PI + dice.range(-0.6, 0.6);
  cottage.position.set(Math.cos(cottageAngle) * 0.45, 0.49, Math.sin(cottageAngle) * 0.45);
  cottage.rotation.y = dice.range(0, Math.PI * 2);
  group.add(cottage);

  // The dock reaches out toward the sea lanes, with a notice board at its foot.
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
  const boardPost = shaded(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), mat(PALETTE.trunk));
  boardPost.position.set(0.98, 0.52, -0.22);
  dock.add(boardPost);
  const board = shaded(new THREE.BoxGeometry(0.03, 0.14, 0.2), mat(PALETTE.parchment));
  board.position.set(0.98, 0.62, -0.22);
  dock.add(board);
  dock.rotation.y = -dockAngle;
  group.add(dock);

  let lamp: THREE.Mesh | null = null;
  if (lighthouse) {
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
    lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
    lamp.position.y = 0.74;
    tower.add(lamp);
    const towerAngle = hillAngle + Math.PI / 2;
    tower.position.set(Math.cos(towerAngle) * 0.85, 0.48, Math.sin(towerAngle) * 0.85);
    group.add(tower);
  }

  // Selection and reach rings sit on the water; the flag marks where the player stands.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.05, 6, 40), new THREE.MeshBasicMaterial({ color: PALETTE.brass, transparent: true, opacity: 0.95 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  ring.visible = false;
  group.add(ring);
  const reachRing = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.025, 6, 40), new THREE.MeshBasicMaterial({ color: PALETTE.parchment, transparent: true, opacity: 0.55 }));
  reachRing.rotation.x = -Math.PI / 2;
  reachRing.position.y = 0.14;
  reachRing.visible = false;
  group.add(reachRing);

  const flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), mat(PALETTE.parchment));
  pole.position.y = 0.25;
  flag.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.13), new THREE.MeshBasicMaterial({ color: PALETTE.brass, side: THREE.DoubleSide }));
  cloth.position.set(0.11, 0.42, 0);
  flag.add(cloth);
  flag.position.set(Math.cos(hillAngle) * 0.4, 1.0, Math.sin(hillAngle) * 0.4);
  flag.visible = false;
  group.add(flag);

  const hit = new THREE.Mesh(new THREE.CircleGeometry(2.1, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hit.rotation.x = -Math.PI / 2;
  hit.position.y = 0.05;
  group.add(hit);

  return { group, hit, ring, reachRing, flag, lamp, dockDir };
}

export interface ShipModel {
  group: THREE.Group;
  hit: THREE.Mesh;
  sail: THREE.Mesh;
  flag: THREE.Mesh;
  wake: THREE.Mesh;
  marker: THREE.Mesh;
}

/** A chunky sloop. The flag's color says whose it is. */
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
  bow.scale.y = 1;
  bow.scale.z = 0.66;
  bow.position.set(0.64, 0.12, 0);
  body.add(bow);
  const gunwale = shaded(new THREE.BoxGeometry(0.92, 0.05, 0.4), mat(PALETTE.gunwale));
  gunwale.position.y = 0.26;
  body.add(gunwale);
  const deck = shaded(new THREE.BoxGeometry(0.84, 0.03, 0.3), mat(PALETTE.deck));
  deck.position.y = 0.285;
  body.add(deck);
  const cabin = shaded(new THREE.BoxGeometry(0.22, 0.12, 0.22), mat(PALETTE.wood));
  cabin.position.set(-0.26, 0.36, 0);
  body.add(cabin);

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

  return { group, hit, sail, flag, wake, marker };
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
  const puffs = 3 + dice.int(2);
  for (let i = 0; i < puffs; i++) {
    const r = 0.3 + dice.range(0, 0.35);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat(PALETTE.cloud, { transparent: true, opacity: 0.93 }));
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
