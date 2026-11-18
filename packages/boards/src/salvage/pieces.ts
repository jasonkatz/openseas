import type { Token } from "../look/tokens.js";
import { cut, disc, type Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Salvage's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The field is wreckage
 * adrift, and each kind of debris is one solid piece of it with an outline of its own: an ingot is
 * a trapezoid bar, a panel a hull plate with a corner torn out, a shard a leaning sliver, a crystal
 * a cut gem, a cell an upright capsule, a spark a four pointed star, a strut a rod with a knuckle
 * at each end, a droplet a tear. Debris has no cut-out. A volatile is debris with its fuse on it:
 * its kind's outline, a hole cut at its heart, and one notch on its crown for each haul left, drawn
 * here since only code knows the count. A loot crate is the one full square, with its latch cut
 * out, and rubble is a heap of three broken stones, dim. Colour is a second cue and never the only
 * one. Each is drawn from its layers in `data/pieces/salvage.json` (ADR 0065): a kind by its id,
 * and `crate` and `rubble`.
 */

export interface SalvageKind {
  /** The message key's suffix: the legend reads `salvage.kind.<id>`, and its drawing is the piece of that name. */
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

const kind = (id: string, color: Token): SalvageKind => ({ id, color, paint: piecePaint("salvage", id) });

/**
 * The debris, in the order the engine numbers it; a field uses the first n. No kind is amber, which
 * is the tether in the player's hand, and none is cream, which is the crate and a net.
 */
export const SALVAGE_KINDS: readonly SalvageKind[] = [
  // An ingot: a bar, wider at its foot.
  kind("ingot", "sand"),
  // A hull panel with its upper corner torn out.
  kind("panel", "sky"),
  // A shard: a sliver, leaning.
  kind("shard", "rose"),
  // A crystal: a cut gem, its table up and its point down.
  kind("crystal", "moss"),
  // A power cell: a capsule, standing.
  kind("cell", "lilac"),
  // A spark: four blunt points.
  kind("spark", "teal"),
  // A strut: a rod with a knuckle at each end.
  kind("strut", "slate"),
  // A droplet: a tear, its point up.
  kind("droplet", "rust"),
];

export const salvageKind = (kind: number): SalvageKind => SALVAGE_KINDS[((kind % SALVAGE_KINDS.length) + SALVAGE_KINDS.length) % SALVAGE_KINDS.length]!;

/** A loot crate: the one full square on the field, its latch cut out. */
export const SALVAGE_CRATE_PAINT: Paint = piecePaint("salvage", "crate");

/** Rubble: a heap of three broken stones, left where a volatile blew. */
export const SALVAGE_RUBBLE_PAINT: Paint = piecePaint("salvage", "rubble");

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
