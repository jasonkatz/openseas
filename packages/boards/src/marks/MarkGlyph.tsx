import { MARK_GEOMETRY, type MarkContour, type MarkName } from "@openseas/content";

/**
 * The marks (ADR 0041) as SVG: the adapter for legends drawn as inline SVG (Navigation's
 * `StarIcon`). The shapes are content's, so they match the Canvas 2D and Pixi adapters'.
 */

const f = (v: number): string => v.toFixed(2);

function contour(c: MarkContour, x: number, y: number, half: number): string {
  if (c.kind === "circle") {
    const r = c.r * half;
    return `M${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)}Z`;
  }
  let d = "";
  for (let i = 0; i < c.points.length; i += 2) d += `${i === 0 ? "M" : "L"}${f(x + c.points[i]! * half)} ${f(y + c.points[i + 1]! * half)}`;
  return `${d}Z`;
}

/** Mark `name` as SVG path data in its box of `half` units each way of (x, y). Fill it with the even-odd rule. */
export function markPathData(name: MarkName, x: number, y: number, half: number): string {
  const geometry = MARK_GEOMETRY[name];
  return contour(geometry.outline, x, y, half) + (geometry.hole ? contour(geometry.hole, x, y, half) : "");
}

export function MarkGlyph({ mark, x, y, half, fill }: { mark: MarkName; x: number; y: number; half: number; fill: string }) {
  return <path d={markPathData(mark, x, y, half)} fill={fill} fillRule="evenodd" />;
}
