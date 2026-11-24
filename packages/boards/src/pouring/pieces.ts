import type { PouringPiece } from "@openseas/engine";
import type { Token } from "../look/tokens.js";
import { cut, type Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Pouring's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). A drink is a glass with a
 * brew in it. The glass is the outline, each its own: a tumbler a tapered block, a flute a tall
 * narrow bowl on a stem, a mug a body with a handle, a coupe a wide shallow bowl on a stem, a bulb a
 * sphere with a neck (a drink in free fall), a cone a deep triangle on a stem. The brew is the
 * colour and the mark cut out of the glass where the drink sits: a bead for fizz, a ring for halo,
 * a band for ribbon, a plus for spark, an X for ember, a triangle for drop. So a drink reads by its
 * outline and its mark with every piece in one colour. Ice is the one square block with a glint cut
 * out, a rag the one ragged cloth with its hem cut out. Each is drawn from its layers in
 * `data/pieces/pouring.json` (ADR 0065); a drink composes a glass and a brew's mark here, where the
 * mark sits being what code must say.
 */

export interface PouringGlass {
  /** The message key's suffix (`pouring.glass.<id>`), and its drawing's name. */
  readonly id: string;
  /** Where the brew's mark is cut, on the 24 unit square, and how large: the heart of the bowl. */
  readonly heart: readonly [number, number, number];
  readonly paint: Paint;
}

export interface PouringBrew {
  /** The message key's suffix (`pouring.brew.<id>`), and its mark's drawing's name. */
  readonly id: string;
  readonly color: Token;
  readonly mark: Paint;
}

const glass = (id: string, x: number, y: number, k: number): PouringGlass => ({ id, heart: [x, y, k], paint: piecePaint("pouring", id) });
const brew = (id: string, color: Token): PouringBrew => ({ id, color, mark: piecePaint("pouring", id) });

/** The glasses, in the order the engine numbers them; a bar uses the first n. */
export const POURING_GLASSES: readonly PouringGlass[] = [
  glass("tumbler", 12, 12.6, 1),
  glass("flute", 12, 7.6, 0.8),
  glass("mug", 9.8, 12.8, 1),
  glass("coupe", 12, 8.2, 0.85),
  glass("bulb", 12, 14.4, 1),
  glass("cone", 12, 6.4, 0.8),
];

/** The brews, in the order the engine numbers them. None is amber, which is the player's, nor cream or ice. */
export const POURING_BREWS: readonly PouringBrew[] = [
  brew("fizz", "rose"),
  brew("halo", "sky"),
  brew("ribbon", "moss"),
  brew("spark", "sand"),
  brew("ember", "lilac"),
  brew("drop", "teal"),
];

const wrap = <T>(xs: readonly T[], i: number): T => xs[((i % xs.length) + xs.length) % xs.length]!;
export const pouringGlass = (i: number): PouringGlass => wrap(POURING_GLASSES, i);
export const pouringBrew = (i: number): PouringBrew => wrap(POURING_BREWS, i);

/** A drink: its glass with its brew's mark cut out at the glass's heart. */
export function pouringDrinkPaint(g: PouringGlass, b: PouringBrew): Paint {
  const [x, y, k] = g.heart;
  return (ctx) => {
    g.paint(ctx);
    cut(ctx, () => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(k, k);
      ctx.translate(-12, -12);
      b.mark(ctx);
      ctx.restore();
    });
  };
}

export const POURING_ICE_PAINT: Paint = piecePaint("pouring", "ice");
export const POURING_ICE_COLOR: Token = "ice";
export const POURING_RAG_PAINT: Paint = piecePaint("pouring", "rag");
export const POURING_RAG_COLOR: Token = "dim";

/** Any piece's key, colour and paint, for the board and the legend alike. */
export function pouringPieceLook(p: Pick<PouringPiece, "kind" | "glass" | "brew">): { key: string; color: Token; paint: Paint } {
  if (p.kind === "ice") return { key: "ice", color: POURING_ICE_COLOR, paint: POURING_ICE_PAINT };
  if (p.kind === "rag") return { key: "rag", color: POURING_RAG_COLOR, paint: POURING_RAG_PAINT };
  const g = pouringGlass(p.glass);
  const b = pouringBrew(p.brew);
  return { key: `drink:${g.id}:${b.id}`, color: b.color, paint: pouringDrinkPaint(g, b) };
}

/**
 * A pirate's ring, left on every square they rang first: the player's one solid circle in amber,
 * each rival's broken into its own number of arcs (two, three, four) in a quiet ink, so whose
 * ring it is reads without colour. Drawn round the square, under the drink.
 */
export function pouringSeatRing(seat: number): { key: string; color: Token; paint: Paint } {
  const arcs = seat === 0 ? 1 : seat + 1;
  const color: Token = seat === 0 ? "amber" : "dim";
  const paint: Paint = (ctx) => {
    ctx.lineWidth = seat === 0 ? 1.4 : 1.1;
    ctx.lineCap = "round";
    const span = (Math.PI * 2) / arcs;
    const gap = arcs === 1 ? 0 : 0.5;
    for (let i = 0; i < arcs; i++) {
      ctx.beginPath();
      const from = -Math.PI / 2 + i * span + gap / 2;
      ctx.arc(12, 12, 11, from, from + span - gap);
      ctx.stroke();
    }
  };
  return { key: `ring:${seat}`, color, paint };
}
