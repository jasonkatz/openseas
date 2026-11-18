import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Cutting's ores, as pictograms (docs/BRAND.md section 3, ADR 0062). A slab is cells of ore sitting
 * edge to edge, so the rules fix every cell's outline: it is a square, whatever its ore. Each ore
 * instead carries one cut-out no other ore has, through which the ground shows (a hole, a slot, a
 * cross, a wedge, a lozenge, a pair of holes, a ring, a pair of slots), and that cut-out tells the
 * ores apart with the colour taken away. Each is drawn from its layers in
 * `data/pieces/cutting.json` (ADR 0065), by the ore's id.
 *
 * A cell is painted to the edge of the 24 unit square but for half a unit, so the cells of a piece
 * leave a thin gap between them: that gap is the slab's grid, and no line is drawn for it.
 */

export interface CuttingOre {
  /** The message key's suffix: the legend reads `cutting.ore.<id>`, and its drawing is the piece of that name. */
  readonly id: string;
  readonly color: Token;
  /** One cell of the ore, filling the 24 unit square. */
  readonly paint: Paint;
}

const ore = (id: string, color: Token): CuttingOre => ({ id, color, paint: piecePaint("cutting", id) });

/**
 * The ores, in the order the engine numbers them; a slab uses the first n. No ore is amber, and
 * none is rust, which would sit beside the danger of a rough slab.
 */
export const CUTTING_ORES: readonly CuttingOre[] = [
  // One round hole.
  ore("nickel", "sand"),
  // A slot across.
  ore("cobalt", "sky"),
  // A cross.
  ore("quartz", "rose"),
  // A wedge, point up.
  ore("olivine", "moss"),
  // A lozenge on its point.
  ore("spinel", "lilac"),
  // Two round holes side by side.
  ore("beryl", "teal"),
  // A ring: a hole with its middle left in.
  ore("iron", "slate"),
  // Two slots, one over the other.
  ore("chalk", "cream"),
];

export const cuttingOre = (kind: number): CuttingOre => CUTTING_ORES[((kind % CUTTING_ORES.length) + CUTTING_ORES.length) % CUTTING_ORES.length]!;
