import type { PieceColor } from "@openseas/content";
import { gunneryPieceUrl, type GunneryShape } from "./pieces.js";

/** One Gunnery piece as an image, for a legend: the same drawing the board bakes. */
export function GunneryPieceIcon(props: { shape: GunneryShape; color: PieceColor; size?: number }) {
  const size = props.size ?? 26;
  return <img src={gunneryPieceUrl(props.shape, props.color, size)} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
