import type { PieceColor, StarColor, StarShape } from "@openseas/content";
import { css, type Token } from "../look/tokens.js";

/**
 * Navigation's stars, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). A star is two
 * things at once, a shape and a colour, and both matter to play. The shape is the outline. The
 * colour cannot have an outline of its own, so each colour carries one cut-out, the same on every
 * shape, and that cut-out reads with the colour taken away: any two stars that differ in shape or
 * in colour are told apart in one flat colour. A marker is the same star hollow: its outline as a
 * line, with the colour's cut-out drawn solid inside it. A marker with a star on it has nothing
 * inside to show, so there the cut-out is cut from the line itself.
 * Painted with Canvas 2D so the chart and the page's legend share one drawing.
 */
export type StarShapeName = StarShape["shape"];
export type StarCutName = StarColor["cut"];

type Ctx = CanvasRenderingContext2D;

interface Outline {
  /** Traces the closed outline on the 24 unit square. */
  trace(ctx: Ctx): void;
  /** How far the fill is rounded outward past the traced line. */
  round: number;
  /** The middle of the body, where the colour's cut-out sits. */
  cx: number;
  cy: number;
}

function points(ctx: Ctx, cx: number, cy: number, n: number, outer: number, inner: number, turn: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = turn + (i * Math.PI) / n;
    if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

const OUTLINES: Record<StarShapeName, Outline> = {
  // Four points, set on the diagonals.
  spark: {
    trace: (ctx) => points(ctx, 12, 12, 4, 12.4, 4.6, Math.PI / 4),
    round: 2.4,
    cx: 12,
    cy: 12,
  },
  // Five points, one up.
  star: {
    trace: (ctx) => points(ctx, 12, 12.7, 5, 9.3, 5, -Math.PI / 2),
    round: 2.4,
    cx: 12,
    cy: 12.7,
  },
  // A round head low on the right, its tail drawn out to the upper left.
  comet: {
    trace(ctx) {
      const r = 5.6;
      const k = r * Math.SQRT1_2;
      ctx.beginPath();
      ctx.moveTo(4.4, 4.4);
      ctx.lineTo(14.6 + k, 14.6 - k);
      ctx.arc(14.6, 14.6, r, -Math.PI / 4, (Math.PI * 3) / 4);
      ctx.closePath();
    },
    round: 2.4,
    cx: 14.6,
    cy: 14.6,
  },
};

/** Each colour's cut-out, drawn round the middle of the body. */
const CUTS: Record<StarCutName, (ctx: Ctx, x: number, y: number) => void> = {
  // A round hole.
  dot(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  },
  // A band across, cutting the star in two.
  band(ctx, _x, y) {
    ctx.fillRect(0, y - 1.4, 24, 2.8);
  },
  // A cut down the middle, from top to bottom.
  split(ctx, x) {
    ctx.fillRect(x - 1.4, 0, 2.8, 24);
  },
};

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
  const o = OUTLINES[look.shape];
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so neighbours never touch.
  const k = (s * (20 / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(look.color);
  ctx.strokeStyle = css(look.color);
  ctx.lineJoin = "round";
  if (look.hollow) {
    o.trace(ctx);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    if (look.cut && look.covered) {
      ctx.globalCompositeOperation = "destination-out";
      CUTS[look.cut](ctx, o.cx, o.cy);
    } else if (look.cut) {
      ctx.save();
      o.trace(ctx);
      ctx.clip();
      CUTS[look.cut](ctx, o.cx, o.cy);
      ctx.restore();
    }
  } else {
    o.trace(ctx);
    ctx.lineWidth = o.round;
    ctx.fill();
    ctx.stroke();
    if (look.cut) {
      // Cut out of what is drawn, so whatever is behind the star shows through.
      ctx.globalCompositeOperation = "destination-out";
      CUTS[look.cut](ctx, o.cx, o.cy);
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
  const key = `${look.shape}:${look.color}:${look.cut}:${look.hollow ? (look.covered ? 2 : 1) : 0}:${px}`;
  let url = urlCache.get(key);
  if (!url) {
    url = starCanvas(px, look, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}

export type { PieceColor };
