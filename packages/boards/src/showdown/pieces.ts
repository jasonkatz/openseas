import type { ShowdownStyle } from "@openseas/engine";
import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Showdown's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The kinds a player must
 * tell apart are the four suits, the cards' own: a spade, a heart, a diamond and a club, each its
 * traditional outline, spades and clubs cream, hearts and diamonds rose. The rivals' styles have emblems of their
 * own too: a brick with its mortar line, a sponge with its hole, a flame, a fin. A card is a raised
 * tile the board draws, its rank in mono and its suit's pictogram under it; face down it shows the
 * back's seal. Colour is a second cue and never the only one. Each is drawn from its layers in
 * `data/pieces/showdown.json` (ADR 0065).
 */
export interface ShowdownPiece {
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

const piece = (id: string, color: Token): ShowdownPiece => ({ id, color, paint: piecePaint("showdown", id) });

/** The suits by the engine's number: 0 spades, 1 hearts, 2 diamonds, 3 clubs. */
export const SHOWDOWN_SUITS: readonly ShowdownPiece[] = [piece("spade", "cream"), piece("heart", "rose"), piece("diamond", "rose"), piece("club", "cream")];
/** A card face down: the back's seal, slate. */
export const SHOWDOWN_BACK = piece("back", "slate");
/** Chips in front of a seat and in the pot. */
export const SHOWDOWN_CHIP = piece("chip", "cream");
/** The button that says who deals. */
export const SHOWDOWN_BUTTON = piece("button", "cream");
/** Each rival style's emblem. */
export const SHOWDOWN_EMBLEMS: Readonly<Record<ShowdownStyle, ShowdownPiece>> = {
  brick: piece("brick", "slate"),
  sponge: piece("sponge", "moss"),
  hothead: piece("hothead", "rust"),
  shark: piece("shark", "teal"),
};
