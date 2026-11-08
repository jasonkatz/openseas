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
import type { CrewFlagWire } from "@openseas/protocol";
import { CameraRig, isoDirection, type View } from "./camera.js";
import { DOCK, buildIsland, type Building, type Door, type IslandModel } from "./island.js";
import { PALETTE, SHIP_SCALE, SHIP_SINK, STATION_ORDER, buildBuoy, buildCloud, buildGangplank, buildGull, buildShip, dressShip, type DeckPost, type GullModel, type ShipModel, type Station } from "./models.js";
import { PIRATE_HEIGHT, buildPirate, workFor, type PirateFigure, type PirateKind } from "./pirate.js";
import { Walker, type Spot as WalkSpot, type WalkGrid } from "./walk.js";

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
  /** The owner's crew flag (M6): flown at the masthead and painted on the mainsail. Null flies none. */
  colors: CrewFlagWire | null;
  /** Someone else's ship flying the viewer's own crew's colors: named on the chart like the viewer's own. */
  crewmate?: boolean;
}
export type Focus = { kind: "all" } | { kind: "island"; id: string } | { kind: "ship"; id: string };
export interface DeckStation {
  station: Station;
  label: string;
  /** Who is at it, or null when open. */
  holder: string | null;
  mine: boolean;
  /** Held by a deckhand, so the viewer may take it. */
  mate: boolean;
}
export interface DeckCrew {
  pirateId: string;
  name: string;
  station: Station | null;
  /** Where they last walked to on deck, in the ship's frame; null to stand at their post. */
  at: WalkSpot | null;
  mine: boolean;
  captain: boolean;
  /** A deckhand: drawn apart from the pirates so nobody mistakes it for a player. */
  mate: boolean;
}
export interface Deck {
  shipId: string;
  stations: DeckStation[];
  crew: DeckCrew[];
  /** The wheel's spot: what it offers the viewer, or null to show none (not the captain). `primary` marks it as the next thing to do. */
  wheel: { label: string; who: string | null; primary: boolean } | null;
  /** The gangway's spot while docked, to walk off the ship: its label, or null at sea. */
  gangway: string | null;
}
/** Someone else walking where the pirate is. */
export interface WorldWalker {
  id: string;
  name: string;
  /** Where they last walked to, in the place's frame; null if they have not walked since arriving. */
  at: WalkSpot | null;
}
/** Ashore: the island the pirate stands on, and everyone else on it (ADR 0032). */
export interface IslandWalk {
  islandId: string;
  me: string;
  others: WorldWalker[];
  /** The ship the pirate just walked off, so they step ashore at its gangplank. */
  arriveFrom: string | null;
  /** The building whose room the pirate has open: they are inside it (or standing at it, for one nobody enters). */
  inside: Building | null;
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
  /** The word on the viewer's own docked ships at the island in focus. */
  boardLabel: string;
  /** Ashore, the island the pirate walks on; null aboard. */
  walk: IslandWalk | null;
}
export interface WorldEvents {
  onIsland(id: string): void;
  onShip(id: string): void;
  onBuilding(islandId: string, building: Building): void;
  onStation(station: Station): void;
  onWheel(): void;
  /** The pirate set off walking to a spot in their place's frame (the island's, or the deck's). */
  onWalk(x: number, z: number): void;
  /** Another pirate was tapped. */
  onPirate(pirateId: string): void;
  /** The pirate walked down the gangway: off the ship. */
  onGangway(): void;
  /** Inside a building, the pirate asked to be somewhere outside it: their room should close. */
  onOutside(): void;
}

const SEA_SIZE = 110;
const LANE_BULGE = 0.16;
const DASH_STEP = 0.55;
/** The island's footprint on the water, beach and all; the view is fitted to it. */
const ISLAND_R = 1.9;
/** The deck view: the hull itself fills the frame, its own little place; the mast and the sea around it fall outside. */
const DECK_MIN_HALF_H = 0.55;
/** Ashore, the camera walks with the pirate this close: a pirate stands a thumb tall on a phone. */
const WALK_HALF_H = 1.0;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.4;
/** On deck the view starts on the whole hull; it zooms in this far, following the pirate, and out a little. */
const DECK_ZOOM_MIN = 0.4;
const DECK_ZOOM_MAX = 1.3;
/** A walk on the island: an easy pace, and never more than this long however far. */
const ISLAND_PACE = 0.55;
const ISLAND_WALK_MAX_S = 2.2;
/** A walk on deck, in the ship's own units. */
const DECK_PACE = 0.42;
const DECK_WALK_MAX_S = 1.3;
/** Lanes run coast to coast, so a ship's progress along a leg is its progress across the water. */
const COAST_R = 2.1;
const AZIMUTHS = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
const SPOT_H = 36;
const SPOT_W = 170;
const SPOT_DX = 18;
const SPOT_DY = -12;

