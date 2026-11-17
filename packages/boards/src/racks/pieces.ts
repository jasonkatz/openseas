import type { Token } from "../look/tokens.js";
import { cut, disc, rounded, soft, type Ctx, type Paint } from "../kit/pictogram.js";

/**
 * Racks' pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). A fuel cell is a
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

/** The gauge window every cell has, centred on (12, y). */
const gauge = (ctx: Ctx, y: number, w = 8): void => cut(ctx, () => rounded(ctx, 12 - w / 2, y - 1.5, w, 3, 1.5));

/**
 * The kinds, in the order the engine numbers them; a row uses the first n. No kind is amber, and
 * none is rust, which would sit beside the danger of a crate with no room.
 */
export const RACKS_KINDS: readonly RacksKind[] = [
  // A round cell.
  {
    id: "sol",
    color: "sand",
    paint: (ctx) => {
      disc(ctx, 12, 12, 10);
      gauge(ctx, 12);
    },
  },
  // A square tank.
  {
    id: "cryo",
    color: "sky",
    paint: (ctx) => {
      rounded(ctx, 2.5, 2.5, 19, 19, 3.5);
      gauge(ctx, 12);
    },
  },
  // A cone.
  {
    id: "plasma",
    color: "rose",
    paint: (ctx) => {
      soft(ctx, [12, 4.6, 20.4, 19, 3.6, 19], 3.2);
      gauge(ctx, 14.8, 7);
    },
  },
  // A pod, standing on its point.
  {
    id: "bio",
    color: "moss",
    paint: (ctx) => {
      soft(ctx, [12, 3.4, 20.6, 12, 12, 20.6, 3.4, 12], 2.8);
      gauge(ctx, 12);
    },
  },
  // A capsule on its side.
  {
    id: "ion",
    color: "lilac",
    paint: (ctx) => {
      rounded(ctx, 2, 6, 20, 12, 6);
      gauge(ctx, 12);
    },
  },
  // A cross of four terminals.
  {
    id: "spark",
    color: "teal",
    paint: (ctx) => {
      rounded(ctx, 8, 2, 8, 20, 2.5);
      rounded(ctx, 2, 8, 20, 8, 2.5);
      gauge(ctx, 12);
    },
  },
  // A battery, its terminal up.
  {
    id: "dry",
    color: "slate",
    paint: (ctx) => {
      rounded(ctx, 9.5, 2, 5, 6, 1.5);
      rounded(ctx, 5.5, 5.5, 13, 16.5, 2.5);
      gauge(ctx, 13.8, 7);
    },
  },
  // A pail, wide at the top.
  {
    id: "coolant",
    color: "cream",
    paint: (ctx) => {
      soft(ctx, [3.6, 5, 20.4, 5, 16.4, 19.4, 7.6, 19.4], 3);
      gauge(ctx, 11.4);
    },
  },
];

export const racksKind = (kind: number): RacksKind => RACKS_KINDS[((kind % RACKS_KINDS.length) + RACKS_KINDS.length) % RACKS_KINDS.length]!;

/** The crate for a legend: the trolley, its two cables and the box, with the box's opening cut out. */
export const CRATE_PAINT: Paint = (ctx) => {
  rounded(ctx, 5, 2, 14, 6, 2);
  rounded(ctx, 7, 6, 3, 7, 0);
  rounded(ctx, 14, 6, 3, 7, 0);
  rounded(ctx, 4, 11, 16, 11, 2.5);
  cut(ctx, () => rounded(ctx, 8, 14.5, 8, 4, 1.5));
};

/** The trolley's colour: dim while the crate fits, cream when it will ship its rack, danger when it has no room. */
export const trolleyColor = (fits: boolean, ships: boolean): Token => (!fits ? "danger" : ships ? "cream" : "dim");
