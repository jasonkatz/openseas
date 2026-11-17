import type { Brush } from "@openseas/engine";
import type { PieceColor } from "@openseas/content";
import { plateDataUrl, type PlateCells, type PlateCut } from "./pieces.js";

const ONE: PlateCells = [[0, 0]];

/**
 * One Plating plate as an image, for a legend: the same drawing the board makes. With no `cells`
 * it is a single cell, which is enough to show a metal's cut-out; with no `cut` it is a blank plate,
 * which is enough to show a footprint.
 */
export function PlatingPlateIcon(props: { color: PieceColor; cut?: PlateCut | null; brush?: Brush; cells?: PlateCells; size?: number }) {
  const size = props.size ?? 26;
  return <img src={plateDataUrl(props.cells ?? ONE, props.cut ?? null, props.brush ?? "h", props.color, size)} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
