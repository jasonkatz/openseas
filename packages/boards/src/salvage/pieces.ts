import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Salvage's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The field is wreckage
 * adrift, and each kind of debris is one solid piece of it with an outline of its own: an ingot is
 * a trapezoid bar, a panel a hull plate with a corner torn out, a shard a leaning sliver, a crystal
 * a cut gem, a cell an upright capsule, a spark a four pointed star, a strut a rod with a knuckle
 * at each end, a droplet a tear. Debris has no cut-out. The two pieces that are not debris each
 * have one: a loot crate is the one full square, with its latch cut out, and a coupler is a ring
 * with four lugs. Colour is a second cue and never the only one. Each is drawn from its layers in
 * `data/pieces/salvage.json` (ADR 0065): a kind by its id, and `crate` and `coupler`.
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
 * is the tether in the player's hand, and none is cream, which is the crate, the coupler and a net.
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

/** A coupler: a ring with four lugs, a joint and no kind of debris. */
export const SALVAGE_COUPLER_PAINT: Paint = piecePaint("salvage", "coupler");

/** The crate and the coupler are the field's special pieces: cream. */
export const SALVAGE_CRATE_COLOR: Token = "cream";
export const SALVAGE_COUPLER_COLOR: Token = "cream";
