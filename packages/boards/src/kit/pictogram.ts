/**
 * What a kit board draws its pieces with (docs/BRAND.md section 3, ADR 0062): a pictogram
 * is one solid silhouette in one palette colour on a 24 unit square, with at most one detail cut
 * out so the ground shows through. It is painted with Canvas 2D so the board (`KitBoard.piece`)
 * and the page's legend (`PictogramIcon`) share one drawing. Cooling's `pieces.ts` is the model;
 * a puzzle keeps its own drawings in a `pieces.ts` beside its renderer and builds them from these.
 */
import { css, type Token } from "../look/tokens.js";
import { pieceOverrideRevision } from "../look/pieces.js";

export type Ctx = CanvasRenderingContext2D;

/** Paints one pictogram on the 24 unit square, in the fill and stroke colour already set. */
export type Paint = (ctx: Ctx) => void;

/** A filled rounded rectangle. */
export function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** A filled disc. */
export function disc(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A filled polygon whose corners are rounded by stroking it in its own colour: `round` is the stroke's width. */
export function soft(ctx: Ctx, pts: readonly number[], round: number): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i]!, pts[i + 1]!);
    else ctx.lineTo(pts[i]!, pts[i + 1]!);
  }
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = round;
  ctx.fill();
  ctx.stroke();
}

/** A round-ended line of `width`: a bar, an arm. */
export function bar(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Cut a detail out of what is already drawn, so whatever is behind the piece shows through. */
export function cut(ctx: Ctx, draw: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  draw();
  ctx.restore();
}

/**
 * Paints a pictogram into a cell of size `s` whose top-left corner is the context origin. The 24
 * unit square is drawn at `fit` of the cell (20/24 by default, so neighbours never touch).
 */
export function paintPictogram(ctx: Ctx, s: number, color: Token, paint: Paint, fit = 20 / 24): void {
  ctx.save();
  const k = (s * fit) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  paint(ctx);
  ctx.restore();
}

/** A pictogram as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function pictogramCanvas(s: number, color: Token, paint: Paint, resolution: number, fit?: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintPictogram(ctx, s, color, paint, fit);
  }
  return canvas;
}

const urls = new Map<string, string>();

/**
 * A data URL of a pictogram for a page's legend, cached because legends re-render often. `key`
 * names the drawing: everything `paint` depends on (the puzzle, the piece, its state).
 */
export function pictogramUrl(key: string, color: Token, paint: Paint, px: number): string {
  // A redrawn piece (ADR 0065) is drawn again rather than read from the cache.
  const id = `${key}:${color}:${px}:${pieceOverrideRevision()}`;
  let url = urls.get(id);
  if (!url) {
    url = pictogramCanvas(px, color, paint, 3, 1).toDataURL();
    urls.set(id, url);
  }
  return url;
}
