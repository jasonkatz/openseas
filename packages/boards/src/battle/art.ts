import { drawSprite } from "../sprites/atlas.js";
import type { ParsedBoard } from "@openseas/engine";
import { battleCellAt } from "@openseas/engine";

/**
 * Sea Battle's art, painted with Canvas 2D and baked to textures (as Gunnery's pieces and
 * Bilging's tiles are): a chart-blue sea with light on the water, shaded rocks ringed with surf,
 * winds as streamlines, eddies as foam spirals, and two sloops seen from above with hull, deck,
 * sail and pennant. The captain's sloop is pale with brass and a swallowtail pennant; the brigand
 * is tarred black with a blood-red sail and a cut-throat's triangular pennant, so the two read
 * apart by silhouette as well as color (CLAUDE.md rule 6).
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

export const SEA = {
  deep: 0x0a2238,
  mid: 0x0f3453,
  shallow: 0x17466a,
  light: 0x8fd0ee,
  foam: 0xe6f6ff,
  grid: 0x7fb6dc,
};

// ---- the sea

/** The whole board: water, light, the grid, and every rock and wind, at `cell` pixels a cell. */
export function paintSea(board: ParsedBoard, cell: number, resolution: number): HTMLCanvasElement {
  const W = board.width * cell;
  const H = board.height * cell;
  const { canvas, ctx } = canvasFor(W, H, resolution);
  const rnd = seeded(board.width * 131 + board.height * 17);

  // Deep water, lighter where the sun strikes it.
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, css(SEA.mid));
  base.addColorStop(0.5, css(SEA.shallow));
  base.addColorStop(1, css(SEA.deep));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.38, H * 0.3, 0, W * 0.38, H * 0.3, Math.max(W, H) * 0.7);
  sun.addColorStop(0, "rgba(120,200,235,0.12)");
  sun.addColorStop(0.5, "rgba(120,200,235,0.05)");
  sun.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);

  // Light on the water: long low swells drawn as faint sine strokes, and a few brighter glints.
  ctx.lineCap = "round";
  for (let i = 0; i < Math.ceil(H / (cell * 0.9)); i++) {
    const y0 = rnd() * H;
    const amp = cell * (0.08 + rnd() * 0.14);
    const len = cell * (2 + rnd() * 5);
    const x0 = rnd() * W;
    const phase = rnd() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= len; x += cell * 0.25) ctx.lineTo(x0 + x, y0 + Math.sin(phase + x / (cell * 0.9)) * amp);
    ctx.strokeStyle = `rgba(150,215,245,${0.05 + rnd() * 0.07})`;
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.stroke();
  }
  for (let i = 0; i < Math.ceil((W * H) / (cell * cell * 9)); i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = cell * (0.08 + rnd() * 0.16);
    const glint = ctx.createRadialGradient(x, y, 0, x, y, r);
    glint.addColorStop(0, "rgba(200,235,255,0.16)");
    glint.addColorStop(1, "rgba(200,235,255,0)");
    ctx.fillStyle = glint;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.8, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The chart's grid: thin lines and a pin at every crossing.
  ctx.strokeStyle = css(SEA.grid, 0.11);
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
  ctx.fillStyle = css(SEA.grid, 0.22);
  for (let x = 1; x < board.width; x++) {
    for (let y = 1; y < board.height; y++) {
      ctx.beginPath();
      ctx.arc(x * cell, y * cell, Math.max(0.8, cell * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Surf around the rocks first, so the rocks sit on it.
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (battleCellAt(board, x, y)?.kind !== "rock") continue;
      paintSurf(ctx, board, x, y, cell, rnd);
    }
  }
  // Winds blow as one current along each run of cells that share a heading, not a stamp a cell.
  const seen = new Set<number>();
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const c = battleCellAt(board, x, y);
      if (!c || c.kind !== "wind" || seen.has(y * board.width + x)) continue;
      const along = c.heading === 1 || c.heading === 3;
      const run: Array<[number, number]> = [];
      let [rx, ry] = [x, y];
      while (true) {
        const cell = battleCellAt(board, rx, ry);
        if (!cell || cell.kind !== "wind" || cell.heading !== c.heading || seen.has(ry * board.width + rx)) break;
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
      if (battleCellAt(board, x, y)?.kind === "rock") paintRock(ctx, (x + 0.5) * cell, (y + 0.5) * cell, cell, seeded(x * 977 + y * 31 + 7));
    }
  }

  // The water darkens toward the edges of the chart.
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
  // Foam only on sides that face open water.
  const open = (dx: number, dy: number): boolean => {
    const c = battleCellAt(board, x + dx, y + dy);
    return c !== null && c.kind !== "rock";
  };
  ctx.save();
  ctx.lineCap = "round";
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    if (!open(dx, dy)) continue;
    const ang = Math.atan2(dy, dx);
    for (let k = 0; k < 2; k++) {
      const r = cell * (0.5 + k * 0.1 + rnd() * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, r, ang - 0.75 + rnd() * 0.2, ang + 0.75 - rnd() * 0.2);
      ctx.strokeStyle = `rgba(230,246,255,${0.22 - k * 0.1})`;
      ctx.lineWidth = Math.max(1, cell * (0.07 - k * 0.02));
      ctx.setLineDash([cell * 0.18, cell * 0.12]);
      ctx.lineDashOffset = rnd() * cell;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintRock(ctx: CanvasRenderingContext2D, cx: number, cy: number, cell: number, rnd: () => number): void {
  if (drawSprite(ctx, "battle", "reef", cx - cell / 2, cy - cell / 2, cell, cell)) return;
  const n = 9;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
    const r = cell * (0.3 + rnd() * 0.18);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92]);
  }
  const path = new Path2D();
  pts.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
  // Shadow on the water, then the stone lit from the upper left.
  ctx.save();
  ctx.translate(cell * 0.05, cell * 0.07);
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fill(path);
  ctx.restore();
  const stone = ctx.createLinearGradient(cx - cell * 0.4, cy - cell * 0.4, cx + cell * 0.4, cy + cell * 0.4);
  stone.addColorStop(0, "#6b6572");
  stone.addColorStop(0.45, "#4a4550");
  stone.addColorStop(1, "#221f27");
  ctx.fillStyle = stone;
  ctx.fill(path);
  // A lit facet and a crack.
  ctx.save();
  ctx.clip(path);
  const facet = new Path2D();
  const [p0, p1, p2] = [pts[0]!, pts[1]!, pts[2]!];
  facet.moveTo(cx, cy);
  facet.lineTo(p0[0], p0[1]);
  facet.lineTo(p1[0], p1[1]);
  facet.lineTo(p2[0], p2[1]);
  facet.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.fill(facet);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1, cell * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx - cell * 0.1, cy - cell * 0.25);
  ctx.lineTo(cx + cell * 0.05, cy + cell * 0.02);
  ctx.lineTo(cx - cell * 0.04, cy + cell * 0.22);
  ctx.stroke();
  // Wet sheen along the waterline.
  const wet = ctx.createLinearGradient(0, cy, 0, cy + cell * 0.45);
  wet.addColorStop(0, "rgba(0,0,0,0)");
  wet.addColorStop(1, "rgba(5,15,30,0.5)");
  ctx.fillStyle = wet;
  ctx.fillRect(cx - cell, cy, cell * 2, cell);
  ctx.restore();
  ctx.strokeStyle = "rgba(4,7,12,0.85)";
  ctx.lineWidth = Math.max(1, cell * 0.04);
  ctx.stroke(path);
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
  wash.addColorStop(0, "rgba(150,220,255,0.02)");
  wash.addColorStop(1, "rgba(150,220,255,0.12)");
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
    ink.addColorStop(0, "rgba(180,230,255,0)");
    ink.addColorStop(0.5, `rgba(180,230,255,${main ? 0.6 : 0.4})`);
    ink.addColorStop(1, `rgba(215,242,255,${main ? 0.95 : 0.7})`);
    ctx.fillStyle = ink;
    ctx.fill(path);
  }
  // One chevron at the head of the current.
  ctx.strokeStyle = "rgba(220,245,255,0.85)";
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

