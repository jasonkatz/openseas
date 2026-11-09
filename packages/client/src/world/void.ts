/**
 * The void the star system hangs in (ADR 0034): a starfield and a nebula drawn behind everything.
 * It is one quad that covers the screen whatever the camera
 * does, so the stars stay round and far away at every zoom. They slide a little as the view moves
 * and swings, which is all that says the camera travelled. The nebula is a small noise texture
 * made once on the CPU, so a frame costs a phone or a software renderer a few texture reads.
 * Like the rest of the world it is primitives and math, no art files.
 */
import * as THREE from "three";
import { nextInt, seedFromString, type PrngState } from "@openseas/engine";

export interface VoidBackdrop {
  mesh: THREE.Mesh;
  /** Each frame: the time, the camera, and the azimuth it looks down. */
  update(t: number, camera: THREE.OrthographicCamera, azimuth: number, width: number, height: number): void;
  /** Free the nebula's texture; the mesh goes with the scene. */
  dispose(): void;
}

/** How far the stars slide for a world unit the camera moves, in screen heights. Far less than the world does. */
const DRIFT = 0.012;
/** How far they slide for a radian the camera swings round. */
const SWING = 0.32;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uNebula;
uniform float uTime;
uniform float uAspect;
uniform float uPixel;
uniform float uSpread;
uniform vec2 uShift;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* One layer of stars: a grid of cells, some of them holding a star somewhere inside. */
float stars(vec2 q, float cells, float share, float radius) {
  vec2 g = q * cells;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash21(id);
  vec2 at = 0.2 + 0.6 * vec2(hash21(id + 3.7), hash21(id + 9.1));
  float r = radius * cells * uPixel * (0.6 + 0.8 * hash21(id + 5.3));
  float twinkle = 0.78 + 0.22 * sin(uTime * (0.6 + h * 30.0) + h * 80.0);
  return step(h, share) * (1.0 - smoothstep(r * 0.25, r, length(f - at))) * twinkle;
}

void main() {
  vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
  vec2 q = p * uSpread;

  // Deep blue at the top running to near black, a shade warmer toward the sun's corner.
  vec3 col = mix(vec3(0.020, 0.027, 0.066), vec3(0.047, 0.062, 0.145), smoothstep(-0.6, 0.6, p.y + p.x * 0.25));
  float lantern = 1.0 - smoothstep(0.0, 1.25, length(p - vec2(-0.5 * uAspect, 0.5)));
  col += vec3(0.20, 0.11, 0.05) * lantern * lantern;

  // The nebula: two reads of the noise, a broad shape and the wisps inside it.
  vec3 broad = texture2D(uNebula, q * 0.33 + uShift * 0.5 + vec2(0.13, 0.41)).rgb;
  vec3 fine = texture2D(uNebula, q * 0.9 + uShift * 0.7 + vec2(0.57, 0.22)).rgb;
  float cloud = smoothstep(0.42, 0.82, broad.r) * (0.45 + 0.9 * fine.r);
  vec3 tint = mix(vec3(0.07, 0.38, 0.50), vec3(0.42, 0.16, 0.52), smoothstep(0.35, 0.65, broad.g));
  tint = mix(tint, vec3(0.62, 0.22, 0.30), smoothstep(0.62, 0.9, fine.g) * 0.5);
  col += tint * cloud * 0.5;
  // Dark dust lanes across it.
  col *= 1.0 - 0.45 * smoothstep(0.55, 0.85, broad.b) * smoothstep(0.3, 0.7, fine.b);

  // Three depths of stars; the nearer ones are fewer, bigger and slide further.
  float far = stars(q + uShift * 0.6, 46.0, 0.16, 1.1);
  float mid = stars(q + uShift * 1.0 + 17.3, 27.0, 0.11, 1.6);
  float near = stars(q + uShift * 1.6 + 41.9, 13.0, 0.07, 2.3);
  col += vec3(0.72, 0.80, 1.0) * far * 0.55;
  col += vec3(1.0, 0.96, 0.88) * mid * 0.8;
  col += mix(vec3(1.0, 0.85, 0.62), vec3(0.72, 0.9, 1.0), hash21(floor((q + uShift * 1.6 + 41.9) * 13.0) + 2.2)) * near;

  gl_FragColor = vec4(col, 1.0);
}`;

/** Noise that tiles, so the nebula goes on for ever as the view slides over it. */
function nebulaTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let s: PrngState = seedFromString("void:lantern-reach");
  const roll = (): number => {
    const r = nextInt(s, 4096);
    s = r.state;
    return r.value / 4095;
  };
  for (let channel = 0; channel < 3; channel++) {
    const field = new Float32Array(size * size);
    let amplitude = 0.5;
    let total = 0;
    for (let period = 4; period <= 32; period *= 2) {
      const lattice = Float32Array.from({ length: period * period }, roll);
      const at = (x: number, y: number): number => lattice[(y % period) * period + (x % period)]!;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * period;
          const fy = (y / size) * period;
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          const tx = fx - ix;
          const ty = fy - iy;
          const sx = tx * tx * (3 - 2 * tx);
          const sy = ty * ty * (3 - 2 * ty);
          const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
          const bottom = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
          field[y * size + x]! += (top * (1 - sy) + bottom * sy) * amplitude;
        }
      }
      total += amplitude;
      amplitude *= 0.5;
    }
    for (let i = 0; i < field.length; i++) data[i * 4 + channel] = Math.round((field[i]! / total) * 255);
  }
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildVoid(): VoidBackdrop {
  const uniforms = {
    uNebula: { value: nebulaTexture() },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uPixel: { value: 1 / 800 },
    uSpread: { value: 1 },
    uShift: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  // Drawn first and never culled: it is the screen, not a thing in the world.
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const looksAt = new THREE.Vector3();
  const facing = new THREE.Vector3();
  return {
    mesh,
    update(t, camera, azimuth, width, height) {
      uniforms.uTime.value = t;
      uniforms.uAspect.value = width / Math.max(1, height);
      uniforms.uPixel.value = 1 / Math.max(1, height);
      const halfH = (camera.top - camera.bottom) / 2;
      // Pulling back shows a little more sky, never a different one.
      uniforms.uSpread.value = Math.pow(Math.max(0.2, halfH) / 2, 0.07);
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      // Where the camera looks on the lane plane, whatever the frustum's own offset.
      camera.getWorldDirection(facing);
      looksAt.copy(camera.position).addScaledVector(facing, facing.y < -1e-3 ? camera.position.y / -facing.y : 0);
      uniforms.uShift.value.set(looksAt.dot(right) * DRIFT + azimuth * SWING, looksAt.dot(up) * DRIFT);
    },
    dispose() {
      uniforms.uNebula.value.dispose();
    },
  };
}
