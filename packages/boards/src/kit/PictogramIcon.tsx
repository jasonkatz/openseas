import type { Token } from "../look/tokens.js";
import { pictogramUrl, type Paint } from "./pictogram.js";

export interface PictogramIconProps {
  /** Names the drawing for the cache: the puzzle, the piece and its state (`overload:cap:2`). */
  name: string;
  color: Token;
  paint: Paint;
  size?: number;
}

/** One pictogram as an image, for a legend or a HUD row: the same drawing a restyled kit board bakes (ADR 0062). */
export function PictogramIcon({ name, color, paint, size = 22 }: PictogramIconProps) {
  return <img src={pictogramUrl(name, color, paint, size)} width={size} height={size} alt="" aria-hidden="true" className="kind-icon" draggable={false} />;
}
