import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { PACT_BACK, PACT_NIL, PACT_SUITS, PACT_TRICK, type PactPiece } from "./pieces.js";

const PIECES: Readonly<Record<string, PactPiece>> = {
  club: PACT_SUITS[0]!,
  diamond: PACT_SUITS[1]!,
  heart: PACT_SUITS[2]!,
  spade: PACT_SUITS[3]!,
  back: PACT_BACK,
  trick: PACT_TRICK,
  nil: PACT_NIL,
};

export type PactIconPiece = "spade" | "heart" | "diamond" | "club" | "back" | "trick" | "nil";

/** One of Pact's pieces as an image, for a legend: the same drawing the board bakes. */
export function PactIcon({ piece, size = 22 }: { piece: PactIconPiece; size?: number }) {
  const p = PIECES[piece]!;
  return <PictogramIcon name={`pact:${p.id}`} color={p.color} paint={p.paint} size={size} />;
}
