import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { CRATE_PAINT, racksKind, trolleyColor } from "./pieces.js";

/** One Racks fuel cell as an image, for a legend: the same drawing the board bakes. */
export function RacksCellIcon({ kind, size = 22 }: { kind: number; size?: number }) {
  const k = racksKind(kind);
  return <PictogramIcon name={`racks:cell:${k.id}`} color={k.color} paint={k.paint} size={size} />;
}

/** The crate on its trolley as an image, for a legend: in the trolley's colour, danger when it has no room. */
export function RacksCrateIcon({ tight = false, size = 22 }: { tight?: boolean; size?: number }) {
  return <PictogramIcon name="racks:crate" color={trolleyColor(!tight, false)} paint={CRATE_PAINT} size={size} />;
}
