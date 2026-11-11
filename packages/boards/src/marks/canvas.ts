import { MARK_GEOMETRY, type MarkContour, type MarkName } from "@openseas/content";

/**
 * The marks (ADR 0041) on a Canvas 2D context: the adapter for every piece baked from a canvas
 * (Cooling's tiles, Engines' pellets, Gunnery's pieces, Swordfighting's blocks) and their legend
 * icons. The shapes are content's, so they match the Pixi and SVG adapters'.
 */

const INK = 0x0b1526;

const css = (c: number, alpha = 1): string => `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${alpha})`;

function contour(ctx: CanvasRenderingContext2D, c: MarkContour, x: number, y: number, half: number): void {
  if (c.kind === "circle") {
    ctx.moveTo(x + c.r * half, y);
    ctx.arc(x, y, c.r * half, 0, Math.PI * 2);
    return;
  }
  for (let i = 0; i < c.points.length; i += 2) {
    const px = x + c.points[i]! * half;
    const py = y + c.points[i + 1]! * half;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export interface MarkPaint {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
}

/** Paints mark `name` in its box of `half` pixels each way of (x, y): filled, outlined, or both. */
export function paintMarkShape(ctx: CanvasRenderingContext2D, name: MarkName, x: number, y: number, half: number, paint: MarkPaint): void {
  const geometry = MARK_GEOMETRY[name];
  ctx.beginPath();
  contour(ctx, geometry.outline, x, y, half);
  if (geometry.hole) contour(ctx, geometry.hole, x, y, half);
  if (paint.fill) {
    ctx.fillStyle = paint.fill;
    ctx.fill("evenodd");
  }
  if (paint.stroke) {
    ctx.strokeStyle = paint.stroke;
    ctx.lineWidth = paint.lineWidth ?? 1;
    ctx.stroke();
  }
}

/**
 * A piece's mark for the marks setting: dark ink on a light badge, so it reads over every texture,
 * centred in a cell of size `s` whose top-left corner is the context origin.
 */
export function paintMark(ctx: CanvasRenderingContext2D, s: number, mark: MarkName): void {
  const c = s / 2;
  const r = s * 0.14;
  ctx.beginPath();
  ctx.arc(c, c, r * 1.75, 0, Math.PI * 2);
  ctx.fillStyle = css(0xffffff, 0.72);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.strokeStyle = css(INK, 0.35);
  ctx.stroke();
  paintMarkShape(ctx, mark, c, c, r * 1.3, { fill: css(INK, 0.85) });
}
