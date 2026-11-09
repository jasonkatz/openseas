/**
 * Static scenery merged into a few meshes. An island is hundreds of primitives (planks, stones,
 * tufts, fence posts); drawn one by one they cost a draw call each, which a phone or a software
 * renderer feels. A batch takes each primitive with a transform and a flat color, bakes the color
 * into the vertices and merges everything into one lit mesh and one unlit (glowing) mesh.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Vec3 = readonly [number, number, number];

/** Where a primitive goes in the batch's current frame: a position, Euler angles and a scale. */
export interface Put {
  p?: Vec3;
  r?: Vec3;
  s?: number | Vec3;
}

const tmpColor = new THREE.Color();

export function matrixOf(put: Put = {}): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const s = put.s === undefined ? [1, 1, 1] : typeof put.s === "number" ? [put.s, put.s, put.s] : put.s;
  m.compose(
    new THREE.Vector3(...(put.p ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(put.r ?? [0, 0, 0]))),
    new THREE.Vector3(s[0], s[1], s[2]),
  );
  return m;
}

export class Batch {
  private readonly solid: THREE.BufferGeometry[] = [];
  private readonly glow: THREE.BufferGeometry[] = [];
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  /** Work in a sub-frame: everything added inside `draw` is placed by `put` first. */
  frame(put: Put | THREE.Matrix4, draw: () => void): void {
    const local = put instanceof THREE.Matrix4 ? put : matrixOf(put);
    this.stack.push(this.top.clone().multiply(local));
    try {
      draw();
    } finally {
      this.stack.pop();
    }
  }

  /** The current frame's matrix, for turning a local point into the batch's root frame. */
  get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1]!;
  }

  /** A point in the current frame, in the root frame. */
  point(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.top);
  }

  add(geometry: THREE.BufferGeometry, color: number, put: Put = {}): void {
    this.solid.push(this.bake(geometry, color, put));
  }

  /** Lamps, windows and embers: drawn unlit so they read as light. */
  addGlow(geometry: THREE.BufferGeometry, color: number, put: Put = {}): void {
    this.glow.push(this.bake(geometry, color, put));
  }

  get empty(): boolean {
    return this.solid.length === 0 && this.glow.length === 0;
  }

  /** The merged meshes. The batch is spent afterwards. */
  build(shadows = true): THREE.Group {
    const group = new THREE.Group();
    if (this.solid.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.solid, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (this.glow.length) group.add(new THREE.Mesh(mergeGeometries(this.glow, false), new THREE.MeshBasicMaterial({ vertexColors: true })));
    for (const g of [...this.solid, ...this.glow]) g.dispose();
    this.solid.length = 0;
    this.glow.length = 0;
    return group;
  }

  private bake(geometry: THREE.BufferGeometry, color: number, put: Put): THREE.BufferGeometry {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
    if (!flat.getAttribute("normal")) flat.computeVertexNormals();
    flat.applyMatrix4(this.top.clone().multiply(matrixOf(put)));
    const count = flat.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    tmpColor.setHex(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return flat;
  }
}
