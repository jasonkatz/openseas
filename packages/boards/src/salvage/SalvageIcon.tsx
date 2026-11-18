import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { SALVAGE_CRATE_COLOR, SALVAGE_CRATE_PAINT, SALVAGE_RUBBLE_COLOR, SALVAGE_RUBBLE_PAINT, salvageKind, salvageVolatilePaint } from "./pieces.js";

/** One kind of Salvage debris as an image, for a legend: the same drawing the board bakes. */
export function SalvageDebrisIcon({ kind, size = 22 }: { kind: number; size?: number }) {
  const k = salvageKind(kind);
  return <PictogramIcon name={`salvage:debris:${k.id}`} color={k.color} paint={k.paint} size={size} />;
}

/** A loot crate as an image, for a legend. */
export function SalvageCrateIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="salvage:crate" color={SALVAGE_CRATE_COLOR} paint={SALVAGE_CRATE_PAINT} size={size} />;
}

/** Rubble as an image, for a legend. */
export function SalvageRubbleIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="salvage:rubble" color={SALVAGE_RUBBLE_COLOR} paint={SALVAGE_RUBBLE_PAINT} size={size} />;
}

/** A volatile of one kind with its fuse at `fuse`, for a legend. */
export function SalvageVolatileIcon({ kind, fuse, size = 22 }: { kind: number; fuse: number; size?: number }) {
  const k = salvageKind(kind);
  return <PictogramIcon name={`salvage:volatile:${k.id}:${fuse}`} color={k.color} paint={salvageVolatilePaint(k, fuse)} size={size} />;
}
