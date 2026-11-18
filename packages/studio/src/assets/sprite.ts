import { paintDrawing } from "@openseas/boards";
import { css, type Token } from "@openseas/boards/look";
import type { Drawing, Layer, LayerKind } from "@openseas/protocol";

/**
 * The sprite editor's geometry (ADR 0065): where a layer's handles are, what dragging one does to
 * it, and what a drawing looks like on a raster, for the checks a layer list cannot make (does it
 * fit the square, is it told from its neighbours). Pure but for the raster, which needs a canvas.
 */

/** A handle on the 24 unit square: `id` says which number of the layer it moves. */
export interface Handle {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** The handle that moves the whole layer. */
  readonly body?: boolean;
}

const round = (v: number, step: number): number => Math.round(v / step) * step;
/** Snapped to `step` and clear of float noise. */
export const snap = (v: number, step: number): number => Number(round(v, step).toFixed(3));

const RAD = Math.PI / 180;
/** A point turned `deg` about the square's centre: where a turned layer's handle is drawn. */
export function turn(x: number, y: number, deg: number): [number, number] {
  if (!deg) return [x, y];
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [12 + (x - 12) * c - (y - 12) * s, 12 + (x - 12) * s + (y - 12) * c];
}

function pairs(points: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push([points[i]!, points[i + 1]!]);
  return out;
}

/** A layer's handles, unturned: the body in the middle of it, and one a number that can be dragged. */
function rawHandles(layer: Layer): Handle[] {
  switch (layer.kind) {
    case "rect":
      return [
        { id: "body", x: layer.x + layer.w / 2, y: layer.y + layer.h / 2, body: true },
        { id: "size", x: layer.x + layer.w, y: layer.y + layer.h },
      ];
    case "disc":
      return [
        { id: "body", x: layer.x, y: layer.y, body: true },
        { id: "r", x: layer.x + layer.r, y: layer.y },
      ];
    case "poly": {
      const pts = pairs(layer.points);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return [{ id: "body", x: cx, y: cy, body: true }, ...pts.map(([x, y], i) => ({ id: `p${i}`, x, y }))];
    }
    case "bar":
      return [
        { id: "body", x: (layer.x0 + layer.x1) / 2, y: (layer.y0 + layer.y1) / 2, body: true },
        { id: "a", x: layer.x0, y: layer.y0 },
        { id: "b", x: layer.x1, y: layer.y1 },
      ];
    case "arc":
      return [
        { id: "body", x: layer.x, y: layer.y, body: true },
        { id: "r", x: layer.x + layer.r * Math.cos(((layer.from + layer.to) / 2) * RAD), y: layer.y + layer.r * Math.sin(((layer.from + layer.to) / 2) * RAD) },
      ];
    case "path": {
      const cx = layer.steps.reduce((a, s) => a + s.x, 0) / layer.steps.length;
      const cy = layer.steps.reduce((a, s) => a + s.y, 0) / layer.steps.length;
      return [{ id: "body", x: cx, y: cy, body: true }, ...layer.steps.map((s, i) => ({ id: `s${i}`, x: s.x, y: s.y }))];
    }
  }
}

/** A layer's handles where they are drawn: turned as the layer is. The copies are not handled; the first is. */
export function handles(layer: Layer): Handle[] {
  return rawHandles(layer).map((h) => {
    const [x, y] = turn(h.x, h.y, layer.turn ?? 0);
    return { ...h, x, y };
  });
}

/** A layer moved by (`dx`, `dy`) on its own unturned axes. */
export function moved(layer: Layer, dx: number, dy: number): Layer {
  switch (layer.kind) {
    case "rect":
    case "disc":
    case "arc":
      return { ...layer, x: layer.x + dx, y: layer.y + dy };
    case "poly":
      return { ...layer, points: layer.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
    case "bar":
      return { ...layer, x0: layer.x0 + dx, y0: layer.y0 + dy, x1: layer.x1 + dx, y1: layer.y1 + dy };
    case "path":
      return { ...layer, steps: layer.steps.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) };
  }
}

const tidy = (v: number): number => Number(v.toFixed(3));

/**
 * A layer with one handle dragged to (`x`, `y`) on the square, as the pointer is: undone from the
 * layer's turn first, so a turned layer's handle follows the pointer. `start` is the layer as the
 * drag began and (`ox`, `oy`) where the drag began, for the body, which moves by the difference.
 */
