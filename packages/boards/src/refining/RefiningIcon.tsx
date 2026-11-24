import type { RefiningKind } from "@openseas/engine";
import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { refiningKind } from "./pieces.js";

/** One kind of Refining piece as an image, for a legend: the same drawing the board bakes. */
export function RefiningIcon({ kind, size = 22 }: { kind: RefiningKind; size?: number }) {
  const k = refiningKind(kind);
  return <PictogramIcon name={`refining:${k.id}`} color={k.color} paint={k.paint} size={size} />;
}
