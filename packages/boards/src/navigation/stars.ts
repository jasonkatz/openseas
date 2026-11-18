import type { PieceColor, StarColor, StarShape } from "@openseas/content";
import type { Layer } from "@openseas/protocol";
import { css, type Token } from "../look/tokens.js";
import { drawingOf, pieceOverrideRevision } from "../look/pieces.js";
import { paintDrawing } from "../kit/drawing.js";

/**
 * Navigation's stars, as pictograms (docs/BRAND.md section 3, ADR 0062). A star is two
 * things at once, a shape and a colour, and both matter to play. The shape is the outline. The
 * colour cannot have an outline of its own, so each colour carries one cut-out, the same on every
 * shape, and that cut-out reads with the colour taken away: any two stars that differ in shape or
 * in colour are told apart in one flat colour. A marker is the same star hollow: its outline as a
 * line, with the colour's cut-out drawn solid inside it. A marker with a star on it has nothing
 * inside to show, so there the cut-out is cut from the line itself.
 * Each outline, solid and as a line, and each cut-out is drawn from its layers in
 * `data/pieces/navigation.json` (ADR 0065), by name, with Canvas 2D so the chart and the page's
 * legend share one drawing.
 */
export type StarShapeName = StarShape["shape"];
export type StarCutName = StarColor["cut"];

type Ctx = CanvasRenderingContext2D;

/** The middle of each shape's body, where the colour's cut-out sits; its drawing is centred on (12, 12). */
const MIDDLE: Record<StarShapeName, readonly [number, number]> = { spark: [12, 12], star: [12, 12.7], comet: [14.6, 14.6] };

/** Traces a drawing's first layer, a polygon or a path, as one closed outline, to clip to. */
function traceOutline(ctx: Ctx, layer: Layer): void {
  ctx.beginPath();
  if (layer.kind === "poly") {
    const p = layer.points;
    for (let i = 0; i + 1 < p.length; i += 2) {
      if (i === 0) ctx.moveTo(p[i]!, p[i + 1]!);
      else ctx.lineTo(p[i]!, p[i + 1]!);
    }
  } else if (layer.kind === "path") {
    layer.steps.forEach((st, i) => {
      if ("r" in st) ctx.arc(st.x, st.y, st.r, (st.from * Math.PI) / 180, (st.to * Math.PI) / 180, st.ccw ?? false);
      else if (i === 0) ctx.moveTo(st.x, st.y);
      else ctx.lineTo(st.x, st.y);
    });
  }
  ctx.closePath();
}

/**
 * Paints the colour's cut-out round the middle of the body: the dot centred on it, the band
 * across at its height, the split down at its width.
 */
function paintCut(ctx: Ctx, shape: StarShapeName, cut: StarCutName): void {
  const [cx, cy] = MIDDLE[shape];
  ctx.save();
  ctx.translate(cut === "band" ? 0 : cx - 12, cut === "split" ? 0 : cy - 12);
  paintDrawing(ctx, drawingOf("navigation", cut));
  ctx.restore();
}

export interface StarLook {
  shape: StarShapeName;
  /** A palette colour. A piece colour for a star; any token for a legend that shows a shape alone. */
  color: Token;
  /** The colour's cut-out, or null for a legend that shows a shape alone. */
  cut: StarCutName | null;
  /** A marker: the outline as a line, the cut-out solid inside it. */
  hollow?: boolean;
  /** A marker with a star on it: the outline alone, the cut-out taken from the line. */
  covered?: boolean;
}

/** Paints one star into a cell of size `s` whose top-left corner is the context origin. */
export function paintStar(ctx: Ctx, s: number, look: StarLook): void {
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so neighbours never touch.
  const k = (s * (20 / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(look.color);
  ctx.strokeStyle = css(look.color);
  if (look.hollow) {
    paintDrawing(ctx, drawingOf("navigation", `${look.shape}-outline`));
    if (look.cut && look.covered) {
      ctx.globalCompositeOperation = "destination-out";
      paintCut(ctx, look.shape, look.cut);
    } else if (look.cut) {
      // Solid inside the outline: clipped to the shape's own outline, unrounded.
      ctx.save();
      traceOutline(ctx, drawingOf("navigation", look.shape).layers[0]!);
      ctx.clip();
      paintCut(ctx, look.shape, look.cut);
      ctx.restore();
    }
  } else {
    paintDrawing(ctx, drawingOf("navigation", look.shape));
    if (look.cut) {
      // Cut out of what is drawn, so whatever is behind the star shows through.
      ctx.globalCompositeOperation = "destination-out";
      paintCut(ctx, look.shape, look.cut);
    }
  }
  ctx.restore();
}

/** A star as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function starCanvas(s: number, look: StarLook, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintStar(ctx, s, look);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a star for the page's legend; cached because legends re-render often. */
export function starDataUrl(look: StarLook, px: number): string {
  const key = `${look.shape}:${look.color}:${look.cut}:${look.hollow ? (look.covered ? 2 : 1) : 0}:${px}:${pieceOverrideRevision()}`;
  let url = urlCache.get(key);
  if (!url) {
    url = starCanvas(px, look, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}

export type { PieceColor };
