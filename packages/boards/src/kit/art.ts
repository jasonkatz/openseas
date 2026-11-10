/**
 * Code-drawn art for prototype boards (ADR 0036): vector pieces, one silhouette and one color per
 * kind, so kinds read apart without color (CLAUDE.md rule 6), and an optional mark of pips for the
 * player setting. A board draws its atlas's sprites over these (ADR 0037); these are what it draws
 * when the atlas is missing or has no frame for a kind.
 */
import type { Graphics } from "pixi.js";

/** The palette every prototype board draws its frame, wells and text in. */
export const INK = {
  bg: 0x0a1424,
  panel: 0x0f1d33,
  well: 0x142642,
  wellLit: 0x1c3358,
  line: 0x24395c,
  edge: 0x35527f,
  text: 0xe8e2cf,
  dim: 0x8ea0bd,
  brass: 0xd4a548,
  gold: 0xf5d58a,
  good: 0x7bd88f,
  danger: 0xf0604d,
  white: 0xffffff,
  black: 0x000000,
} as const;

export const FONT = "Atkinson Hyperlegible, Avenir Next, Segoe UI, sans-serif";
export const FONT_DISPLAY = "Fraunces, Georgia, serif";

export type Shape = "circle" | "square" | "triangle" | "diamond" | "hexagon" | "star" | "cross" | "drop";

export interface PlaceholderKind {
  /** Message key suffix: a board's legend reads `<puzzle>.kind.<id>` or names its own. */
  readonly id: string;
  readonly color: number;
  readonly shape: Shape;
}

/** Eight kinds that differ by silhouette first and color second. A board uses the first n. */
export const KINDS: readonly PlaceholderKind[] = [
  { id: "gold", color: 0xf5d021, shape: "circle" },
  { id: "ice", color: 0x58c4f6, shape: "square" },
  { id: "ember", color: 0xff6b5e, shape: "triangle" },
  { id: "moss", color: 0x7bd88f, shape: "diamond" },
  { id: "violet", color: 0xb48cff, shape: "hexagon" },
  { id: "amber", color: 0xff9f43, shape: "star" },
  { id: "bone", color: 0xf2f0e6, shape: "cross" },
  { id: "rose", color: 0xf78fb3, shape: "drop" },
];

export function kindStyle(kind: number): PlaceholderKind {
  return KINDS[((kind % KINDS.length) + KINDS.length) % KINDS.length]!;
}

/** Blend two 0xRRGGBB colors: t = 0 is `a`, t = 1 is `b`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

/** The outline of a shape as points round (x, y), for a Graphics polygon or an SVG path. Circles return null. */
export function shapePoints(shape: Shape, x: number, y: number, r: number): number[] | null {
  const poly = (n: number, rot: number, rr = r): number[] => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(x + rr * Math.cos(rot + (i * Math.PI * 2) / n), y + rr * Math.sin(rot + (i * Math.PI * 2) / n));
    return pts;
  };
  switch (shape) {
    case "circle":
      return null;
    case "square": {
      const h = r * 0.84;
      return [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h];
    }
    case "triangle": {
      // Dropped a little so it sits centred to the eye.
      const pts = poly(3, -Math.PI / 2, r * 1.1);
      for (let i = 1; i < pts.length; i += 2) pts[i] = pts[i]! + r * 0.14;
      return pts;
    }
    case "diamond":
      return poly(4, -Math.PI / 2, r * 1.05);
    case "hexagon":
      return poly(6, 0);
    case "star": {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? r * 1.08 : r * 0.5;
        pts.push(x + rr * Math.cos(-Math.PI / 2 + (i * Math.PI) / 5), y + rr * Math.sin(-Math.PI / 2 + (i * Math.PI) / 5));
      }
      return pts;
    }
    case "cross": {
      const a = r * 0.36;
      const b = r * 0.98;
      return [x - a, y - b, x + a, y - b, x + a, y - a, x + b, y - a, x + b, y + a, x + a, y + a, x + a, y + b, x - a, y + b, x - a, y + a, x - b, y + a, x - b, y - a, x - a, y - a];
    }
    case "drop": {
      const pts: number[] = [x, y - r * 1.1];
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI / 6 + (i * (Math.PI + Math.PI / 3)) / 12;
        pts.push(x + r * 0.82 * Math.cos(a), y + r * 0.22 + r * 0.82 * Math.sin(a));
      }
      return pts;
    }
  }
}

/** Add a shape's outline to `g` as a path; the caller fills or strokes it. */
export function shapePath(g: Graphics, shape: Shape, x: number, y: number, r: number): void {
  const pts = shapePoints(shape, x, y, r);
  if (pts === null) g.circle(x, y, r);
  else g.poly(pts);
}