/** A tappable thing hung on the geometry: a pin at the anchor, a label beside it, a leader between. */
interface Spot {
  el: HTMLButtonElement;
  pin: HTMLElement;
  line: SVGLineElement;
}

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
  /** Where it lies when docked: the island and the berth's number along its dock. */
  berth: { islandId: string; n: number } | null;
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
  spots: Map<Building, Spot>;
}
/** A pirate figure walking in a place: on an island's frame or a ship's deck. */
interface WalkerView {
  id: string;
  scope: "island" | "ship";
  /** The island's or the ship's id. */
  placeId: string;
  kind: PirateKind;
  figure: PirateFigure;
  walker: Walker;
  hit: THREE.Mesh;
  tag: HTMLButtonElement | null;
  /** The last walk target applied, so a repeated snapshot does not restart a walk. */
  atKey: string;
  /** Aboard: the post they stand at when not walking, and the station it is for. */
  post: DeckPost | null;
  postKey: string;
  station: Station | null;
  captain: boolean;
  /** A pirate (not a deckhand): tappable, and named when idle. */
  real: boolean;
  /** The building they are in, out of sight. */
  inside: Building | null;
  /** The doorway they are stepping through, in or out. */
  doorway: { building: Building; out: boolean } | null;
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
  private readonly walkers = new Map<string, WalkerView>();
  private readonly stationSpots = new Map<Station, Spot>();
  private wheelSpot: Spot | null = null;
  private gangwaySpot: Spot | null = null;
  /** Gangplanks down to the docks, by island, rebuilt when who lies at a berth changes. */
  private readonly gangplanks = new Map<string, { key: string; group: THREE.Group }>();
  /** Where a tap sent the pirate: a ring on the ground that fades. */
  private readonly goalRing: THREE.Mesh;
  private goalAge = Infinity;
  /** The walking camera's zoom, a wheel or a pinch away from 1. */
  private zoom = 1;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number } | null = null;
  private dataKey = "";
  /** The building the player was last asked to be in (their open room), to act only when it changes. */
  private lastInside: Building | null | undefined = undefined;
  /** What to do once the player is out of the building they are in: walk where they tapped, board a ship. */
  private afterLeave: (() => void) | null = null;
  /** Walking keys held down (arrows or WASD), as screen directions. */
  private readonly keys = new Set<string>();
  private readonly leaders: SVGSVGElement;
  private readonly clouds: Cloud[] = [];
  private readonly gulls: Gull[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly center = new THREE.Vector3();
  /** Where the sun stands from whatever it lights. */
  private readonly sunOffset = new THREE.Vector3(-8, 14, 6);
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
    this.leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.leaders.setAttribute("class", "ow-leaders");
    host.appendChild(this.leaders);
    this.labels = document.createElement("div");
    this.labels.className = "ow-labels";
    host.appendChild(this.labels);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene.fog = new THREE.Fog(0xa9dcea, 46, 100);
    this.scene.add(new THREE.HemisphereLight(0xdff4ff, 0x35604a, 1.35));
    this.sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.intensity = 0.55;
    this.scene.add(this.sun, this.sun.target);

    this.sea = this.buildSea();
    this.scene.add(this.sea);
    this.goalRing = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.042, 24),
      new THREE.MeshBasicMaterial({ color: PALETTE.parchment, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.goalRing.rotation.x = -Math.PI / 2;
    this.goalRing.renderOrder = 3;
    this.goalRing.visible = false;

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
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
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
    this.placeShips(0);
    this.syncDeck(input);
    this.syncWalkers(input);
    const focusIsland = input.focus.kind === "island" ? input.focus.id : null;
    const focusShip = input.focus.kind === "ship" ? input.focus.id : null;
    for (const [id, iv] of this.islands) {
      iv.model.ring.visible = id === input.selected;
      iv.model.reachRing.visible = id !== input.selected && input.reachable.includes(id);
      // Ashore the pirate themself says where they are; the flag marks it on the chart.
      iv.model.flag.visible = id === input.here && input.focus.kind === "all";
      iv.label.classList.toggle("selected", id === input.selected);
      iv.label.classList.toggle("here", id === input.here);
      iv.label.classList.toggle("reachable", input.reachable.includes(id));
      // The focused island's name is on the card; its buildings take over.
      iv.label.classList.toggle("ow-hidden", id === focusIsland || focusShip !== null);
      for (const spot of iv.spots.values()) hideSpot(spot, id !== focusIsland);
      iv.model.ring.visible = iv.model.ring.visible && focusIsland === null;
    }
    for (const [id, sv] of this.ships) {
      sv.label.classList.toggle("selected", id === input.selectedShip);
      // Other people's ships are named only when picked, or when their island is, so a busy dock stays legible.
      const docked = sv.ship.location.kind === "docked" ? sv.ship.location.islandId : null;
      const quiet = sv.ship.kind === "other" && !sv.ship.crewmate && id !== input.selectedShip && !(docked && docked === input.selected) && !(docked && docked === focusIsland);
      sv.label.classList.toggle("ow-label-quiet", quiet);
      sv.label.classList.toggle("ow-label-crew", Boolean(sv.ship.crewmate));
      sv.label.classList.toggle("ow-hidden", focusShip !== null);
      // The viewer's own ship at the island in focus is a tap away from boarding.
      const boardable = sv.ship.kind === "yours" && docked !== null && docked === focusIsland;
      sv.label.classList.toggle("ow-label-board", boardable);
      sv.label.dataset.board = boardable ? input.boardLabel : "";
    }
    // Clouds drift over the chart; up close they would hide the thing being looked at.
    for (const c of this.clouds) c.group.visible = input.focus.kind === "all";
    // On deck the sails go to glass, so no angle of the canvas ever hides a station.
    for (const [id, sv] of this.ships) {
      const glass = id === focusShip;
      for (const m of sv.model.canvas) {
        const material = m.material as THREE.Material & { opacity: number };
        material.opacity = glass ? 0.22 : 1;
        material.depthWrite = !glass;
        m.castShadow = !glass;
      }
    }
    this.host.classList.toggle("is-dimmed", input.dimmed);
    this.host.classList.toggle("is-walking", this.walkFocus() !== null);
    if (focusChanged) this.zoom = 1;
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
    el.removeEventListener("pointercancel", this.onPointerCancel);
    el.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    for (const wv of this.walkers.values()) wv.tag?.remove();
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
    this.leaders.remove();
  }

  // ---- layout

  private layoutIslands(input: WorldInput): void {
    for (const iv of this.islands.values()) {
      this.scene.remove(iv.model.group);
      iv.label.remove();
      for (const s of iv.spots.values()) removeSpot(s);
    }
    this.islands.clear();
    for (const wv of [...this.walkers.values()]) if (wv.scope === "island") this.removeWalker(wv);
    this.gangplanks.clear();
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
      const model = buildIsland(island.id, toward, island.landmark, { lowQuality: this.lowQuality });
      model.group.position.set(island.x, 0, island.y);
      this.scene.add(model.group);
      const label = this.makeLabel("ow-label ow-label-island", island.name, () => this.events.onIsland(island.id));
      label.dataset.island = island.id;
      const spots = new Map<Building, Spot>();
      for (const b of island.buildings) {
        const spot = this.makeSpot(`ow-spot ow-spot-${b.kind}`, b.label, () => this.goBuilding(island.id, b.kind));
        spot.el.dataset.building = b.kind;
        spot.el.dataset.island = island.id;
        hideSpot(spot, true);
        spots.set(b.kind, spot);
      }
      this.islands.set(island.id, { island, model, label, spots });
      seaIslands.push(new THREE.Vector3(island.x, island.y, 1.42));
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
      const ca = new THREE.Vector3(ia.island.x, 0.12, ia.island.y);
      const cb = new THREE.Vector3(ib.island.x, 0.12, ib.island.y);
      const across = cb.clone().sub(ca).normalize();
      const pa = ca.clone().addScaledVector(across, COAST_R);
      const pb = cb.clone().addScaledVector(across, -COAST_R);
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
        const model = buildShip(ship.kind, !this.lowQuality);
        this.scene.add(model.group);
        const label = this.makeLabel(`ow-label ow-label-ship ow-label-${ship.kind}`, ship.name, () => this.goShip(ship.id));
        label.dataset.ship = ship.id;
        sv = { ship, model, berth: null, phase: hashPhase(ship.id), shownProgress: -1, targetProgress: 0, laneKey: null, reversed: false, label };
        this.ships.set(ship.id, sv);
      }
      sv.ship = ship;
      sv.label.textContent = ship.name;
      dressShip(sv.model, ship.colors);
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

  /** Station spots, the wheel and the gangway on the ship the player is aboard. */
  private syncDeck(input: WorldInput): void {
    const deck = input.focus.kind === "ship" && input.deck && input.deck.shipId === input.focus.id ? input.deck : null;
    const sv = deck ? this.ships.get(deck.shipId) : undefined;
    if (!deck || !sv) {
      for (const spot of this.stationSpots.values()) hideSpot(spot, true);
      if (this.wheelSpot) hideSpot(this.wheelSpot, true);
      if (this.gangwaySpot) hideSpot(this.gangwaySpot, true);
      return;
    }
    for (const st of STATION_ORDER) {
      const ds = deck.stations.find((s) => s.station === st);
      let spot = this.stationSpots.get(st);
      if (!ds) {
        if (spot) hideSpot(spot, true);
        continue;
      }
      if (!spot) {
        spot = this.makeSpot(`ow-spot ow-spot-station ow-spot-${st}`, ds.label, () => this.goStation(st));
        spot.el.dataset.station = st;
        this.stationSpots.set(st, spot);
      }
      hideSpot(spot, false);
      spot.el.classList.toggle("is-mine", ds.mine);
      spot.el.classList.toggle("is-taken", ds.holder !== null && !ds.mine && !ds.mate);
      spot.el.classList.toggle("is-mate", ds.mate);
      spot.el.dataset.holder = ds.holder === null ? "open" : ds.mine ? "me" : ds.mate ? "mate" : "pirate";
      const who = spot.el.querySelector(".ow-spot-who");
      if (who) who.textContent = ds.holder ?? "";
      spot.el.setAttribute("aria-label", ds.holder ? `${ds.label}: ${ds.holder}` : ds.label);
    }
    if (deck.wheel) {
      if (!this.wheelSpot) {
        this.wheelSpot = this.makeSpot("ow-spot ow-spot-wheel", deck.wheel.label, () => this.goWheel());
        this.wheelSpot.el.dataset.wheel = "1";
      }
      const name = this.wheelSpot.el.querySelector(".ow-spot-name");
      if (name) name.textContent = deck.wheel.label;
      const who = this.wheelSpot.el.querySelector(".ow-spot-who");
      if (who) who.textContent = deck.wheel.who ?? "";
      this.wheelSpot.el.classList.toggle("is-primary", deck.wheel.primary);
      hideSpot(this.wheelSpot, false);
    } else if (this.wheelSpot) hideSpot(this.wheelSpot, true);
    // The gangway is only there while she lies against a dock.
    const gangway = deck.gangway !== null && this.gangwaySide(sv) !== null ? deck.gangway : null;
    if (gangway) {
      if (!this.gangwaySpot) {
        this.gangwaySpot = this.makeSpot("ow-spot ow-spot-gangway", gangway, () => this.goGangway());
        this.gangwaySpot.el.dataset.gangway = "1";
      }
      const name = this.gangwaySpot.el.querySelector(".ow-spot-name");
      if (name) name.textContent = gangway;
      hideSpot(this.gangwaySpot, false);
    } else if (this.gangwaySpot) hideSpot(this.gangwaySpot, true);
  }

  // ---- walkers

  /** Everyone walking where the player is: ashore on their island, or on the deck of their ship. */
  private syncWalkers(input: WorldInput): void {
    const seen = new Set<string>();
    const walk = input.walk;
    const iv = walk ? this.islands.get(walk.islandId) : undefined;
    if (walk && iv) {
      const people: { id: string; name: string; at: WalkSpot | null; mine: boolean }[] = [{ id: walk.me, name: "", at: null, mine: true }, ...walk.others.map((o) => ({ ...o, mine: false }))];
      for (const p of people) {
        const key = `island:${p.id}`;
        seen.add(key);
        let wv = this.walkers.get(key);
        if (wv && wv.placeId !== walk.islandId) {
          this.removeWalker(wv);
          wv = undefined;
        }
        if (!wv) {
          // The player opening the game in a building's room is in it; anyone else last seen walking into one is too.
          const into = p.mine ? walk.inside : p.at ? this.insideOf(iv, p.at) : null;
          const door = into ? iv.model.doors[into] : null;
          const start = door ? (door.inside ?? door.at) : p.mine ? this.arrivalFor(iv, walk) : (p.at ?? this.standAbout(iv, p.id));
          wv = this.addWalker(key, p.id, "island", walk.islandId, p.mine ? "me" : "pirate", iv.model.frame, start, door ? door.face : p.mine ? 0 : hashPhase(p.id), p.name, !p.mine);
          wv.atKey = spotKey(p.at);
          if (into && door?.inside) {
            wv.inside = into;
            wv.figure.group.visible = false;
          }
          if (p.mine) {
            this.lastInside = walk.inside;
            // Others hear where the player stepped ashore.
            this.events.onWalk(start.x, start.z);
          }
        } else if (p.mine) {
          this.reconcileInside(wv, iv, walk.inside);
        } else {
          const k = spotKey(p.at);
          if (p.at && k !== wv.atKey) this.walkThere(wv, iv, p.at);
          wv.atKey = k;
          if (wv.tag) wv.tag.textContent = p.name;
        }
      }
    }
    const deck = input.deck;
    const sv = deck ? this.ships.get(deck.shipId) : undefined;
    if (deck && sv) {
      let idle = 0;
      const side = this.gangwaySide(sv);
      for (const c of deck.crew) {
        const key = `ship:${c.pirateId}`;
        seen.add(key);
        const kind: PirateKind = c.mine ? "me" : c.mate ? "mate" : c.captain ? "captain" : "pirate";
        const post: DeckPost = c.station ? sv.model.deck.stations[c.station] : c.captain ? sv.model.deck.helm : { at: sv.model.deck.idle[idle++ % sv.model.deck.idle.length]!, face: hashPhase(c.pirateId) };
        const postKey = `${c.station ?? ""}:${c.captain}:${post.at.x.toFixed(3)},${post.at.z.toFixed(3)}`;
        let wv = this.walkers.get(key);
        if (wv && (wv.placeId !== deck.shipId || wv.kind !== kind)) {
          this.removeWalker(wv);
          wv = undefined;
        }
        if (!wv) {
          // Coming aboard over the gangplank; at sea, straight to their post.
          const start = c.mine && side !== null && sv.ship.location.kind === "docked" ? sv.model.deck.gangway(side) : (c.at ?? post.at);
          wv = this.addWalker(key, c.pirateId, "ship", deck.shipId, kind, sv.model.body, start, post.face, c.name, !c.mate && !c.mine);
          wv.atKey = spotKey(c.at);
          wv.postKey = postKey;
          if (c.mine && !c.at) {
            this.walkOn(wv, post.at, post.face);
            this.events.onWalk(post.at.x, post.at.z);
          }
        } else {
          const k = spotKey(c.at);
          if (!c.mine && c.at && k !== wv.atKey) this.walkOn(wv, c.at);
          else if (postKey !== wv.postKey) this.walkOn(wv, post.at, post.face);
          wv.atKey = k;
          wv.postKey = postKey;
        }
        wv.post = post;
        wv.station = c.station;
        wv.captain = c.captain;
        if (wv.tag) wv.tag.textContent = c.name;
      }
    }
    for (const [key, wv] of this.walkers) if (!seen.has(key)) this.removeWalker(wv);
  }

  private addWalker(key: string, id: string, scope: "island" | "ship", placeId: string, kind: PirateKind, parent: THREE.Object3D, at: WalkSpot, heading: number, name: string, tagged: boolean): WalkerView {
    const figure = buildPirate(kind, id, !this.lowQuality);
    const onDeck = scope === "ship";
    if (onDeck) figure.group.scale.setScalar(1 / SHIP_SCALE);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, PIRATE_HEIGHT * 1.2, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = PIRATE_HEIGHT * 0.6;
    hit.userData.walker = key;
    figure.group.add(hit);
    parent.add(figure.group);
    const walker = onDeck ? new Walker(at, heading, DECK_PACE, DECK_WALK_MAX_S) : new Walker(at, heading, ISLAND_PACE, ISLAND_WALK_MAX_S);
    let tag: HTMLButtonElement | null = null;
    if (tagged) {
      tag = document.createElement("button");
      tag.type = "button";
      tag.className = "ow-tag";
      tag.textContent = name;
      tag.dataset.walker = id;
      tag.addEventListener("click", (e) => {
        e.preventDefault();
        this.events.onPirate(id);
      });
      this.labels.appendChild(tag);
    }
    const wv: WalkerView = { id, scope, placeId, kind, figure, walker, hit, tag, atKey: "", post: null, postKey: "", station: null, captain: false, real: kind !== "mate", inside: null, doorway: null };
    this.walkers.set(key, wv);
    this.placeWalker(wv);
    return wv;
  }

  private removeWalker(wv: WalkerView): void {
    if (wv.kind === "me" && wv.scope === "island") {
      this.lastInside = undefined;
      this.afterLeave = null;
    }
    wv.figure.group.removeFromParent();
    wv.figure.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    wv.tag?.remove();
    this.walkers.delete(`${wv.scope}:${wv.id}`);
  }

  /** Where the player first stands ashore: at the foot of the gangplank they came down, else the plaza. */
  private arrivalFor(iv: IslandView, walk: IslandWalk): WalkSpot {
    const sv = walk.arriveFrom ? this.ships.get(walk.arriveFrom) : undefined;
    if (sv?.berth && sv.berth.islandId === walk.islandId) {
      const foot = iv.model.berth(sv.berth.n).foot;
      if (foot) return foot;
    }
    return this.standAbout(iv, walk.me);
  }

  /** Somewhere near the plaza for a pirate nobody has seen walk yet, the same spot on every screen. */
  private standAbout(iv: IslandView, id: string): WalkSpot {
    const a = hashPhase(id);
    const r = 0.04 + (hashPhase(`${id}:r`) / (Math.PI * 2)) * 0.1;
    const p = { x: iv.model.arrival.x + Math.cos(a) * r, z: iv.model.arrival.z + Math.sin(a) * r };
    return iv.model.grid.nearestOpen(p.x, p.z, 0.3) ?? iv.model.arrival;
  }

  private gridOf(wv: WalkerView): WalkGrid | null {
    if (wv.scope === "island") return this.islands.get(wv.placeId)?.model.grid ?? null;
    return this.ships.get(wv.placeId)?.model.deck.grid ?? null;
  }

  /** Walk a figure somewhere; a pirate with nowhere to path to (or with motion reduced) just stands there. */
  private walkOn(wv: WalkerView, to: WalkSpot, face?: number, arrive?: () => void): WalkSpot {
    const grid = this.gridOf(wv);
    if (this.reducedMotion || !grid || !wv.walker.walkTo(grid, to, { ...(face === undefined ? {} : { face }), ...(arrive ? { arrive } : {}) })) {
      wv.walker.place(to, face);
      this.placeWalker(wv);
      arrive?.();
      return to;
    }
    return wv.walker.goal ?? to;
  }

  private me(scope: "island" | "ship"): WalkerView | null {
    for (const wv of this.walkers.values()) if (wv.kind === "me" && wv.scope === scope) return wv;
    return null;
  }

  /** The place the camera walks with the player in, if any: their island ashore, or their deck. */
  private walkFocus(): WalkerView | null {
    const input = this.input;
    if (!input) return null;
    if (input.focus.kind === "island" && input.walk?.islandId === input.focus.id) return this.me("island");
    if (input.focus.kind === "ship" && input.deck?.shipId === input.focus.id) return this.me("ship");
    return null;
  }

  /** Walk the player to a spot in their place and tell the room; `then` runs once they are there. */
  private walkMe(wv: WalkerView, to: WalkSpot, face: number | undefined, then: (() => void) | null, ring: boolean): void {
    const goal = this.walkOn(wv, to, face, then ?? undefined);
    this.events.onWalk(goal.x, goal.z);
    if (ring) this.showGoal(wv, goal);
  }

  private goBuilding(islandId: string, building: Building): void {
    const me = this.walkFocus();
    const iv = this.islands.get(islandId);
    // Already in a building, the room just changes; the player walks out and over as it does.
    if (!me || me.scope !== "island" || me.placeId !== islandId || !iv || this.inOrEntering(me)) {
      this.events.onBuilding(islandId, building);
      return;
    }
    this.enter(me, iv, building, () => this.events.onBuilding(islandId, building), true);
  }

  // ---- in and out of buildings

  /** The building a spot is just inside the door of, if any: a walk there is a walk into it. */
  private insideOf(iv: IslandView, at: WalkSpot): Building | null {
    for (const [b, door] of Object.entries(iv.model.doors) as [Building, Door][]) if (door.inside && Math.hypot(door.inside.x - at.x, door.inside.z - at.z) < 0.02) return b;
    return null;
  }

  /** The building a walker is in or stepping into. */
  private inOrEntering(wv: WalkerView): Building | null {
    return wv.inside ?? (wv.doorway && !wv.doorway.out ? wv.doorway.building : null);
  }

  /**
   * Walk to a building's door and, if it is one people go into, through it and out of sight. `atDoor`
   * runs on reaching the door. `announce` tells the place each leg, for the player's own pirate.
   */
  private enter(wv: WalkerView, iv: IslandView, b: Building, atDoor?: () => void, announce = false): void {
    const now = this.inOrEntering(wv);
    if (now === b) {
      atDoor?.();
      return;
    }
    if (now) {
      this.leave(wv, iv, () => this.enter(wv, iv, b, atDoor, announce), announce);
      return;
    }
    const door = iv.model.doors[b];
    const stepIn = (): void => {
      const inside = door.inside;
      if (inside) {
        if (announce) this.events.onWalk(inside.x, inside.z);
        wv.doorway = { building: b, out: false };
        const done = (): void => {
          wv.doorway = null;
          wv.inside = b;
          wv.figure.group.visible = false;
        };
        if (this.reducedMotion) {
          wv.walker.place(inside, door.face);
          this.placeWalker(wv);
          done();
        } else wv.walker.stepThrough([inside], { arrive: done });
      }
      atDoor?.();
    };
    const goal = this.walkOn(wv, door.at, door.face, stepIn);
    if (announce && wv.walker.moving) this.events.onWalk(goal.x, goal.z);
  }

  /** Out through the door of the building a walker is in, to stand just outside it; then `then`. */
  private leave(wv: WalkerView, iv: IslandView, then?: () => void, announce = false): void {
    const b = this.inOrEntering(wv);
    const door = b ? iv.model.doors[b] : null;
    if (!b || !door?.inside) {
      then?.();
      return;
    }
    // From out of sight inside, or wherever they had got to on the way in.
    if (wv.inside) wv.walker.place(door.inside, door.face + Math.PI);
    wv.inside = null;
    wv.figure.group.visible = true;
    wv.doorway = { building: b, out: true };
    if (announce) this.events.onWalk(door.at.x, door.at.z);
    const done = (): void => {
      wv.doorway = null;
      then?.();
    };
    if (this.reducedMotion) {
      wv.walker.place(door.at, door.face + Math.PI);
      this.placeWalker(wv);
      done();
    } else wv.walker.stepThrough([door.at], { face: door.face + Math.PI, arrive: done });
  }

  /** The player's open room changed: walk them into its building, or out of the one they are in. */
  private reconcileInside(wv: WalkerView, iv: IslandView, want: Building | null): void {
    if (this.lastInside === want) return;
    this.lastInside = want;
    if (want) {
      this.afterLeave = null;
      this.enter(wv, iv, want, undefined, true);
      return;
    }
    const after = this.afterLeave;
    this.afterLeave = null;
    if (this.inOrEntering(wv)) this.leave(wv, iv, after ?? undefined, true);
    else after?.();
  }

  /** Someone else walked: into a building if the spot is inside one, out of the one they are in first if not. */
  private walkThere(wv: WalkerView, iv: IslandView, at: WalkSpot): void {
    const into = this.insideOf(iv, at);
    if (into) this.enter(wv, iv, into);
    else if (this.inOrEntering(wv)) this.leave(wv, iv, () => void this.walkOn(wv, at));
    else this.walkOn(wv, at);
  }

  /** Ease each door toward open while someone passes through it or stands on its step. */
  private swingDoors(dt: number): void {
    for (const [islandId, iv] of this.islands) {
      for (const [b, way] of Object.entries(iv.model.doorways) as [Building, NonNullable<IslandModel["doorways"][Building]>][]) {
        const door = iv.model.doors[b];
        let want = 0;
        for (const wv of this.walkers.values()) {
          if (wv.scope !== "island" || wv.placeId !== islandId) continue;
          // Open for someone stepping through, and just ahead of someone walking up to it; shut behind them.
          const goal = wv.walker.goal;
          const approaching = wv.walker.moving && goal !== null && Math.hypot(goal.x - door.at.x, goal.z - door.at.z) < 0.02 && Math.hypot(wv.walker.x - door.at.x, wv.walker.z - door.at.z) < 0.14;
          if (wv.doorway?.building === b || approaching) want = 1;
        }
        way.open += (want - way.open) * Math.min(1, dt * (want ? 9 : 4));
        way.pivot.rotation.y = way.yaw + way.open * 1.45;
      }
    }
  }

  private goShip(shipId: string): void {
    const me = this.walkFocus();
    if (me?.scope === "island" && this.inOrEntering(me)) {
      // Out of the building first; the room closes, and the walk to her goes on from the door.
      this.afterLeave = () => this.goShip(shipId);
      this.events.onOutside();
      return;
    }
    const sv = this.ships.get(shipId);
    const iv = sv?.berth ? this.islands.get(sv.berth.islandId) : undefined;
    if (!me || me.scope !== "island" || !sv?.berth || !iv || me.placeId !== sv.berth.islandId) {
      this.events.onShip(shipId);
      return;
    }
    const berth = iv.model.berth(sv.berth.n);
    // A ship rafted further out is boarded from the dock's edge nearest her.
    const foot = berth.foot ?? { x: berth.u, z: Math.sign(berth.w) * (DOCK.half - 0.035) };
    this.walkMe(me, foot, Math.sign(berth.w) * (Math.PI / 2), () => this.events.onShip(shipId), false);
  }

  private goStation(st: Station): void {
    const me = this.walkFocus();
    const deck = this.input?.deck;
    const ds = deck?.stations.find((s) => s.station === st);
    const sv = deck ? this.ships.get(deck.shipId) : undefined;
    // Someone else's station: say so at once rather than walk over to be told.
    if (!me || me.scope !== "ship" || !sv || !ds || (ds.holder !== null && !ds.mine && !ds.mate)) {
      this.events.onStation(st);
      return;
    }
    const post = sv.model.deck.stations[st];
    this.walkMe(me, post.at, post.face, () => this.events.onStation(st), false);
  }

  private goWheel(): void {
    const me = this.walkFocus();
    const deck = this.input?.deck;
    const sv = deck ? this.ships.get(deck.shipId) : undefined;
    const captain = deck?.crew.find((c) => c.mine)?.captain ?? false;
    if (!me || me.scope !== "ship" || !sv || !captain) {
      this.events.onWheel();
      return;
    }
    this.walkMe(me, sv.model.deck.helm.at, sv.model.deck.helm.face, () => this.events.onWheel(), false);
  }

  private goGangway(): void {
    const me = this.walkFocus();
    const deck = this.input?.deck;
    const sv = deck ? this.ships.get(deck.shipId) : undefined;
    const side = sv ? this.gangwaySide(sv) : null;
    if (!me || me.scope !== "ship" || !sv || side === null) {
      this.events.onGangway();
      return;
    }
    this.walkMe(me, sv.model.deck.gangway(side), (side * Math.PI) / 2, () => this.events.onGangway(), false);
  }

  /** Which rail of a docked ship (in its own frame: +1 starboard, -1 port) the gangplank comes aboard at, if it lies against the dock. */
  private gangwaySide(sv: ShipView): number | null {
    if (!sv.berth || sv.ship.location.kind !== "docked") return null;
    const iv = this.islands.get(sv.berth.islandId);
    if (!iv || !iv.model.berth(sv.berth.n).foot) return null;
    return iv.model.berth(sv.berth.n).dockSide;
  }

  private showGoal(wv: WalkerView, at: WalkSpot): void {
    const parent = wv.figure.group.parent;
    if (!parent) return;
    parent.add(this.goalRing);
    const y = this.heightOf(wv, at.x, at.z);
    this.goalRing.position.set(at.x, y + 0.006, at.z);
    this.goalRing.scale.setScalar(wv.scope === "ship" ? 1 / SHIP_SCALE : 1);
    this.goalRing.visible = true;
    this.goalAge = 0;
  }

  private heightOf(wv: WalkerView, x: number, z: number): number {
    if (wv.scope === "island") return this.islands.get(wv.placeId)?.model.heightAt(x, z) ?? 0;
    return this.ships.get(wv.placeId)?.model.deck.heightAt(x, z) ?? 0;
  }

  private placeWalker(wv: WalkerView): void {
    const { walker, figure } = wv;
    figure.group.position.set(walker.x, this.heightOf(wv, walker.x, walker.z), walker.z);
    figure.group.rotation.y = -walker.heading;
  }

  private updateWalkers(dt: number, t: number): void {
    for (const wv of this.walkers.values()) {
      const speed = wv.walker.update(dt);
      this.placeWalker(wv);
      let work = null;
      if (speed === 0 && wv.post && (wv.station || wv.captain) && Math.hypot(wv.walker.x - wv.post.at.x, wv.walker.z - wv.post.at.z) < 0.02) work = workFor(wv.station, wv.captain);
      wv.figure.animate(t, dt, wv.scope === "ship" ? speed * SHIP_SCALE : speed, work);
    }
    if (this.goalRing.visible) {
      this.goalAge += dt;
      const k = Math.min(1, this.goalAge / 0.9);
      (this.goalRing.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      this.goalRing.scale.setScalar((this.goalRing.parent && this.goalRing.parent !== this.scene && this.input?.focus.kind === "ship" ? 1 / SHIP_SCALE : 1) * (0.7 + k * 0.6));
      if (k >= 1) this.goalRing.visible = false;
    }
  }

  private removeShip(sv: ShipView): void {
    for (const wv of [...this.walkers.values()]) if (wv.scope === "ship" && wv.placeId === sv.ship.id) this.removeWalker(wv);
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

  private makeSpot(className: string, text: string, onTap: () => void): Spot {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    const name = document.createElement("span");
    name.className = "ow-spot-name";
    name.textContent = text;
    const who = document.createElement("small");
    who.className = "ow-spot-who";
    el.append(name, who);
    el.addEventListener("click", (e) => {
      e.preventDefault();
      onTap();
    });
    const pin = document.createElement("i");
    pin.className = `ow-pin ${className.replace(/\bow-spot\b/g, "").trim().replace(/ow-spot-/g, "ow-pin-")}`;
    pin.addEventListener("click", onTap);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "ow-leader");
    this.leaders.appendChild(line);
    this.labels.append(pin, el);
    return { el, pin, line };
  }

  /** Project spots to the screen, keep their labels apart, and draw a leader from each pin to its label. */
  private placeSpots(spots: { spot: Spot; world: THREE.Vector3 }[]): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const cam = this.rig.camera;
    const placed: { spot: Spot; x: number; y: number; lx: number; ly: number; flip: boolean }[] = [];
    for (const { spot, world } of spots) {
      this.tmp.copy(world).project(cam);
      const x = (this.tmp.x * 0.5 + 0.5) * w;
      const y = (-this.tmp.y * 0.5 + 0.5) * h;
      const flip = x + SPOT_DX + spot.el.offsetWidth > w - 8;
      placed.push({ spot, x, y, lx: flip ? x - SPOT_DX : x + SPOT_DX, ly: y + SPOT_DY, flip });
    }
    placed.sort((a, b) => a.ly - b.ly);
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]!;
      for (let j = 0; j < i; j++) {
        const q = placed[j]!;
        if (Math.abs(q.lx - p.lx) < SPOT_W && p.ly - q.ly < SPOT_H) p.ly = q.ly + SPOT_H;
      }
      p.spot.pin.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      p.spot.el.style.transform = `translate(${p.lx.toFixed(1)}px, ${p.ly.toFixed(1)}px)${p.flip ? " translate(-100%, 0)" : ""}`;
      p.spot.el.classList.toggle("is-flipped", p.flip);
      p.spot.line.setAttribute("x1", p.x.toFixed(1));
      p.spot.line.setAttribute("y1", p.y.toFixed(1));
      p.spot.line.setAttribute("x2", p.lx.toFixed(1));
      p.spot.line.setAttribute("y2", p.ly.toFixed(1));
    }
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
    float lap = 0.1 * sin(uTime * 1.6 - d * 3.5);
    foam = max(foam, smoothstep(0.13, 0.0, abs(d - 0.24 + lap)) * 0.75);
    foam = max(foam, smoothstep(0.12, 0.0, d) * 0.55);
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
    const walking = this.walkFocus();
    if (walking?.scope === "island") {
      // Ashore the camera walks with the pirate, a little ahead of their feet.
      const center = walking.figure.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0));
      const h = this.host.clientHeight || 1;
      const halfH = (WALK_HALF_H * Math.max(1, h / 900) * this.zoom) / Math.max(0.6, vh);
      return { center, halfH, anchorY, anchorX };
    }
    if (input.focus.kind === "island") {
      const iv = this.islands.get(input.focus.id);
      const center = iv ? new THREE.Vector3(iv.island.x, 0.35, iv.island.y) : this.center.clone();
      // On a tall phone the island's width is the limit; on a wide screen its height.
      const halfH = Math.max((ISLAND_R * 1.15) / vh, ISLAND_R / (aspect * vw));
      return { center, halfH, anchorY, anchorX };
    }
    if (input.focus.kind === "ship") {
      const sv = this.ships.get(input.focus.id);
      if (!sv) return { center: this.center.clone(), halfH: DECK_MIN_HALF_H, anchorY, anchorX };
      // The deck is looked at broadside from its open side, so neither the dock nor a neighbour stands in the way.
      // A little above the deck, so the rig and the deck share the frame.
      const center = sv.model.group.position.clone().setY(0.42);
      const az = this.deckAzimuth(sv);
      this.rig.setAzimuth(az);
      const probe = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
      probe.position.copy(center).add(isoDirection(az).multiplyScalar(60));
      probe.lookAt(center);
      probe.updateMatrixWorld();
      const inv = probe.matrixWorldInverse;
      let spanX = 0;
      let spanY = 0;
      const hx = 0.78;
      const hz = 0.38;
      for (const [dx, dz] of [
        [-hx, -hz],
        [hx, -hz],
        [-hx, hz],
        [hx, hz],
      ]) {
        for (const y of [0.1, 0.5]) {
          this.tmp.set(dx!, y, dz!).applyMatrix4(sv.model.group.matrixWorld).sub(center).add(center).applyMatrix4(inv);
          spanX = Math.max(spanX, Math.abs(this.tmp.x));
          spanY = Math.max(spanY, Math.abs(this.tmp.y));
        }
      }
      const zoom = Math.min(DECK_ZOOM_MAX, Math.max(DECK_ZOOM_MIN, this.zoom));
      const halfH = Math.max(DECK_MIN_HALF_H, (spanY * 1.12) / vh, (spanX * 1.08) / (aspect * vw)) * zoom;
      // Zoomed in, the view walks with the pirate across the deck rather than staring at its middle.
      const me = this.me("ship");
      if (me && zoom < 1) {
        const at = me.figure.group.getWorldPosition(new THREE.Vector3()).setY(center.y - 0.06);
        center.lerp(at, Math.min(1, (1 - zoom) / 0.35));
      }
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
      if (this.input?.focus.kind !== "ship") this.rig.setAzimuth(best, true);
      this.sunOffset.copy(isoDirection(best + Math.PI * 0.6).multiplyScalar(14).setY(14));
    }
  }

  private updateView(immediate: boolean): void {
    if (!this.input) return;
    if (this.input.focus.kind !== "ship") this.rig.setAzimuth(this.azimuth, immediate || this.reducedMotion);
    this.rig.setView(this.viewFor(this.input), immediate || this.reducedMotion);
  }

  /** The azimuth that looks at a ship's side from the water: away from the island it is docked at, else its starboard side. */
  private deckAzimuth(sv: ShipView): number {
    const g = sv.model.group;
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    const docked = sv.ship.location.kind === "docked" ? this.islands.get(sv.ship.location.islandId) : undefined;
    if (docked) {
      const away = g.position.clone().sub(docked.model.group.position);
      if (away.dot(side) < 0) side.negate();
    }
    return Math.atan2(side.z, side.x);
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
    const raw = (now - this.lastFrameAt) / 1000;
    this.lastFrameAt = now;
    // Walks keep to the clock even when frames come slowly, so a walk always ends on time.
    this.render(this.reducedMotion ? 0 : Math.min(0.1, raw), Math.min(0.35, raw));
    this.frame = requestAnimationFrame(this.loop);
  };

  private render(dt: number, walkDt = dt): void {
    const input = this.input;
    if (!input) return;
    this.time += dt;
    const t = this.time;
    this.seaUniforms.uTime.value = t;
    this.placeDashes(t);
    this.placeShips(dt);
    this.keyWalk();
    this.updateWalkers(walkDt, t);
    this.swingDoors(walkDt);
    // A followed ship moves between snapshots, a walking pirate between taps; keep the target on them.
    if (input.focus.kind === "ship" || this.walkFocus()) this.rig.setView(this.viewFor(input));
    this.aimSun(input);
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
    this.renderer.render(this.scene, this.rig.camera);
    this.placeLabels();
    this.markHost();
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
    /** Which berths with a gangplank are taken, by island. */
    const planks = new Map<string, string>();
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
        // Tied up alongside the dock: the first ship on its near side, the next on the far side, and so on out.
        const n = docked.get(iv.island.id) ?? 0;
        docked.set(iv.island.id, n + 1);
        const berth = iv.model.berth(n);
        const a = iv.model.dockAngle;
        g.position.set(iv.island.x + berth.u * Math.cos(a) - berth.w * Math.sin(a), 0, iv.island.y + berth.u * Math.sin(a) + berth.w * Math.cos(a));
        g.rotation.y = -(a + berth.heading);
        sv.berth = { islandId: iv.island.id, n };
        if (berth.foot) planks.set(iv.island.id, `${planks.get(iv.island.id) ?? ""}${n},`);
      } else {
        sv.berth = null;
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
      // The bob lives on the body so the group, which labels hang off, holds still. Made fast to a dock she barely stirs.
      const body = sv.model.body;
      const calm = sv.berth ? 0.3 : 1;
      body.position.y = -SHIP_SINK + Math.sin(t * 1.7 + sv.phase) * 0.03 * calm;
      body.rotation.z = Math.sin(t * 1.1 + sv.phase) * 0.05 * calm;
      body.rotation.x = Math.sin(t * 0.8 + sv.phase * 1.3) * 0.025 * calm;
      sv.model.flag.rotation.y = Math.sin(t * 5 + sv.phase) * 0.3;
      sv.model.marker.position.y = 1.33 + Math.sin(t * 3 + sv.phase) * 0.07;
      sv.model.marker.rotation.y = t * 1.5;
      // The "your ship" marker is for finding her on the chart; up close it would only hang in the air.
      sv.model.marker.visible = sv.ship.kind !== "other" && this.input.focus.kind === "all";
    }
    this.layGangplanks(planks);
    // On deck, a neighbour tied up alongside would stand between the camera and the deck; it steps out of the view.
    if (this.input.focus.kind === "ship") {
      const mine = this.ships.get(this.input.focus.id);
      if (mine) {
        for (const sv of this.ships.values()) {
          if (sv === mine || !sv.model.group.visible) continue;
          if (sv.model.group.position.distanceTo(mine.model.group.position) < 2.2) sv.model.group.visible = false;
        }
      }
    }
  }

  /** A gangplank from the dock up to each ship lying against it; rebuilt only when that changes. */
  private layGangplanks(planks: Map<string, string>): void {
    for (const [islandId, iv] of this.islands) {
      const key = planks.get(islandId) ?? "";
      const have = this.gangplanks.get(islandId);
      if (have?.key === key) continue;
      have?.group.removeFromParent();
      const group = new THREE.Group();
      for (const n of key.split(",").filter(Boolean).map(Number)) {
        const berth = iv.model.berth(n);
        if (!berth.foot) continue;
        const side = Math.sign(berth.w);
        const deckY = 0.3 * SHIP_SCALE - SHIP_SINK;
        const from = new THREE.Vector3(berth.foot.x, DOCK.top + 0.006, side * (DOCK.half - 0.01));
        const to = new THREE.Vector3(berth.foot.x, deckY + 0.008, side * (Math.abs(berth.w) - 0.2 * SHIP_SCALE));
        group.add(buildGangplank(from, to));
      }
      iv.model.frame.add(group);
      this.gangplanks.set(islandId, { key, group });
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
    const spots: { spot: Spot; world: THREE.Vector3 }[] = [];
    for (const iv of this.islands.values()) {
      place(iv.label, this.tmp2.set(iv.island.x, 2.4, iv.island.y));
      for (const [b, spot] of iv.spots) {
        if (spot.el.classList.contains("ow-hidden")) continue;
        spots.push({ spot, world: iv.model.group.localToWorld(iv.model.anchors[b].clone()) });
      }
    }
    const shipLabels: { el: HTMLDivElement; x: number; y: number }[] = [];
    for (const sv of this.ships.values()) {
      sv.label.style.display = sv.model.group.visible ? "" : "none";
      if (!sv.model.group.visible || sv.label.classList.contains("ow-hidden") || sv.label.classList.contains("ow-label-quiet")) continue;
      // Named at her stern, the end nearest the shore when she lies at a dock bow out.
      sv.model.group.localToWorld(this.tmp.set(-0.32, 0.25, 0)).project(cam);
      shipLabels.push({ el: sv.label, x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h });
    }
    shipLabels.sort((a, b) => a.y - b.y);
    for (let i = 0; i < shipLabels.length; i++) {
      const p = shipLabels[i]!;
      for (let j = 0; j < i; j++) {
        const q = shipLabels[j]!;
        if (Math.abs(q.x - p.x) < (q.el.offsetWidth + p.el.offsetWidth) / 2 + 6 && p.y - q.y < 26) p.y = q.y + 26;
      }
      p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
    const focus = this.input?.focus;
    const aboard = focus?.kind === "ship" ? this.ships.get(focus.id) : undefined;
    this.placeSpots(spots);
    this.placeTags();
    if (aboard) {
      const deckSpots: { spot: Spot; world: THREE.Vector3; still: THREE.Vector3 }[] = [];
      // Pins ride the hull itself, bob and all, so each sits on its thing; the labels stand on the
      // ship's steady frame so the column holds still.
      const body = aboard.model.body;
      const steady = aboard.model.group;
      const still = (local: THREE.Vector3): THREE.Vector3 => steady.localToWorld(local.clone().multiplyScalar(SHIP_SCALE).add(new THREE.Vector3(0, -SHIP_SINK, 0)));
      const callout = (spot: Spot | null, local: THREE.Vector3): void => {
        if (spot && !spot.el.classList.contains("ow-hidden")) deckSpots.push({ spot, world: body.localToWorld(local.clone()), still: still(local) });
      };
      for (const [st, spot] of this.stationSpots) callout(spot, aboard.model.anchors[st]);
      callout(this.wheelSpot, aboard.model.wheel.clone().add(new THREE.Vector3(0, 0.07, 0)));
      const side = this.gangwaySide(aboard);
      if (side !== null) {
        const g = aboard.model.deck.gangway(side);
        callout(this.gangwaySpot, new THREE.Vector3(g.x, 0.34, side * 0.19));
      }
      // Zoomed in, the hull runs off the screen and a column of labels would string leaders across
      // the deck: each label stands beside its own pin instead.
      if (this.walkFocus()?.scope === "ship" && this.zoom < 0.85) this.placeSpots(deckSpots);
      else this.placeCallouts(deckSpots);
    }
  }

  /** Name tags over the other pirates where the player is: everyone ashore, the idle hands aboard. */
  private placeTags(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const focus = this.input?.focus;
    const shown: { el: HTMLElement; x: number; y: number }[] = [];
    for (const wv of this.walkers.values()) {
      if (!wv.tag) continue;
      const here = focus && ((focus.kind === "island" && wv.scope === "island" && focus.id === wv.placeId) || (focus.kind === "ship" && wv.scope === "ship" && focus.id === wv.placeId));
      const busy = wv.scope === "ship" && wv.station !== null;
      const show = Boolean(here) && !busy && wv.figure.group.visible;
      wv.tag.classList.toggle("ow-hidden", !show);
      if (!show) continue;
      wv.figure.group.getWorldPosition(this.tmp);
      this.tmp.y += PIRATE_HEIGHT * 1.35;
      this.tmp.project(this.rig.camera);
      shown.push({ el: wv.tag, x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h });
    }
    shown.sort((a, b) => a.y - b.y);
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i]!;
      for (let j = 0; j < i; j++) {
        const q = shown[j]!;
        if (Math.abs(q.x - p.x) < (q.el.offsetWidth + p.el.offsetWidth) / 2 + 4 && p.y - q.y < 20) p.y = q.y + 20;
      }
      p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  }

  /** What the world says about walking on its host, for the shell and its smoke test. */
  private markHost(): void {
    const me = this.walkFocus();
    let screen = "";
    if (me) {
      me.figure.group.getWorldPosition(this.tmp).project(this.rig.camera);
      screen = `${Math.round((this.tmp.x * 0.5 + 0.5) * this.host.clientWidth)},${Math.round((-this.tmp.y * 0.5 + 0.5) * this.host.clientHeight)}`;
    }
    const key = me ? `${me.scope}:${me.placeId}|${me.walker.x.toFixed(2)},${me.walker.z.toFixed(2)}|${me.walker.moving ? 1 : 0}|${screen}|${me.inside ?? ""}` : "";
    if (key === this.dataKey) return;
    this.dataKey = key;
    const d = this.host.dataset;
    d.walk = me ? `${me.scope}:${me.placeId}` : "";
    d.me = me ? `${me.walker.x.toFixed(2)},${me.walker.z.toFixed(2)}` : "";
    // Where the pirate's feet are on screen, in the world's own pixels.
    d.meScreen = screen;
    d.walking = me?.walker.moving ? "1" : "0";
    d.inside = me?.inside ?? "";
  }

  /** Keep the sun's shadows sharp where the eye is: tight on a pirate or a deck, wide over the chart. */
  private aimSun(input: WorldInput): void {
    const me = this.walkFocus();
    let reach: number;
    const at = this.tmp2;
    if (me) {
      me.figure.group.getWorldPosition(at);
      reach = me.scope === "ship" ? 1.4 : 2.6;
    } else if (input.focus.kind === "island") {
      const iv = this.islands.get(input.focus.id);
      at.set(iv?.island.x ?? this.center.x, 0, iv?.island.y ?? this.center.z);
      reach = 2.8;
    } else if (input.focus.kind === "ship") {
      this.ships.get(input.focus.id)?.model.group.getWorldPosition(at);
      reach = 1.4;
    } else {
      at.copy(this.center);
      reach = this.spread;
    }
    at.y = 0;
    this.sun.position.copy(at).add(this.sunOffset);
    this.sun.target.position.copy(at);
    const cam = this.sun.shadow.camera;
    if (cam.right !== reach) {
      cam.left = -reach;
      cam.right = reach;
      cam.top = reach;
      cam.bottom = -reach;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * The deck's spots are a hand's width apart, so their labels stand in two columns, one each side
   * of the hull: a pin on the port half of the deck gets its label on the left, a pin on the
   * starboard half on the right, each column in deck order from bow to stern. Leaders never cross
   * and stay short: a callout diagram rather than a pile of pills. When one side has no room
   * (the card unfolded beside the ship) every label stands on the other.
   */
  private placeCallouts(spots: { spot: Spot; world: THREE.Vector3; still: THREE.Vector3 }[]): void {
    if (spots.length === 0) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const cam = this.rig.camera;
    const insets = this.input?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const pins: { spot: Spot; x: number; y: number; sx: number; sy: number }[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let maxWidth = 0;
    let maxHeight = 0;
    for (const { spot, world, still } of spots) {
      this.tmp.copy(world).project(cam);
      const x = (this.tmp.x * 0.5 + 0.5) * w;
      const y = (-this.tmp.y * 0.5 + 0.5) * h;
      this.tmp.copy(still).project(cam);
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      pins.push({ spot, x, y, sx, sy });
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      maxWidth = Math.max(maxWidth, spot.el.offsetWidth);
      maxHeight = Math.max(maxHeight, spot.el.offsetHeight);
    }
    const leftEdge = w * insets.left + 8;
    const rightEdge = w * (1 - insets.right) - 8;
    const roomRight = rightEdge - (maxX + 40);
    const roomLeft = minX - 40 - leftEdge;
    // Two columns of equal weight, the portmost half of the pins on the left, unless one side has
    // no room at all (the card unfolded beside the ship) or there are too few spots to split;
    // otherwise everything on the roomier side.
    const both = roomRight > 0 && roomLeft > 0 && pins.length > 2;
    const byX = [...pins].sort((a, b) => a.sx - b.sx);
    const half = Math.ceil(byX.length / 2);
    const sides: { right: boolean; pins: typeof pins }[] = both
      ? [
          { right: false, pins: byX.slice(0, half) },
          { right: true, pins: byX.slice(half) },
        ]
      : [{ right: roomRight >= roomLeft, pins }];
    // Labels stack a little apart, however tall a phone draws them.
    const gap = Math.max(30, maxHeight + 6);
    const top = h * insets.top + 24;
    const bottom = h * (1 - insets.bottom) - 24;
    for (const side of sides) {
      if (side.pins.length === 0) continue;
      const colPins = side.pins.sort((a, b) => a.sy - b.sy);
      const nearest = side.right ? Math.max(...colPins.map((p) => p.sx)) : Math.min(...colPins.map((p) => p.sx));
      // The column stands a hand's width off the pins it serves, and never past the screen's edge.
      const col = side.right ? Math.min(nearest + 40, rightEdge - maxWidth) : Math.max(nearest - 40, leftEdge + maxWidth);
      const meanY = colPins.reduce((n, p) => n + p.sy, 0) / colPins.length;
      let y0 = meanY - ((colPins.length - 1) * gap) / 2;
      y0 = Math.max(top, Math.min(bottom - (colPins.length - 1) * gap, y0));
      colPins.forEach((p, i) => {
        const ly = y0 + i * gap;
        p.spot.pin.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        p.spot.el.style.transform = `translate(${col.toFixed(1)}px, ${ly.toFixed(1)}px)${side.right ? "" : " translate(-100%, 0)"}`;
        p.spot.el.classList.toggle("is-flipped", !side.right);
        p.spot.line.setAttribute("x1", p.x.toFixed(1));
        p.spot.line.setAttribute("y1", p.y.toFixed(1));
        p.spot.line.setAttribute("x2", col.toFixed(1));
        p.spot.line.setAttribute("y2", (ly + 14).toFixed(1));
      });
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

  /** What a tap lands on where the player walks: a pirate, a building, a ship, a station, or the ground to walk to. */
  private pickWalk(clientX: number, clientY: number, me: WalkerView): WalkPick | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const targets: THREE.Object3D[] = [];
    for (const wv of this.walkers.values()) if (wv !== me && wv.real && wv.scope === me.scope && wv.placeId === me.placeId) targets.push(wv.hit);
    let ground: THREE.Object3D[] = [];
    let frame: THREE.Object3D | null = null;
    if (me.scope === "island") {
      const iv = this.islands.get(me.placeId);
      if (!iv) return null;
      targets.push(...iv.model.buildingHits);
      // Up close a ship is only her hull: the tall chart box would swallow taps on the dock and the shore behind her.
      for (const sv of this.ships.values()) if (sv.model.group.visible && sv.berth?.islandId === me.placeId) targets.push(sv.model.hullHit);
      ground = iv.model.walkable;
      frame = iv.model.frame;
    } else {
      const sv = this.ships.get(me.placeId);
      if (!sv) return null;
      targets.push(...sv.model.stationHits);
      ground = [sv.model.deckHit];
      frame = sv.model.body;
    }
    const hits = this.raycaster.intersectObjects([...targets, ...ground], false);
    const hit = hits[0];
    if (!hit) return null;
    const o = hit.object;
    if (typeof o.userData.walker === "string") {
      const wv = this.walkers.get(o.userData.walker);
      return wv ? { kind: "pirate", id: wv.id } : null;
    }
    if (typeof o.userData.building === "string") return { kind: "building", building: o.userData.building as Building };
    if (typeof o.userData.station === "string") return o.userData.station === "wheel" ? { kind: "wheel" } : { kind: "station", station: o.userData.station as Station };
    for (const sv of this.ships.values()) if (o === sv.model.hullHit || o === sv.model.hit) return { kind: "ship", id: sv.ship.id };
    const local = frame.worldToLocal(hit.point.clone());
    return { kind: "ground", x: local.x, z: local.z };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), zoom: this.zoom };
      this.pointerDown = null;
      return;
    }
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size === 0) this.pinch = null;
      return;
    }
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 600) return;
    const me = this.walkFocus();
    if (me) {
      const p = this.pickWalk(e.clientX, e.clientY, me);
      if (p) {
        this.tapWalk(me, p);
        return;
      }
    }
    const p = this.pick(e.clientX, e.clientY);
    if (!p) return;
    if (p.kind === "island") this.events.onIsland(p.id);
    // Walking, a ship is boarded only by a tap on her hull (pickWalk); a tap on the water near her is nothing.
    else if (!me) this.goShip(p.id);
  };

  private tapWalk(me: WalkerView, p: WalkPick): void {
    switch (p.kind) {
      case "pirate":
        this.events.onPirate(p.id);
        return;
      case "building":
        this.goBuilding(me.placeId, p.building);
        return;
      case "ship":
        this.goShip(p.id);
        return;
      case "station":
        this.goStation(p.station);
        return;
      case "wheel":
        this.goWheel();
        return;
      case "ground": {
        const grid = this.gridOf(me);
        const to = grid?.nearestOpen(p.x, p.z, me.scope === "ship" ? 0.08 : 0.3);
        if (!to) return;
        if (me.scope === "island" && this.inOrEntering(me)) {
          this.afterLeave = () => this.walkMe(me, to, undefined, null, true);
          this.events.onOutside();
          return;
        }
        this.walkMe(me, to, undefined, null, true);
        return;
      }
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d > 1) this.setZoom((this.pinch.zoom * this.pinch.d) / d);
      return;
    }
    if (e.pointerType !== "mouse") return;
    const me = this.walkFocus();
    let key: string | null;
    if (me) {
      const p = this.pickWalk(e.clientX, e.clientY, me);
      key = p && p.kind !== "ground" ? `walk:${p.kind}` : null;
    } else {
      const p = this.pick(e.clientX, e.clientY);
      key = p ? `${p.kind}:${p.id}` : null;
    }
    if (key === this.hovered) return;
    this.hovered = key;
    this.renderer.domElement.style.cursor = key ? "pointer" : "";
  };

  private readonly onPointerLeave = (): void => {
    this.hovered = null;
    this.renderer.domElement.style.cursor = "";
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.pointerDown = null;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.walkFocus()) return;
    e.preventDefault();
    this.setZoom(this.zoom * Math.exp(e.deltaY * 0.0015));
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const dir = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!dir || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || this.input?.dimmed || !this.walkFocus()) return;
    e.preventDefault();
    this.keys.add(dir);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const dir = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (dir) this.keys.delete(dir);
  };

  private readonly onBlur = (): void => this.keys.clear();

  /** Keys held: keep the pirate walking a short step ahead in the direction they point on screen. */
  private keyWalk(): void {
    if (this.keys.size === 0) return;
    const me = this.walkFocus();
    const grid = me ? this.gridOf(me) : null;
    const parent = me?.figure.group.parent;
    if (!me || !grid || !parent || this.input?.dimmed) {
      this.keys.clear();
      return;
    }
    // Inside a building a key means "out": the room closes and the pirate steps outside, then walks on.
    if (me.scope === "island" && (me.inside || me.doorway)) {
      if (me.inside && !me.doorway) this.events.onOutside();
      return;
    }
    const sx = (this.keys.has("right") ? 1 : 0) - (this.keys.has("left") ? 1 : 0);
    const sy = (this.keys.has("up") ? 1 : 0) - (this.keys.has("down") ? 1 : 0);
    if (!sx && !sy) return;
    const cam = this.rig.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
    const away = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).setY(0).normalize();
    const dir = right.multiplyScalar(sx).add(away.multiplyScalar(sy)).normalize();
    dir.applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    const step = me.scope === "ship" ? 0.07 : 0.16;
    const base = Math.atan2(dir.z, dir.x);
    // Straight on if the way is open, else glance off whatever is in the way.
    for (const turn of [0, 0.5, -0.5, 1, -1]) {
      const a = base + turn;
      const to = { x: me.walker.x + Math.cos(a) * step, z: me.walker.z + Math.sin(a) * step };
      if (!grid.isOpen(to.x, to.z) || !grid.clear({ x: me.walker.x, z: me.walker.z }, to)) continue;
      me.walker.walkTo(grid, to);
      this.events.onWalk(to.x, to.z);
      return;
    }
  }

  private setZoom(z: number): void {
    const deck = this.walkFocus()?.scope === "ship";
    this.zoom = deck ? Math.max(DECK_ZOOM_MIN, Math.min(DECK_ZOOM_MAX, z)) : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }
}

type WalkPick =
  | { kind: "pirate"; id: string }
  | { kind: "building"; building: Building }
  | { kind: "ship"; id: string }
  | { kind: "station"; station: Station }
  | { kind: "wheel" }
  | { kind: "ground"; x: number; z: number };

const KEY_DIRS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

/** Whether a key went to something that takes typing, which walking must leave alone. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

function spotKey(at: WalkSpot | null): string {
  return at ? `${at.x.toFixed(3)},${at.z.toFixed(3)}` : "";
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

function hideSpot(spot: Spot, hidden: boolean): void {
  spot.el.classList.toggle("ow-hidden", hidden);
  spot.pin.classList.toggle("ow-hidden", hidden);
  spot.line.classList.toggle("ow-hidden", hidden);
}

function removeSpot(spot: Spot): void {
  spot.el.remove();
  spot.pin.remove();
  spot.line.remove();
}

function focusKey(f: Focus): string {
  return f.kind === "all" ? "all" : `${f.kind}:${f.id}`;
}

function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}
