import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Deflectors' pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). A mirror is a bar on a
 * pivot, drawn as a `/`; a `\` is the same picture a quarter turn on, so the way a mirror is set is
 * its outline. Each beam of a volley wears a sign with a silhouette of its own (a disc, a square, a
 * triangle) and a colour second. An entry port wears the sign solid; an exit port wears it with its
 * middle cut out, until the beam is home and it fills. Each kind of lens is a glass of its own
 * outline (a diamond, a hexagon, a cross), none a sign's, with a small window cut through; a beam's
 * recipe is the same glasses drawn small beside its exit. Each is drawn from its layers in
 * `data/pieces/deflectors.json` (ADR 0065): `mirror`, `sign-<shape>`, `sign-<shape>-hollow` and
 * `lens-<shape>`.
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

export type LensShape = "diamond" | "hexagon" | "cross";

export interface DeflectorsLens {
  readonly shape: LensShape;
  readonly color: Token;
}

/** Each kind of lens, in the order the engine numbers them. */
export const DEFLECTORS_LENSES: readonly DeflectorsLens[] = [
  { shape: "diamond", color: "lilac" },
  { shape: "hexagon", color: "teal" },
  { shape: "cross", color: "rust" },
];

export const lensOf = (kind: number): DeflectorsLens => DEFLECTORS_LENSES[kind % DEFLECTORS_LENSES.length]!;

/** The drawing of a lens of `shape`. */
export function lensPaint(shape: LensShape): Paint {
  return piecePaint("deflectors", `lens-${shape}`);
}