// ---- eddies

export function paintEddy(size: number, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  if (drawSprite(ctx, "battle", "eddy", 0, 0, size, size)) {
    return canvas;
  }
  const c = size / 2;
  const R = size * 0.46;
  const bowl = ctx.createRadialGradient(c, c, 0, c, c, R);
  bowl.addColorStop(0, "rgba(2,10,22,0.75)");
  bowl.addColorStop(0.55, "rgba(10,40,70,0.35)");
  bowl.addColorStop(1, "rgba(10,40,70,0)");
  ctx.fillStyle = bowl;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = "round";
  for (const [turns, width, alpha] of [
    [2.6, 0.075, 0.85],
    [2.2, 0.035, 0.5],
  ] as const) {
    ctx.beginPath();
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const a = k * Math.PI * 2 * turns;
      const r = R * (1 - k) * 0.95;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(214,244,240,${alpha})`;
    ctx.lineWidth = Math.max(1, size * width);
    ctx.stroke();
  }
  // Flecks of foam.
  const rnd = seeded(42);
  ctx.fillStyle = "rgba(230,250,255,0.7)";
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = R * (0.35 + rnd() * 0.6);
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, Math.max(0.6, size * (0.012 + rnd() * 0.02)), 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

// ---- the sloops

/** A sloop seen from above, bow up, in a square of `size`. The hull is about 0.9 of it long. */
export function paintShip(size: number, who: ShipSide, showMarks: boolean, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  if (drawSprite(ctx, "battle", `ship${who}`, 0, 0, size, size)) {
    if (showMarks) {
      ctx.font = `bold ${size * 0.18}px sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = Math.max(2, size * 0.04);
      ctx.strokeStyle = "#0b1526";
      ctx.fillStyle = "#ffffff";
      ctx.strokeText(who === 0 ? "○" : "△", size / 2, size * 0.65);
      ctx.fillText(who === 0 ? "○" : "△", size / 2, size * 0.65);
    }
    return canvas;
  }
  const cx = size / 2;
  const L = size * 0.9;
  const top = (size - L) / 2;
  const bot = top + L;
  const half = size * 0.19;
  const captain = who === 0;

  const hullLight = captain ? "#f6ecd4" : "#5a5866";
  const hullMid = captain ? "#d9c89b" : "#2d2c36";
  const hullDark = captain ? "#8f7a4e" : "#0f0f15";
  const trim = captain ? "#d4a548" : "#d24a3c";
  const sailLight = captain ? "#fffaf0" : "#8a2f3a";
  const sailDark = captain ? "#cdbfa0" : "#2e1018";
  const pennant = captain ? "#f5d58a" : "#f0604d";

  // The hull, stern rounded, bow sharp.
  const hull = new Path2D();
  hull.moveTo(cx, top);
  hull.bezierCurveTo(cx + half * 1.15, top + L * 0.3, cx + half, bot - L * 0.22, cx + half * 0.78, bot - size * 0.02);
  hull.quadraticCurveTo(cx, bot + size * 0.02, cx - half * 0.78, bot - size * 0.02);
  hull.bezierCurveTo(cx - half, bot - L * 0.22, cx - half * 1.15, top + L * 0.3, cx, top);
  hull.closePath();

  // Shadow on the water.
  ctx.save();
  ctx.translate(size * 0.035, size * 0.05);
  ctx.filter = "blur(1px)";
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fill(hull);
  ctx.restore();

  // Planking across the beam, lit from port.
  const planks = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  planks.addColorStop(0, hullDark);
  planks.addColorStop(0.3, hullLight);
  planks.addColorStop(0.6, hullMid);
  planks.addColorStop(1, hullDark);
  ctx.fillStyle = planks;
  ctx.fill(hull);
  ctx.save();
  ctx.clip(hull);
  // Deck: a lighter inset with plank seams running fore and aft.
  const deck = new Path2D();
  deck.moveTo(cx, top + L * 0.1);
  deck.bezierCurveTo(cx + half * 0.78, top + L * 0.34, cx + half * 0.7, bot - L * 0.26, cx + half * 0.5, bot - size * 0.08);
  deck.quadraticCurveTo(cx, bot - size * 0.05, cx - half * 0.5, bot - size * 0.08);
  deck.bezierCurveTo(cx - half * 0.7, bot - L * 0.26, cx - half * 0.78, top + L * 0.34, cx, top + L * 0.1);
  deck.closePath();
  const deckFill = ctx.createLinearGradient(0, top, 0, bot);
  deckFill.addColorStop(0, captain ? "#e8d8ae" : "#44434f");
  deckFill.addColorStop(1, captain ? "#c4ad7a" : "#23222b");
  ctx.fillStyle = deckFill;
  ctx.fill(deck);
  ctx.save();
  ctx.clip(deck);
  ctx.strokeStyle = captain ? "rgba(90,70,40,0.35)" : "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(0.6, size * 0.012);
  for (let k = -2; k <= 2; k++) {
    const x = cx + k * half * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
  }
  ctx.restore();
  // Gun ports, two a side.
  ctx.fillStyle = "rgba(5,5,8,0.85)";
  for (const k of [0.42, 0.6]) {
    const y = top + L * k;
    const w = size * 0.05;
    ctx.fillRect(cx - half * 0.98 - w * 0.2, y - w / 2, w, w * 0.8);
    ctx.fillRect(cx + half * 0.98 - w * 0.8, y - w / 2, w, w * 0.8);
  }
  ctx.restore();
  // Gunwale and a stripe along the rail.
  ctx.lineWidth = Math.max(1, size * 0.028);
  ctx.strokeStyle = trim;
  ctx.stroke(hull);
  ctx.lineWidth = Math.max(0.8, size * 0.012);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.stroke(hull);

  // Bowsprit and jib.
  ctx.strokeStyle = captain ? "#6b4a2e" : "#0e0d12";
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, top + size * 0.02);
  ctx.lineTo(cx, top - size * 0.01);
  ctx.stroke();

  // The mainsail: a billowed square sail across the yard, forward of the mast.
  const mastY = top + L * 0.5;
  const yardHalf = half * 1.55;
  const sail = new Path2D();
  sail.moveTo(cx - yardHalf, mastY);
  sail.quadraticCurveTo(cx, mastY - L * 0.34, cx + yardHalf, mastY);
  sail.quadraticCurveTo(cx, mastY - L * 0.1, cx - yardHalf, mastY);
  sail.closePath();
  ctx.save();
  ctx.translate(size * 0.015, size * 0.02);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fill(sail);
  ctx.restore();
  const cloth = ctx.createLinearGradient(cx - yardHalf, 0, cx + yardHalf, 0);
  cloth.addColorStop(0, sailDark);
  cloth.addColorStop(0.45, sailLight);
  cloth.addColorStop(1, sailDark);
  ctx.fillStyle = cloth;
  ctx.fill(sail);
  ctx.save();
  ctx.clip(sail);
  // Seams, and the brigand's bar.
  ctx.strokeStyle = captain ? "rgba(120,100,60,0.3)" : "rgba(0,0,0,0.45)";
  ctx.lineWidth = Math.max(0.6, size * 0.01);
  for (let k = -2; k <= 2; k++) {
    const x = cx + k * yardHalf * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, mastY - L * 0.4);
    ctx.lineTo(x, mastY + L * 0.05);
    ctx.stroke();
  }
  if (!captain) {
    ctx.fillStyle = "rgba(240,96,77,0.55)";
    ctx.fillRect(cx - yardHalf, mastY - L * 0.2, yardHalf * 2, size * 0.045);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(0.8, size * 0.012);
  ctx.stroke(sail);
  // The yard and the mast.
  ctx.strokeStyle = captain ? "#5b3f26" : "#0e0d12";
  ctx.lineWidth = Math.max(1, size * 0.022);
  ctx.beginPath();
  ctx.moveTo(cx - yardHalf, mastY);
  ctx.lineTo(cx + yardHalf, mastY);
  ctx.stroke();
  const mastR = size * 0.035;
  const mast = ctx.createRadialGradient(cx - mastR * 0.3, mastY - mastR * 0.3, 0, cx, mastY, mastR);
  mast.addColorStop(0, captain ? "#b58a5c" : "#4a4650");
  mast.addColorStop(1, captain ? "#3f2a17" : "#050508");
  ctx.fillStyle = mast;
  ctx.beginPath();
  ctx.arc(cx, mastY, mastR, 0, Math.PI * 2);
  ctx.fill();
  // The pennant at the masthead: a swallowtail for the captain, a cut-throat's triangle for the brigand.
  ctx.fillStyle = pennant;
  ctx.beginPath();
  if (captain) {
    ctx.moveTo(cx, mastY - mastR * 0.3);
    ctx.lineTo(cx + size * 0.14, mastY - size * 0.06);
    ctx.lineTo(cx + size * 0.1, mastY - size * 0.03);
    ctx.lineTo(cx + size * 0.14, mastY);
  } else {
    ctx.moveTo(cx, mastY - mastR * 0.3);
    ctx.lineTo(cx + size * 0.15, mastY - size * 0.045);
    ctx.lineTo(cx, mastY + mastR * 0.3);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(0.6, size * 0.008);
  ctx.stroke();
  // A stern lantern.
  const lx = cx;
  const ly = bot - size * 0.06;
  const lamp = ctx.createRadialGradient(lx, ly, 0, lx, ly, size * 0.03);
  lamp.addColorStop(0, "#fff0b0");
  lamp.addColorStop(1, "rgba(212,165,72,0)");
  ctx.fillStyle = lamp;
  ctx.beginPath();
  ctx.arc(lx, ly, size * 0.03, 0, Math.PI * 2);
  ctx.fill();
  if (showMarks) {
    // A bold badge on the foredeck: a ring for the captain, a cross for the brigand.
    const by = top + L * 0.25;
    const r = size * 0.055;
    ctx.strokeStyle = captain ? "#1b150c" : "#f6ecd4";
    ctx.lineWidth = Math.max(1.2, size * 0.022);
    ctx.beginPath();
    if (captain) ctx.arc(cx, by, r, 0, Math.PI * 2);
    else {
      ctx.moveTo(cx - r, by - r);
      ctx.lineTo(cx + r, by + r);
      ctx.moveTo(cx + r, by - r);
      ctx.lineTo(cx - r, by + r);
    }
    ctx.stroke();
  }
  return canvas;
}

// ---- small things

export function paintBall(size: number, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  if (drawSprite(ctx, "battle", "ball", 0, 0, size, size)) {
    return canvas;
  }
  const c = size / 2;
  const r = size * 0.42;
  const g = ctx.createRadialGradient(c - r * 0.4, c - r * 0.45, r * 0.1, c, c, r);
  g.addColorStop(0, "#8d93a0");
  g.addColorStop(0.5, "#30343c");
  g.addColorStop(1, "#07080b");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/** A cannon seen from above for the plot strip's gun toggles, with a lamp that lights when armed. */
export function paintCannon(size: number, lit: boolean, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  const c = size / 2;
  // Carriage.
  ctx.fillStyle = "#4e3419";
  ctx.fillRect(c - size * 0.22, c - size * 0.12, size * 0.44, size * 0.3);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = Math.max(0.8, size * 0.03);
  ctx.strokeRect(c - size * 0.22, c - size * 0.12, size * 0.44, size * 0.3);
  // Barrel, muzzle up.
  const barrel = ctx.createLinearGradient(c - size * 0.1, 0, c + size * 0.1, 0);
  barrel.addColorStop(0, "#1a1c22");
  barrel.addColorStop(0.4, "#6a6f7a");
  barrel.addColorStop(1, "#111216");
  ctx.fillStyle = barrel;
  ctx.beginPath();
  ctx.moveTo(c - size * 0.11, c + size * 0.14);
  ctx.lineTo(c - size * 0.08, c - size * 0.34);
  ctx.lineTo(c + size * 0.08, c - size * 0.34);
  ctx.lineTo(c + size * 0.11, c + size * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#05060a";
  ctx.beginPath();
  ctx.ellipse(c, c - size * 0.34, size * 0.075, size * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  // The lamp.
  const lamp = ctx.createRadialGradient(c, c + size * 0.3, 0, c, c + size * 0.3, size * 0.14);
  lamp.addColorStop(0, lit ? "#fff3c4" : "#2a2f3a");
  lamp.addColorStop(0.5, lit ? "#f0604d" : "#171a22");
  lamp.addColorStop(1, lit ? "rgba(240,96,77,0)" : "rgba(0,0,0,0)");
  ctx.fillStyle = lamp;
  ctx.beginPath();
  ctx.arc(c, c + size * 0.3, size * 0.14, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/** A soft tile of light for the water, drifted slowly over the sea. */
export function paintCaustic(size: number, resolution: number): HTMLCanvasElement {
  const { canvas, ctx } = canvasFor(size, size, resolution);
  const rnd = seeded(9);
  for (let i = 0; i < 14; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.08 + rnd() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(190,235,255,0.10)");
    g.addColorStop(1, "rgba(190,235,255,0)");
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
