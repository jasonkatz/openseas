import type { Token } from "../look/tokens.js";
import { bar, cut, disc, rounded, soft, type Paint } from "../kit/pictogram.js";

/**
 * Salvage's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). The field is
 * wreckage adrift, and each kind of debris is one solid piece of it with an outline of its own: an
 * ingot is a trapezoid bar, a panel a hull plate with a corner torn out, a shard a leaning sliver,
 * a crystal a cut gem, a cell an upright capsule, a spark a four pointed star, a strut a rod with a
 * knuckle at each end, a droplet a tear. Debris has no cut-out. The two pieces that are not debris
 * each have one: a loot crate is the one full square, with its latch cut out, and a coupler is a
 * ring with four lugs. Colour is a second cue and never the only one.
 */

export interface SalvageKind {
  /** The message key's suffix: the legend reads `salvage.kind.<id>`. */
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

/**
 * The debris, in the order the engine numbers it; a field uses the first n. No kind is amber, which
 * is the tether in the player's hand, and none is cream, which is the crate, the coupler and a net.
 */
export const SALVAGE_KINDS: readonly SalvageKind[] = [
  // An ingot: a bar, wider at its foot.
  { id: "ingot", color: "sand", paint: (ctx) => soft(ctx, [7.4, 6.8, 16.6, 6.8, 20.4, 17.2, 3.6, 17.2], 3.2) },
  // A hull panel with its upper corner torn out.
  {
    id: "panel",
    color: "sky",
    paint: (ctx) => {
      rounded(ctx, 2.5, 2.5, 9, 19, 2.5);
      rounded(ctx, 2.5, 12.5, 19, 9, 2.5);
    },
  },
  // A shard: a sliver, leaning.
  { id: "shard", color: "rose", paint: (ctx) => soft(ctx, [15, 4.2, 20, 14.2, 4.8, 19.8], 3.2) },
  // A crystal: a cut gem, its table up and its point down.
  { id: "crystal", color: "moss", paint: (ctx) => soft(ctx, [8.2, 4.2, 15.8, 4.2, 20, 9.4, 12, 20.2, 4, 9.4], 2.4) },
  // A power cell: a capsule, standing.
  { id: "cell", color: "lilac", paint: (ctx) => rounded(ctx, 6.5, 2, 11, 20, 5.5) },
  // A spark: four blunt points.
  { id: "spark", color: "teal", paint: (ctx) => soft(ctx, [12, 3, 14.5, 9.5, 21, 12, 14.5, 14.5, 12, 21, 9.5, 14.5, 3, 12, 9.5, 9.5], 2.2) },
  // A strut: a rod with a knuckle at each end.
  {
    id: "strut",
    color: "slate",
    paint: (ctx) => {
      bar(ctx, 6.4, 17.6, 17.6, 6.4, 4);
      disc(ctx, 6.2, 17.8, 4.2);
      disc(ctx, 17.8, 6.2, 4.2);
    },
  },
  // A droplet: a tear, its point up.
  {
    id: "droplet",
    color: "rust",
    paint: (ctx) => {
      disc(ctx, 12, 14.6, 7.4);
      soft(ctx, [12, 4, 17.2, 11.4, 6.8, 11.4], 2.4);
    },
  },
];

export const salvageKind = (kind: number): SalvageKind => SALVAGE_KINDS[((kind % SALVAGE_KINDS.length) + SALVAGE_KINDS.length) % SALVAGE_KINDS.length]!;

/** A loot crate: the one full square on the field, its latch cut out. */
export const SALVAGE_CRATE_PAINT: Paint = (ctx) => {
  rounded(ctx, 2, 2, 20, 20, 3);
  cut(ctx, () => rounded(ctx, 8, 9.5, 8, 5, 2));
};

/** A coupler: a ring with four lugs, a joint and no kind of debris. */
export const SALVAGE_COUPLER_PAINT: Paint = (ctx) => {
  for (const [x, y] of [
    [5.4, 5.4],
    [18.6, 5.4],
    [5.4, 18.6],
    [18.6, 18.6],
  ] as const)
    disc(ctx, x, y, 3.2);
  disc(ctx, 12, 12, 8.2);
  cut(ctx, () => disc(ctx, 12, 12, 3.6));
};

/** The crate and the coupler are the field's special pieces: cream. */
export const SALVAGE_CRATE_COLOR: Token = "cream";
export const SALVAGE_COUPLER_COLOR: Token = "cream";
