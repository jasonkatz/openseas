import { z } from "zod";

/**
 * The marks the player's "mark tiles" setting draws on a piece, so kinds read apart with no color
 * at all (CLAUDE.md rule 6), ADR 0041. This is the one vocabulary: a puzzle's content names its
 * kinds' marks from it, startup refuses any other name, and no two kinds of one puzzle share one.
 *
 * Each name has one geometry, here, beside it: a name cannot be added without its shape. The
 * shapes sit in a box from -1 to 1 on each axis, centred on the origin, with y pointing down. The
 * boards draw them through one adapter for each surface they draw on (Canvas 2D, Pixi, SVG) and
 * choose only where a mark goes, how big its box is and how it is painted.
 *
 * The prototype boards mark their kinds with pips, a count by kind, not with these (ADR 0036).
 */
export const MARK_NAMES = ["circle", "square", "triangle", "diamond", "hexagon", "star", "gear"] as const;
export type MarkName = (typeof MARK_NAMES)[number];
export const MarkNameSchema = z.enum(MARK_NAMES);

/** One closed outline: a circle centred on the origin, or a polygon as x, y pairs. */
export type MarkContour = { readonly kind: "circle"; readonly r: number } | { readonly kind: "poly"; readonly points: readonly number[] };

/** A mark's shape: its outline, and a hole cut through it where it has one. */
export interface MarkGeometry {
  readonly outline: MarkContour;
  readonly hole?: MarkContour;
}

// The shapes were Cooling's, the first board that drew all seven: measured in its symbol radius,
// which is this many box units, so the star's points reach the edge of the box.
const R = 1 / 1.3;

const poly = (...points: number[]): MarkContour => ({ kind: "poly", points: points.map((v) => v * R) });
const circle = (r: number): MarkContour => ({ kind: "circle", r: r * R });

/** `count` points evenly round the origin from angle `rot`, alternating `outer` and `inner` radii when `inner` is given. */
function ring(count: number, outer: number, rot: number, inner = outer): MarkContour {
  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = rot + (i / count) * Math.PI * 2;
    const r = i % 2 ? inner : outer;
    points.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return poly(...points);
}

export const MARK_GEOMETRY: Readonly<Record<MarkName, MarkGeometry>> = {
  circle: { outline: circle(1) },
  square: { outline: poly(-1, -1, 1, -1, 1, 1, -1, 1) },
  // Its base sits lower than its tip is high, so it looks centred.
  triangle: { outline: poly(0, -1.1, 1.1, 0.8, -1.1, 0.8) },
  diamond: { outline: poly(0, -1.25, 1.25, 0, 0, 1.25, -1.25, 0) },
  hexagon: { outline: ring(6, 1.15, 0) },
  star: { outline: ring(10, 1.3, -Math.PI / 2, 0.6) },
  // Drawn as a ring: the hole is what tells it from the circle at the size of a mark.
  gear: { outline: circle(1.1), hole: circle(0.45) },
};
