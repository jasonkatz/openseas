import type { GunneryPieceStyle, PieceColor } from "@openseas/content";
import { css } from "../look/tokens.js";
import { drawingOf, pieceOverrideRevision } from "../look/pieces.js";
import { paintDrawing } from "../kit/drawing.js";

/**
 * Gunnery's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062): each kind is
 * one solid silhouette in one palette colour, on a 24 unit square, with at most one detail cut out
 * so the ground shows through. A cell is a battery on its side, a sabot an open cup, a slug an
 * upright pointed round and coolant a six-armed frost crystal: no two outlines are alike, so the
 * kinds read apart with the colour taken away. Each is drawn from its layers in
 * `data/pieces/gunnery.json` (ADR 0065), by name, with Canvas 2D so the board and the page's legend
 * share one drawing.
 */
export type GunneryShape = GunneryPieceStyle["shape"];

type Ctx = CanvasRenderingContext2D;

/** Paints one piece into a cell of size `s` whose top-left corner is the context origin. */
export function paintGunneryPiece(ctx: Ctx, s: number, shape: GunneryShape, color: PieceColor): void {
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so a piece never touches its neighbour.
  const k = (s * (20 / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  paintDrawing(ctx, drawingOf("gunnery", shape));
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
  const key = `${shape}:${color}:${px}:${pieceOverrideRevision()}`;
  let url = urlCache.get(key);
  if (!url) {
    url = gunneryPieceCanvas(px, shape, color, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
