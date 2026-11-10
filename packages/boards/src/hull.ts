import { FillGradient, type Graphics } from "pixi.js";

/**
 * The boards' shared chrome since the space sprite pass: painted gunmetal plate with steel rivets,
 * cream trim and orange hazard paint, the same materials the sprites are drawn in. Every board's
 * frame comes from here so the seven read as one ship. Presentation only.
 */
export const HULL = {
  plateTop: 0x3c4555,
  plateMid: 0x2c3340,
  plateBottom: 0x1c212b,
  edge: 0x0a0e15,
  seam: 0x11151d,
  sheen: 0x8793a6,
  rivet: 0xa7b0bd,
  rivetDeep: 0x4b5361,
  trim: 0xd8ccae,
  trimDeep: 0x8f8670,
  hazard: 0xe8892c,
  glow: 0x5fe3ff,
  voidTop: 0x101a33,
  voidBottom: 0x05080f,
  star: 0xdfe9ff,
} as const;

/** A vertical or horizontal gradient in the shape's own space. The caller owns and destroys it. */
export function hullGradient(vertical: boolean, stops: readonly number[]): FillGradient {
  const g = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 }, textureSpace: "local" });
  stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
  return g;
}

/** One domed steel rivet with a shadow and a glint. */
export function hullRivet(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y + r * 0.45, r).fill({ color: 0x000000, alpha: 0.45 });
  g.circle(x, y, r).fill({ color: HULL.rivetDeep });
  g.circle(x - r * 0.12, y - r * 0.12, r * 0.78).fill({ color: HULL.rivet });
  g.circle(x - r * 0.32, y - r * 0.32, r * 0.32).fill({ color: 0xffffff, alpha: 0.55 });
}

export interface HullFrameOptions {
  /** Distance between rivets along each rail; defaults to about four times the rail width. */
  rivetStep?: number;
  /** Paint a hazard stripe band across the top rail, for frames that carry a strip above the well. */
  hazardTop?: number;
}

/**
 * A riveted gunmetal frame: drop shadow, plate, dark edge, a sheen along the top, a cream trim
 * line around the opening and rivets down every rail. `inner` is the opening the well sits in.
 */
export function hullFrame(
  g: Graphics,
  fill: FillGradient,
  outer: { x: number; y: number; w: number; h: number; r: number },
  inner: { x: number; y: number; w: number; h: number },
  opts: HullFrameOptions = {},
): void {
  const { x, y, w, h, r } = outer;
  g.roundRect(x - 2, y + 4, w + 4, h, r + 2).fill({ color: 0x000000, alpha: 0.45 });
  g.roundRect(x, y, w, h, r).fill(fill);
  g.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, Math.max(1, r - 1)).stroke({ width: 1, color: HULL.sheen, alpha: 0.35 });
  g.roundRect(x, y, w, h, r).stroke({ width: 1.5, color: HULL.edge, alpha: 0.95 });
  if (opts.hazardTop && opts.hazardTop > 4) hazardBand(g, x + r, y + 3, w - r * 2, opts.hazardTop - 6);
  // Trim around the opening.
  g.rect(inner.x - 2, inner.y - 2, inner.w + 4, inner.h + 4).stroke({ width: 1.5, color: HULL.trim, alpha: 0.4 });
  const rail = Math.max(4, Math.min(inner.x - x, x + w - inner.x - inner.w, inner.y - y, y + h - inner.y - inner.h));
  const rr = Math.max(1.4, rail * 0.18);
  const step = opts.rivetStep ?? Math.max(rail * 4, 24);
  const left = x + (inner.x - x) / 2;
  const right = inner.x + inner.w + (x + w - inner.x - inner.w) / 2;
  const top = y + (inner.y - y) / 2;
  const bottom = inner.y + inner.h + (y + h - inner.y - inner.h) / 2;
  const along = (from: number, to: number, put: (t: number) => void): void => {
    const n = Math.max(1, Math.round((to - from) / step));
    for (let i = 0; i <= n; i++) put(from + ((to - from) * i) / n);
  };
  along(top, bottom, (t) => {
    hullRivet(g, left, t, rr);
    hullRivet(g, right, t, rr);
  });
  if (!opts.hazardTop) along(left, right, (t) => hullRivet(g, t, top, rr));
  along(left, right, (t) => hullRivet(g, t, bottom, rr));
}

/** Diagonal orange-and-dark hazard stripes clipped to a rectangle. */
export function hazardBand(g: Graphics, x: number, y: number, w: number, h: number, alpha = 0.55): void {
  if (w <= 0 || h <= 0) return;
  g.rect(x, y, w, h).fill({ color: 0x14171d, alpha });
  const step = Math.max(6, h * 1.2);
  for (let sx = x - h; sx < x + w; sx += step * 2) {
    const a = Math.max(x, sx);
    const b = Math.min(x + w, sx + step);
    if (b <= a) continue;
    // A parallelogram stripe, trimmed to the band.
    const pts = [sx, y + h, sx + h, y, sx + h + step, y, sx + step, y + h].map((v, i) => (i % 2 === 0 ? Math.max(x, Math.min(x + w, v)) : v));
    g.poly(pts).fill({ color: HULL.hazard, alpha: alpha * 0.7 });
  }
  g.rect(x, y, w, h).stroke({ width: 1, color: HULL.edge, alpha: 0.8 });
}

/** A field of faint stars, placed by a fixed hash so the same board always gets the same sky. */
export function starField(g: Graphics, x: number, y: number, w: number, h: number, density: number, seed = 1): void {
  let s = (seed * 2654435761) >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = Math.round((w * h) / 1000 * density);
  for (let i = 0; i < n; i++) {
    const big = rnd() < 0.08;
    g.circle(x + rnd() * w, y + rnd() * h, big ? 1.2 : 0.6 + rnd() * 0.4).fill({ color: HULL.star, alpha: big ? 0.75 : 0.2 + rnd() * 0.35 });
  }
}