export function dragged(start: Layer, id: string, x: number, y: number, ox: number, oy: number): Layer {
  const deg = start.turn ?? 0;
  const [ux, uy] = turn(x, y, -deg);
  if (id === "body") {
    const [sx, sy] = turn(ox, oy, -deg);
    return moved(start, tidy(ux - sx), tidy(uy - sy));
  }
  switch (start.kind) {
    case "rect":
      return { ...start, w: tidy(Math.max(0.5, ux - start.x)), h: tidy(Math.max(0.5, uy - start.y)) };
    case "disc":
      return { ...start, r: tidy(Math.max(0.5, Math.hypot(ux - start.x, uy - start.y))) };
    case "arc":
      return { ...start, r: tidy(Math.max(0.5, Math.hypot(ux - start.x, uy - start.y))) };
    case "poly": {
      const i = Number(id.slice(1));
      const points = start.points.slice();
      points[i * 2] = tidy(ux);
      points[i * 2 + 1] = tidy(uy);
      return { ...start, points };
    }
    case "bar":
      return id === "a" ? { ...start, x0: tidy(ux), y0: tidy(uy) } : { ...start, x1: tidy(ux), y1: tidy(uy) };
    case "path": {
      const i = Number(id.slice(1));
      return { ...start, steps: start.steps.map((s, k) => (k === i ? { ...s, x: tidy(ux), y: tidy(uy) } : s)) };
    }
  }
}

/** A new layer of a kind, sitting in the middle of the square. */
export function fresh(kind: LayerKind): Layer {
  switch (kind) {
    case "rect":
      return { kind, x: 7, y: 7, w: 10, h: 10, r: 2 };
    case "disc":
      return { kind, x: 12, y: 12, r: 5 };
    case "poly":
      return { kind, points: [12, 5, 19, 17, 5, 17], round: 2 };
    case "bar":
      return { kind, x0: 7, y0: 12, x1: 17, y1: 12, width: 3 };
    case "arc":
      return { kind, x: 12, y: 12, r: 6, from: 180, to: 360, width: 3, cap: true };
    case "path":
      return { kind, steps: [{ x: 6, y: 16 }, { x: 12, y: 8 }, { x: 18, y: 16 }], width: 3, cap: true };
  }
}

/** The numbers of a layer the inspector lists, in order: every plain number its kind has. */
export const NUMBER_FIELDS: Readonly<Record<LayerKind, readonly string[]>> = {
  rect: ["x", "y", "w", "h", "r"],
  disc: ["x", "y", "r"],
  poly: ["round"],
  bar: ["x0", "y0", "x1", "y1", "width"],
  arc: ["x", "y", "r", "from", "to", "width"],
  path: ["width"],
};

/**
 * Paints a drawing as the studio shows it, `px` pixels square: in its colour on nothing, or, for a
 * detail, cut out of a tile so the hole is what is seen.
 */
export function paintPreview(ctx: CanvasRenderingContext2D, drawing: Drawing, px: number, color: Token, fit = 1): void {
  ctx.save();
  const k = (px * fit) / 24;
  ctx.translate(px / 2 - 12 * k, px / 2 - 12 * k);
  ctx.scale(k, k);
  if (drawing.detail) {
    ctx.fillStyle = css("dim");
    ctx.beginPath();
    ctx.roundRect(1, 1, 22, 22, 3);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
  }
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  paintDrawing(ctx, drawing);
  ctx.restore();
}

/** The raster the checks read: a drawing's coverage, `RES` pixels a side, one byte a pixel. */
const RES = 48;
export function mask(drawing: Drawing): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = RES;
  canvas.height = RES;
  const ctx = canvas.getContext("2d");
  const out = new Uint8Array(RES * RES);
  if (!ctx) return out;
  ctx.scale(RES / 24, RES / 24);
  ctx.fillStyle = "white";
  ctx.strokeStyle = "white";
  paintDrawing(ctx, { ...drawing, detail: false });
  const data = ctx.getImageData(0, 0, RES, RES).data;
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3]! > 127 ? 1 : 0;
  return out;
}

/** The box a drawing covers, in units of the square, or null for one that covers nothing. */
export function extent(m: Uint8Array): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = RES;
  let y0 = RES;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < RES; y++)
    for (let x = 0; x < RES; x++)
      if (m[y * RES + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  const u = 24 / RES;
  return { x0: x0 * u, y0: y0 * u, x1: (x1 + 1) * u, y1: (y1 + 1) * u };
}

/** How alike two silhouettes are: the share of what either covers that both cover. */
export function overlap(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either === 0 ? 1 : both / either;
}

/** Two silhouettes this alike read as one kind with the colour taken away (docs/BRAND.md section 3). */
export const ALIKE = 0.9;
