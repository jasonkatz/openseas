/**
 * The world: an isometric three.js diorama of the ocean that the whole game lives in (ADR 0020).
 * Islands sit on a slow sea, sea lanes march between them, ships bob at the docks or sail along a
 * lane, clouds drift and throw shadows, gulls circle. The camera glides between the chart, an
 * island and the deck of a ship; buildings and stations are tappable spots hung on the geometry.
 * Everything shown comes from content and server snapshots; nothing here decides anything.
 *
 * Chart units: an island's content x maps to world x, its y to world z.
 */
import * as THREE from "three";
import type { IslandLandmark } from "@openseas/content";
import { CameraRig, isoDirection, type View } from "./camera.js";
import {
  PALETTE,
  STATION_ORDER,
  buildBuoy,
  buildCloud,
  buildCrewPeg,
  buildGull,
  buildIsland,
  buildShip,
  type Building,
  type CrewPeg,
  type GullModel,
  type IslandModel,
  type ShipModel,
  type Station,
} from "./models.js";

export interface WorldIsland {
  id: string;
  name: string;
  x: number;
  y: number;
  landmark: IslandLandmark;
  buildings: { kind: Building; label: string }[];
}
export interface WorldRoute {
  id: string;
  from: string;
  to: string;
}
export type WorldShipLocation = { kind: "docked"; islandId: string } | { kind: "at-sea"; from: string; to: string; progress: number };
export interface WorldShip {
  id: string;
  name: string;
  kind: "yours" | "aboard" | "other";
  location: WorldShipLocation;
}
export type Focus = { kind: "all" } | { kind: "island"; id: string } | { kind: "ship"; id: string };
export interface DeckStation {
  station: Station;
  label: string;
  /** Who is at it, or null when open. */
  holder: string | null;
  mine: boolean;
}
export interface DeckCrew {
  pirateId: string;
  station: Station | null;
  mine: boolean;
  captain: boolean;
}
export interface Deck {
  shipId: string;
  stations: DeckStation[];
  crew: DeckCrew[];
}
/** Fractions of the viewport covered by the shell's panels, so the focus lands in the clear. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export interface WorldInput {
  islands: WorldIsland[];
  routes: WorldRoute[];
  ships: WorldShip[];
  /** The island the player stands on, flagged. */
  here: string | null;
  focus: Focus;
  /** The selected island, ringed in brass. */
  selected: string | null;
  /** Islands the player may pick, ringed faintly. */
  reachable: string[];
  selectedShip: string | null;
  /** How long a ship takes to ease to a new progress, so turn-by-turn snapshots read as motion. */
  smoothMs: number;
  /** The deck of the ship the player is aboard, when the focus is on it. */
  deck: Deck | null;
  insets: Insets;
  /** Dim the world: a board is open over it. */
  dimmed: boolean;
}
export interface WorldEvents {
  onIsland(id: string): void;
  onShip(id: string): void;
  onBuilding(islandId: string, building: Building): void;
  onStation(station: Station): void;
}

const SEA_SIZE = 110;
const LANE_BULGE = 0.16;
const DASH_STEP = 0.55;
const ISLAND_HALF_H = 3.1;
const SHIP_HALF_H = 1.05;
const AZIMUTHS = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
const SPOT_H = 40;
const SPOT_W = 120;

interface Lane {
  key: string;
  a: string;
  b: string;
  curve: THREE.QuadraticBezierCurve3;
  length: number;
  dashes: THREE.Mesh[];
  buoy: THREE.Group;
}
interface ShipView {
  ship: WorldShip;
  model: ShipModel;
  phase: number;
  /** Progress along its lane as shown, 0..1, eased toward the snapshot's. */
  shownProgress: number;
  targetProgress: number;
  laneKey: string | null;
  reversed: boolean;
  label: HTMLDivElement;
}
interface IslandView {
  island: WorldIsland;
  model: IslandModel;
  label: HTMLDivElement;
  spots: Map<Building, HTMLButtonElement>;
}
interface Cloud {
  group: THREE.Group;
  speed: number;
}
interface Gull {
  model: GullModel;
  center: THREE.Vector3;
  radius: number;
  phase: number;
  speed: number;
}

