import type { Token } from "../look/tokens.js";
import { bar, cut, disc, rounded, soft, type Paint } from "../kit/pictogram.js";

/**
 * Deflectors' pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). A mirror is
 * a bar on a pivot, drawn as a `/`; a `\` is the same picture a quarter turn on, so the way a
 * mirror is set is its outline. Each beam of a volley wears a sign with a silhouette of its own (a
 * disc, a square, a triangle) and a colour second. An entry port wears the sign solid; an exit
 * port wears it with its middle cut out, until the beam is home and it fills.
 */

/** A mirror set as `/`: a bar with a boss at its pivot and the pivot's hole cut through. */
export const MIRROR_PAINT: Paint = (ctx) => {
  bar(ctx, 5.2, 18.8, 18.8, 5.2, 4.6);
  disc(ctx, 12, 12, 4.4);
  cut(ctx, () => disc(ctx, 12, 12, 1.6));
};

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

const SOLID: Record<SignShape, Paint> = {
  disc: (ctx) => disc(ctx, 12, 12, 9.5),
  square: (ctx) => rounded(ctx, 3.2, 3.2, 17.6, 17.6, 3.2),
  triangle: (ctx) => soft(ctx, [12, 4.4, 20.2, 18.8, 3.8, 18.8], 3.2),
};

const HOLE: Record<SignShape, Paint> = {
  disc: (ctx) => disc(ctx, 12, 12, 5.6),
  square: (ctx) => rounded(ctx, 7.2, 7.2, 9.6, 9.6, 1.4),
  triangle: (ctx) => soft(ctx, [12, 10.4, 15.4, 16.2, 8.6, 16.2], 0.8),
};

/** The drawing of a beam's sign: solid for an entry and a beam that is home, hollow for an exit still waiting. */
export function signPaint(shape: SignShape, hollow: boolean): Paint {
  if (!hollow) return SOLID[shape];
  return (ctx) => {
    SOLID[shape](ctx);
    cut(ctx, () => HOLE[shape](ctx));
  };
}
