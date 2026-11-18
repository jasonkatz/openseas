import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Deflectors' pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). A mirror is a bar on a
 * pivot, drawn as a `/`; a `\` is the same picture a quarter turn on, so the way a mirror is set is
 * its outline. Each beam of a volley wears a sign with a silhouette of its own (a disc, a square, a
 * triangle) and a colour second. An entry port wears the sign solid; an exit port wears it with its
 * middle cut out, until the beam is home and it fills. Each is drawn from its layers in
 * `data/pieces/deflectors.json` (ADR 0065): `mirror`, `sign-<shape>` and `sign-<shape>-hollow`.
 */

/** A mirror set as `/`: a bar with a boss at its pivot and the pivot's hole cut through. */
export const MIRROR_PAINT: Paint = piecePaint("deflectors", "mirror");

/** The colour mirrors are drawn in. */
export const MIRROR_COLOR: Token = "sky";

export type SignShape = "disc" | "square" | "triangle";

export interface DeflectorsSign {
  readonly shape: SignShape;
  readonly color: Token;
}

/** The sign of each beam of a volley, in the order the engine numbers them. */
export const DEFLECTORS_SIGNS: readonly DeflectorsSign[] = [
  { shape: "disc", color: "sand" },
  { shape: "square", color: "rose" },
  { shape: "triangle", color: "moss" },
];

export const signOf = (sign: number): DeflectorsSign => DEFLECTORS_SIGNS[sign % DEFLECTORS_SIGNS.length]!;

/** The drawing of a beam's sign: solid for an entry and a beam that is home, hollow for an exit still waiting. */
export function signPaint(shape: SignShape, hollow: boolean): Paint {
  return piecePaint("deflectors", hollow ? `sign-${shape}-hollow` : `sign-${shape}`);
}
