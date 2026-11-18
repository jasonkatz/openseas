import type { CoolingPieceStyle, PieceColor } from "@openseas/content";
import { css } from "../look/tokens.js";

/**
 * Cooling's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062): each kind is
 * one solid silhouette in one palette colour, on a 24 unit square, with at most one detail cut out
 * so the ground shows through. Nothing else tells two kinds apart, so no two outlines may be alike.
 * Painted with Canvas 2D so the board and the page's legend share one drawing.
 */
export type PieceShape = CoolingPieceStyle["shape"];
export type SpecialName = "charge" | "magnet" | "slag";
export type Pictogram = PieceShape | SpecialName;

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

/** A filled polygon whose corners are rounded by stroking it in its own colour. */
function soft(ctx: Ctx, pts: readonly number[], round: number): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i]!, pts[i + 1]!);
    else ctx.lineTo(pts[i]!, pts[i + 1]!);
  }
  ctx.closePath();
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

const DRAW: Record<Pictogram, (ctx: Ctx) => void> = {
  // A toothed disc with a hub.
  cog(ctx) {
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate(12, 12);
      ctx.rotate((k * Math.PI) / 4);
      rounded(ctx, -2.5, -10, 5, 20, 1.6);
      ctx.restore();
    }
    disc(ctx, 12, 12, 7.6);
    cut(ctx, () => disc(ctx, 12, 12, 3));
  },
  // A four-lobed handwheel.
  valve(ctx) {
    disc(ctx, 12, 6.6, 4.6);
    disc(ctx, 12, 17.4, 4.6);
    disc(ctx, 6.6, 12, 4.6);
    disc(ctx, 17.4, 12, 4.6);
    disc(ctx, 12, 12, 5);
    cut(ctx, () => disc(ctx, 12, 12, 2.4));
  },
  // A hexagon head with a driver slot.
  bolt(ctx) {
    soft(ctx, [12, 3.6, 19.3, 7.8, 19.3, 16.2, 12, 20.4, 4.7, 16.2, 4.7, 7.8], 3);
    cut(ctx, () => rounded(ctx, 7.5, 10.5, 9, 3, 1.5));
  },
  // A capsule with a band.
  fuse(ctx) {
    rounded(ctx, 7, 2, 10, 20, 5);
    cut(ctx, () => ctx.fillRect(6, 10.5, 12, 3));
  },
  // A cut gem.
  crystal(ctx) {
    soft(ctx, [12, 3.5, 19, 10, 12, 20.5, 5, 10], 3);
  },
  // Three turns of a spring.
  coil(ctx) {
    rounded(ctx, 3, 3, 18, 4.6, 2.3);
    rounded(ctx, 3, 9.7, 18, 4.6, 2.3);
    rounded(ctx, 3, 16.4, 18, 4.6, 2.3);
    ctx.fillRect(16.5, 5, 4.5, 7);
    ctx.fillRect(3, 11.7, 4.5, 7);
  },
  // A package with two rows of pins and a die.
  chip(ctx) {
    rounded(ctx, 5, 5, 14, 14, 2.4);
    rounded(ctx, 2, 7.4, 20, 3, 1.5);
    rounded(ctx, 2, 13.6, 20, 3, 1.5);
    cut(ctx, () => rounded(ctx, 9.5, 9.5, 5, 5, 1.2));
  },
  // A long-rayed starburst with a hollow heart.
  charge(ctx) {
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 === 0 ? 11.6 : 5.2;
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      pts.push(12 + r * Math.cos(a), 12 + r * Math.sin(a));
    }
    soft(ctx, pts, 1.4);
    cut(ctx, () => disc(ctx, 12, 12, 2.6));
  },
  // A thick horseshoe, its pole tips cut off from the bend.
  magnet(ctx) {
    ctx.beginPath();
    ctx.moveTo(5.5, 2.5);
    ctx.lineTo(5.5, 12);
    ctx.arc(12, 12, 6.5, Math.PI, 0, true);
    ctx.lineTo(18.5, 2.5);
    ctx.lineWidth = 7.4;
    ctx.lineJoin = "round";
    ctx.stroke();
    cut(ctx, () => ctx.fillRect(0, 6.2, 24, 2.4));
  },
  // A jagged rock split by a crack.
  slag(ctx) {
    soft(ctx, [2.5, 17, 4.5, 8, 9, 10, 10.5, 2.5, 15, 7.5, 21.5, 5.5, 21, 15, 16, 21.5, 8, 20], 2);
    cut(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(11, 8);
      ctx.lineTo(13.5, 12);
      ctx.lineTo(10.5, 15);
      ctx.lineTo(12.5, 19);
      ctx.lineWidth = 1.8;
      ctx.stroke();
    });
  },
};

/** Paints one piece into a cell of size `s` whose top-left corner is the context origin. */
export function paintPiece(ctx: Ctx, s: number, shape: Pictogram, color: PieceColor): void {
  ctx.save();
  // The 24 unit square is drawn at 20/24 of the cell, so neighbours never touch.
  // A special stands bigger than the rest: 23/24 of the cell.
  const special = shape === "charge" || shape === "magnet" || shape === "slag";
  const k = (s * ((special ? 23 : 20) / 24)) / 24;
  ctx.translate(s / 2 - 12 * k, s / 2 - 12 * k);
  ctx.scale(k, k);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = css(color);
  DRAW[shape](ctx);
  ctx.restore();
}

/** A piece as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function pieceCanvas(s: number, shape: Pictogram, color: PieceColor, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintPiece(ctx, s, shape, color);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a piece for the page's legend; cached because legends re-render often. */
export function pieceDataUrl(shape: Pictogram, color: PieceColor, px: number): string {
  const key = `${shape}:${color}:${px}`;
  let url = urlCache.get(key);
  if (!url) {
    url = pieceCanvas(px, shape, color, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
