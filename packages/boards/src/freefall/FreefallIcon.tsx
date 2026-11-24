import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { FREEFALL_ARM, FREEFALL_BERTH, FREEFALL_CRADLE, FREEFALL_POD, type FreefallPiece } from "./pieces.js";

const PIECES: Readonly<Record<"pod" | "cradle" | "arm" | "berth", FreefallPiece>> = {
  pod: FREEFALL_POD,
  cradle: FREEFALL_CRADLE,
  arm: FREEFALL_ARM,
  berth: FREEFALL_BERTH,
};

/** One of Freefall's pieces as an image, for a legend: the same drawing the board bakes. */
export function FreefallIcon({ piece, size = 22 }: { piece: keyof typeof PIECES; size?: number }) {
  const p = PIECES[piece];
  return <PictogramIcon name={`freefall:${p.id}`} color={p.color} paint={p.paint} size={size} />;
}
