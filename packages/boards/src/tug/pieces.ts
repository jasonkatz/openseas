import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Tug's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The bay is seen from above. A
 * pod is one solid piece of cargo with an outline of its own: a drum is a disc, a crate a square, a
 * wedge a triangle, a prism a diamond, a cell a capsule. A clamp is the floor socket its pod drops
 * into: the same outline, a size larger (its rim stands 2 units outside the pod), with the pod's
 * own shape a unit smaller cut out of it, so a clamp is its pod's partner with the colour taken
 * away and no pod is mistaken for one. A block is a girder stub, an outline no pod has. Colour is a
 * second cue and never the only one. Each is drawn from its layers in `data/pieces/tug.json`
 * (ADR 0065): a pod by its id, its clamp as `clamp-<id>`, and `block`.
 */

export interface TugPod {
  /** The message key suffix: `tug.pod.<id>`; its drawing is the piece of that name, its clamp's `clamp-<id>`. */
  readonly id: string;
  readonly color: Token;
}

/** The pods in the order the engine numbers them. A bay holds the first `pods` of them. */
export const TUG_PODS: readonly TugPod[] = [
  { id: "drum", color: "sand" },
  { id: "crate", color: "sky" },
  { id: "wedge", color: "rose" },
  { id: "prism", color: "moss" },
  { id: "cell", color: "lilac" },
];

export const tugPod = (pod: number): TugPod => TUG_PODS[((pod % TUG_PODS.length) + TUG_PODS.length) % TUG_PODS.length]!;

/** The drawing of a pod: its outline, solid. */
export function tugPodPaint(pod: number): Paint {
  return piecePaint("tug", tugPod(pod).id);
}

/** The drawing of the clamp that wants `pod`: the pod's outline a size larger, with the pod's shape cut out. */
export function tugClampPaint(pod: number): Paint {
  return piecePaint("tug", `clamp-${tugPod(pod).id}`);
}

/** The colour a pod and its clamp are drawn in. */
export const tugPodColor = (pod: number): Token => tugPod(pod).color;

/** A block: a girder stub seen end on, two flanges and the web between them. Fixed, and a stop like any wall. */
export const TUG_BLOCK_PAINT: Paint = piecePaint("tug", "block");

/** Blocks are inert: slate. */
export const TUG_BLOCK_COLOR: Token = "slate";
