import type { EnginesPieceStyle, PieceColor } from "@openseas/content";
import { css } from "../look/tokens.js";
import { drawingOf, pieceOverrideRevision } from "../look/pieces.js";
import { paintDrawing } from "../kit/drawing.js";

/**
 * Engines' pellets, as pictograms (docs/BRAND.md section 3, ADR 0062): each kind is one solid
 * silhouette in one palette colour, on a 24 unit square, with at most one detail cut out so the
 * ground shows through. Nothing else tells two kinds apart, so no two outlines may be alike. A
 * kind's hollow target is the same outline drawn a little larger, as a line, so the pellet sits
 * inside it. Each form of each kind is drawn from its layers in `data/pieces/engines.json`
 * (ADR 0065), by name, with Canvas 2D so the board and the page's legend share one drawing.
 */
export type PelletShape = EnginesPieceStyle["shape"];

/**
 * How a pellet is drawn: `solid` is the piece, `target` the hollow an injector wants it in, and
 * `ghost` the thin outline, the piece's own size, that shows where the pair in hand would land.
 */
export type PelletForm = "solid" | "target" | "ghost";

type Ctx = CanvasRenderingContext2D;

/** The drawing a pellet is painted from: the piece by its shape's name, its target and ghost by `<shape>-target` and `<shape>-ghost`. */
const drawingName = (shape: PelletShape, form: PelletForm): string => (form === "solid" ? shape : `${shape}-${form}`);

/** Paints one pellet, or its target or ghost, into a cell of size `s` whose top-left corner is the context origin. */
export function paintPellet(ctx: Ctx, s: number, shape: PelletShape, color: PieceColor | "amber", form: PelletForm = "solid"): void {
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so neighbours never touch and a target has room round its pellet.
  const k = (s * (20 / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  paintDrawing(ctx, drawingOf("engines", drawingName(shape, form)));
  ctx.restore();
}

/** A pellet as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function pelletCanvas(s: number, shape: PelletShape, color: PieceColor | "amber", resolution: number, form: PelletForm = "solid"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintPellet(ctx, s, shape, color, form);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a pellet for the page's legend; cached because legends re-render often. */
export function pelletDataUrl(shape: PelletShape, color: PieceColor, px: number, form: PelletForm = "solid"): string {
  const key = `${shape}:${color}:${px}:${form}:${pieceOverrideRevision()}`;
  let url = urlCache.get(key);
  if (!url) {
    url = pelletCanvas(px, shape, color, 3, form).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
