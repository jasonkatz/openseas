import type { PieceColor } from "@openseas/content";
import { pieceDataUrl, type Pictogram } from "./pieces.js";

/** One Cooling piece as an image, for a legend or a splash: the same drawing the board bakes. */
export function CoolingPieceIcon(props: { shape: Pictogram; color: PieceColor; size?: number }) {
  const size = props.size ?? 26;
  return <img src={pieceDataUrl(props.shape, props.color, size)} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
