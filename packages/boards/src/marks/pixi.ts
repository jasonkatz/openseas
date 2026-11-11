import { MARK_GEOMETRY, type MarkContour, type MarkName } from "@openseas/content";
import type { FillInput, Graphics, StrokeInput } from "pixi.js";

/**
 * The marks (ADR 0041) in a Pixi Graphics: the adapter for what a board draws live (Navigation's
 * stars, Engines' injector targets, Plating's plates, Swordfighting's small boards). The shapes are
 * content's, so they match the Canvas 2D and SVG adapters'.
 */

function contour(g: Graphics, c: MarkContour, x: number, y: number, half: number): void {
  if (c.kind === "circle") {
    g.circle(x, y, c.r * half);
    return;
  }
  const points: number[] = [];
  for (let i = 0; i < c.points.length; i += 2) points.push(x + c.points[i]! * half, y + c.points[i + 1]! * half);
  g.poly(points);
}

export interface MarkStyle {
  fill?: FillInput;
  stroke?: StrokeInput;
}

/** Draws mark `name` in its box of `half` pixels each way of (x, y): filled, outlined, or both. */
export function drawMarkShape(g: Graphics, name: MarkName, x: number, y: number, half: number, style: MarkStyle): void {
  const geometry = MARK_GEOMETRY[name];
  if (style.fill !== undefined) {
    contour(g, geometry.outline, x, y, half);
    g.fill(style.fill);
    if (geometry.hole) {
      contour(g, geometry.hole, x, y, half);
      g.cut();
    }
  }
  if (style.stroke !== undefined) {
    contour(g, geometry.outline, x, y, half);
    g.stroke(style.stroke);
    if (geometry.hole) {
      contour(g, geometry.hole, x, y, half);
      g.stroke(style.stroke);
    }
  }
}
