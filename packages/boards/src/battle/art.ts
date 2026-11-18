import { css, type Token } from "../look/tokens.js";

/**
 * Space Battle's things, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062): each kind
 * is one solid silhouette in one palette colour, on a 24 unit square, with at most one detail cut
 * out so the ground shows through. Everything that has a facing is drawn pointing up and turned by
 * the board.
 *
 * No two outlines are alike, so every kind reads with the colour taken away: the captain's ship is
 * a dart with one point forward, the raider a broad hull with two prongs forward and a square
 * stern, an asteroid a lump, a gravity well a ring broken by an arrowhead, a current a chevron, a
 * slug a small capsule, a plotted position the dart hollow, and a turret a barrel on a mount.
 */
export type BattleKind = "ship" | "raider" | "asteroid" | "well" | "current" | "slug" | "ghost" | "turret" | "turretArmed";

type Ctx = CanvasRenderingContext2D;

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function disc(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function trace(ctx: Ctx, pts: readonly number[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i]!, pts[i + 1]!);
    else ctx.lineTo(pts[i]!, pts[i + 1]!);
  }
  ctx.closePath();
}

/** A filled polygon whose corners are rounded by stroking it in its own colour. */
function soft(ctx: Ctx, pts: readonly number[], round: number): void {
  trace(ctx, pts);
  ctx.lineJoin = "round";
  ctx.lineWidth = round;
  ctx.fill();
  ctx.stroke();
}

/** Cut a detail out of what is already drawn, so whatever is behind the piece shows through. */
function cut(ctx: Ctx, draw: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  draw();
  ctx.restore();
}

/** The captain's dart: one point forward, two swept wings and a notched stern. */
const DART = [12, 3, 19.6, 19.4, 12, 15.6, 4.4, 19.4] as const;

const DRAW: Record<BattleKind, (ctx: Ctx) => void> = {
  // The captain's ship: a dart with a canopy.
  ship(ctx) {
    soft(ctx, DART, 3);
    cut(ctx, () => disc(ctx, 12, 12.2, 2));
  },
  // The raider: a broad hull, two prongs forward with a gap between them, a square stern with a slot.
  raider(ctx) {
    soft(ctx, [4.6, 4, 8.4, 4, 9.6, 11, 14.4, 11, 15.6, 4, 19.4, 4, 20, 19.4, 4, 19.4], 3);
    cut(ctx, () => rounded(ctx, 8, 14.4, 8, 2.6, 1.3));
  },
  // A lump of rock.
  asteroid(ctx) {
    soft(ctx, [5, 13.4, 7.6, 6.6, 14, 4.6, 19.4, 9.6, 17.4, 17.4, 10, 19.4], 3);
  },
  // A gravity well: a ring, broken where an arrowhead shows which way it turns a ship.
  well(ctx) {
    ctx.beginPath();
    ctx.arc(12, 12, 7.2, -Math.PI * 0.42, Math.PI * 1.1);
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.stroke();
    soft(ctx, [9.2, 2.6, 15.2, 5.2, 9.8, 8.6], 1.6);
  },
  // A solar current: a chevron pointing the way it carries a ship.
  current(ctx) {
    ctx.beginPath();
    ctx.moveTo(6.5, 14.5);
    ctx.lineTo(12, 9);
    ctx.lineTo(17.5, 14.5);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  },
  // A slug in flight: a short capsule, nose up.
  slug(ctx) {
    rounded(ctx, 9, 5, 6, 14, 3);
  },
  // Where the plot leaves the ship: the dart, hollow.
  ghost(ctx) {
    trace(ctx, DART);
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.6;
    ctx.stroke();
  },
  // A turret on its mount, barrel up.
  turret(ctx) {
    rounded(ctx, 5, 13, 14, 7.5, 2.4);
    rounded(ctx, 10, 6.5, 4, 9, 1.6);
  },
  // The same turret with a slug leaving it: this one fires.
  turretArmed(ctx) {
    rounded(ctx, 5, 14.5, 14, 7, 2.4);
    rounded(ctx, 10, 9, 4, 8, 1.6);
    disc(ctx, 12, 4.2, 2.6);
  },
};

/** A palette colour, or a flat blend of two (`blend` in the token module), as Canvas 2D takes it. */
export type Paint = Token | number;
const paintOf = (color: Paint): string => (typeof color === "number" ? `#${color.toString(16).padStart(6, "0")}` : css(color));

/** Paints one pictogram, pointing up, on a square of `s` whose top-left corner is the context origin. */
export function paintKind(ctx: Ctx, s: number, kind: BattleKind, color: Paint): void {
  ctx.save();
  ctx.scale(s / 24, s / 24);
  ctx.fillStyle = paintOf(color);
  ctx.strokeStyle = paintOf(color);
  DRAW[kind](ctx);
  ctx.restore();
}

/** A pictogram as its own canvas, `s` CSS pixels square at `resolution` device pixels a pixel. */
export function kindCanvas(s: number, kind: BattleKind, color: Paint, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(s * resolution));
  canvas.height = Math.max(1, Math.ceil(s * resolution));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintKind(ctx, s, kind, color);
  }
  return canvas;
}
