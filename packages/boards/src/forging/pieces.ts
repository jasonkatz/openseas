import type { ForgingMark } from "@openseas/engine";
import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Forging's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). Every live spot of the
 * plate is the same square tile, so the rules fix the outline; its mark is the one cut-out, through
 * which the ground shows, and tells the marks apart with the colour taken away: one to four round
 * pips for a step, a plus for a rail, an X for a slant, an eight-spoked asterisk for a star, an L
 * for a hook and a four-pointed spark for a spark. How hot a spot is is its size: the tile shrinks a
 * step with each strike, so heat reads without colour too, and colour (rust, sand, sky as it cools)
 * is the second cue. A set spot is no piece at all: the board draws an empty position's dot. Each
 * is drawn from its layers in `data/pieces/forging.json` (ADR 0065), by the mark's name.
 */

export const forgingPaint = (mark: ForgingMark): Paint => piecePaint("forging", mark);

/** The colour of a spot with `heat` blows left: rust while it is hot, then sand, then sky. A spark is cream. No spot is amber, which is the press. */
export function forgingColor(heat: number, mark: ForgingMark): Token {
  if (mark === "spark") return "cream";
  return heat >= 3 ? "rust" : heat === 2 ? "sand" : "sky";
}

/** How much of its cell a spot fills, by heat: a step smaller with each strike. Above three it stays full. */
export function forgingFit(heat: number, blows: number): number {
  const left = Math.max(1, Math.min(3, heat - Math.max(0, blows - 3)));
  return left >= 3 ? 22 / 24 : left === 2 ? 18 / 24 : 14.5 / 24;
}
