/**
 * Code-drawn art for prototype boards (ADR 0036) on the game's one palette (docs/BRAND.md, ADR
 * 0061): the kit's inks, eight placeholder kinds with a silhouette and a piece colour each, the
 * ground a playfield sits on and the dot of an empty position. Everything is flat: one solid
 * colour a piece, rounded, with no rim, shine or shadow.
 *
 * A restyled board (`KitBoard.drawn`) draws pictograms of its own subject (`pictogram.ts`) and
 * uses the inks and the ground from here. The kinds and their pips are what a board that has not
 * been restyled yet draws under its atlas, and they go when the last of those is restyled.
 */
import type { Graphics } from "pixi.js";
import { FONT as TYPE, ink, type PieceColor } from "../look/tokens.js";

/**
 * The inks a kit board draws in, by token name. Amber is only the player's own, the active thing
 * and the beat; danger is only what is bad; good news is cream.
 */
export const INK = {
  ground: ink("ground"),
  raised: ink("raised"),
  line: ink("line"),
  cream: ink("cream"),
  dim: ink("dim"),
  amber: ink("amber"),
  danger: ink("danger"),
  // The old names, for the boards not restyled yet. Each goes with the last board that reads it.
  bg: ink("ground"),
  panel: ink("ground"),
  well: ink("raised"),
  wellLit: ink("line"),
  edge: ink("line"),
  text: ink("cream"),
  brass: ink("amber"),
  gold: ink("cream"),
  good: ink("cream"),
  white: ink("cream"),
  black: ink("ground"),
} as const;

/** Text is the body face; anything counted is the mono face, bold (docs/BRAND.md section 4). */
export const FONT = TYPE.body;
export const FONT_MONO = TYPE.mono;

export type Shape = "circle" | "square" | "triangle" | "diamond" | "pill" | "star" | "cross" | "heart";

export interface PlaceholderKind {
  /** Message key suffix and atlas frame suffix: a board's legend reads `<puzzle>.kind.<id>` or names its own. */
  readonly id: string;
  /** The piece colour the kind wears, by name. */
  readonly token: PieceColor;
  readonly color: number;
  readonly shape: Shape;
}

const kind = (id: string, token: PieceColor, shape: Shape): PlaceholderKind => ({ id, token, color: ink(token), shape });

/**
 * Eight kinds that differ by silhouette first and colour second, in the eight piece colours. A
 * board uses the first n. The ids are older than the palette (they name atlas frames and message
 * keys), so `amber` is a kind's name here and never its colour.
 */
export const KINDS: readonly PlaceholderKind[] = [
  kind("gold", "sand", "circle"),
  kind("ice", "sky", "square"),
  kind("ember", "rust", "triangle"),
  kind("moss", "moss", "diamond"),
  kind("violet", "lilac", "pill"),
  kind("amber", "teal", "star"),
  kind("bone", "slate", "cross"),
  kind("rose", "rose", "heart"),
];

export function kindStyle(kind: number): PlaceholderKind {
  return KINDS[((kind % KINDS.length) + KINDS.length) % KINDS.length]!;
}

/** Blend two 0xRRGGBB colors: t = 0 is `a`, t = 1 is `b`. For a flat tint, never for a gradient. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

/**
 * How far a shape's corners are rounded, as a share of its radius: the outline is drawn that much
 * smaller and stroked in its own colour with round joins, which is 2 units of the 24 unit square.
 */
export const ROUND = 0.2;

