import { FONT } from "../look/tokens.js";
import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { reactorPortColor, reactorPortPaint, reactorRodColor, reactorRodPaint, type ReactorPortMark } from "./pieces.js";

/** A rod's numeral is set in the mono face: a picture made before the face is in is made again once it is. */
const faceIn = (): boolean => typeof document === "undefined" || (document.fonts?.check(`700 16px ${FONT.mono}`) ?? true);

/** One Reactor rod as an image, for a legend or the HUD: the same drawing the board bakes. */
export function ReactorRodIcon({ grade, hot = false, size = 22 }: { grade: number; hot?: boolean; size?: number }) {
  return <PictogramIcon name={`reactor:${hot ? "hot" : "rod"}:${grade}:${faceIn() ? 1 : 0}`} color={reactorRodColor(grade, hot)} paint={reactorRodPaint(grade, hot)} size={size} />;
}

/** A port as an image, for a legend: the gap in the wall and the mark the board draws over it. */
export function ReactorPortIcon({ status, size = 22 }: { status: ReactorPortMark; size?: number }) {
  return <PictogramIcon name={`reactor:port:${status}`} color={reactorPortColor(status)} paint={reactorPortPaint(status)} size={size} />;
}
