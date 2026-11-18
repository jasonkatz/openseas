import type { Token } from "../look/tokens.js";
import { bar, cut, disc, rounded, soft, type Ctx, type Paint } from "../kit/pictogram.js";

/**
 * Cutting's ores, drawn in code (docs/BRAND.md section 3, ADR 0062). A slab is cells of ore sitting
 * edge to edge, so the rules fix every cell's outline: it is a square, whatever its ore. Each ore
 * instead carries one cut-out no other ore has, through which the ground shows (a hole, a slot, a
 * cross, a wedge, a lozenge, a pair of holes, a ring, a pair of slots), and that cut-out tells the
 * ores apart with the colour taken away.
 *
 * A cell is painted to the edge of the 24 unit square but for half a unit, so the cells of a piece
 * leave a thin gap between them: that gap is the slab's grid, and no line is drawn for it.
 */

export interface CuttingOre {
  /** The message key's suffix: the legend reads `cutting.ore.<id>`. */
  readonly id: string;
  readonly color: Token;
  /** One cell of the ore, filling the 24 unit square. */
  readonly paint: Paint;
}

/** The cell every ore is cut from. */
const cell = (ctx: Ctx): void => rounded(ctx, 0.5, 0.5, 23, 23, 2.5);

const ore = (id: string, color: Token, hole: (ctx: Ctx) => void): CuttingOre => ({
  id,
  color,
  paint: (ctx) => {
    cell(ctx);
    cut(ctx, () => hole(ctx));
  },
});

/**
 * The ores, in the order the engine numbers them; a slab uses the first n. No ore is amber, and
 * none is rust, which would sit beside the danger of a rough slab.
 */
export const CUTTING_ORES: readonly CuttingOre[] = [
  // One round hole.
  ore("nickel", "sand", (ctx) => disc(ctx, 12, 12, 4.4)),
  // A slot across.
  ore("cobalt", "sky", (ctx) => rounded(ctx, 4.5, 9.9, 15, 4.2, 2.1)),
  // A cross.
  ore("quartz", "rose", (ctx) => {
    bar(ctx, 12, 6.6, 12, 17.4, 3.6);
    bar(ctx, 6.6, 12, 17.4, 12, 3.6);
  }),
  // A wedge, point up.
  ore("olivine", "moss", (ctx) => soft(ctx, [12, 7.4, 17.4, 16.2, 6.6, 16.2], 2.4)),
  // A lozenge on its point.
  ore("spinel", "lilac", (ctx) => soft(ctx, [12, 6.2, 17.8, 12, 12, 17.8, 6.2, 12], 1.8)),
  // Two round holes side by side.
  ore("beryl", "teal", (ctx) => {
    disc(ctx, 7.6, 12, 2.8);
    disc(ctx, 16.4, 12, 2.8);
  }),
  // A ring: a hole with its middle left in.
  {
    id: "iron",
    color: "slate",
    paint: (ctx) => {
      cell(ctx);
      cut(ctx, () => disc(ctx, 12, 12, 6));
      disc(ctx, 12, 12, 2.6);
    },
  },
  // Two slots, one over the other.
  ore("chalk", "cream", (ctx) => {
    rounded(ctx, 5, 6.9, 14, 3.6, 1.8);
    rounded(ctx, 5, 13.5, 14, 3.6, 1.8);
  }),
];

export const cuttingOre = (kind: number): CuttingOre => CUTTING_ORES[((kind % CUTTING_ORES.length) + CUTTING_ORES.length) % CUTTING_ORES.length]!;
