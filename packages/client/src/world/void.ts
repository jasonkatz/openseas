/**
 * The void the star system hangs in (ADR 0034, docs/BRAND.md section 7): the ground colour and a
 * sparse field of small cream stars, drawn behind everything. It is one quad that covers the
 * screen whatever the camera does, so the stars stay round and far away at every zoom. They slide
 * a little as the view moves and swings, which is all that says the camera travelled. There is no
 * nebula, no gradient and no twinkle: the void is one flat colour with still dots on it. Like the
 * rest of the world it is primitives and math, no art files.
 */
import * as THREE from "three";
import { ink } from "@openseas/boards/look";

export interface VoidBackdrop {
  mesh: THREE.Mesh;
  /** Each frame: the camera, the azimuth it looks down, the view's size and how many buffer pixels a CSS pixel gets. */
  update(camera: THREE.OrthographicCamera, azimuth: number, width: number, height: number, pixelRatio: number): void;
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
uniform vec3 uGround;
uniform vec3 uStar;
uniform float uAspect;
uniform float uPixel;
uniform float uSpread;
uniform vec2 uShift;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* One layer of stars: a grid of cells, a few of them holding a star somewhere inside. */
float stars(vec2 q, float cells, float share, float radius) {
  vec2 g = q * cells;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 at = 0.2 + 0.6 * vec2(hash21(id + 3.7), hash21(id + 9.1));
  float r = radius * cells * uPixel * (0.7 + 0.5 * hash21(id + 5.3));
  // A hard dot with a pixel of edge, so it is a round star and not a glow.
  float edge = cells * uPixel * 0.5;
  return step(hash21(id), share) * (1.0 - smoothstep(r - edge, r + edge, length(f - at)));
}

void main() {
  vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
  vec2 q = p * uSpread;
  // Three depths of stars; the nearer ones are fewer, bigger and slide further, the far ones fainter.
  float far = stars(q + uShift * 0.6, 34.0, 0.07, 0.9) * 0.45;
  float mid = stars(q + uShift * 1.0 + 17.3, 21.0, 0.05, 1.2) * 0.7;
  float near = stars(q + uShift * 1.6 + 41.9, 11.0, 0.035, 1.6);
  gl_FragColor = vec4(mix(uGround, uStar, max(far, max(mid, near))), 1.0);
  #include <colorspace_fragment>
}`;

export function buildVoid(): VoidBackdrop {
  const uniforms = {
    uGround: { value: new THREE.Color(ink("ground")) },
    uStar: { value: new THREE.Color(ink("cream")) },
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
    update(camera, azimuth, width, height, pixelRatio) {
      uniforms.uAspect.value = width / Math.max(1, height);
      // A star is sized in CSS pixels, but never smaller than the buffer's own: drawn below one
      // pixel per pixel it would otherwise fall between them and flicker.
      uniforms.uPixel.value = 1 / Math.max(1, height * Math.min(1, pixelRatio));
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
  };
}