export class WorldScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly sun: THREE.DirectionalLight;
  private readonly sea: THREE.Mesh;
  private readonly seaUniforms = {
    uTime: { value: 0 },
    uIslands: { value: [] as THREE.Vector3[] },
    uIslandCount: { value: 0 },
    uShallow: { value: new THREE.Color(PALETTE.seaShallow) },
    uFoam: { value: new THREE.Color(PALETTE.foam) },
  };
  private readonly labels: HTMLDivElement;
  private readonly islands = new Map<string, IslandView>();
  private readonly lanes = new Map<string, Lane>();
  private readonly ships = new Map<string, ShipView>();
  private readonly pegs = new Map<string, CrewPeg>();
  private readonly stationSpots = new Map<Station, HTMLButtonElement>();
  private readonly clouds: Cloud[] = [];
  private readonly gulls: Gull[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly center = new THREE.Vector3();
  private spread = 10;
  private azimuth = Math.PI / 4;
  private input: WorldInput | null = null;
  private frame = 0;
  private running = false;
  private visible = true;
  private lastFrameAt = 0;
  private time = 0;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private hovered: string | null = null;
  private readonly reducedMotion: boolean;
  private readonly lowQuality: boolean;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver | null;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  /** Fires once the first frame with content has been drawn. */
  onReady: (() => void) | null = null;
  private ready = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: WorldEvents,
  ) {
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    // A software renderer (a headless browser, a machine without a GPU) gets a lighter world: no
    // shadows, one pixel per pixel, a coarser sea. It still reads as the same place.
    this.lowQuality = isSoftwareRenderer(this.renderer);
    this.renderer.setPixelRatio(this.lowQuality ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = !this.lowQuality;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.setAttribute("data-testid", "world-canvas");
    host.appendChild(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "ow-labels";
    host.appendChild(this.labels);

    this.scene.fog = new THREE.Fog(0xa9dcea, 46, 100);
    this.scene.add(new THREE.HemisphereLight(0xd4f0ff, 0x2f5a46, 1.15));
    this.sun = new THREE.DirectionalLight(0xfff2d9, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.intensity = 0.55;
    this.scene.add(this.sun, this.sun.target);

    this.sea = this.buildSea();
    this.scene.add(this.sea);

    for (let i = 0; i < 6; i++) {
      const group = buildCloud(String(i));
      this.scene.add(group);
      this.clouds.push({ group, speed: 0.12 + i * 0.03 });
    }

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.intersectionObserver =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            this.visible = entries.some((e) => e.isIntersecting);
            if (this.visible && this.running) this.loop();
          })
        : null;
    this.intersectionObserver?.observe(host);
    this.resize();
  }

  // ---- public

  setInput(input: WorldInput): void {
    const first = this.input === null;
    const focusChanged = !this.input || focusKey(this.input.focus) !== focusKey(input.focus);
    this.input = input;
    if (first || this.islands.size !== input.islands.length) this.layoutIslands(input);
    this.syncShips(input);
    this.syncDeck(input);
    const focusIsland = input.focus.kind === "island" ? input.focus.id : null;
    const focusShip = input.focus.kind === "ship" ? input.focus.id : null;
    for (const [id, iv] of this.islands) {
      iv.model.ring.visible = id === input.selected;
      iv.model.reachRing.visible = id !== input.selected && input.reachable.includes(id);
      iv.model.flag.visible = id === input.here;
      iv.label.classList.toggle("selected", id === input.selected);
      iv.label.classList.toggle("here", id === input.here);
      iv.label.classList.toggle("reachable", input.reachable.includes(id));
      // The focused island's name is on the card; its buildings take over.
      iv.label.classList.toggle("ow-hidden", id === focusIsland || focusShip !== null);
      for (const spot of iv.spots.values()) spot.classList.toggle("ow-hidden", id !== focusIsland);
    }
    for (const [id, sv] of this.ships) {
      sv.label.classList.toggle("selected", id === input.selectedShip);
      // Other people's ships are named only when picked, or when their island is, so a busy dock stays legible.
      const docked = sv.ship.location.kind === "docked" ? sv.ship.location.islandId : null;
      const quiet = sv.ship.kind === "other" && id !== input.selectedShip && !(docked && docked === input.selected) && !(docked && docked === focusIsland);
      sv.label.classList.toggle("ow-label-quiet", quiet);
      sv.label.classList.toggle("ow-hidden", focusShip !== null);
    }
    this.host.classList.toggle("is-dimmed", input.dimmed);
    this.updateView(first || focusChanged ? first : false);
    if (!this.running || this.reducedMotion) this.render(0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.intersectionObserver?.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        for (const mm of Array.isArray(m) ? m : [m]) mm.dispose();
      }
    });
    this.renderer.dispose();
    el.remove();
    this.labels.remove();
  }

  // ---- layout

  private layoutIslands(input: WorldInput): void {
    for (const iv of this.islands.values()) {
      this.scene.remove(iv.model.group);
      iv.label.remove();
      for (const s of iv.spots.values()) s.remove();
    }
    this.islands.clear();
    for (const lane of this.lanes.values()) {
      for (const d of lane.dashes) this.scene.remove(d);
      this.scene.remove(lane.buoy);
    }
    this.lanes.clear();
    for (const g of this.gulls) this.scene.remove(g.model.group);
    this.gulls.length = 0;

    const centroid = new THREE.Vector2();
    for (const i of input.islands) centroid.add(new THREE.Vector2(i.x, i.y));
    centroid.divideScalar(Math.max(1, input.islands.length));
    this.center.set(centroid.x, 0, centroid.y);

    const seaIslands: THREE.Vector3[] = [];
    for (const island of input.islands) {
      const toward = new THREE.Vector2(centroid.x - island.x, centroid.y - island.y);
      if (toward.lengthSq() < 1e-6) toward.set(1, 0);
      const model = buildIsland(island.id, toward, island.landmark);
      model.group.position.set(island.x, 0, island.y);
      this.scene.add(model.group);
      const label = this.makeLabel("ow-label ow-label-island", island.name, () => this.events.onIsland(island.id));
      label.dataset.island = island.id;
      const spots = new Map<Building, HTMLButtonElement>();
      for (const b of island.buildings) {
        const spot = this.makeSpot(`ow-spot ow-spot-${b.kind}`, b.label, () => this.events.onBuilding(island.id, b.kind));
        spot.dataset.building = b.kind;
        spot.dataset.island = island.id;
        spot.classList.add("ow-hidden");
        spots.set(b.kind, spot);
      }
      this.islands.set(island.id, { island, model, label, spots });
      seaIslands.push(new THREE.Vector3(island.x, island.y, 1.6));
    }
    while (seaIslands.length < 8) seaIslands.push(new THREE.Vector3(0, 0, -100));
    this.seaUniforms.uIslands.value = seaIslands;
    this.seaUniforms.uIslandCount.value = Math.min(8, input.islands.length);
    this.sea.position.set(this.center.x, 0, this.center.z);

    for (const route of input.routes) {
      const [a, b] = route.from < route.to ? [route.from, route.to] : [route.to, route.from];
      const key = `${a}|${b}`;
      if (this.lanes.has(key)) continue;
      const ia = this.islands.get(a);
      const ib = this.islands.get(b);
      if (!ia || !ib) continue;
      const pa = new THREE.Vector3(ia.island.x, 0.12, ia.island.y);
      const pb = new THREE.Vector3(ib.island.x, 0.12, ib.island.y);
      const mid = pa.clone().lerp(pb, 0.5);
      const dir = pb.clone().sub(pa);
      const len = dir.length();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(len * LANE_BULGE);
      const curve = new THREE.QuadraticBezierCurve3(pa, mid.add(perp), pb);
      const length = curve.getLength();
      const dashes: THREE.Mesh[] = [];
      const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
      for (let i = 0; i < Math.floor(length / DASH_STEP); i++) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.09), dashMat);
        dash.rotation.x = -Math.PI / 2;
        this.scene.add(dash);
        dashes.push(dash);
      }
      const buoy = buildBuoy();
      const at = curve.getPointAt(0.5);
      buoy.position.set(at.x, 0, at.z);
      this.scene.add(buoy);
      this.lanes.set(key, { key, a, b, curve, length, dashes, buoy });
    }
    this.placeDashes(0);

    for (let i = 0; i < Math.min(3, input.islands.length); i++) {
      const island = input.islands[(i * 2) % input.islands.length]!;
      const model = buildGull();
      this.scene.add(model.group);
      this.gulls.push({ model, center: new THREE.Vector3(island.x, 1.7 + i * 0.3, island.y), radius: 1.6 + i * 0.5, phase: i * 2.1, speed: 0.5 + i * 0.1 });
    }

    this.spread = Math.max(6, ...input.islands.map((i) => Math.hypot(i.x - centroid.x, i.y - centroid.y))) + 3;
    for (const [i, c] of this.clouds.entries()) {
      c.group.position.set(this.center.x + ((i * 7.3) % (this.spread * 2)) - this.spread, 3.6 + (i % 3) * 0.5, this.center.z + ((i * 4.1) % (this.spread * 1.6)) - this.spread * 0.8);
    }

    this.sun.position.copy(this.center).add(new THREE.Vector3(-8, 14, 6));
    this.sun.target.position.copy(this.center);
    const cam = this.sun.shadow.camera;
    cam.left = -this.spread;
    cam.right = this.spread;
    cam.top = this.spread;
    cam.bottom = -this.spread;
    cam.near = 1;
    cam.far = 60;
    cam.updateProjectionMatrix();
    this.pickAzimuth();
  }

  private syncShips(input: WorldInput): void {
    const seen = new Set<string>();
    for (const ship of input.ships) {
      seen.add(ship.id);
      let sv = this.ships.get(ship.id);
      if (sv && sv.ship.kind !== ship.kind) {
        this.removeShip(sv);
        sv = undefined;
      }
      if (!sv) {
        const model = buildShip(ship.kind);
        this.scene.add(model.group);
        const label = this.makeLabel(`ow-label ow-label-ship ow-label-${ship.kind}`, ship.name, () => this.events.onShip(ship.id));
        label.dataset.ship = ship.id;
        sv = { ship, model, phase: hashPhase(ship.id), shownProgress: -1, targetProgress: 0, laneKey: null, reversed: false, label };
        this.ships.set(ship.id, sv);
      }
      sv.ship = ship;
      sv.label.textContent = ship.name;
      if (ship.location.kind === "at-sea") {
        const [a, b] = ship.location.from < ship.location.to ? [ship.location.from, ship.location.to] : [ship.location.to, ship.location.from];
        const key = `${a}|${b}`;
        const reversed = ship.location.from !== a;
        const target = Math.max(0, Math.min(1, ship.location.progress / 1000));
        if (sv.laneKey !== key || sv.reversed !== reversed || sv.shownProgress < 0 || target < sv.shownProgress) sv.shownProgress = target;
        sv.laneKey = key;
        sv.reversed = reversed;
        sv.targetProgress = target;
        sv.model.wake.visible = true;
      } else {
        sv.laneKey = null;
        sv.shownProgress = -1;
        sv.model.wake.visible = false;
      }
    }
    for (const [id, sv] of this.ships) if (!seen.has(id)) this.removeShip(sv);
    this.placeShips(0);
  }

  /** Crew pegs and station spots on the ship the player is aboard. */
  private syncDeck(input: WorldInput): void {
    const deck = input.focus.kind === "ship" && input.deck && input.deck.shipId === input.focus.id ? input.deck : null;
    const sv = deck ? this.ships.get(deck.shipId) : undefined;
    if (!deck || !sv) {
      for (const peg of this.pegs.values()) peg.group.removeFromParent();
      this.pegs.clear();
      for (const spot of this.stationSpots.values()) spot.classList.add("ow-hidden");
      return;
    }
    const seen = new Set<string>();
    let idle = 0;
    for (const c of deck.crew) {
      seen.add(c.pirateId);
      let peg = this.pegs.get(c.pirateId);
      const key = `${c.mine}:${c.captain}`;
      if (peg && peg.group.userData.key !== key) {
        peg.group.removeFromParent();
        peg = undefined;
      }
      if (!peg) {
        peg = buildCrewPeg(c.mine, c.captain);
        peg.group.userData.key = key;
        this.pegs.set(c.pirateId, peg);
      }
      if (peg.group.parent !== sv.model.group) sv.model.group.add(peg.group);
      const spot = c.station ? sv.model.standing[c.station] : c.captain ? sv.model.wheel.clone().add(new THREE.Vector3(-0.08, -0.1, 0)) : sv.model.idleSpots[idle++ % sv.model.idleSpots.length]!;
      peg.group.position.copy(spot);
      peg.group.userData.phase = hashPhase(c.pirateId);
    }
    for (const [id, peg] of this.pegs) {
      if (!seen.has(id)) {
        peg.group.removeFromParent();
        this.pegs.delete(id);
      }
    }
    for (const st of STATION_ORDER) {
      const ds = deck.stations.find((s) => s.station === st);
      let spot = this.stationSpots.get(st);
      if (!ds) {
        spot?.classList.add("ow-hidden");
        continue;
      }
      if (!spot) {
        spot = this.makeSpot(`ow-spot ow-spot-station ow-spot-${st}`, ds.label, () => this.events.onStation(st));
        spot.dataset.station = st;
        this.stationSpots.set(st, spot);
      }
      spot.classList.remove("ow-hidden");
      spot.classList.toggle("is-mine", ds.mine);
      spot.classList.toggle("is-taken", ds.holder !== null && !ds.mine);
      const who = spot.querySelector(".ow-spot-who");
      if (who) who.textContent = ds.holder ?? "";
      spot.setAttribute("aria-label", ds.holder ? `${ds.label}: ${ds.holder}` : ds.label);
    }
  }

  private removeShip(sv: ShipView): void {
    this.scene.remove(sv.model.group);
    sv.label.remove();
    this.ships.delete(sv.ship.id);
  }

  private makeLabel(className: string, text: string, onTap: () => void): HTMLDivElement {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      onTap();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onTap();
      }
    });
    this.labels.appendChild(el);
    return el;
  }

  private makeSpot(className: string, text: string, onTap: () => void): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    const pin = document.createElement("i");
    pin.className = "ow-spot-pin";
    const name = document.createElement("span");
    name.className = "ow-spot-name";
    name.textContent = text;
    const who = document.createElement("small");
    who.className = "ow-spot-who";
    el.append(pin, name, who);
    el.addEventListener("click", (e) => {
      e.preventDefault();
      onTap();
    });
    this.labels.appendChild(el);
    return el;
  }

  // ---- the sea

  private buildSea(): THREE.Mesh {
    const segments = this.lowQuality ? 48 : 120;
    const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, segments, segments);
    const material = new THREE.MeshLambertMaterial({ color: PALETTE.seaDeep });
    const u = this.seaUniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uIslands = u.uIslands;
      shader.uniforms.uIslandCount = u.uIslandCount;
      shader.uniforms.uShallow = u.uShallow;
      shader.uniforms.uFoam = u.uFoam;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uTime;
