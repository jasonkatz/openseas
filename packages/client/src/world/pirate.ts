/**
 * A pirate in the world: a small jointed figure that walks, idles and works, the same on an outpost
 * and on a deck. Every kind reads apart by shape before color (rule 6): the player's own pirate
 * stands in a brass ring, a captain's headgear carries a crest, and a bot wears a sailcloth smock,
 * a kerchief and a coil of rope. A pirate wears the jacket and headgear of the look they picked on their
 * sheet (DESIGN.md 3.6, ADR 0033); a figure given no look draws one from its seed. Built from
 * primitives, like the rest of the world; nothing here is art.
 */
import * as THREE from "three";
import { seedFromString, nextInt, type PrngState } from "@openseas/engine";

/** How tall a pirate stands, headgear and all, in world units. */
export const PIRATE_HEIGHT = 0.105;

export type PirateKind = "me" | "pirate" | "captain" | "bot";

export interface PirateFigure {
  group: THREE.Group;
  /** The ring under the player's own feet, and the circle of shade under everyone's. */
  ring: THREE.Mesh | null;
  /** Set each frame: how fast they walk (0 standing) and whether they are working a station. */
  animate(t: number, dt: number, speed: number, work: WorkKind | null): void;
}

/** What a pirate wears, as the figure takes it: the jacket's color and the headgear's content id (`pirates.json`). */
export interface FigureLook {
  jacket: number;
  headgear: string;
}

/** How a pirate works their station: each one moves differently, so a busy deck reads at a glance. */
export type WorkKind = "vent" | "haul" | "hammer" | "gun" | "chart" | "helm";

const SKIN = [0xe0a57c, 0xc98b5e, 0x9c6644, 0xf1c6a0, 0x7a4b30];
const JACKETS = [0x2f4b8f, 0x7a2e2e, 0x2e6b4f, 0x5b3f78, 0x8a5a2b, 0x3c5560, 0x9a3f22];
const TROUSERS = [0x3b3026, 0x2e3440, 0x564533, 0x40403a];
const HEADGEAR = [0x2b2622, 0x7a2e2e, 0x3e6f9a, 0x2e6b4f];
const BRASS = 0xd4a548;
const BOT_SMOCK = 0xd9cfae;
const BOT_KERCHIEF = 0x7a3b3b;
const ROPE = 0xb8945a;

class Dice {
  private s: PrngState;
  constructor(seed: string) {
    this.s = seedFromString(seed);
  }
  pick<T>(xs: readonly T[]): T {
    const r = nextInt(this.s, xs.length);
    this.s = r.state;
    return xs[r.value]!;
  }
  int(n: number): number {
    const r = nextInt(this.s, n);
    this.s = r.state;
    return r.value;
  }
}

const lambert = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * A pirate figure facing +x with its feet at the origin. `look` dresses anyone who is not a
 * bot in the jacket and headgear they picked. Without one, `seed` (their id) picks a look, so a
 * pirate looks the same on every screen. The seed always picks skin and trousers.
 */
