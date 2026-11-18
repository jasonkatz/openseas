import type { PieceColor } from "@openseas/content";
import { pelletDataUrl, type PelletShape } from "./pellets.js";

/** One Engines pellet as an image, for a legend or the next pair: the same drawing the board bakes. `hollow` is its target. */
export function PelletIcon(props: { shape: PelletShape; color: PieceColor; hollow?: boolean; size?: number }) {
  const size = props.size ?? 22;
  return <img src={pelletDataUrl(props.shape, props.color, size, props.hollow ? "target" : "solid")} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
