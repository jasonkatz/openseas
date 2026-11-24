import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Deflectors' pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). A mirror is a bar on a
 * pivot, drawn as a `/`; a `\` is the same picture a quarter turn on, so the way a mirror is set is
 * its outline. Each emitter wears a sign with a silhouette of its own (a disc, a square, a triangle)
 * and a colour second, and its beam's route is beaded with it. Each kind of lens is a glass of its
 * own outline (a diamond, a hexagon, a cross), none a sign's, with a small window cut through; a
 * target's recipe is the same glasses drawn small outside it. A target is a bullseye, a rim round
 * an eye, none of the others' outlines. Each is drawn from its layers in
 * `data/pieces/deflectors.json` (ADR 0065): `mirror`, `sign-<shape>`, `lens-<shape>` and `target`.
 */

/** A mirror set as `/`: a bar with a boss at its pivot and the pivot's hole cut through. */
export const MIRROR_PAINT: Paint = piecePaint("deflectors", "mirror");

/** The colour mirrors are drawn in. */
export const MIRROR_COLOR: Token = "sky";

/** A target on the edge: a bullseye. */
export const TARGET_PAINT: Paint = piecePaint("deflectors", "target");

/** The colour targets are drawn in. */
export const TARGET_COLOR: Token = "ice";

export type SignShape = "disc" | "square" | "triangle";

export interface DeflectorsSign {
  readonly shape: SignShape;
  readonly color: Token;
}

/** The sign of each emitter and its beam, top to bottom, in the order the engine numbers them. */
export const DEFLECTORS_SIGNS: readonly DeflectorsSign[] = [
  { shape: "disc", color: "sand" },
  { shape: "square", color: "rose" },
  { shape: "triangle", color: "moss" },
];

export const signOf = (sign: number): DeflectorsSign => DEFLECTORS_SIGNS[sign % DEFLECTORS_SIGNS.length]!;

/** The drawing of an emitter's sign. */
export function signPaint(shape: SignShape): Paint {
  return piecePaint("deflectors", `sign-${shape}`);
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
