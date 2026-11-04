import * as THREE from "three";

/** A view the rig eases toward: what sits at the focus, how much of the world is in frame, and where on screen the focus lands. */
export interface View {
  center: THREE.Vector3;
  /** Half the vertical extent of the frustum in world units (the zoom). */
  halfH: number;
  /** Where the center sits vertically on screen, 0 at the top, 1 at the bottom. */
  anchorY: number;
  /** Where the center sits horizontally on screen, 0 at the left, 1 at the right. */
  anchorX: number;
}

const DISTANCE = 60;

/** The camera looks down one of the four isometric diagonals; the rig picks the one that fits the screen. */
export function isoDirection(azimuth: number): THREE.Vector3 {
  return new THREE.Vector3(Math.SQRT2 * Math.cos(azimuth), 1, Math.SQRT2 * Math.sin(azimuth)).normalize();
}

/**
 * An isometric orthographic camera that moves rather than cuts (DESIGN.md 3.11): every change of
 * place is an eased glide of the center and the zoom. Following a ship is the same glide with a
 * target that moves each frame.
 */
export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly target: View = { center: new THREE.Vector3(), halfH: 10, anchorY: 0.5, anchorX: 0.5 };
  private readonly shown: View = { center: new THREE.Vector3(), halfH: 10, anchorY: 0.5, anchorX: 0.5 };
  private started = false;
  private targetAzimuth = Math.PI / 4;
  private shownAzimuth = Math.PI / 4;
  /** Seconds for the glide to cover most of the distance. */
  speed = 0.42;

  /** Which way the camera looks down at the world. It swings round to a new azimuth as it glides. */
  setAzimuth(azimuth: number, immediate = false): void {
    this.targetAzimuth = azimuth;
    if (immediate || !this.started) this.shownAzimuth = azimuth;
  }

  get azimuth(): number {
    return this.shownAzimuth;
  }

  setView(v: View, immediate = false): void {
    this.target.center.copy(v.center);
    this.target.halfH = v.halfH;
    this.target.anchorY = v.anchorY;
    this.target.anchorX = v.anchorX;
    if (immediate || !this.started) {
      this.shown.center.copy(v.center);
      this.shown.halfH = v.halfH;
      this.shown.anchorY = v.anchorY;
      this.shown.anchorX = v.anchorX;
      this.started = true;
    }
  }

  /** Eases toward the target and applies it. Returns true while still moving. */
  update(dt: number, aspect: number): boolean {
    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt / (this.speed / 2.2));
    this.shown.center.lerp(this.target.center, k);
    this.shown.halfH = Math.exp(THREE.MathUtils.lerp(Math.log(this.shown.halfH), Math.log(this.target.halfH), k));
    this.shown.anchorY += (this.target.anchorY - this.shown.anchorY) * k;
    this.shown.anchorX += (this.target.anchorX - this.shown.anchorX) * k;
    // The short way round between the two azimuths.
    let dAz = (this.targetAzimuth - this.shownAzimuth) % (Math.PI * 2);
    if (dAz > Math.PI) dAz -= Math.PI * 2;
    if (dAz < -Math.PI) dAz += Math.PI * 2;
    this.shownAzimuth += dAz * k;
    this.apply(aspect);
    return this.shown.center.distanceTo(this.target.center) > 0.002 || Math.abs(this.shown.halfH - this.target.halfH) > 0.002 || Math.abs(dAz) > 0.002;
  }

  /** The world point under a screen position, on the y = 0 plane, for picking. */
  get position(): THREE.Vector3 {
    return this.camera.position;
  }

  private apply(aspect: number): void {
    const c = this.shown.center;
    this.camera.position.copy(c).add(isoDirection(this.shownAzimuth).multiplyScalar(DISTANCE));
    this.camera.lookAt(c);
    const halfH = this.shown.halfH;
    const halfW = halfH * aspect;
    // The focus sits at (anchorX, anchorY) of the screen: shift the frustum around it.
    const ndcY = 1 - 2 * this.shown.anchorY;
    const ndcX = 2 * this.shown.anchorX - 1;
    const bottom = -(ndcY + 1) * halfH;
    const left = -(ndcX + 1) * halfW;
    this.camera.left = left;
    this.camera.right = left + 2 * halfW;
    this.camera.bottom = bottom;
    this.camera.top = bottom + 2 * halfH;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
