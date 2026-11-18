import type { Brush } from "@openseas/engine";
import type { PieceColor, PlatingPieceStyle } from "@openseas/content";
import { css } from "../look/tokens.js";
import { drawingOf, pieceOverrideRevision } from "../look/pieces.js";
import { paintDrawing } from "../kit/drawing.js";

/**
 * Plating's plates, drawn in code (docs/BRAND.md section 3, ADR 0062). A plate is one solid slab
 * in its metal's palette colour, cut to the footprint the rules give it, so its outline cannot tell
 * metals apart. Each cell instead carries the metal's one cut-out, through which whatever is under
 * the plate shows: a slot, a lozenge, a window or a bone. The cut-out lies along the plate's
 * brushing, so the same detail says both things the player reads off a plate.
 *
 * The plate's body is its footprint, so code traces it; each cut-out is a drawing in
 * `data/pieces/plating.json` (ADR 0065) that code stamps into every cell.
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

/**
 * Stamps a cell's cut-out: the metal's drawing, `cut-<metal>` in `data/pieces/plating.json`, is
 * drawn along a horizontal brushing on the 24 unit square, so the cell scales it to its size and
 * turns it a quarter for a vertical one. The caller has set the context to cut.
 */
function stampCut(pen: Pen, x: number, y: number, m: number, cut: PlateCut, brush: Brush): void {
  pen.save();
  pen.translate(x, y);
  pen.scale(m / 24, m / 24);
  if (brush === "v") {
    pen.translate(12, 12);
    pen.rotate(HALF);
    pen.translate(-12, -12);
  }
  paintDrawing(pen, drawingOf("plating", `cut-${cut}`));
  pen.restore();
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
    ctx.strokeStyle = ctx.fillStyle;
    for (const [dx, dy] of cells) stampCut(ctx, x0 + dx * m, y0 + dy * m, m, cut, brush);
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
  const key = `${JSON.stringify(cells)}:${cut}:${brush}:${color}:${px}:${pieceOverrideRevision()}`;
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
