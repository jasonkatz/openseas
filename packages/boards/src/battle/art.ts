import { drawSprite } from "../sprites/atlas.js";
import type { ParsedBoard } from "@openseas/engine";
import type { MarkName } from "@openseas/content";
import { battleCellAt } from "@openseas/engine";
import { paintPart } from "../parts.js";
import { paintMarkShape } from "../marks/canvas.js";

/**
 * Space Battle's art, painted with Canvas 2D and baked to textures (as Gunnery's pieces and
 * Cooling's tiles are): deep space with faint nebulae and stars under the chart's grid, asteroids
 * with a little drifting debris, solar currents as streamlines, gravity wells as spirals, and two
 * skiffs seen from above. The sprites draw the asteroids, wells and skiffs; the procedural pieces
 * below are their fallback. The captain's skiff is a cream starfighter with a rounded nose and two
 * side pods; the raider is rust red with a forked prow and one tank slung to the side, so the two
 * read apart by silhouette as well as color (CLAUDE.md rule 6).
 */

export type ShipSide = 0 | 1;

const css = (c: number, alpha = 1): string => `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${alpha})`;

/** Small seeded generator so rocks and ripples land the same way on every bake. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasFor(w: number, h: number, resolution: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * resolution));
  canvas.height = Math.max(1, Math.ceil(h * resolution));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.scale(resolution, resolution);
  return { canvas, ctx };
}

export const SPACE = {
  deep: 0x05080f,
  mid: 0x0b1428,
  shallow: 0x121e3c,
  light: 0x8fd0ee,
  foam: 0xe6f6ff,
  grid: 0x7f9fdc,
};

// ---- the void

/** The whole board: space, nebulae, stars, the grid, and every asteroid and current, at `cell` pixels a cell. */
export function paintSpace(board: ParsedBoard, cell: number, resolution: number): HTMLCanvasElement {
  const W = board.width * cell;
  const H = board.height * cell;
  const { canvas, ctx } = canvasFor(W, H, resolution);
  const rnd = seeded(board.width * 131 + board.height * 17);

  // Deep space, a little lighter through the middle.
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, css(SPACE.mid));
  base.addColorStop(0.5, css(SPACE.shallow));
  base.addColorStop(1, css(SPACE.deep));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // Two or three soft nebulae in the sprites' violet and cyan.
  for (const [r, g, b] of [
    [120, 80, 230],
    [60, 200, 230],
    [150, 70, 200],
  ] as const) {
    const x = rnd() * W;
    const y = rnd() * H;
    const rad = Math.max(W, H) * (0.3 + rnd() * 0.25);
    const neb = ctx.createRadialGradient(x, y, 0, x, y, rad);
    neb.addColorStop(0, `rgba(${r},${g},${b},0.16)`);
    neb.addColorStop(0.6, `rgba(${r},${g},${b},0.05)`);
    neb.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);
  }
  // Stars: many faint pinpricks and a few bright ones with a soft halo.
  for (let i = 0; i < Math.ceil((W * H) / (cell * cell)) * 3; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const bright = rnd() < 0.07;
    if (bright) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.14);
      halo.addColorStop(0, "rgba(220,235,255,0.35)");
      halo.addColorStop(1, "rgba(220,235,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(x - cell * 0.14, y - cell * 0.14, cell * 0.28, cell * 0.28);
    }
    ctx.fillStyle = `rgba(225,235,255,${bright ? 0.9 : 0.15 + rnd() * 0.35})`;
    ctx.beginPath();
    ctx.arc(x, y, bright ? Math.max(0.9, cell * 0.03) : Math.max(0.5, cell * 0.014), 0, Math.PI * 2);
    ctx.fill();
  }

  // The chart's grid: thin lines and a pin at every crossing.
  ctx.strokeStyle = css(SPACE.grid, 0.11);
  ctx.lineWidth = 1;
  for (let x = 0; x <= board.width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cell, 0);
    ctx.lineTo(x * cell, H);
    ctx.stroke();
  }
  for (let y = 0; y <= board.height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cell);
    ctx.lineTo(W, y * cell);
    ctx.stroke();
  }
  ctx.fillStyle = css(SPACE.grid, 0.22);
  for (let x = 1; x < board.width; x++) {
    for (let y = 1; y < board.height; y++) {
      ctx.beginPath();
      ctx.arc(x * cell, y * cell, Math.max(0.8, cell * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Debris around the asteroids first, so the asteroids sit on it.
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (battleCellAt(board, x, y)?.kind !== "asteroid") continue;
      paintSurf(ctx, board, x, y, cell, rnd);
    }
  }
  // A current flows as one stream along each run of cells that share a heading, not a stamp a cell.
  const seen = new Set<number>();
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const c = battleCellAt(board, x, y);
      if (!c || c.kind !== "current" || seen.has(y * board.width + x)) continue;
      const along = c.heading === 1 || c.heading === 3;
      const run: Array<[number, number]> = [];
      let [rx, ry] = [x, y];
      while (true) {
        const cell = battleCellAt(board, rx, ry);
        if (!cell || cell.kind !== "current" || cell.heading !== c.heading || seen.has(ry * board.width + rx)) break;
        seen.add(ry * board.width + rx);
        run.push([rx, ry]);
        if (along) rx += 1;
        else ry += 1;
      }
      paintGust(ctx, run, c.heading, cell, rnd);
    }
  }
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (battleCellAt(board, x, y)?.kind === "asteroid") paintAsteroid(ctx, (x + 0.5) * cell, (y + 0.5) * cell, cell, seeded(x * 977 + y * 31 + 7));
    }
  }

  // Space darkens toward the edges of the chart.
  for (const [x0, y0, x1, y1] of [
    [0, 0, 0, cell * 1.5],
    [0, H, 0, H - cell * 1.5],
    [0, 0, cell * 1.5, 0],
    [W, 0, W - cell * 1.5, 0],
  ] as const) {
    const edge = ctx.createLinearGradient(x0, y0, x1, y1);
    edge.addColorStop(0, "rgba(3,10,20,0.4)");
    edge.addColorStop(1, "rgba(3,10,20,0)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }
  return canvas;
}

function paintSurf(ctx: CanvasRenderingContext2D, board: ParsedBoard, x: number, y: number, cell: number, rnd: () => number): void {
  const cx = (x + 0.5) * cell;
  const cy = (y + 0.5) * cell;
  // A few specks of drifting debris, only on sides that face open space.
  const open = (dx: number, dy: number): boolean => {
    const c = battleCellAt(board, x + dx, y + dy);
    return c !== null && c.kind !== "asteroid";
  };
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    if (!open(dx, dy)) continue;
    const ang = Math.atan2(dy, dx);
    for (let k = 0; k < 3; k++) {
      const a = ang - 0.7 + rnd() * 1.4;
      const r = cell * (0.5 + rnd() * 0.18);
      ctx.fillStyle = `rgba(170,175,185,${0.25 + rnd() * 0.3})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(0.6, cell * (0.015 + rnd() * 0.025)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintAsteroid(ctx: CanvasRenderingContext2D, cx: number, cy: number, cell: number, rnd: () => number): void {
  if (drawSprite(ctx, "battle", "asteroid", cx - cell / 2, cy - cell / 2, cell, cell)) return;
  // Without the atlas: the vector asteroid, turned at random so a field of them never repeats.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rnd() * Math.PI * 2);
  paintPart(ctx, "asteroid", 0, 0, cell * 0.95);
  ctx.restore();
}

/**
 * A gust along a run of wind cells: a few tapered strands that thicken and brighten toward the
 * head, swaying a little, with one soft chevron at the head of the main strand to settle which
 * way it blows. A run of four cells is one current, not four stamps.
 */
function paintGust(ctx: CanvasRenderingContext2D, run: ReadonlyArray<readonly [number, number]>, heading: number, cell: number, rnd: () => number): void {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const dx = [0, 1, 0, -1][heading]!;
  const dy = [-1, 0, 1, 0][heading]!;
  // The run's cells in blowing order: the head is downwind.
  const forward = heading === 1 || heading === 2;
  const head = forward ? last : first;
  const tail = forward ? first : last;
  // A short run overhangs its cells more and blows thicker, so one cell of wind still reads.
  const over = run.length === 1 ? 0.5 : run.length === 2 ? 0.42 : 0.35;
  const bold = run.length <= 2 ? 1.5 : 1.15;
  const tx = (tail[0] + 0.5) * cell - dx * cell * over;
  const ty = (tail[1] + 0.5) * cell - dy * cell * over;
  const hx = (head[0] + 0.5) * cell + dx * cell * over;
  const hy = (head[1] + 0.5) * cell + dy * cell * over;
  const L = Math.hypot(hx - tx, hy - ty);
  const px = -dy;
  const py = dx;
  // A faint wash over the run, brighter downwind.
  const wash = ctx.createLinearGradient(tx, ty, hx, hy);
  wash.addColorStop(0, "rgba(120,220,255,0.02)");
  wash.addColorStop(1, "rgba(255,214,120,0.10)");
  ctx.fillStyle = wash;
  for (const [cx, cy] of run) ctx.fillRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
  const strands = [-0.24, 0, 0.24];
  for (const k of strands) {
    const offset = k * cell + (rnd() - 0.5) * cell * 0.08;
    const amp = cell * (0.04 + rnd() * 0.04);
    const freq = 1 + Math.round(L / (cell * 2.2));
    const phase = rnd() * Math.PI * 2;
    const main = k === 0;
    const start = main ? 0 : 0.08 + rnd() * 0.12;
    const end = main ? 1 : 0.8 + rnd() * 0.12;
    const steps = Math.max(12, Math.round(L / 3));
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const t = start + ((end - start) * i) / steps;
      const u = (t - start) / (end - start);
      const sway = Math.sin(phase + u * Math.PI * freq) * amp;
      const cx = tx + (hx - tx) * t + px * (offset + sway);
      const cy = ty + (hy - ty) * t + py * (offset + sway);
      // Thin at the tail, full near the head, rounding off at the tip.
      const w = bold * (cell * (main ? 0.02 : 0.015) + cell * (main ? 0.06 : 0.04) * Math.sin(Math.min(1, u * 1.12) * Math.PI * 0.5) * (u > 0.92 ? (1 - u) / 0.08 : 1));
      left.push([cx + px * w, cy + py * w]);
      right.push([cx - px * w, cy - py * w]);
    }
    const path = new Path2D();
    left.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i]![0], right[i]![1]);
    path.closePath();
    const ink = ctx.createLinearGradient(tx, ty, hx, hy);
    ink.addColorStop(0, "rgba(120,220,255,0)");
    ink.addColorStop(0.5, `rgba(150,226,255,${main ? 0.6 : 0.4})`);
    ink.addColorStop(1, `rgba(255,232,160,${main ? 0.95 : 0.7})`);
    ctx.fillStyle = ink;
    ctx.fill(path);
  }
  // One chevron at the head of the current.
  ctx.strokeStyle = "rgba(255,236,180,0.9)";
  ctx.lineWidth = Math.max(1.2, cell * 0.065 * bold);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const ax = hx - dx * cell * 0.08;
  const ay = hy - dy * cell * 0.08;
  const back = cell * 0.22 * bold;
  ctx.beginPath();
  ctx.moveTo(ax - dx * back + px * back * 0.8, ay - dy * back + py * back * 0.8);
  ctx.lineTo(ax, ay);
  ctx.lineTo(ax - dx * back - px * back * 0.8, ay - dy * back - py * back * 0.8);
  ctx.stroke();
}

// ---- gravity wells

export function paintWell(size: number, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  if (!drawSprite(ctx, "battle", "well", 0, 0, size, size)) paintPart(ctx, "well", size / 2, size / 2, size);
  return canvas;
}

// ---- the skiffs: the sprites, or vector starfighters without the atlas

/** A skiff seen from above, bow up, in a square of `size`. The hull is about 0.9 of it long. */
export function paintShip(size: number, who: ShipSide, showMarks: boolean, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  if (!drawSprite(ctx, "battle", `ship${who}`, 0, 0, size, size)) paintPart(ctx, who === 0 ? "fighter" : "raider", size / 2, size / 2, size);
  if (showMarks) {
    // Yours wears a circle and the raider a triangle, in white over a dark edge, so they read apart without color.
    const mark: MarkName = who === 0 ? "circle" : "triangle";
    paintMarkShape(ctx, mark, size / 2, size * 0.6, size * 0.08, { stroke: "#0b1526", lineWidth: Math.max(3, size * 0.06) });
    paintMarkShape(ctx, mark, size / 2, size * 0.6, size * 0.08, { stroke: "#ffffff", lineWidth: Math.max(1.2, size * 0.025) });
  }
  return canvas;
}

// ---- small things

export function paintBall(size: number, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  if (!drawSprite(ctx, "battle", "ball", 0, 0, size, size)) paintPart(ctx, "round", size / 2, size / 2, size, 0x8a8f99);
  return canvas;
}

/** A turret seen from above for the plot strip's gun toggles, with a lamp that lights when armed. */
export function paintTurret(size: number, lit: boolean, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  const c = size / 2;
  const line = Math.max(0.8, size * 0.035);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0b1526";
  ctx.lineWidth = line;
  // A cream turret housing on a gunmetal base, barrel up, like the gun deck's turrets.
  ctx.fillStyle = "#3c4555";
  ctx.beginPath();
  ctx.roundRect(c - size * 0.26, c + size * 0.12, size * 0.52, size * 0.14, size * 0.04);
  ctx.fill();
  ctx.stroke();
  const barrel = ctx.createLinearGradient(c - size * 0.07, 0, c + size * 0.07, 0);
  barrel.addColorStop(0, "#2a2e36");
  barrel.addColorStop(0.45, "#8a93a0");
  barrel.addColorStop(1, "#22252c");
  ctx.fillStyle = barrel;
  ctx.beginPath();
  ctx.roundRect(c - size * 0.065, c - size * 0.4, size * 0.13, size * 0.36, size * 0.03);
  ctx.fill();
  ctx.stroke();
  const housing = ctx.createLinearGradient(0, c - size * 0.12, 0, c + size * 0.14);
  housing.addColorStop(0, "#efe5c8");
  housing.addColorStop(1, "#b9ad8e");
  ctx.fillStyle = housing;
  ctx.beginPath();
  ctx.roundRect(c - size * 0.2, c - size * 0.12, size * 0.4, size * 0.26, size * 0.06);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e8892c";
  ctx.fillRect(c - size * 0.2 + line, c - size * 0.02, size * 0.4 - line * 2, size * 0.045);
  // The status light: lit once the gun is armed.
  ctx.fillStyle = lit ? "#7dff8a" : "#2a2f3a";
  if (lit) {
    ctx.shadowColor = "#7dff8a";
    ctx.shadowBlur = size * 0.12;
  }
  ctx.beginPath();
  ctx.roundRect(c - size * 0.09, c + size * 0.05, size * 0.18, size * 0.045, size * 0.02);
  ctx.fill();
  ctx.shadowBlur = 0;
  return canvas;
}

/** A soft tile of nebula haze, drifted slowly over the chart. */
export function paintCaustic(size: number, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  const rnd = seeded(9);
  for (let i = 0; i < 14; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.08 + rnd() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(160,150,255,0.07)");
    g.addColorStop(1, "rgba(160,150,255,0)");
    ctx.fillStyle = g;
    // Drawn four times so the tile wraps seamlessly.
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, r * 1.6, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}
