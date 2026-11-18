/**
 * The figures in the world: pirates and bots, the same on an outpost and on a deck. Every kind
 * reads apart by shape before color (rule 6). A pirate is a small jointed person in a jacket and
 * headgear: the player's own stands in an amber ring, and a captain's headgear carries a crest. A
 * bot is not a person at all (ADR 0034): a small round robot on a wheel, with one lamp eye and a
 * tool arm, half a pirate's height, so nobody takes it for a player. A pirate wears the jacket and
 * headgear of the look they picked on their sheet (DESIGN.md 3.6, ADR 0033); a figure given no look
 * draws one from its seed. Built from primitives, like the rest of the world; nothing here is art.
 */
import * as THREE from "three";
import { seedFromString, nextInt, type PrngState } from "@openseas/engine";
import { blend, ink } from "@openseas/boards/look";
import { AMBER, CREAM, GROUND, LINE, PLAYER_INKS, SLATE, TONES, mix, muted, plate } from "./tones.js";

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

/** How a station is worked: each one moves differently, so a busy deck reads at a glance. */
export type WorkKind = "vent" | "haul" | "hammer" | "gun" | "chart" | "helm";

/** Skin, hair and trousers are drawn from the seed. All of them are warm or plate tints, so the jacket is the colour a figure is known by. */
const SKIN = [mix(ink("rust"), CREAM, 0.45), blend("rust", "sand", 0.5), ink("rust"), blend("sand", "cream", 0.5), blend("ground", "rust", 0.6)];
const TROUSERS = [LINE, plate(0.15), muted("rust", 0.25), plate(0.3)];
/** The headgear content offers, for a figure that was given no look. */
const HEADGEAR = ["bubble-helmet", "goggles", "wide-brim", "flight-cap", "beanie"];
const HAIR = [blend("ground", "line", 0.5), blend("ground", "rust", 0.5), SLATE, ink("sand")];
const BEARD = [blend("ground", "rust", 0.35), blend("ground", "rust", 0.55), SLATE];
const TIN = TONES.tin;
const STEEL = TONES.steel;
const IRON = TONES.iron;
/** Dark cloth and leather: a strap, a boot, a hat. A step above the floor it stands on. */
const FELT = plate(0.2);
/** What a bot's band is painted, so two on a deck are not twins. */
const BOT_BANDS = [muted("rust", 0.75), muted("teal", 0.75), muted("sky", 0.75), muted("sand", 0.75)];

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
  return m;
}

/** Something that gives light or is glass: drawn unlit, so it is its own colour whichever way it faces. */
function lit(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, opacity = 1): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
  m.position.set(x, y, z);
  return m;
}

/** A jacket's darker band and its lighter collar: the jacket's own colour, a step toward the ground or toward cream. */
const shade = (color: number): number => mix(color, GROUND, 0.35);
const tint = (color: number): number => mix(color, CREAM, 0.3);

/**
 * The one shadow in the world: a flat circle of the ground's colour a figure stands on, so it sits
 * on the floor and does not float. Nothing else casts or takes a shadow (docs/BRAND.md section 7).
 */
