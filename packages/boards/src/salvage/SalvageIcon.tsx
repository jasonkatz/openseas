import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { SALVAGE_COUPLER_COLOR, SALVAGE_COUPLER_PAINT, SALVAGE_CRATE_COLOR, SALVAGE_CRATE_PAINT, salvageKind } from "./pieces.js";

/** One kind of Salvage debris as an image, for a legend: the same drawing the board bakes. */
export function SalvageDebrisIcon({ kind, size = 22 }: { kind: number; size?: number }) {
  const k = salvageKind(kind);
  return <PictogramIcon name={`salvage:debris:${k.id}`} color={k.color} paint={k.paint} size={size} />;
}

/** A loot crate as an image, for a legend. */
export function SalvageCrateIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="salvage:crate" color={SALVAGE_CRATE_COLOR} paint={SALVAGE_CRATE_PAINT} size={size} />;
}

/** A coupler as an image, for a legend. */
export function SalvageCouplerIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="salvage:coupler" color={SALVAGE_COUPLER_COLOR} paint={SALVAGE_COUPLER_PAINT} size={size} />;
}
