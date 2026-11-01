/**
 * The chart: an isometric three.js diorama of the ocean. Islands sit on a slow sea, sea lanes
 * march between them, ships bob at the docks or sail along a lane, clouds drift and throw
 * shadows, gulls circle. Everything shown comes from content and server snapshots; nothing here
 * decides anything (ADR 0019).
 *
 * Chart units: an island's content x maps to world x, its y to world z. The camera is a true
 * isometric orthographic camera fitted to the islands.
 */
import * as THREE from "three";
import { PALETTE, buildCloud, buildGull, buildIsland, buildShip, type GullModel, type IslandModel, type ShipModel } from "./models.js";

export interface ChartIsland {
  id: string;
  name: string;
  x: number;
  y: number;
}
export interface ChartRoute {
  id: string;
  from: string;
  to: string;
}
export type ChartShipLocation = { kind: "docked"; islandId: string } | { kind: "at-sea"; from: string; to: string; progress: number };
export interface ChartShip {
  id: string;
  name: string;
  kind: "yours" | "aboard" | "other";
  location: ChartShipLocation;
}
export interface ChartInput {
  islands: ChartIsland[];
  routes: ChartRoute[];
  ships: ChartShip[];
  /** The island the player stands on, flagged. */
  here: string | null;
  /** The selected island, ringed in brass. */
  selected: string | null;
  /** Islands the player may pick, ringed faintly. */
  reachable: string[];
  /** The selected ship, if any. */
  selectedShip: string | null;
  /** How long a ship takes to ease to a new progress, so turn-by-turn snapshots read as motion. */
  smoothMs: number;
}
export interface ChartEvents {
  onIsland(id: string): void;
  onShip(id: string): void;
}

const ISO = new THREE.Vector3(1, 1, 1).normalize();
const SEA_SIZE = 90;
const LANE_BULGE = 0.16;
const DASH_STEP = 0.55;