varying vec3 vSeaWorld;
varying float vWave;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
{
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float w = sin(wp.x * 0.9 + uTime * 1.1) * 0.07
          + sin(wp.z * 1.25 - uTime * 0.85) * 0.055
          + sin((wp.x + wp.z) * 0.45 + uTime * 0.55) * 0.05;
  transformed.z += w;
  vWave = w;
  vSeaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uTime;
uniform vec3 uIslands[8];
uniform int uIslandCount;
uniform vec3 uShallow;
uniform vec3 uFoam;
varying vec3 vSeaWorld;
varying float vWave;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  float shallow = 0.0;
  float foam = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uIslandCount) break;
    vec3 isl = uIslands[i];
    float d = distance(vSeaWorld.xz, isl.xy) - isl.z;
    shallow = max(shallow, 1.0 - smoothstep(0.0, 2.8, d));
    float lap = 0.18 * sin(uTime * 1.6 - d * 3.5);
    foam = max(foam, smoothstep(0.32, 0.0, abs(d - 0.3 + lap)) * 0.9);
    foam = max(foam, smoothstep(0.14, 0.0, d) * 0.5);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, shallow * 0.85);
  diffuseColor.rgb += vec3(0.10, 0.12, 0.12) * smoothstep(0.06, 0.16, vWave);
  float glint = smoothstep(0.985, 1.0, sin(vSeaWorld.x * 3.1 + uTime * 0.9) * sin(vSeaWorld.z * 2.7 - uTime * 0.7));
  diffuseColor.rgb += vec3(0.35) * glint * (1.0 - shallow);
  diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam);
}`,
        );
    };
    const mesh = new THREE.Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---- camera

  /** The view the focus asks for, with the shell's panels kept clear of it. */
  private viewFor(input: WorldInput): View {
    const { insets } = input;
    const vh = Math.max(0.2, 1 - insets.top - insets.bottom);
    const vw = Math.max(0.2, 1 - insets.left - insets.right);
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const aspect = w / h;
    const anchorY = insets.top + vh / 2;
    const anchorX = insets.left + vw / 2;
    if (input.focus.kind === "island") {
      const iv = this.islands.get(input.focus.id);
      const center = iv ? new THREE.Vector3(iv.island.x, 0.35, iv.island.y) : this.center.clone();
      // On a tall phone the island's width is the limit; on a wide screen its height.
      const halfH = Math.max(ISLAND_HALF_H / vh, (ISLAND_HALF_H * 1.05) / (aspect * vw));
      return { center, halfH, anchorY, anchorX };
    }
    if (input.focus.kind === "ship") {
      const sv = this.ships.get(input.focus.id);
      const center = sv ? sv.model.group.position.clone().setY(0.45) : this.center.clone();
      const halfH = Math.max(SHIP_HALF_H / vh, (SHIP_HALF_H * 1.1) / (aspect * vw));
      return { center, halfH, anchorY, anchorX };
    }
    return this.fitAll(input, this.azimuth, aspect, vh, vw, anchorY, anchorX);
  }

  /** The view that fits every island looking down `azimuth`: their footprints projected into the camera's frame. */
  private fitAll(input: WorldInput, azimuth: number, aspect: number, vh: number, vw: number, anchorY: number, anchorX: number): View {
    const probe = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    probe.position.copy(this.center).add(isoDirection(azimuth).multiplyScalar(60));
    probe.lookAt(this.center);
    probe.updateMatrixWorld();
    const inv = probe.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const pad = 2.5;
    for (const i of input.islands) {
      for (const [dx, dz] of [
        [-pad, -pad],
        [pad, -pad],
        [-pad, pad],
        [pad, pad],
      ]) {
        for (const y of [-0.2, 2.4]) {
          this.tmp.set(i.x + dx!, y, i.y + dz!).applyMatrix4(inv);
          minX = Math.min(minX, this.tmp.x);
          maxX = Math.max(maxX, this.tmp.x);
          minY = Math.min(minY, this.tmp.y);
          maxY = Math.max(maxY, this.tmp.y);
        }
      }
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const halfH = Math.max(spanY / 2 / vh, spanX / 2 / (aspect * vw));
    // The bounds' middle in the probe's frame, back in world space.
    const right = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
    const center = this.center.clone().addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
    return { center, halfH, anchorY, anchorX };
  }

  /** Look down whichever diagonal shows the whole chart largest on this screen; a cut, so only on resize. */
  private pickAzimuth(): void {
    const input = this.input;
    if (!input || input.islands.length === 0) return;
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const { insets } = input;
    const vh = Math.max(0.2, 1 - insets.top - insets.bottom);
    const vw = Math.max(0.2, 1 - insets.left - insets.right);
    let best = this.azimuth;
    let bestHalfH = Infinity;
    for (const az of AZIMUTHS) {
      const v = this.fitAll(input, az, w / h, vh, vw, 0.5, 0.5);
      if (v.halfH < bestHalfH - 1e-6) {
        bestHalfH = v.halfH;
        best = az;
      }
    }
    if (best !== this.azimuth) {
      this.azimuth = best;
      this.rig.setAzimuth(best);
      this.sun.position.copy(this.center).add(isoDirection(best + Math.PI * 0.6).multiplyScalar(14).setY(14));
    }
  }

  private updateView(immediate: boolean): void {
    if (!this.input) return;
    this.rig.setView(this.viewFor(this.input), immediate || this.reducedMotion);
  }

  private resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.pickAzimuth();
    this.updateView(true);
    if (!this.running || this.reducedMotion) this.render(0);
  }

  // ---- animation

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible" && this.running) this.loop();
  };

  private loop = (): void => {
    cancelAnimationFrame(this.frame);
    if (!this.running || !this.visible || document.visibilityState === "hidden") return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    this.render(this.reducedMotion ? 0 : dt);
    this.frame = requestAnimationFrame(this.loop);
  };

  private render(dt: number): void {
    const input = this.input;
    if (!input) return;
    this.time += dt;
    const t = this.time;
    this.seaUniforms.uTime.value = t;
    this.placeDashes(t);
    this.placeShips(dt);
    // A followed ship moves between snapshots; keep the target on it.
    if (input.focus.kind === "ship") this.rig.setView(this.viewFor(input));
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.rig.update(dt, w / h);
    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > this.center.x + this.spread) c.group.position.x = this.center.x - this.spread;
    }
    for (const g of this.gulls) {
      const a = g.phase + t * g.speed;
      g.model.group.position.set(g.center.x + Math.cos(a) * g.radius, g.center.y + Math.sin(t * 1.3 + g.phase) * 0.15, g.center.z + Math.sin(a) * g.radius);
      g.model.group.rotation.y = -a;
      const flap = Math.sin(t * 9 + g.phase) * 0.6;
      g.model.left.rotation.z = flap;
      g.model.right.rotation.z = -flap;
    }
    for (const iv of this.islands.values()) {
      iv.model.animate(t, dt);
      if (iv.model.ring.visible) {
        const s = 1 + 0.03 * Math.sin(t * 3);
        iv.model.ring.scale.set(s, s, 1);
        (iv.model.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.2 * Math.sin(t * 3);
      }
    }
    for (const lane of this.lanes.values()) {
      lane.buoy.position.y = Math.sin(t * 1.5 + lane.length) * 0.03;
      lane.buoy.rotation.z = Math.sin(t * 1.1 + lane.length) * 0.08;
      const lamp = lane.buoy.children[2] as THREE.Mesh | undefined;
      if (lamp) (lamp.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 2.5 + lane.length) > 0.5 ? PALETTE.lamp : PALETTE.lampOff);
    }
    for (const peg of this.pegs.values()) {
      const ph = (peg.group.userData.phase as number | undefined) ?? 0;
      peg.group.rotation.y = Math.sin(t * 1.4 + ph) * 0.3;
      peg.group.scale.y = 1 + Math.sin(t * 5 + ph) * 0.03;
    }
    this.renderer.render(this.scene, this.rig.camera);
    this.placeLabels();
    if (!this.ready) {
      this.ready = true;
      this.onReady?.();
    }
  }

  private placeDashes(t: number): void {
    for (const lane of this.lanes.values()) {
      const offset = (t * 0.25) % DASH_STEP;
      lane.dashes.forEach((dash, i) => {
        const u = Math.min(0.999, (i * DASH_STEP + offset) / lane.length);
        const p = lane.curve.getPointAt(u);
        const tan = lane.curve.getTangentAt(u);
        dash.position.copy(p);
        dash.rotation.z = -Math.atan2(tan.z, tan.x);
        const fade = Math.min(1, Math.min(u, 1 - u) * 12);
        dash.scale.setScalar(0.6 + 0.4 * fade);
      });
    }
  }

  private placeShips(dt: number): void {
    if (!this.input) return;
    const docked = new Map<string, number>();
    for (const sv of this.ships.values()) {
      const t = this.time;
      const g = sv.model.group;
      if (sv.ship.location.kind === "docked") {
        const iv = this.islands.get(sv.ship.location.islandId);
        if (!iv) {
          g.visible = false;
          continue;
        }
        g.visible = true;
        const n = docked.get(iv.island.id) ?? 0;
        docked.set(iv.island.id, n + 1);
        const base = Math.atan2(iv.model.dockDir.y, iv.model.dockDir.x);
        const angle = base + (n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2) * 0.42);
        const r = 2.35;
        g.position.set(iv.island.x + Math.cos(angle) * r, 0, iv.island.y + Math.sin(angle) * r);
        g.rotation.y = -(angle + Math.PI / 2);
      } else {
        const lane = sv.laneKey ? this.lanes.get(sv.laneKey) : null;
        if (!lane) {
          g.visible = false;
          continue;
        }
        g.visible = true;
        if (dt > 0 && this.input.smoothMs > 0) {
          const k = 1 - Math.exp(-dt / (this.input.smoothMs / 1000 / 1.6));
          sv.shownProgress += (sv.targetProgress - sv.shownProgress) * k;
        } else sv.shownProgress = sv.targetProgress;
        const u = sv.reversed ? 1 - sv.shownProgress : sv.shownProgress;
        const p = lane.curve.getPointAt(Math.max(0.001, Math.min(0.999, u)));
        const tan = lane.curve.getTangentAt(Math.max(0.001, Math.min(0.999, u)));
        if (sv.reversed) tan.negate();
        g.position.set(p.x, 0, p.z);
        g.rotation.y = -Math.atan2(tan.z, tan.x);
      }
      g.position.y = Math.sin(t * 1.7 + sv.phase) * 0.035;
      g.rotation.z = Math.sin(t * 1.1 + sv.phase) * 0.06;
      g.rotation.x = Math.sin(t * 0.8 + sv.phase * 1.3) * 0.03;
      sv.model.flag.rotation.y = Math.sin(t * 5 + sv.phase) * 0.3;
      sv.model.marker.position.y = 1.75 + Math.sin(t * 3 + sv.phase) * 0.08;
      sv.model.marker.rotation.y = t * 1.5;
      sv.model.marker.visible = sv.ship.kind !== "other" && this.input.focus.kind !== "ship";
    }
  }

  private placeLabels(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const cam = this.rig.camera;
    const place = (el: HTMLElement, p: THREE.Vector3): void => {
      this.tmp.copy(p).project(cam);
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    };
    for (const iv of this.islands.values()) {
      place(iv.label, this.tmp2.set(iv.island.x, 2.4, iv.island.y));
      for (const [b, spot] of iv.spots) {
        if (spot.classList.contains("ow-hidden")) continue;
        place(spot, iv.model.group.localToWorld(this.tmp2.copy(iv.model.anchors[b])));
      }
    }
    for (const sv of this.ships.values()) {
      sv.label.style.display = sv.model.group.visible ? "" : "none";
      place(sv.label, this.tmp2.set(sv.model.group.position.x, 0.2, sv.model.group.position.z));
    }
    const focus = this.input?.focus;
    const aboard = focus?.kind === "ship" ? this.ships.get(focus.id) : undefined;
    if (aboard) {
      // Station spots hang off a small deck; keep them apart so every one stays readable and tappable.
      const placed: { el: HTMLElement; x: number; y: number }[] = [];
      for (const [st, spot] of this.stationSpots) {
        if (spot.classList.contains("ow-hidden")) continue;
        this.tmp.copy(aboard.model.group.localToWorld(this.tmp2.copy(aboard.model.anchors[st]))).project(cam);
        placed.push({ el: spot, x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h });
      }
      placed.sort((a, b) => a.y - b.y);
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i]!;
        for (let j = 0; j < i; j++) {
          const q = placed[j]!;
          if (Math.abs(q.x - p.x) < SPOT_W && p.y - q.y < SPOT_H) p.y = q.y + SPOT_H;
        }
        p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      }
    }
  }

  // ---- picking

  private pick(clientX: number, clientY: number): { kind: "island" | "ship"; id: string } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const targets: THREE.Object3D[] = [];
    for (const sv of this.ships.values()) if (sv.model.group.visible) targets.push(sv.model.hit);
    for (const iv of this.islands.values()) targets.push(iv.model.hit, iv.model.group);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      for (const sv of this.ships.values()) if (hit.object === sv.model.hit) return { kind: "ship", id: sv.ship.id };
      for (const [id, iv] of this.islands) {
        let o: THREE.Object3D | null = hit.object;
        while (o) {
          if (o === iv.model.group) return { kind: "island", id };
          o = o.parent;
        }
      }
    }
    return null;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 600) return;
    const p = this.pick(e.clientX, e.clientY);
    if (!p) return;
    if (p.kind === "island") this.events.onIsland(p.id);
    else this.events.onShip(p.id);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse") return;
    const p = this.pick(e.clientX, e.clientY);
    const key = p ? `${p.kind}:${p.id}` : null;
    if (key === this.hovered) return;
    this.hovered = key;
    this.renderer.domElement.style.cursor = p ? "pointer" : "";
  };

  private readonly onPointerLeave = (): void => {
    this.hovered = null;
    this.renderer.domElement.style.cursor = "";
  };
}

function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
}

function focusKey(f: Focus): string {
  return f.kind === "all" ? "all" : `${f.kind}:${f.id}`;
}

function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}
