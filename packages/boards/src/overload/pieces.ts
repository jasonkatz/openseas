import type { Token } from "../look/tokens.js";
import { cut, disc, rounded, type Paint } from "../kit/pictogram.js";

/**
 * Overload's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). A capacitor
 * is a disc, seen from above. A booster is a disc with four lugs, one towards each neighbour it
 * passes two charges to, so the two are told apart by outline alone. The charge is a rule's number
 * on the piece, so it is part of the drawing: one hole cut for each charge, with the ground showing
 * through. The colour steps with the charge as a second cue and is never the only one.
 */

/** The most holes drawn: a capacitor at four is full and about to burst. */
export const OVERLOAD_MAX_SHOWN = 4;

/** The piece colour of each charge, 0 to 4: inert at none, and cream for the one about to burst. */
export const OVERLOAD_CHARGE_COLORS: readonly Token[] = ["slate", "sky", "sand", "rust", "cream"];

/** Where the holes sit for each charge, as offsets from the centre in units of the spacing. */
const HOLES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],
  [[0, 0]],
  [[-1, 0], [1, 0]],
  [[0, -1], [-1, 0.8], [1, 0.8]],
  [[-1, -1], [1, -1], [-1, 1], [1, 1]],
];

function holes(charge: number, gap: number, r: number): Paint {
  return (ctx) => {
    for (const [dx, dy] of HOLES[charge] ?? []) disc(ctx, 12 + dx * gap, 12 + dy * gap, r);
  };
}

/** The drawing of a capacitor holding `charge`, plain or a booster, on the 24 unit square. */
export function overloadPaint(charge: number, booster: boolean): Paint {
  const c = Math.max(0, Math.min(OVERLOAD_MAX_SHOWN, charge));
  if (!booster) {
    return (ctx) => {
      disc(ctx, 12, 12, 10);
      cut(ctx, () => holes(c, 3.7, 2.1)(ctx));
    };
  }
  return (ctx) => {
    // Four lugs, up, down, left and right, and the can between them.
    rounded(ctx, 9, 1.5, 6, 21, 2);
    rounded(ctx, 1.5, 9, 21, 6, 2);
    disc(ctx, 12, 12, 8);
    cut(ctx, () => holes(c, 3.2, 1.8)(ctx));
  };
}

/** The colour a capacitor holding `charge` is drawn in. */
export const overloadColor = (charge: number): Token => OVERLOAD_CHARGE_COLORS[Math.max(0, Math.min(OVERLOAD_MAX_SHOWN, charge))]!;