interface Lane {
  key: string;
  a: string;
  b: string;
  curve: THREE.QuadraticBezierCurve3;
  length: number;
  dashes: THREE.Mesh[];
}
interface ShipView {
  ship: ChartShip;
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
  island: ChartIsland;
  model: IslandModel;
  label: HTMLDivElement;
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

export class OverworldScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly sun: THREE.DirectionalLight;
  private readonly sea: THREE.Mesh;
  private readonly seaUniforms = { uTime: { value: 0 }, uIslands: { value: [] as THREE.Vector3[] }, uIslandCount: { value: 0 }, uShallow: { value: new THREE.Color(PALETTE.seaShallow) }, uFoam: { value: new THREE.Color(PALETTE.foam) } };
  private readonly labels: HTMLDivElement;
  private readonly islands = new Map<string, IslandView>();
  private readonly lanes = new Map<string, Lane>();
  private readonly ships = new Map<string, ShipView>();
  private readonly clouds: Cloud[] = [];
  private readonly gulls: Gull[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly center = new THREE.Vector3();
  private input: ChartInput | null = null;
  private frame = 0;
  private running = false;
  private visible = true;
  private lastFrameAt = 0;
  private time = 0;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private hovered: string | null = null;
  private readonly reducedMotion: boolean;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver | null;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly host: HTMLElement,
    private readonly events: ChartEvents,
  ) {
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "pan-y";
    host.appendChild(this.renderer.domElement);
    this.labels = document.createElement("div");
    this.labels.className = "ow-labels";
    host.appendChild(this.labels);

    this.scene.fog = new THREE.Fog(0xa9dcea, 40, 90);
    this.scene.add(new THREE.HemisphereLight(0xcdeeff, 0x2f5a46, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff2d9, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.intensity = 0.55;
    this.scene.add(this.sun, this.sun.target);

    this.sea = this.buildSea();
    this.scene.add(this.sea);

    for (let i = 0; i < 5; i++) {
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

  setInput(input: ChartInput): void {
    const first = this.input === null;
    this.input = input;
    if (first || this.islands.size !== input.islands.length) this.layoutIslands(input);
    this.syncShips(input);
    for (const [id, iv] of this.islands) {
      iv.model.ring.visible = id === input.selected;
      iv.model.reachRing.visible = id !== input.selected && input.reachable.includes(id);
      iv.model.flag.visible = id === input.here;
      iv.label.classList.toggle("selected", id === input.selected);
      iv.label.classList.toggle("here", id === input.here);
      iv.label.classList.toggle("reachable", input.reachable.includes(id));
    }
    for (const [id, sv] of this.ships) {
      sv.label.classList.toggle("selected", id === input.selectedShip);
      // Other people's ships are named only when picked, or when their island is, so a busy dock stays legible.
      const docked = sv.ship.location.kind === "docked" ? sv.ship.location.islandId : null;
      sv.label.classList.toggle("ow-label-quiet", sv.ship.kind === "other" && id !== input.selectedShip && !(docked && docked === input.selected));
    }
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

  private layoutIslands(input: ChartInput): void {
    for (const iv of this.islands.values()) {
      this.scene.remove(iv.model.group);
      iv.label.remove();
    }
    this.islands.clear();
    for (const lane of this.lanes.values()) for (const d of lane.dashes) this.scene.remove(d);
    this.lanes.clear();
    for (const g of this.gulls) this.scene.remove(g.model.group);
    this.gulls.length = 0;

    const centroid = new THREE.Vector2();
    for (const i of input.islands) centroid.add(new THREE.Vector2(i.x, i.y));
    centroid.divideScalar(Math.max(1, input.islands.length));
    this.center.set(centroid.x, 0, centroid.y);

    // The lighthouse goes to the island farthest from the middle of the ocean.
    let farthest: string | null = null;
    let farDist = -1;
    for (const i of input.islands) {
      const d = centroid.distanceTo(new THREE.Vector2(i.x, i.y));
      if (d > farDist) {
        farDist = d;
        farthest = i.id;
      }
    }

    const seaIslands: THREE.Vector3[] = [];
    for (const island of input.islands) {
      const toward = new THREE.Vector2(centroid.x - island.x, centroid.y - island.y);
      if (toward.lengthSq() < 1e-6) toward.set(1, 0);
      const model = buildIsland(island.id, toward, island.id === farthest);
      model.group.position.set(island.x, 0, island.y);
      this.scene.add(model.group);
      const label = this.makeLabel("ow-label ow-label-island", island.name, () => this.events.onIsland(island.id));
      label.dataset.island = island.id;
      this.islands.set(island.id, { island, model, label });
      seaIslands.push(new THREE.Vector3(island.x, island.y, 1.55));
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
      this.lanes.set(key, { key, a, b, curve, length, dashes });
    }
    this.placeDashes(0);

    for (let i = 0; i < Math.min(3, input.islands.length); i++) {
      const island = input.islands[(i * 2) % input.islands.length]!;
      const model = buildGull();
      this.scene.add(model.group);
      this.gulls.push({ model, center: new THREE.Vector3(island.x, 1.7 + i * 0.3, island.y), radius: 1.6 + i * 0.5, phase: i * 2.1, speed: 0.5 + i * 0.1 });
    }

    const spread = Math.max(6, ...input.islands.map((i) => Math.hypot(i.x - centroid.x, i.y - centroid.y))) + 3;
    for (const [i, c] of this.clouds.entries()) {
      c.group.position.set(this.center.x + ((i * 7.3) % (spread * 2)) - spread, 3.6 + (i % 3) * 0.5, this.center.z + ((i * 4.1) % (spread * 1.6)) - spread * 0.8);
      c.group.userData.spread = spread;
    }

    this.sun.position.copy(this.center).add(new THREE.Vector3(-8, 14, 6));
    this.sun.target.position.copy(this.center);
    const cam = this.sun.shadow.camera;
    cam.left = -spread;
    cam.right = spread;
    cam.top = spread;
    cam.bottom = -spread;
    cam.near = 1;
    cam.far = 60;
    cam.updateProjectionMatrix();
    this.fitCamera();
  }

  private syncShips(input: ChartInput): void {
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

  // ---- the sea

  private buildSea(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 110, 110);
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
    shallow = max(shallow, 1.0 - smoothstep(0.0, 2.6, d));
    float lap = 0.18 * sin(uTime * 1.6 - d * 3.5);
    foam = max(foam, smoothstep(0.32, 0.0, abs(d - 0.3 + lap)) * 0.9);
    foam = max(foam, smoothstep(0.14, 0.0, d) * 0.5);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, shallow * 0.85);
  diffuseColor.rgb += vec3(0.10, 0.12, 0.12) * smoothstep(0.06, 0.16, vWave);
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

  private fitCamera(): void {
    if (!this.input) return;
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.position.copy(this.center).add(ISO.clone().multiplyScalar(60));
    this.camera.lookAt(this.center);
    this.camera.updateMatrixWorld();
    const inv = this.camera.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const pad = 2.3;
    for (const i of this.input.islands) {
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
    const aspect = w / h;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const halfH = Math.max((maxY - minY) / 2, (maxX - minX) / 2 / aspect);
    const halfW = halfH * aspect;
    this.camera.left = cx - halfW;
    this.camera.right = cx + halfW;
    this.camera.top = cy + halfH;
    this.camera.bottom = cy - halfH;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    this.fitCamera();
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
    if (!this.input) return;
    this.time += dt;
    const t = this.time;
    this.seaUniforms.uTime.value = t;
    this.placeDashes(t);
    this.placeShips(dt);
    for (const c of this.clouds) {
      const spread = (c.group.userData.spread as number | undefined) ?? 10;
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > this.center.x + spread) c.group.position.x = this.center.x - spread;
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
      if (iv.model.ring.visible) {
        const s = 1 + 0.03 * Math.sin(t * 3);
        iv.model.ring.scale.set(s, s, 1);
        (iv.model.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.2 * Math.sin(t * 3);
      }
      if (iv.model.flag.visible) iv.model.flag.children[1]!.rotation.y = Math.sin(t * 4) * 0.25;
      if (iv.model.lamp) (iv.model.lamp.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 2.2) > 0.3 ? PALETTE.lamp : 0x6b5a2a);
    }
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
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
        const r = 2.25;
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
    }
  }

  private placeLabels(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const place = (el: HTMLDivElement, x: number, y: number, z: number): void => {
      this.tmp.set(x, y, z).project(this.camera);
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    };
    for (const iv of this.islands.values()) place(iv.label, iv.island.x, 2.3, iv.island.y);
    for (const sv of this.ships.values()) {
      sv.label.style.display = sv.model.group.visible ? "" : "none";
      place(sv.label, sv.model.group.position.x, 0.2, sv.model.group.position.z);
    }
  }

  // ---- picking

  private pick(clientX: number, clientY: number): { kind: "island" | "ship"; id: string } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
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

function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}