/**
 * The outline of a shape as points round (x, y), for a Graphics polygon or an SVG path. Circles
 * return null. The points are the sharp outline; `drawPiece` and `KindIcon` round its corners.
 */
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
      const h = r * 0.86;
      return [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h];
    }
    case "triangle": {
      // Dropped a little so it sits centred to the eye.
      const pts = poly(3, -Math.PI / 2, r * 1.12);
      for (let i = 1; i < pts.length; i += 2) pts[i] = pts[i]! + r * 0.2;
      return pts;
    }
    case "diamond":
      return [x, y - r * 1.08, x + r * 0.78, y, x, y + r * 1.08, x - r * 0.78, y];
    case "pill": {
      // A capsule on its side: two half circles and the flats between them.
      const pts: number[] = [];
      const h = r * 0.5;
      const w = r - h;
      for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 8;
        pts.push(x + w + h * Math.cos(a), y + h * Math.sin(a));
      }
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 8;
        pts.push(x - w + h * Math.cos(a), y + h * Math.sin(a));
      }
      return pts;
    }
    case "star": {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? r * 1.12 : r * 0.52;
        pts.push(x + rr * Math.cos(-Math.PI / 2 + (i * Math.PI) / 5), y + r * 0.06 + rr * Math.sin(-Math.PI / 2 + (i * Math.PI) / 5));
      }
      return pts;
    }
    case "cross": {
      const a = r * 0.3;
      const b = r;
      return [x - a, y - b, x + a, y - b, x + a, y - a, x + b, y - a, x + b, y + a, x + a, y + a, x + a, y + b, x - a, y + b, x - a, y + a, x - b, y + a, x - b, y - a, x - a, y - a];
    }
    case "heart": {
      // Two lobes over a point.
      const pts: number[] = [];
      for (let i = 0; i < 28; i++) {
        const t = (i * Math.PI * 2) / 28;
        const s = Math.sin(t);
        pts.push(x + (r * 16 * s * s * s) / 16, y - r * 0.08 - (r * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 15.5);
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

/** A shape filled flat in one colour, its corners rounded: the whole of a placeholder piece. */
export function fillShape(g: Graphics, shape: Shape, x: number, y: number, r: number, color: number, alpha = 1): void {
  if (shape === "circle") {
    g.circle(x, y, r).fill({ color, alpha });
    return;
  }
  const inner = r * (1 - ROUND);
  shapePath(g, shape, x, y, inner);
  g.fill({ color, alpha });
  shapePath(g, shape, x, y, inner);
  g.stroke({ width: r * ROUND * 2, color, alpha, join: "round" });
}

export interface PieceOptions {
  /** Draw the kind's pips over it (the "mark tiles" setting of a board not restyled yet). */
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

/**
 * `count` pips (1 to 8) centred on (x, y), in the ground's colour so they read as holes. Only for a
 * board that has not been restyled: a restyled board has no marks setting, and a number its rules
 * put on a piece is drawn as part of that piece.
 */
export function drawPips(g: Graphics, count: number, x: number, y: number, r: number, color: number = INK.ground, alpha = 1): void {
  const layout = PIPS[Math.max(1, Math.min(PIPS.length, count)) - 1]!;
  const gap = r * 0.36;
  const dot = Math.max(1.2, r * 0.13);
  for (const [dx, dy] of layout) g.circle(x + dx * gap, y + dy * gap, dot);
  g.fill({ color, alpha });
}

/**
 * A kind's pips on a ground plate, for a sprite of a board not restyled yet: painted art has no
 * flat face for pips to read on, so the mark brings its own. The same count and layout as `drawPips`.
 */
export function drawMark(g: Graphics, kind: number, x: number, y: number, r: number): void {
  const half = r * 0.52;
  g.roundRect(x - half, y - half, half * 2, half * 2, half * 0.34).fill({ color: INK.ground });
  drawPips(g, (kind % KINDS.length) + 1, x, y, r * 0.86, INK.cream, 1);
}

/** The atlas frame of a kind: `spriteName("debris", 2)` is `debris-ember`. */
export const spriteName = (prefix: string, kind: number): string => `${prefix}-${kindStyle(kind).id}`;

/**
 * One placeholder piece of `kind` centred on (x, y) with radius `r`: its silhouette, flat, in its
 * colour, and its pips when marks are on.
 */
export function drawPiece(g: Graphics, kind: number, x: number, y: number, r: number, opts: PieceOptions = {}): void {
  const style = kindStyle(kind);
  const color = opts.color ?? style.color;
  const alpha = opts.alpha ?? 1;
  if (opts.hollow) {
    shapePath(g, style.shape, x, y, r * (style.shape === "circle" ? 0.9 : 1 - ROUND));
    g.stroke({ width: Math.max(1.5, r * 0.2), color, alpha, join: "round" });
    return;
  }
  fillShape(g, style.shape, x, y, r, color, alpha);
  if (opts.marks) drawPips(g, (kind % KINDS.length) + 1, x, y, r * 0.9);
}

/**
 * A playfield: bare ground with one hairline round it, painted so the board is whole wherever it
 * is shown (docs/BRAND.md section 3). No frame, no bevel, no grid. A renderer asks its board for
 * this (`KitBoard.paintGround`), which also tells the beat where the board is.
 */
export function drawGround(g: Graphics, x: number, y: number, w: number, h: number, hairline = true): void {
  g.rect(x, y, w, h).fill({ color: INK.ground });
  if (hairline) drawHairline(g, x, y, w, h);
}

/** The one hairline a playfield may have, where its edge matters: round the ground, or round the grid inside it. */
export function drawHairline(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x - 0.5, y - 0.5, w + 1, h + 1).stroke({ width: 1, color: INK.line });
}

/** The small dot of an empty position that matters, at the centre of a cell of `size`. */
export function drawDot(g: Graphics, cx: number, cy: number, size: number, color: number = INK.line): void {
  g.circle(cx, cy, Math.max(1.5, size * 0.045)).fill({ color });
}

/** The old board backing, now the bare ground. A board not restyled yet still asks by this name. */
export function drawPanel(g: Graphics, x: number, y: number, w: number, h: number, _radius = 0): void {
  drawGround(g, x, y, w, h);
}

/** The old cell well, now the empty position's dot. A board not restyled yet still asks by this name. */
export function drawWell(g: Graphics, x: number, y: number, size: number, lit = false): void {
  drawDot(g, x + size / 2, y + size / 2, size, lit ? INK.dim : INK.line);
}
