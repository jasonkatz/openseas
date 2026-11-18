import type { Token } from "../look/tokens.js";
import { bar, cut, disc, rounded, soft, type Paint } from "../kit/pictogram.js";

/**
 * Salvage's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). The field is
 * wreckage adrift, and each kind of debris is one solid piece of it with an outline of its own: an
 * ingot is a trapezoid bar, a panel a hull plate with a corner torn out, a shard a leaning sliver,
 * a crystal a cut gem, a cell an upright capsule, a spark a four pointed star, a strut a rod with a
 * knuckle at each end, a droplet a tear. Debris has no cut-out. A volatile is debris with its fuse
 * on it: its own outline, a hole cut at its heart, and one notch on its crown for each haul left. A
 * loot crate is the one full square, with its latch cut out, and rubble is a heap of three broken
 * stones, dim. Colour is a second cue and never the only one.
 */

export interface SalvageKind {
  /** The message key's suffix: the legend reads `salvage.kind.<id>`. */
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

/**
 * The debris, in the order the engine numbers it; a field uses the first n. No kind is amber, which
 * is the tether in the player's hand, and none is cream, which is the crate and a net.
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

/** Rubble: a heap of three broken stones, left where a volatile blew. */
export const SALVAGE_RUBBLE_PAINT: Paint = (ctx) => {
  soft(ctx, [2.5, 21, 3.5, 13.5, 10, 12.5, 11, 21], 1.4);
  soft(ctx, [13, 21, 13.5, 12, 20.5, 13, 21.5, 21], 1.4);
  soft(ctx, [7.5, 10.5, 8.5, 3.5, 15, 3, 16, 10.5], 1.4);
};

/** A volatile of one kind: that kind's outline with a hole at its heart and a notch on its crown for each haul its fuse has left. */
export function salvageVolatilePaint(kind: SalvageKind, fuse: number): Paint {
  return (ctx) => {
    kind.paint(ctx);
    cut(ctx, () => disc(ctx, 12, 12.6, 2.6));
    const n = Math.max(0, Math.min(fuse, 8));
    const step = 3.3;
    const x0 = 12 - ((n - 1) * step) / 2;
    for (let i = 0; i < n; i++) disc(ctx, x0 + i * step, 1.7, 1.25);
  };
}

/** The crate is the field's prize: cream. Rubble is spent: dim. */
export const SALVAGE_CRATE_COLOR: Token = "cream";
export const SALVAGE_RUBBLE_COLOR: Token = "dim";