export function buildPirate(kind: PirateKind, seed: string, shadows: boolean, look: FigureLook | null = null): PirateFigure {
  const dice = new Dice(`pirate:${seed}`);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const skin = dice.pick(SKIN);
  const dressed = kind !== "bot" ? look : null;
  const jacket = dressed ? dressed.jacket : kind === "me" ? BRASS : kind === "bot" ? BOT_SMOCK : kind === "captain" ? 0x23324f : dice.pick(JACKETS);
  const trousers = dice.pick(TROUSERS);
  const cast = (o: THREE.Object3D): void => o.traverse((c) => ((c as THREE.Mesh).castShadow = shadows));

  // Legs swing from the hip.
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.034, side * 0.0085);
    const leg = part(new THREE.BoxGeometry(0.012, 0.03, 0.012), trousers, 0, -0.016, 0);
    const boot = part(new THREE.BoxGeometry(0.017, 0.008, 0.013), 0x1f1a16, 0.003, -0.03, 0);
    hip.add(leg, boot);
    body.add(hip);
    legs.push(hip);
  }
  // Jacket or smock, flaring at the hem, with a belt.
  const torso = part(
    kind === "bot" ? new THREE.CylinderGeometry(0.019, 0.022, 0.036, 8) : new THREE.CylinderGeometry(0.016, 0.022, 0.038, 8),
    jacket,
    0,
    0.05,
    0,
  );
  body.add(torso);
  body.add(part(new THREE.CylinderGeometry(0.0185, 0.0185, 0.005, 8), 0x3a2414, 0, 0.042, 0));
  if (kind !== "bot") body.add(part(new THREE.BoxGeometry(0.004, 0.006, 0.006), BRASS, 0.018, 0.042, 0));
  // Arms swing from the shoulder.
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 0.064, side * 0.021);
    const arm = part(new THREE.BoxGeometry(0.009, 0.028, 0.009), jacket, 0, -0.013, 0);
    const hand = part(new THREE.SphereGeometry(0.0055, 6, 4), skin, 0, -0.029, 0);
    shoulder.add(arm, hand);
    body.add(shoulder);
    arms.push(shoulder);
  }
  // A head a size too big, as toys have, with eyes so the way they face reads.
  const head = new THREE.Group();
  head.position.y = 0.081;
  head.add(part(new THREE.SphereGeometry(0.0165, 10, 8), skin));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.003), new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
    eye.position.set(0.0155, 0.002, side * 0.006);
    head.add(eye);
  }
  if (kind !== "bot" && kind !== "me" && dice.int(3) === 0) head.add(part(new THREE.BoxGeometry(0.012, 0.012, 0.022), dice.pick([0x3a2414, 0x6b4a2a, 0x9a9a9a]), 0.01, -0.011, 0)); // a beard
  body.add(head);

  // What each kind wears on the head is its silhouette.
  if (kind === "bot") {
    head.add(part(new THREE.SphereGeometry(0.0175, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), BOT_KERCHIEF, 0, 0.001, 0));
    head.add(part(new THREE.BoxGeometry(0.008, 0.006, 0.01), BOT_KERCHIEF, -0.017, 0.004, 0));
    const coil = part(new THREE.TorusGeometry(0.012, 0.0035, 5, 12), ROPE, -0.004, 0.056, 0.018);
    coil.rotation.y = Math.PI / 2;
    coil.rotation.x = 0.5;
    body.add(coil);
  } else if (dressed) {
    head.add(lookHeadgear(dressed.headgear, kind === "captain"));
  } else if (kind === "captain" || (kind === "me" ? false : dice.int(2) === 0)) {
    head.add(tricorn(kind === "captain" ? 0x1d1c22 : dice.pick(HEADGEAR), kind === "captain"));
  } else if (kind === "me") {
    head.add(tricorn(0x3a2414, false));
  } else if (dice.int(2) === 0) {
    // A bandana, knotted behind.
    const color = dice.pick([0xa8262f, 0x1f5c8a, 0xdba53a, 0x3c7a3e]);
    head.add(part(new THREE.SphereGeometry(0.0172, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), color, 0, 0.002, 0));
    head.add(part(new THREE.BoxGeometry(0.009, 0.005, 0.011), color, -0.017, 0.005, 0));
  } else {
    // A knitted cap.
    const color = dice.pick([0x6b2b2b, 0x2f4b8f, 0x40403a]);
    head.add(part(new THREE.CylinderGeometry(0.009, 0.0165, 0.016, 8), color, 0, 0.014, 0));
  }

  let ring: THREE.Mesh | null = null;
  if (kind === "me") {
    // Drawn over everything, so the player finds themself behind a house or a sail.
    ring = new THREE.Mesh(new THREE.RingGeometry(0.034, 0.044, 28), new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    ring.renderOrder = 5;
    group.add(ring);
  }
  // A soft circle of shade, so a pirate stands on the ground even where no shadow map is drawn.
  const shade = new THREE.Mesh(new THREE.CircleGeometry(0.024, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = 0.005;
  shade.renderOrder = 1;
  group.add(shade);
  cast(body);

  let stride = dice.int(100) / 16;
  const workPhase = dice.int(100) / 10;
  return {
    group,
    ring,
    animate(t, dt, speed, work) {
      const walking = speed > 0.001;
      if (walking) stride += dt * (10 + speed * 22);
      const s = Math.sin(stride);
      const swing = walking ? 0.75 : 0;
      legs[0]!.rotation.z = s * swing;
      legs[1]!.rotation.z = -s * swing;
      body.position.y = walking ? Math.abs(Math.cos(stride)) * 0.004 : Math.sin(t * 2 + workPhase) * 0.0008;
      body.rotation.z = walking ? -0.08 : 0;
      head.rotation.y = 0;
      if (walking) {
        arms[0]!.rotation.set(0, 0, -s * 0.7);
        arms[1]!.rotation.set(0, 0, s * 0.7);
      } else if (work) {
        const w = t * 7 + workPhase;
        switch (work) {
          case "vent": {
            // Both hands on the handle, up and down.
            const k = 1.35 + Math.sin(w) * 0.45;
            arms[0]!.rotation.set(0.2, 0, k);
            arms[1]!.rotation.set(-0.2, 0, k);
            body.rotation.z = -0.1 + Math.sin(w) * 0.08;
            break;
          }
          case "haul": {
            // Hand over hand on a line.
            const k = Math.sin(w * 0.7);
            arms[0]!.rotation.set(0, 0, 2.2 + k * 0.5);
            arms[1]!.rotation.set(0, 0, 2.2 - k * 0.5);
            body.rotation.z = 0.12 + k * 0.05;
            break;
          }
          case "hammer": {
            const k = Math.max(0, Math.sin(w * 1.3));
            arms[0]!.rotation.set(0, 0, 0.4);
            arms[1]!.rotation.set(0, 0, 0.9 + k * 1.4);
            body.rotation.z = -0.15;
            break;
          }
          case "gun": {
            // Ramming home, then a crouch.
            const k = Math.sin(w * 0.5);
            arms[0]!.rotation.set(0.1, 0, 1.1 - k * 0.6);
            arms[1]!.rotation.set(-0.1, 0, 1.1 - k * 0.6);
            body.rotation.z = -0.1 - Math.max(0, k) * 0.1;
            break;
          }
          case "chart": {
            // Leaning over the chart, one hand tracing it, looking up now and then.
            arms[0]!.rotation.set(0, 0, 0.9);
            arms[1]!.rotation.set(0, 0, 0.7 + Math.sin(w * 0.6) * 0.3);
            body.rotation.z = -0.22;
            head.rotation.y = Math.sin(w * 0.25) * 0.4;
            break;
          }
          case "helm": {
            const k = Math.sin(w * 0.3) * 0.25;
            arms[0]!.rotation.set(0, 0, 1.3 + k);
            arms[1]!.rotation.set(0, 0, 1.3 - k);
            break;
          }
        }
      } else {
        const k = Math.sin(t * 1.6 + workPhase) * 0.06;
        arms[0]!.rotation.set(-0.08, 0, k);
        arms[1]!.rotation.set(0.08, 0, -k);
      }
      if (ring) {
        const pulse = 1 + Math.sin(t * 3.2) * 0.06;
        ring.scale.set(pulse, pulse, 1);
      }
    },
  };
}

/** Headgear from a look are dark felt, as on the likeness, so the jacket is the look's color. */
const FELT = 0x2a2420;

/** A captain's crest: a brass band and a white feather swept back, set on any headgear at `y`. */
function crestOn(g: THREE.Group, y: number): void {
  g.add(part(new THREE.CylinderGeometry(0.0125, 0.0125, 0.0025, 8), BRASS, 0, y - 0.003, 0));
  const feather = part(new THREE.BoxGeometry(0.026, 0.004, 0.007), 0xf2ede0, -0.008, y + 0.009, 0.006);
  feather.rotation.z = 0.6;
  g.add(feather);
}

/**
 * A headgear from a look, by content id, at the head's scale. Each is its own silhouette, as on the
 * likeness (rule 6), and none is a bot's kerchief. A captain's carries the crest.
 */
function lookHeadgear(id: string, crest: boolean): THREE.Group {
  switch (id) {
    case "bubble-helmet":
      return tricorn(FELT, crest);
    case "goggles": {
      // A fan worn side to side: a half disc standing across the head.
      const g = new THREE.Group();
      g.position.y = 0.012;
      const fan = part(new THREE.CylinderGeometry(0.028, 0.028, 0.006, 12, 1, false, 0, Math.PI), FELT, 0, -0.004, 0);
      fan.rotation.z = Math.PI / 2;
      fan.rotation.y = Math.PI / 2;
      g.add(fan);
      g.add(part(new THREE.SphereGeometry(0.003, 6, 4), BRASS, 0.004, 0.012, 0));
      if (crest) crestOn(g, 0.018);
      return g;
    }
    case "wide-brim": {
      const g = new THREE.Group();
      g.position.y = 0.011;
      g.add(part(new THREE.CylinderGeometry(0.031, 0.031, 0.003, 14), FELT));
      g.add(part(new THREE.CylinderGeometry(0.011, 0.0135, 0.014, 10), FELT, 0, 0.008, 0));
      if (crest) crestOn(g, 0.012);
      return g;
    }
    case "beanie": {
      // A tall soft cap that flops over backwards, with a bobble at its tip.
      const g = new THREE.Group();
      g.position.y = 0.009;
      const cap = part(new THREE.ConeGeometry(0.0165, 0.036, 9), FELT, -0.004, 0.012, 0);
      cap.rotation.z = 0.6;
      g.add(cap);
      g.add(part(new THREE.SphereGeometry(0.0055, 6, 5), 0xc94a3d, -0.016, 0.026, 0));
      if (crest) crestOn(g, 0.012);
      return g;
    }
    default: {
      // A round cap: a short drum.
      const g = new THREE.Group();
      g.position.y = 0.012;
      g.add(part(new THREE.CylinderGeometry(0.0155, 0.017, 0.011, 10), FELT, 0, 0.002, 0));
      if (crest) crestOn(g, 0.01);
      return g;
    }
  }
}

/** A three-cornered headgear; a captain's carries a crest. */
function tricorn(color: number, crest: boolean): THREE.Group {
  const g = new THREE.Group();
  g.position.y = 0.012;
  const brim = part(new THREE.CylinderGeometry(0.026, 0.026, 0.005, 3), color);
  brim.rotation.y = Math.PI;
  g.add(brim);
  // The brim's corners turn up.
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + (i * Math.PI * 2) / 3;
    const corner = part(new THREE.BoxGeometry(0.014, 0.008, 0.005), color, Math.cos(a) * 0.015, 0.004, -Math.sin(a) * 0.015);
    corner.rotation.y = a + Math.PI / 2;
    corner.rotation.x = 0.5;
    g.add(corner);
  }
  g.add(part(new THREE.CylinderGeometry(0.012, 0.0145, 0.012, 8), color, 0, 0.007, 0));
  if (crest) {
    g.add(part(new THREE.CylinderGeometry(0.0125, 0.0125, 0.0025, 8), BRASS, 0, 0.004, 0));
    const feather = part(new THREE.BoxGeometry(0.026, 0.004, 0.007), 0xf2ede0, -0.008, 0.016, 0.006);
    feather.rotation.z = 0.6;
    g.add(feather);
  }
  return g;
}

/** What each station's work looks like. */
export function workFor(station: string | null, captain: boolean): WorkKind | null {
  switch (station) {
    case "cooling":
      return "vent";
    case "engines":
      return "haul";
    case "plating":
      return "hammer";
    case "gunnery":
      return "gun";
    case "navigation":
      return "chart";
    default:
      return captain ? "helm" : null;
  }
}
