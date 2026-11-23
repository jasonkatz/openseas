import type { TractorMark } from "@openseas/engine";
import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { TRACTOR_CACHE_COLOR, TRACTOR_CACHE_PAINT, tractorBeaconPaint, tractorKind } from "./pieces.js";

/** One kind of Tractor loot as an image, for a legend: the same drawing the board bakes. */
export function TractorLootIcon({ kind, size = 22 }: { kind: number; size?: number }) {
  const k = tractorKind(kind);
  return <PictogramIcon name={`tractor:loot:${k.id}`} color={k.color} paint={k.paint} size={size} />;
}

/** A sealed cache as an image, for a legend. */
export function TractorCacheIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="tractor:cache" color={TRACTOR_CACHE_COLOR} paint={TRACTOR_CACHE_PAINT} size={size} />;
}

/** A beacon of one kind and mark, for a legend. */
export function TractorBeaconIcon({ kind, mark, size = 22 }: { kind: number; mark: TractorMark; size?: number }) {
  const k = tractorKind(kind);
  return <PictogramIcon name={`tractor:beacon:${k.id}:${mark}`} color={k.color} paint={tractorBeaconPaint(k, mark)} size={size} />;
}
