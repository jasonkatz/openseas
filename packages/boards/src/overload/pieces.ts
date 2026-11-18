import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Overload's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062), each drawn from its layers
 * in `data/pieces/overload.json` (ADR 0065): `cap-<charge>` and `booster-<charge>`, 0 to 4. A
 * capacitor is a disc, seen from above. A booster is a disc with four lugs, one towards each
 * neighbour it passes two charges to, so the two are told apart by outline alone. The charge is a
 * rule's number on the piece, so it is part of the drawing: one hole cut for each charge, with the
 * ground showing through. The colour steps with the charge as a second cue and is never the only one.
 */

/** The most holes drawn: a capacitor at four is full and about to burst. */
export const OVERLOAD_MAX_SHOWN = 4;

/** The piece colour of each charge, 0 to 4: inert at none, and cream for the one about to burst. */
export const OVERLOAD_CHARGE_COLORS: readonly Token[] = ["slate", "sky", "sand", "rust", "cream"];

/** The drawing of a capacitor holding `charge`, plain or a booster, on the 24 unit square. */
export function overloadPaint(charge: number, booster: boolean): Paint {
  const c = Math.max(0, Math.min(OVERLOAD_MAX_SHOWN, charge));
  return piecePaint("overload", `${booster ? "booster" : "cap"}-${c}`);
}

/** The colour a capacitor holding `charge` is drawn in. */
export const overloadColor = (charge: number): Token => OVERLOAD_CHARGE_COLORS[Math.max(0, Math.min(OVERLOAD_MAX_SHOWN, charge))]!;
