import type { ShowdownStyle } from "@openseas/engine";
import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { SHOWDOWN_BACK, SHOWDOWN_BUTTON, SHOWDOWN_CHIP, SHOWDOWN_EMBLEMS, SHOWDOWN_SUITS, type ShowdownPiece } from "./pieces.js";

const PIECES: Readonly<Record<string, ShowdownPiece>> = {
  spade: SHOWDOWN_SUITS[0]!,
  heart: SHOWDOWN_SUITS[1]!,
  diamond: SHOWDOWN_SUITS[2]!,
  club: SHOWDOWN_SUITS[3]!,
  back: SHOWDOWN_BACK,
  chip: SHOWDOWN_CHIP,
  button: SHOWDOWN_BUTTON,
  ...SHOWDOWN_EMBLEMS,
};

export type ShowdownIconPiece = "spade" | "heart" | "diamond" | "club" | "back" | "chip" | "button" | ShowdownStyle;

/** One of Showdown's pieces as an image, for a legend: the same drawing the board bakes. */
export function ShowdownIcon({ piece, size = 22 }: { piece: ShowdownIconPiece; size?: number }) {
  const p = PIECES[piece]!;
  return <PictogramIcon name={`showdown:${p.id}`} color={p.color} paint={p.paint} size={size} />;
}
