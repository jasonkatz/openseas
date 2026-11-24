import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Pact's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The kinds a player must tell
 * apart are the four suits, the traditional ones, each an outline of its own: a spade's blade on a
 * stem, a heart, a diamond, a club's three leaves on a stem. A card is a raised tile the board
 * draws, its rank in mono in its suit's colour over its suit's pictogram; face down it shows the
 * back's seal. A trick taken is a small stack with a fold cut across it, and a nil bid a ring.
 * Colour is a second cue and never the only one. Each is drawn from its layers in
 * `data/pieces/pact.json` (ADR 0065).
 */
export interface PactPiece {
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

const piece = (id: string, color: Token): PactPiece => ({ id, color, paint: piecePaint("pact", id) });

/** The suits by the engine's number: 0 clubs, 1 diamonds, 2 hearts, 3 spades. */
export const PACT_SUITS: readonly PactPiece[] = [piece("club", "moss"), piece("diamond", "sand"), piece("heart", "rose"), piece("spade", "cream")];
/** A card face down. */
export const PACT_BACK = piece("back", "slate");
/** A trick taken, beside a seat. */
export const PACT_TRICK = piece("trick", "cream");
/** A nil bid, beside a seat. */
export const PACT_NIL = piece("nil", "lilac");
