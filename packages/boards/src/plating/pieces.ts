import type { Brush } from "@openseas/engine";
import type { PieceColor, PlatingPieceStyle } from "@openseas/content";
import { css } from "../look/tokens.js";

/**
 * Plating's plates, drawn in code (docs/BRAND.md section 3, ADR 0062). A plate is one solid slab
 * in its metal's palette colour, cut to the footprint the rules give it, so its outline cannot tell
 * metals apart. Each cell instead carries the metal's one cut-out, through which whatever is under
 * the plate shows: a slot, a lozenge, a window or a bone. The cut-out lies along the plate's
 * brushing, so the same detail says both things the player reads off a plate.
 *
 * Painted with Canvas 2D so the board, which bakes each plate to a texture, and the page's legend
 * share one drawing.
 */
export type PlateCut = PlatingPieceStyle["cut"];
export type PlateCells = ReadonlyArray<readonly [number, number]>;

type Pen = CanvasRenderingContext2D;

/** On the pieces' 24 unit square: the ground left round a plate, and its corner. */
const GAP = 1.5 / 24;
const ROUND = 4 / 24;
const HALF = Math.PI / 2;

/**
 * One cell of a plate as a closed path. A side with a neighbour in the same plate runs to the
 * cell's edge so the cells join; a side without one stops short, so two plates never touch. An
 * outside corner is rounded, and an inside corner is eased by the same gap.
 */
function traceCell(pen: Pen, x: number, y: number, m: number, has: (dx: number, dy: number) => boolean): void {
  const g = m * GAP;
  const r = m * ROUND;
  // Clockwise from the top left. `sx`, `sy` point out of the cell at each corner.
  const corners = [
    [x, y, -1, -1],
    [x + m, y, 1, -1],
    [x + m, y + m, 1, 1],
    [x, y + m, -1, 1],
  ] as const;
  corners.forEach(([px, py, sx, sy], k) => {
    const a = has(sx, 0);
    const b = has(0, sy);
    const cx = px - (a ? 0 : sx * g);
    const cy = py - (b ? 0 : sy * g);
    const to = (qx: number, qy: number): unknown => (k === 0 ? pen.moveTo(qx, qy) : pen.lineTo(qx, qy));
    if (!a && !b) {
      const start = Math.PI + k * HALF;
      const ox = cx - sx * r;
      const oy = cy - sy * r;
      to(ox + r * Math.cos(start), oy + r * Math.sin(start));
      pen.arc(ox, oy, r, start, start + HALF);
    } else if (a && b && !has(sx, sy)) {
      const start = HALF + k * HALF;
      to(px + g * Math.cos(start), py + g * Math.sin(start));
      pen.arc(px, py, g, start, start - HALF, true);
    } else to(cx, cy);
  });
  pen.closePath();
}

/** A cut-out's outline in units from the cell's centre: `a` along the brushing, `b` across it. */
function cutOutline(cut: PlateCut): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const sweep = (ca: number, cb: number, r: number, from: number, to: number): void => {
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      pts.push([ca + r * Math.cos(t), cb + r * Math.sin(t)]);
    }
  };
  switch (cut) {
    // A thin slot with round ends.
    case "slot":
      sweep(4.6, 0, 1.9, -HALF, HALF);
      sweep(-4.6, 0, 1.9, HALF, 3 * HALF);
      break;
    // A stretched diamond.
    case "lozenge":
      pts.push([-7.6, 0], [0, -4.4], [7.6, 0], [0, 4.4]);
      break;
    // A broad opening with barely eased corners.
    case "window":
      sweep(4.2, 2.6, 1.2, 0, HALF);
      sweep(-4.2, 2.6, 1.2, HALF, 2 * HALF);
      sweep(-4.2, -2.6, 1.2, 2 * HALF, 3 * HALF);
      sweep(4.2, -2.6, 1.2, 3 * HALF, 4 * HALF);
      break;
    // Two holes joined by a neck.
    case "bone": {
      const neck = Math.asin(1.5 / 3.2);
      sweep(4.3, 0, 3.2, -(Math.PI - neck), Math.PI - neck);
      sweep(-4.3, 0, 3.2, neck, 2 * Math.PI - neck);
      break;
    }
  }
  return pts;
}

const OUTLINES = new Map<PlateCut, Array<[number, number]>>();

function traceCut(pen: Pen, x: number, y: number, m: number, cut: PlateCut, brush: Brush): void {
  let pts = OUTLINES.get(cut);
  if (!pts) OUTLINES.set(cut, (pts = cutOutline(cut)));
  const u = m / 24;
  const cx = x + m / 2;
  const cy = y + m / 2;
  pts.forEach(([a, b], i) => {
    const px = cx + (brush === "h" ? a : b) * u;
    const py = cy + (brush === "h" ? b : a) * u;
    if (i === 0) pen.moveTo(px, py);
    else pen.lineTo(px, py);
  });
  pen.closePath();
}

function neighbours(cells: PlateCells): (x: number, y: number) => boolean {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  return (x, y) => set.has(`${x},${y}`);
}

/**
 * Paints a plate: `cells` are its cells as offsets from (`x0`, `y0`), each `m` pixels square.
 * `cut` null paints a blank plate.
 */
export function paintPlate(ctx: CanvasRenderingContext2D, cells: PlateCells, x0: number, y0: number, m: number, cut: PlateCut | null, brush: Brush, color: PieceColor): void {
  const has = neighbours(cells);
  ctx.save();
  ctx.fillStyle = css(color);
  // One path for the whole plate, so no seam shows where two cells meet.
  ctx.beginPath();
  for (const [dx, dy] of cells) traceCell(ctx, x0 + dx * m, y0 + dy * m, m, (ax, ay) => has(dx + ax, dy + ay));
  ctx.fill();
  if (cut) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    for (const [dx, dy] of cells) traceCut(ctx, x0 + dx * m, y0 + dy * m, m, cut, brush);
    ctx.fill();
  }
  ctx.restore();
}

/** The box a plate's cells fill, in cells. A plate clipped by the hull's edge need not start at its origin. */
export function plateBox(cells: PlateCells): { x: number; y: number; w: number; h: number } {
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

/** A plate as its own canvas, exactly its box at `m` CSS pixels a cell and `resolution` device pixels per pixel. */
export function plateCanvas(cells: PlateCells, m: number, cut: PlateCut | null, brush: Brush, color: PieceColor, resolution: number): HTMLCanvasElement {
  const box = plateBox(cells);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(box.w * m * resolution);
  canvas.height = Math.ceil(box.h * m * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintPlate(ctx, cells, -box.x * m, -box.y * m, m, cut, brush, color);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a plate centred in a square of `px` pixels, for the page's legend; cached because legends re-render often. */
export function plateDataUrl(cells: PlateCells, cut: PlateCut | null, brush: Brush, color: PieceColor, px: number): string {
  const key = `${JSON.stringify(cells)}:${cut}:${brush}:${color}:${px}`;
  let url = urlCache.get(key);
  if (!url) {
    const resolution = 3;
    const canvas = document.createElement("canvas");
    canvas.width = px * resolution;
    canvas.height = px * resolution;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(resolution, resolution);
      const box = plateBox(cells);
      const m = px / Math.max(box.w, box.h);
      paintPlate(ctx, cells, (px - box.w * m) / 2 - box.x * m, (px - box.h * m) / 2 - box.y * m, m, cut, brush, color);
    }
    url = canvas.toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
