import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Freefall's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). A shaft of rockers over a
 * row of berths, and the cargo pods dropped down it. Each kind has an outline of its own: a pod is
 * an upright capsule with its porthole cut out, a cradle an open cup with a beam rising from it, an
 * arm the beam's other half on a pivot post up to a knob, a berth a tray open at the top. A
 * cradle and its arm are drawn edge to edge, so a rocker reads as one seesaw. A cluster is a pod with its count on it, in mono.
 * Colour is a second cue and never the only one. Each is drawn from its layers in
 * `data/pieces/freefall.json` (ADR 0065).
 */
export interface FreefallPiece {
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

const piece = (id: string, color: Token): FreefallPiece => ({ id, color, paint: piecePaint("freefall", id) });

/** A pod is sand, warm cargo; nothing else on the board is. Amber is the player's own lane. */
export const FREEFALL_POD = piece("pod", "sand");
/** The rockers are the shaft's structure: slate, both sides. */
export const FREEFALL_CRADLE = piece("cradle", "slate");
/** The arm is drawn rising to the right of its pivot; the board mirrors it when the arm is on the left. */
export const FREEFALL_ARM = piece("arm", "slate");
/** A berth, dim under its value. */
export const FREEFALL_BERTH = piece("berth", "dim");
