import type { CoolingPieceStyle, PieceColor } from "@openseas/content";
import { css } from "../look/tokens.js";
import { drawingOf, pieceOverrideRevision } from "../look/pieces.js";
import { paintDrawing } from "../kit/drawing.js";

/**
 * Cooling's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062): each kind is one solid
 * silhouette in one palette colour, on a 24 unit square, with at most one detail cut out so the
 * ground shows through. Nothing else tells two kinds apart, so no two outlines may be alike. Each
 * is drawn from its layers in `data/pieces/cooling.json` (ADR 0065), by name, with Canvas 2D so the
 * board and the page's legend share one drawing.
 */
export type PieceShape = CoolingPieceStyle["shape"];
export type SpecialName = "charge" | "magnet" | "slag";
export type Pictogram = PieceShape | SpecialName;

type Ctx = CanvasRenderingContext2D;

/** Paints one piece into a cell of size `s` whose top-left corner is the context origin. */
export function paintPiece(ctx: Ctx, s: number, shape: Pictogram, color: PieceColor): void {
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so neighbours never touch.
  const k = (s * (20 / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  paintDrawing(ctx, drawingOf("cooling", shape));
  ctx.restore();
}

/** A piece as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function pieceCanvas(s: number, shape: Pictogram, color: PieceColor, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintPiece(ctx, s, shape, color);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a piece for the page's legend; cached because legends re-render often. */
export function pieceDataUrl(shape: Pictogram, color: PieceColor, px: number): string {
  const key = `${shape}:${color}:${px}:${pieceOverrideRevision()}`;
  let url = urlCache.get(key);
  if (!url) {
    url = pieceCanvas(px, shape, color, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
