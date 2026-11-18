import type { GunneryPieceStyle, PieceColor } from "@openseas/content";
import { css } from "../look/tokens.js";

/**
 * Gunnery's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062): each kind is
 * one solid silhouette in one palette colour, on a 24 unit square, with at most one detail cut out
 * so the ground shows through. A cell is a battery on its side, a sabot an open cup, a slug an
 * upright pointed round and coolant a six-armed frost crystal: no two outlines are alike, so the
 * kinds read apart with the colour taken away. Painted with Canvas 2D so the board and the page's
 * legend share one drawing.
 */
export type GunneryShape = GunneryPieceStyle["shape"];

type Ctx = CanvasRenderingContext2D;

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** A filled polygon whose corners are rounded by stroking it in its own colour. */
function soft(ctx: Ctx, pts: readonly number[], round: number): void {
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

/** Cut a detail out of what is already drawn, so whatever is behind the piece shows through. */
function cut(ctx: Ctx, draw: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  draw();
  ctx.restore();
}

const DRAW: Record<GunneryShape, (ctx: Ctx) => void> = {
  // A battery on its side: a wide body, a terminal at one end and a charge window.
  cell(ctx) {
    rounded(ctx, 2, 6, 16.5, 12, 3);
    rounded(ctx, 17, 9.2, 5, 5.6, 1.8);
    cut(ctx, () => rounded(ctx, 5.4, 9.6, 8, 4.8, 1.6));
  },
  // An open cup, the cradle a slug rides in.
  sabot(ctx) {
    ctx.beginPath();
    ctx.moveTo(5.5, 5.5);
    ctx.lineTo(5.5, 12);
    ctx.arc(12, 12, 6.5, Math.PI, 0, true);
    ctx.lineTo(18.5, 5.5);
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  },
  // An upright pointed round with its driving band.
  slug(ctx) {
    soft(ctx, [8, 20.5, 16, 20.5, 16, 10.5, 12, 3.5, 8, 10.5], 3);
    cut(ctx, () => ctx.fillRect(5, 14.4, 14, 3));
  },
  // A frost crystal: three bars crossed.
  coolant(ctx) {
    for (let k = 0; k < 3; k++) {
      ctx.save();
      ctx.translate(12, 12);
      ctx.rotate((k * Math.PI) / 3);
      rounded(ctx, -2.2, -10, 4.4, 20, 2.2);
      ctx.restore();
    }
  },
};

/** Paints one piece into a cell of size `s` whose top-left corner is the context origin. */
export function paintGunneryPiece(ctx: Ctx, s: number, shape: GunneryShape, color: PieceColor): void {
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so a piece never touches its neighbour.
  const k = (s * (20 / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  DRAW[shape](ctx);
  ctx.restore();
}

/** A piece as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function gunneryPieceCanvas(s: number, shape: GunneryShape, color: PieceColor, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintGunneryPiece(ctx, s, shape, color);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a piece for the page's legend; cached because legends re-render often. */
export function gunneryPieceUrl(shape: GunneryShape, color: PieceColor, px: number): string {
  const key = `${shape}:${color}:${px}`;
  let url = urlCache.get(key);
  if (!url) {
    url = gunneryPieceCanvas(px, shape, color, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