function shadeUnder(radius: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), new THREE.MeshBasicMaterial({ color: GROUND, transparent: true, opacity: 0.3, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.005;
  m.renderOrder = 1;
  return m;
}

/**
 * A figure facing +x with its feet at the origin. `look` dresses a pirate in the jacket and
 * headgear they picked. Without one, `seed` (their id) picks a look, so a pirate looks the same on
 * every screen. The seed always picks skin and trousers. A bot takes no look: it is a robot.
 */
export function buildPirate(kind: PirateKind, seed: string, look: FigureLook | null = null): PirateFigure {
  if (kind === "bot") return buildBot(seed);
  const dice = new Dice(`pirate:${seed}`);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const skin = dice.pick(SKIN);
  const trousers = dice.pick(TROUSERS);
  const hair = dice.pick(HAIR);
  const jacket = look ? look.jacket : kind === "me" ? AMBER : kind === "captain" ? SLATE : dice.pick(PLAYER_INKS);
  const headgear = look ? look.headgear : dice.pick(HEADGEAR);

  // Legs swing from the hip, in boots made for a deck.
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.034, side * 0.0085);
    const leg = part(new THREE.BoxGeometry(0.012, 0.03, 0.012), trousers, 0, -0.016, 0);
    const boot = part(new THREE.BoxGeometry(0.019, 0.01, 0.014), GROUND, 0.003, -0.029, 0);
    hip.add(leg, boot);
    body.add(hip);
    legs.push(hip);
  }
  // A jacket: short, straight, with a stand collar, a waistband and a zip down the front.
  body.add(part(new THREE.CylinderGeometry(0.0172, 0.0205, 0.036, 8), jacket, 0, 0.051, 0));
  body.add(part(new THREE.CylinderGeometry(0.0212, 0.0212, 0.006, 8), shade(jacket), 0, 0.035, 0));
  body.add(part(new THREE.CylinderGeometry(0.0125, 0.0165, 0.007, 8), tint(jacket), 0, 0.0715, 0));
  body.add(part(new THREE.BoxGeometry(0.003, 0.03, 0.004), shade(jacket), 0.0188, 0.052, 0));
  // Arms swing from the shoulder.
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 0.064, side * 0.021);
    const arm = part(new THREE.BoxGeometry(0.009, 0.028, 0.009), jacket, 0, -0.013, 0);
    const cuff = part(new THREE.BoxGeometry(0.0098, 0.005, 0.0098), shade(jacket), 0, -0.0245, 0);
    const hand = part(new THREE.SphereGeometry(0.0055, 6, 4), skin, 0, -0.029, 0);
    shoulder.add(arm, cuff, hand);
    body.add(shoulder);
    arms.push(shoulder);
  }
  // A head a size too big, as toys have, with eyes so the way they face reads.
  const head = new THREE.Group();
  head.position.y = 0.081;
  head.add(part(new THREE.SphereGeometry(0.0165, 10, 8), skin));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.003), new THREE.MeshBasicMaterial({ color: GROUND }));
    eye.position.set(0.0155, 0.002, side * 0.006);
    head.add(eye);
  }
  if (kind !== "me" && dice.int(3) === 0) head.add(part(new THREE.BoxGeometry(0.012, 0.012, 0.022), dice.pick(BEARD), 0.01, -0.011, 0)); // a beard
  body.add(head);
  // What is worn on the head is the silhouette.
  head.add(lookHeadgear(headgear, kind === "captain", hair));

  let ring: THREE.Mesh | null = null;
  if (kind === "me") {
    // Drawn over everything, so the player finds themself behind a pod or a tail fin.
    ring = new THREE.Mesh(new THREE.RingGeometry(0.034, 0.044, 28), new THREE.MeshBasicMaterial({ color: AMBER, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    ring.renderOrder = 5;
    group.add(ring);
  }
  group.add(shadeUnder(0.024));

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
            // Both hands on the vent lever, up and down.
            const k = 1.35 + Math.sin(w) * 0.45;
            arms[0]!.rotation.set(0.2, 0, k);
            arms[1]!.rotation.set(-0.2, 0, k);
            body.rotation.z = -0.1 + Math.sin(w) * 0.08;
            break;
          }
          case "haul": {
            // A throttle in each hand, one forward as the other comes back.
            const k = Math.sin(w * 0.7);
            arms[0]!.rotation.set(0, 0, 1.5 + k * 0.5);
            arms[1]!.rotation.set(0, 0, 1.5 - k * 0.5);
            body.rotation.z = 0.06 + k * 0.04;
            break;
          }
          case "hammer": {
            // One hand steadies the plate, the other works the welder along it.
            const k = Math.max(0, Math.sin(w * 1.3));
            arms[0]!.rotation.set(0, 0, 0.4);
            arms[1]!.rotation.set(0, 0, 0.9 + k * 1.4);
            body.rotation.z = -0.15;
            break;
          }
          case "gun": {
            // Ramming a load home, then a crouch.
            const k = Math.sin(w * 0.5);
            arms[0]!.rotation.set(0.1, 0, 1.1 - k * 0.6);
            arms[1]!.rotation.set(-0.1, 0, 1.1 - k * 0.6);
            body.rotation.z = -0.1 - Math.max(0, k) * 0.1;
            break;
          }
          case "chart": {
            // Leaning over the star chart, one hand tracing it, looking up now and then.
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

/**
 * A bot: a ball of a body on one wheel, a band of paint round its middle, one lamp for an eye, an
 * aerial, and a tool arm on its right. It rolls where a pirate walks and works a station with the
 * arm. Half a pirate's height and no head, no legs, no jacket: its shape alone says it is no player.
 */
function buildBot(seed: string): PirateFigure {
  const dice = new Dice(`bot:${seed}`);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const band = dice.pick(BOT_BANDS);

  const wheel = part(new THREE.CylinderGeometry(0.0115, 0.0115, 0.014, 10), IRON, 0, 0.0115, 0);
  wheel.rotation.x = Math.PI / 2;
  // A tread mark on the wheel, so its turning shows.
  const tread = part(new THREE.BoxGeometry(0.006, 0.0235, 0.0145), STEEL);
  wheel.add(tread);
  body.add(wheel);
  for (const side of [-1, 1]) body.add(part(new THREE.BoxGeometry(0.006, 0.016, 0.003), STEEL, 0, 0.018, side * 0.0095));

  // Everything above the wheel leans and bobs together.
  const shell = new THREE.Group();
  shell.position.y = 0.038;
  body.add(shell);
  const ball = part(new THREE.SphereGeometry(0.0215, 12, 9), TIN);
  ball.scale.y = 0.92;
  shell.add(ball);
  shell.add(part(new THREE.CylinderGeometry(0.0219, 0.0219, 0.008, 12), band, 0, -0.003, 0));
  // The eye: a bezel on its front and a lamp in it.
  const bezel = part(new THREE.CylinderGeometry(0.0098, 0.0098, 0.005, 12), IRON, 0.019, 0.005, 0);
  bezel.rotation.z = Math.PI / 2;
  shell.add(bezel);
  const lamp = lit(new THREE.CylinderGeometry(0.0068, 0.0068, 0.003, 12), TONES.lamp, 0.0222, 0.005, 0);
  lamp.rotation.z = Math.PI / 2;
  shell.add(lamp);
  shell.add(part(new THREE.CylinderGeometry(0.001, 0.001, 0.02, 4), IRON, -0.006, 0.028, -0.007));
  const beacon = lit(new THREE.SphereGeometry(0.003, 5, 4), CREAM, -0.006, 0.039, -0.007);
  shell.add(beacon);
  // The tool arm: an upper arm from the shoulder, a forearm at the elbow, a two-pronged grip, and a spark for welding.
  const shoulder = new THREE.Group();
  shoulder.position.set(0.002, 0.004, 0.0225);
  shoulder.add(part(new THREE.SphereGeometry(0.0048, 6, 5), STEEL));
  shoulder.add(part(new THREE.BoxGeometry(0.005, 0.02, 0.005), STEEL, 0, -0.01, 0));
  const elbow = new THREE.Group();
  elbow.position.y = -0.02;
  elbow.add(part(new THREE.BoxGeometry(0.018, 0.0045, 0.0045), TIN, 0.009, 0, 0));
  for (const side of [-1, 1]) elbow.add(part(new THREE.BoxGeometry(0.008, 0.003, 0.002), IRON, 0.021, 0, side * 0.003));
  const spark = lit(new THREE.SphereGeometry(0.0035, 5, 4), TONES.ice, 0.027, 0, 0);
  spark.visible = false;
  elbow.add(spark);
  shoulder.add(elbow);
  shell.add(shoulder);

  group.add(shadeUnder(0.022));

  const phase = dice.int(100) / 10;
  return {
    group,
    ring: null,
    animate(t, dt, speed, work) {
      const rolling = speed > 0.001;
      if (rolling) wheel.rotation.y -= dt * (speed / 0.0115);
      shell.position.y = 0.038 + Math.sin(t * 2.4 + phase) * 0.0012;
      shell.rotation.z = rolling ? -0.16 : 0;
      shell.rotation.y = 0;
      // It blinks: the lamp shuts to a slit now and then.
      lamp.scale.x = Math.sin(t * 0.9 + phase) > 0.985 ? 0.15 : 1;
      beacon.visible = Math.sin(t * 3 + phase) > 0;
      spark.visible = false;
      const w = t * 7 + phase;
      if (rolling) {
        shoulder.rotation.set(0, 0, 0.5);
        elbow.rotation.z = 0.4;
      } else if (work === "vent") {
        // The lever, up and down.
        shoulder.rotation.set(0, 0, 1.25 + Math.sin(w) * 0.45);
        elbow.rotation.z = -0.3;
      } else if (work === "haul") {
        // A throttle, forward and back.
        shoulder.rotation.set(0, 0, 1.2 + Math.sin(w * 0.7) * 0.4);
        elbow.rotation.z = Math.sin(w * 0.7 + 1) * 0.5;
      } else if (work === "hammer") {
        // Welding: the grip dips to the plate and sparks.
        const k = Math.max(0, Math.sin(w * 1.3));
        shoulder.rotation.set(0, 0, 0.8 + k * 0.5);
        elbow.rotation.z = -0.5 + k * 0.4;
        spark.visible = k > 0.55 && Math.sin(t * 47) > -0.2;
        shell.rotation.z = -0.1;
      } else if (work === "gun") {
        // Ramming a load home.
        shoulder.rotation.set(0, 0, 1.15 - Math.sin(w * 0.5) * 0.55);
        elbow.rotation.z = 0.1;
      } else {
        // Nothing to do: the arm hangs, and it looks about.
        shoulder.rotation.set(0, 0, 0.25 + Math.sin(t * 1.3 + phase) * 0.08);
        elbow.rotation.z = 0.5;
        shell.rotation.y = Math.sin(t * 0.5 + phase) * 0.35;
      }
    },
  };
}

/** A captain's crest: a band and a cream blade standing fore and aft, set on any headgear at `y`. Its shape is the sign, not its colour. */
function crestOn(g: THREE.Group, y: number): void {
  g.add(part(new THREE.CylinderGeometry(0.0105, 0.0125, 0.003, 8), TIN, 0, y, 0));
  const blade = part(new THREE.CylinderGeometry(0.0145, 0.0145, 0.0035, 10, 1, false, 0, Math.PI), CREAM, -0.002, y + 0.001, 0);
  // Half a disc, stood on its flat edge along the line of the head.
  blade.rotation.set(0, Math.PI / 2, Math.PI / 2);
  g.add(blade);
}

/**
 * Headgear from a look, by content id, at the head's scale. Each is its own silhouette, as on the
 * likeness (rule 6): a bubble of glass, goggles pushed up into spiked hair, a wide brim, a cap with
 * ear flaps, a beanie with a bobble. A captain's carries the crest.
 */
function lookHeadgear(id: string, crest: boolean, hair: number): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case "bubble-helmet": {
      // A clear globe right round the head on a collar ring, with a glint on its brow.
      g.add(lit(new THREE.SphereGeometry(0.0245, 14, 10), TONES.ice, 0, 0.003, 0, 0.25));
      g.add(part(new THREE.CylinderGeometry(0.0185, 0.0205, 0.007, 12), TIN, 0, -0.0165, 0));
      const glint = lit(new THREE.BoxGeometry(0.002, 0.009, 0.004), CREAM, 0.017, 0.017, 0.011);
      glint.rotation.z = -0.6;
      g.add(glint);
      if (crest) crestOn(g, 0.0275);
      return g;
    }
    case "goggles": {
      // A strap round the brow, two lenses pushed up on the forehead, its ends loose behind, over a head of spikes.
      g.add(part(new THREE.CylinderGeometry(0.0172, 0.0172, 0.0045, 12), FELT, 0, 0.0075, 0));
      for (const side of [-1, 1]) {
        const rim = part(new THREE.CylinderGeometry(0.0068, 0.0068, 0.006, 10), TIN, 0.0155, 0.0085, side * 0.0074);
        rim.rotation.z = Math.PI / 2;
        g.add(rim);
        const lens = lit(new THREE.CylinderGeometry(0.0048, 0.0048, 0.002, 10), TONES.ice, 0.019, 0.0085, side * 0.0074);
        lens.rotation.z = Math.PI / 2;
        g.add(lens);
        const tail = part(new THREE.BoxGeometry(0.011, 0.004, 0.002), FELT, -0.02, 0.003, side * 0.004);
        tail.rotation.z = 0.5;
        g.add(tail);
      }
      for (let i = 0; i < 3; i++) {
        const spike = part(new THREE.ConeGeometry(0.0062, 0.016, 5), hair, -0.008 + i * 0.008, 0.02 - Math.abs(i - 1) * 0.003, 0);
        spike.rotation.z = (1 - i) * 0.35;
        g.add(spike);
      }
      if (crest) crestOn(g, 0.0245);
      return g;
    }
    case "wide-brim": {
      g.position.y = 0.011;
      g.add(part(new THREE.CylinderGeometry(0.031, 0.031, 0.003, 14), FELT));
      g.add(part(new THREE.CylinderGeometry(0.011, 0.0135, 0.014, 10), FELT, 0, 0.008, 0));
      g.add(part(new THREE.CylinderGeometry(0.0138, 0.0138, 0.004, 10), ink("sand"), 0, 0.0035, 0));
      if (crest) crestOn(g, 0.0165);
      return g;
    }
    case "beanie": {
      // A knitted dome pulled down to a rolled brim, with a bobble on top.
      g.add(part(new THREE.SphereGeometry(0.0176, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), plate(0.5), 0, 0.003, 0));
      g.add(part(new THREE.CylinderGeometry(0.0184, 0.0184, 0.0065, 12), plate(0.8), 0, 0.005, 0));
      g.add(part(new THREE.SphereGeometry(0.0065, 7, 6), CREAM, 0, 0.0235, 0));
      if (crest) crestOn(g, 0.0205);
      return g;
    }
    default: {
      // A flight cap: leather close over the skull, a flap down over each ear, a fleece band across the brow.
      g.add(part(new THREE.SphereGeometry(0.0178, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), TONES.trim, 0, 0.001, 0));
      for (const side of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.013, 0.018, 0.004), TONES.trim, -0.001, -0.011, side * 0.0172));
      g.add(part(new THREE.BoxGeometry(0.005, 0.0055, 0.024), CREAM, 0.0158, 0.0065, 0));
      if (crest) crestOn(g, 0.0188);
      return g;
    }
  }
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
