import type { EnginesPieceStyle, PieceColor } from "@openseas/content";
import { css } from "../look/tokens.js";

/**
 * Engines' pellets, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062): each kind is
 * one solid silhouette in one palette colour, on a 24 unit square, with at most one detail cut out
 * so the ground shows through. Nothing else tells two kinds apart, so no two outlines may be alike.
 * A kind's hollow target is the same outline drawn a little larger, as a line, so the pellet sits
 * inside it. Painted with Canvas 2D so the board and the page's legend share one drawing.
 */
export type PelletShape = EnginesPieceStyle["shape"];

/**
 * How a pellet is drawn: `solid` is the piece, `target` the hollow an injector wants it in, and
 * `ghost` the thin outline, the piece's own size, that shows where the pair in hand would land.
 */
export type PelletForm = "solid" | "target" | "ghost";

type Ctx = CanvasRenderingContext2D;

/** Every outline is traced a unit inside its silhouette and stroked a unit out, which rounds its corners. */
const SOFT = 2;
/** A target's line runs from this far outside the trace to this far, so the pellet sits inside it with ground between. */
const TARGET_INNER = 2.5;
const TARGET_OUTER = 4.3;

function polygon(ctx: Ctx, pts: readonly number[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i]!, pts[i + 1]!);
    else ctx.lineTo(pts[i]!, pts[i + 1]!);
  }
  ctx.closePath();
}

/** A five-pointed star about (12, 12.8), which sits it evenly in the square. */
const STAR: readonly number[] = (() => {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 9.6 : 5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(12 + r * Math.cos(a), 12.8 + r * Math.sin(a));
  }
  return pts;
})();

/** Each kind's outline as one closed path. */
const TRACE: Record<PelletShape, (ctx: Ctx) => void> = {
  // Plasma: a flame, a drop with its point up.
  flame(ctx) {
    const lean = Math.acos(6.5 / 11);
    ctx.beginPath();
    ctx.moveTo(12, 3);
    ctx.arc(12, 14, 6.5, -Math.PI / 2 + lean, (3 * Math.PI) / 2 - lean);
    ctx.closePath();
  },
  // Ion: a charge, a plus.
  cross(ctx) {
    polygon(ctx, [9.2, 3, 14.8, 3, 14.8, 9.2, 21, 9.2, 21, 14.8, 14.8, 14.8, 14.8, 21, 9.2, 21, 9.2, 14.8, 3, 14.8, 3, 9.2, 9.2, 9.2]);
  },
  // Fusion: the ring of a torus.
  ring(ctx) {
    ctx.beginPath();
    ctx.arc(12, 12, 9, 0, Math.PI * 2);
    ctx.closePath();
  },
  // Nova: a star.
  star(ctx) {
    polygon(ctx, STAR);
  },
};

/** The one detail cut out of a solid pellet, where a kind has one. */
const CUT: Partial<Record<PelletShape, (ctx: Ctx) => void>> = {
  ring(ctx) {
    ctx.beginPath();
    ctx.arc(12, 12, 3.6, 0, Math.PI * 2);
    ctx.fill();
  },
};

/** Paints one pellet, or its target or ghost, into a cell of size `s` whose top-left corner is the context origin. */
export function paintPellet(ctx: Ctx, s: number, shape: PelletShape, color: PieceColor | "amber", form: PelletForm = "solid"): void {
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so neighbours never touch and a target has room round its pellet.
  const k = (s * (20 / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  ctx.lineJoin = "round";
  TRACE[shape](ctx);
  if (form === "solid") {
    ctx.lineWidth = SOFT;
    ctx.fill();
    ctx.stroke();
    const detail = CUT[shape];
    if (detail) {
      ctx.globalCompositeOperation = "destination-out";
      detail(ctx);
    }
  } else if (form === "ghost") {
    ctx.lineWidth = SOFT;
    ctx.stroke();
  } else {
    // The outline pushed outward: a wide stroke with the middle of it taken back out.
    ctx.lineWidth = TARGET_OUTER * 2;
    ctx.stroke();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = TARGET_INNER * 2;
    ctx.fill();
    ctx.stroke();
  }
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
  const key = `${shape}:${color}:${px}:${form}`;
  let url = urlCache.get(key);
  if (!url) {
    url = pelletCanvas(px, shape, color, 3, form).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