export interface PieceOptions {
  /** Draw the kind's pips over it (the "mark tiles" setting). */
  marks?: boolean;
  alpha?: number;
  /** Override the kind's color, e.g. for a greyed piece. */
  color?: number;
  /** An outline only: a target or a ghost of the piece. */
  hollow?: boolean;
}

/** Where a kind's pips sit, as offsets in units of the pip spacing: the faces of a die, then a ring for 7 and 8. */
export const PIPS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0]],
  [[-1, -1], [1, 1]],
  [[-1, -1], [0, 0], [1, 1]],
  [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [1, 1]],
  [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
];

/** `count` pips (1 to 8) centred on (x, y): the mark that tells kinds apart with no color at all. */
export function drawPips(g: Graphics, count: number, x: number, y: number, r: number, color: number = INK.black, alpha = 0.78): void {
  const layout = PIPS[Math.max(1, Math.min(PIPS.length, count)) - 1]!;
  const gap = r * 0.36;
  const dot = Math.max(1.2, r * 0.13);
  for (const [dx, dy] of layout) g.circle(x + dx * gap, y + dy * gap, dot);
  g.fill({ color, alpha });
}

/**
 * A kind's pips on a dark plate, for a sprite: painted art has no flat face for dark pips to read
 * on, so the mark brings its own. The same count and layout as `drawPips`.
 */
export function drawMark(g: Graphics, kind: number, x: number, y: number, r: number): void {
  const half = r * 0.52;
  g.roundRect(x - half, y - half, half * 2, half * 2, half * 0.34).fill({ color: INK.bg, alpha: 0.86 });
  g.roundRect(x - half, y - half, half * 2, half * 2, half * 0.34).stroke({ width: Math.max(1, r * 0.05), color: INK.white, alpha: 0.7 });
  drawPips(g, (kind % KINDS.length) + 1, x, y, r * 0.86, INK.white, 1);
}

/** The atlas frame of a kind: `spriteName("debris", 2)` is `debris-ember`. */
export const spriteName = (prefix: string, kind: number): string => `${prefix}-${kindStyle(kind).id}`;

/**
 * One placeholder piece of `kind` centred on (x, y) with radius `r`: its silhouette in its color,
 * a darker rim, a soft shine, and its pips when marks are on.
 */
export function drawPiece(g: Graphics, kind: number, x: number, y: number, r: number, opts: PieceOptions = {}): void {
  const style = kindStyle(kind);
  const color = opts.color ?? style.color;
  const alpha = opts.alpha ?? 1;
  if (opts.hollow) {
    shapePath(g, style.shape, x, y, r * 0.92);
    g.fill({ color, alpha: 0.12 * alpha });
    shapePath(g, style.shape, x, y, r * 0.92);
    g.stroke({ width: Math.max(1.5, r * 0.12), color, alpha: 0.85 * alpha, join: "round" });
    return;
  }
  // A drop shadow, the body, the rim, then a shine up and to the left.
  shapePath(g, style.shape, x, y + r * 0.1, r);
  g.fill({ color: INK.black, alpha: 0.35 * alpha });
  shapePath(g, style.shape, x, y, r);
  g.fill({ color, alpha });
  shapePath(g, style.shape, x, y, r);
  g.stroke({ width: Math.max(1.2, r * 0.11), color: mix(color, INK.black, 0.45), alpha, join: "round" });
  shapePath(g, style.shape, x - r * 0.12, y - r * 0.14, r * 0.52);
  g.fill({ color: mix(color, INK.white, 0.55), alpha: 0.42 * alpha });
  if (opts.marks) drawPips(g, (kind % KINDS.length) + 1, x, y, r * 0.9);
}

/** The board's backing: a dark rounded panel with a lit edge. */
export function drawPanel(g: Graphics, x: number, y: number, w: number, h: number, radius = 14): void {
  g.roundRect(x, y, w, h, radius).fill({ color: INK.panel });
  g.roundRect(x, y, w, h, radius).stroke({ width: 2, color: INK.edge, alpha: 0.9 });
  g.roundRect(x + 3, y + 3, w - 6, h - 6, Math.max(2, radius - 3)).stroke({ width: 1, color: INK.white, alpha: 0.05 });
}

/** A cell's well: the recess a piece sits in. */
export function drawWell(g: Graphics, x: number, y: number, size: number, lit = false): void {
  const inset = Math.max(1, size * 0.04);
  g.roundRect(x + inset, y + inset, size - inset * 2, size - inset * 2, size * 0.16).fill({ color: lit ? INK.wellLit : INK.well });
}
