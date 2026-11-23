import type { TractorMark } from "@openseas/engine";
import type { Token } from "../look/tokens.js";
import { bar, cut, type Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Tractor's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The field is loot adrift
 * after a fight, and each kind is one solid piece of treasure with an outline of its own: a coin is
 * a disc, an ingot a low trapezoid bar, a gem a diamond standing on its point, a chalice a bowl on
 * a stem and foot, a crown three points over a band, an idol a round head on a square body, a
 * flask a bulb with a neck, a scroll a sheet between two rolls. Loot has no cut-out. A beacon is
 * loot with its mark cut through its heart: a plus for a cross, an X for a saltire, drawn here
 * since the mark is the engine's. A cache is the one wide box on the field, its lid's seam and its
 * lock cut out. Colour is a second cue and never the only one. Each is drawn from its layers in
 * `data/pieces/tractor.json` (ADR 0065): a kind by its id, and `cache`.
 */

export interface TractorKind {
  /** The message key's suffix: the legend reads `tractor.kind.<id>`, and its drawing is the piece of that name. */
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

const kind = (id: string, color: Token): TractorKind => ({ id, color, paint: piecePaint("tractor", id) });

/**
 * The loot, in the order the engine numbers it; a field uses the first n. No kind is amber, which
 * is the pair in the player's hand, and none is cream, which is the cache.
 */
export const TRACTOR_KINDS: readonly TractorKind[] = [
  kind("coin", "sand"),
  kind("ingot", "sky"),
  kind("gem", "rose"),
  kind("chalice", "moss"),
  kind("crown", "lilac"),
  kind("idol", "teal"),
  kind("flask", "slate"),
  kind("scroll", "rust"),
];

export const tractorKind = (kind: number): TractorKind => TRACTOR_KINDS[((kind % TRACTOR_KINDS.length) + TRACTOR_KINDS.length) % TRACTOR_KINDS.length]!;

/** A sealed cache: the one wide box on the field, its seam and lock cut out. */
export const TRACTOR_CACHE_PAINT: Paint = piecePaint("tractor", "cache");
/** The cache is the field's prize: cream. */
export const TRACTOR_CACHE_COLOR: Token = "cream";

/** Where each kind's mark is cut when it is a beacon: the heart of its widest part. */
const HEART: Readonly<Record<string, readonly [number, number]>> = { chalice: [12, 7.6], crown: [12, 14.4], idol: [12, 14.6], flask: [12, 14.4] };

/** A beacon of one kind: that kind's outline with its mark cut through its heart, a plus for a cross and an X for a saltire. */
export function tractorBeaconPaint(kind: TractorKind, mark: TractorMark): Paint {
  const [x, y] = HEART[kind.id] ?? [12, 12];
  return (ctx) => {
    kind.paint(ctx);
    cut(ctx, () => {
      const d = mark === "cross" ? 3.4 : 2.5;
      if (mark === "cross") {
        bar(ctx, x, y - d, x, y + d, 2.2);
        bar(ctx, x - d, y, x + d, y, 2.2);
      } else {
        bar(ctx, x - d, y - d, x + d, y + d, 2.2);
        bar(ctx, x + d, y - d, x - d, y + d, 2.2);
      }
    });
  };
}
