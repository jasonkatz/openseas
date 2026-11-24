import type { ForgingMark } from "@openseas/engine";
import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { forgingColor, forgingPaint } from "./pieces.js";

/** One mark as an image, for a legend or the preview: the same drawing the board bakes, at full heat. */
export function ForgingMarkIcon({ mark, heat = 3, size = 22 }: { mark: ForgingMark; heat?: number; size?: number }) {
  return <PictogramIcon name={`forging:${mark}:${heat}`} color={forgingColor(heat, mark)} paint={forgingPaint(mark)} size={size} />;
}
