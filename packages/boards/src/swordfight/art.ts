import type { PieceColor, SwordPieceStyle } from "@openseas/content";
import { FONT, css } from "../look/tokens.js";
import { drawingOf, pieceOverrideRevision } from "../look/pieces.js";
import { paintDrawing } from "../kit/drawing.js";

/**
 * Swordfighting's pieces, drawn in code (docs/BRAND.md section 3, ADR 0062). Blocks of one colour
 * fuse into slabs of any size, so a block cannot have an outline of its own: every block and slab
 * is one solid rounded rectangle in its colour's palette colour, and the colour's one cut-out, a
 * hole the ground shows through, does the outline's job. A slab carries that cut-out once, at its
 * centre, as large as its shorter side, so it reads as one thing and not as its blocks.
 *
 * The three kinds that are not blocks each have a silhouette of their own. A breaker is a square
 * stood on its point, with its colour's cut-out. Stone is a slate block with its corners cut off, counting the drops it has
 * left in pips. Ripening stone, with one drop left, is the same cut-cornered block tinted half way
 * to the colour it will turn, with that colour's cut-out in place of the pips.
 *
 * The block, the breaker, stone and each cut-out are drawings in `data/pieces/swordfight.json`
 * (ADR 0065); code stretches the block over a slab's cells, scales the cut-out to a piece, and
 * says what stone has left (its pips, its count, its half tint).
 *
 * Painted with Canvas 2D so the board, which bakes each to a texture, the small boards beside it and
 * the page's legend share one drawing.
 */
export type BlockCut = SwordPieceStyle["cut"];

export interface BlockStyle {
  /** The block's colour; for stone, the colour it ripens into. */
  color: PieceColor;
  cut: BlockCut;
  kind: "block" | "breaker" | "scrap";
  /** Stone only: the drops left before it ripens. With none given it is plain stone, as a board seen from outside shows it. */
  ripen?: number;
}

/** How far along stone is: counting down until one drop is left, then showing what it will turn into. */
export type ScrapStage = "stone" | "hint";
export const scrapStage = (ripen: number): ScrapStage => (ripen <= 1 ? "hint" : "stone");

type Pen = CanvasRenderingContext2D;

/** On the pieces' 24 unit square: the ground left round a slab, and its corner, as the block's drawing has them. */
const GAP = 2;
const ROUND = 4;
/** The most pips stone shows; a longer count is a number. */
const MAX_PIPS = 4;

function roundRect(pen: Pen, x: number, y: number, w: number, h: number, r: number): void {
  pen.moveTo(x + r, y);
  pen.arcTo(x + w, y, x + w, y + h, r);
  pen.arcTo(x + w, y + h, x, y + h, r);
  pen.arcTo(x, y + h, x, y, r);
  pen.arcTo(x, y, x + w, y, r);
  pen.closePath();
}

/** Cuts a path traced round the origin out of what is drawn, centred on (`cx`, `cy`) at `k` times its size. */
function cutOut(pen: Pen, cx: number, cy: number, k: number, trace: (pen: Pen) => void): void {
  pen.save();
  pen.globalCompositeOperation = "destination-out";
  pen.translate(cx, cy);
  pen.scale(k, k);
  pen.beginPath();
  trace(pen);
  pen.fill();
  pen.restore();
}

/** Cuts a colour's cut-out, the drawing `cut-<cut>` centred on its 24 unit square, out of what is drawn: centred on (`cx`, `cy`) at `k` times its size. */
function stampCut(pen: Pen, cx: number, cy: number, k: number, cut: BlockCut): void {
  pen.save();
  pen.globalCompositeOperation = "destination-out";
  pen.translate(cx, cy);
  pen.scale(k, k);
  pen.translate(-12, -12);
  paintDrawing(pen, drawingOf("swordfight", `cut-${cut}`));
  pen.restore();
}

/** Paints one of the pieces' fixed drawings on the 24 unit square at the origin. */
const paint = (pen: Pen, name: "block" | "breaker" | "stone"): void => paintDrawing(pen, drawingOf("swordfight", name));

/**
 * Paints a block `w` by `h` cells of size `s`, its top-left at the context origin. One cell is the
 * ordinary block; more is a slab. A breaker and stone are always one cell.
 */
export function paintBlock(ctx: Pen, s: number, w: number, h: number, style: BlockStyle): void {
  const u = s / 24;
  ctx.save();
  ctx.scale(u, u);
  const fill = (color: PieceColor): void => {
    ctx.fillStyle = css(color);
    ctx.strokeStyle = css(color);
  };
  fill(style.color);
  if (style.kind === "breaker") {
    paint(ctx, "breaker");
    stampCut(ctx, 12, 12, 0.8, style.cut);
  } else if (style.kind === "scrap") {
    const hint = style.ripen !== undefined && scrapStage(style.ripen) === "hint";
    fill("slate");
    paint(ctx, "stone");
    if (hint) {
      // Half way to its colour: the same shape again, half clear, is one flat tint.
      ctx.globalAlpha = 0.5;
      fill(style.color);
      paint(ctx, "stone");
      ctx.globalAlpha = 1;
      stampCut(ctx, 12, 12, 0.92, style.cut);
    } else if (style.ripen !== undefined) paintCount(ctx, style.ripen);
  } else if (w === 1 && h === 1) {
    paint(ctx, "block");
    stampCut(ctx, 12, 12, 1, style.cut);
  } else {
    // A slab is the block's rounded rectangle stretched over its cells.
    ctx.beginPath();
    roundRect(ctx, GAP, GAP, 24 * w - GAP * 2, 24 * h - GAP * 2, ROUND);
    ctx.fill();
    // One cut-out a piece, whatever its size: a slab's is as large as its shorter side.
    const k = Math.min(w, h);
    stampCut(ctx, 12 * w, 12 * h, k === 1 ? 1 : k * 0.92, style.cut);
  }
  ctx.restore();
}

/** The drops stone has left, cut out of it: a row of pips, or a number when there are too many to count at a glance. */
function paintCount(ctx: Pen, n: number): void {
  if (n <= MAX_PIPS) {
    const step = n > 3 ? 4.2 : 5;
    cutOut(ctx, 12, 12, 1, (pen) => {
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * step;
        pen.moveTo(x + 1.9, 0);
        pen.arc(x, 0, 1.9, 0, Math.PI * 2);
      }
    });
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.font = `700 ${n > 9 ? 10 : 12}px ${FONT.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 12, 12.6);
  ctx.restore();
}

export function blockCanvas(s: number, w: number, h: number, style: BlockStyle, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * w * resolution);
  canvas.height = Math.ceil(s * h * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintBlock(ctx, s, w, h, style);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a block or a slab, fitted in a square of `px` pixels, for the page's legend; cached because legends re-render often. */
export function blockDataUrl(style: BlockStyle, px: number, w = 1, h = 1): string {
  const key = JSON.stringify([style, px, w, h, pieceOverrideRevision()]);
  let url = urlCache.get(key);
  if (!url) {
    const resolution = 3;
    const canvas = document.createElement("canvas");
    canvas.width = px * resolution;
    canvas.height = px * resolution;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const s = px / Math.max(w, h);
      ctx.scale(resolution, resolution);
      ctx.translate((px - s * w) / 2, (px - s * h) / 2);
      paintBlock(ctx, s, w, h, style);
    }
    url = canvas.toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
