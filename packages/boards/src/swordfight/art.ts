import type { PieceColor, SwordPieceStyle } from "@openseas/content";
import { FONT, css } from "../look/tokens.js";

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

/** On the pieces' 24 unit square: the ground left round a piece, its corner, and the corner cut off stone. */
const GAP = 2;
const ROUND = 4;
const CHAMFER = 6;
/** A breaker stands on its point, so only its points come near its neighbours. */
const BREAKER_GAP = 0.5;
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

/** A closed polygon with every corner eased by `r`. */
function soft(pen: Pen, pts: ReadonlyArray<readonly [number, number]>, r: number): void {
  const n = pts.length;
  const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1]!, pts[0]!);
  pen.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    const m = mid(p, q);
    pen.arcTo(p[0], p[1], m[0], m[1], r);
    pen.lineTo(m[0], m[1]);
  }
  pen.closePath();
}

/** Each colour's cut-out as a path round the origin, in units. No two are alike, and none is thinner than 3. */
const CUTS: Record<BlockCut, (pen: Pen) => void> = {
  // A round hole.
  dot(pen) {
    pen.arc(0, 0, 3.9, 0, Math.PI * 2);
  },
  // A slot lying flat.
  bar(pen) {
    roundRect(pen, -6.2, -1.9, 12.4, 3.8, 1.9);
  },
  // A plus.
  cross(pen) {
    roundRect(pen, -5.6, -1.7, 11.2, 3.4, 1);
    roundRect(pen, -1.7, -5.6, 3.4, 11.2, 1);
  },
  // A square on its point.
  diamond(pen) {
    soft(pen, [[0, -5.8], [5.8, 0], [0, 5.8], [-5.8, 0]], 1);
  },
  // A wedge pointing up.
  triangle(pen) {
    soft(pen, [[0, -5.6], [5.9, 4.4], [-5.9, 4.4]], 1.2);
  },
  // A ring, with the middle left standing.
  ring(pen) {
    pen.arc(0, 0, 6, 0, Math.PI * 2);
    pen.moveTo(2.7, 0);
    pen.arc(0, 0, 2.7, 0, Math.PI * 2, true);
  },
};

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

/** A breaker's outline: a square stood on its point, reaching nearly to the cell's edges. */
function traceBreaker(pen: Pen): void {
  const r = 12 - BREAKER_GAP;
  soft(pen, [[12, 12 - r], [12 + r, 12], [12, 12 + r], [12 - r, 12]], 2);
}

/** Stone's outline: a block with its corners cut off. */
function traceStone(pen: Pen): void {
  const a = GAP;
  const b = 24 - GAP;
  const c = CHAMFER;
  soft(pen, [[a + c, a], [b - c, a], [b, a + c], [b, b - c], [b - c, b], [a + c, b], [a, b - c], [a, a + c]], 1.2);
}

/**
 * Paints a block `w` by `h` cells of size `s`, its top-left at the context origin. One cell is the
 * ordinary block; more is a slab. A breaker and stone are always one cell.
 */
export function paintBlock(ctx: Pen, s: number, w: number, h: number, style: BlockStyle): void {
  const u = s / 24;
  ctx.save();
  ctx.scale(u, u);
  ctx.fillStyle = css(style.color);
  if (style.kind === "breaker") {
    ctx.beginPath();
    traceBreaker(ctx);
    ctx.fill();
    cutOut(ctx, 12, 12, 0.8, CUTS[style.cut]);
  } else if (style.kind === "scrap") {
    const hint = style.ripen !== undefined && scrapStage(style.ripen) === "hint";
    ctx.fillStyle = css("slate");
    ctx.beginPath();
    traceStone(ctx);
    ctx.fill();
    if (hint) {
      // Half way to its colour: the same shape again, half clear, is one flat tint.
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = css(style.color);
      ctx.beginPath();
      traceStone(ctx);
      ctx.fill();
      ctx.globalAlpha = 1;
      cutOut(ctx, 12, 12, 0.92, CUTS[style.cut]);
    } else if (style.ripen !== undefined) paintCount(ctx, style.ripen);
  } else {
    ctx.beginPath();
    roundRect(ctx, GAP, GAP, 24 * w - GAP * 2, 24 * h - GAP * 2, ROUND);
    ctx.fill();
    // One cut-out a piece, whatever its size: a slab's is as large as its shorter side.
    const k = Math.min(w, h);
    cutOut(ctx, 12 * w, 12 * h, k === 1 ? 1 : k * 0.92, CUTS[style.cut]);
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
  const key = JSON.stringify([style, px, w, h]);
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
