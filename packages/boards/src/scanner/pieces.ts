import type { Token } from "../look/tokens.js";
import { bar, cut, disc, rounded, soft, type Ctx, type Paint } from "../kit/pictogram.js";

/**
 * Scanner's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). The sector is
 * a sheet of fog plates. A cell is told from every other by what stands on it, with the colour
 * taken away: fog is a solid plate, a clear cell is bare ground with a dot, a ping is its number,
 * a found contact is a dot held in four brackets, a spooked one is a disc struck through, and a
 * miss is a cross. A lock is four brackets, bare until they hold something; a ping is a hollow
 * diamond, the shape of its ring.
 */

/** Four corner brackets, each an L three units thick. */
function brackets(ctx: Ctx): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(12 + sx * 8.5, 12 + sy * 4);
    ctx.lineTo(12 + sx * 8.5, 12 + sy * 8.5);
    ctx.lineTo(12 + sx * 4, 12 + sy * 8.5);
    ctx.stroke();
  }
}

/** A diamond round the centre whose points reach `r` units out, its corners rounded by `round`. */
const diamond = (ctx: Ctx, r: number, round: number): void => soft(ctx, [12, 12 - r, 12 + r, 12, 12, 12 + r, 12 - r, 12], round * 2);

export interface ScannerPiece {
  readonly color: Token;
  readonly paint: Paint;
}

export const SCANNER_PIECES = {
  /** Fog: a flat plate over a cell nothing is known of. */
  fog: { color: "raised", paint: (ctx) => rounded(ctx, 2, 2, 20, 20, 3) },
  /** A contact found by a lock: the contact, held in the lock's brackets. Good news is cream. */
  found: {
    color: "cream",
    paint: (ctx) => {
      brackets(ctx);
      disc(ctx, 12, 12, 4);
    },
  },
  /** A contact a ping spooked: the contact, struck through. */
  spooked: {
    color: "danger",
    paint: (ctx) => {
      disc(ctx, 12, 12, 9.5);
      cut(ctx, () => bar(ctx, 3, 21, 21, 3, 3.6));
    },
  },
  /** A lock on empty space: a cross. */
  miss: {
    color: "danger",
    paint: (ctx) => {
      bar(ctx, 5, 5, 19, 19, 4);
      bar(ctx, 19, 5, 5, 19, 4);
    },
  },
  /** A lock that holds nothing yet: the brackets closing under a held finger, and a hint to lock. */
  brackets: { color: "cream", paint: brackets },
  /** A ping: a hollow diamond, the shape of the ring it sounds. The switch's glyph and a hint to ping. */
  ping: {
    color: "cream",
    paint: (ctx) => {
      diamond(ctx, 8.4, 1.6);
      cut(ctx, () => diamond(ctx, 3.6, 0.8));
    },
  },
} as const satisfies Record<string, ScannerPiece>;

export type ScannerPieceId = keyof typeof SCANNER_PIECES;
