import type { PouringPieceKind } from "@openseas/engine";
import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { pouringGlass, pouringPieceLook, pouringSeatRing } from "./pieces.js";

/** One Pouring piece as an image, for a legend: the same drawing the board bakes. */
export function PouringPieceIcon({ kind = "drink", glass = 0, brew = 0, size = 22 }: { kind?: PouringPieceKind; glass?: number; brew?: number; size?: number }) {
  const look = pouringPieceLook({ kind, glass, brew });
  return <PictogramIcon name={`pouring:${look.key}`} color={look.color} paint={look.paint} size={size} />;
}

/** A glass with no brew's mark, in one quiet colour, for the legend's row of glasses. */
export function PouringGlassIcon({ glass, size = 22 }: { glass: number; size?: number }) {
  const g = pouringGlass(glass);
  return <PictogramIcon name={`pouring:glass:${g.id}`} color="dim" paint={g.paint} size={size} />;
}

/** A pirate's ring, for the legend and the table of pirates. */
export function PouringRingIcon({ seat, size = 22 }: { seat: number; size?: number }) {
  const r = pouringSeatRing(seat);
  return <PictogramIcon name={`pouring:${r.key}`} color={r.color} paint={r.paint} size={size} />;
}
