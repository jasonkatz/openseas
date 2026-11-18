import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Racks' pieces, as pictograms (docs/BRAND.md section 3, ADR 0062), each drawn from its layers in
 * `data/pieces/racks.json` (ADR 0065) by the kind's id, and the crate as `crate`. A fuel cell is a
 * vessel with a gauge window cut in it. Each kind is a vessel of its own outline (a round cell, a
 * square tank, a cone, a pod, a capsule, a cross, a battery, a pail), so a kind is told from every
 * other by its silhouette alone; the window is the same on all of them and the colour comes second.
 * The crate is a trolley, two cables and a box.
 */

export interface RacksKind {
  /** The message key's suffix: the legend reads `racks.kind.<id>`. */
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

/**
 * The kinds, in the order the engine numbers them; a row uses the first n. No kind is amber, and
 * none is rust, which would sit beside the danger of a crate with no room.
 */
export const RACKS_KINDS: readonly RacksKind[] = [
  // A round cell.
  { id: "sol", color: "sand", paint: piecePaint("racks", "sol") },
  // A square tank.
  { id: "cryo", color: "sky", paint: piecePaint("racks", "cryo") },
  // A cone.
  { id: "plasma", color: "rose", paint: piecePaint("racks", "plasma") },
  // A pod, standing on its point.
  { id: "bio", color: "moss", paint: piecePaint("racks", "bio") },
  // A capsule on its side.
  { id: "ion", color: "lilac", paint: piecePaint("racks", "ion") },
  // A cross of four terminals.
  { id: "spark", color: "teal", paint: piecePaint("racks", "spark") },
  // A battery, its terminal up.
  { id: "dry", color: "slate", paint: piecePaint("racks", "dry") },
  // A pail, wide at the top.
  { id: "coolant", color: "cream", paint: piecePaint("racks", "coolant") },
];

export const racksKind = (kind: number): RacksKind => RACKS_KINDS[((kind % RACKS_KINDS.length) + RACKS_KINDS.length) % RACKS_KINDS.length]!;

/** The crate for a legend: the trolley, its two cables and the box, with the box's opening cut out. */
export const CRATE_PAINT: Paint = piecePaint("racks", "crate");

/** The trolley's colour: dim while the crate fits, cream when it will ship its rack, danger when it has no room. */
export const trolleyColor = (fits: boolean, ships: boolean): Token => (!fits ? "danger" : ships ? "cream" : "dim");
