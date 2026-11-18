import type { Token } from "../look/tokens.js";
import { cut, disc, rounded, soft, type Ctx, type Paint } from "../kit/pictogram.js";

/**
 * Tug's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). The bay is seen
 * from above. A pod is one solid piece of cargo with an outline of its own: a drum is a disc, a
 * crate a square, a wedge a triangle, a prism a diamond, a cell a capsule. A clamp is the floor
 * socket its pod drops into: the same outline, a size larger, with the pod's own shape cut out of
 * it, so a clamp is its pod's partner with the colour taken away and no pod is mistaken for one.
 * A block is a girder stub, an outline no pod has. Colour is a second cue and never the only one.
 */

/** Draws a pod's outline round the centre of the 24 unit square, pushed out by `grow` units (in, when negative). */
type Outline = (ctx: Ctx, grow: number) => void;

export interface TugPod {
  /** The message key suffix: `tug.pod.<id>`. */
  readonly id: string;
  readonly color: Token;
  readonly outline: Outline;
}

/** A polygon with rounded corners: `round` is how far the corners reach past the points. */
const poly =
  (pts: readonly number[], round: number): Outline =>
  (ctx, grow) =>
    soft(ctx, pts, (round + grow) * 2);

/** The pods in the order the engine numbers them. A bay holds the first `pods` of them. */
export const TUG_PODS: readonly TugPod[] = [
  { id: "drum", color: "sand", outline: (ctx, g) => disc(ctx, 12, 12, 9.6 + g) },
  { id: "crate", color: "sky", outline: (ctx, g) => rounded(ctx, 3.2 - g, 3.2 - g, 17.6 + g * 2, 17.6 + g * 2, 2.6 + g) },
  { id: "wedge", color: "rose", outline: poly([12, 5.4, 19.4, 18.2, 4.6, 18.2], 1.8) },
  { id: "prism", color: "moss", outline: poly([12, 3.8, 19.4, 12, 12, 20.2, 4.6, 12], 1.6) },
  { id: "cell", color: "lilac", outline: (ctx, g) => rounded(ctx, 2.2 - g, 7 - g, 19.6 + g * 2, 10 + g * 2, 5 + g) },
];

export const tugPod = (pod: number): TugPod => TUG_PODS[((pod % TUG_PODS.length) + TUG_PODS.length) % TUG_PODS.length]!;

/** How far a clamp's rim stands outside its pod and how far it reaches under it, in units: a rim 3 wide. */
const CLAMP_OUT = 2;
const CLAMP_IN = 1;

/** The drawing of a pod: its outline, solid. */
export function tugPodPaint(pod: number): Paint {
  const { outline } = tugPod(pod);
  return (ctx) => outline(ctx, 0);
}

/** The drawing of the clamp that wants `pod`: the pod's outline a size larger, with the pod's shape cut out. */
export function tugClampPaint(pod: number): Paint {
  const { outline } = tugPod(pod);
  return (ctx) => {
    outline(ctx, CLAMP_OUT);
    cut(ctx, () => outline(ctx, -CLAMP_IN));
  };
}

/** The colour a pod and its clamp are drawn in. */
export const tugPodColor = (pod: number): Token => tugPod(pod).color;

/** A block: a girder stub seen end on, two flanges and the web between them. Fixed, and a stop like any wall. */
export const TUG_BLOCK_PAINT: Paint = (ctx) => {
  rounded(ctx, 2, 2, 20, 7.2, 2);
  rounded(ctx, 2, 14.8, 20, 7.2, 2);
  rounded(ctx, 6.8, 4, 10.4, 16, 1);
};

/** Blocks are inert: slate. */
export const TUG_BLOCK_COLOR: Token = "slate";
