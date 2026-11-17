import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { MIRROR_COLOR, MIRROR_PAINT, signOf, signPaint } from "./pieces.js";

/** A beam's sign as an image, for a legend: solid as an entry wears it, hollow as a waiting exit does. */
export function DeflectorsSignIcon({ sign, hollow = false, size = 22 }: { sign: number; hollow?: boolean; size?: number }) {
  const s = signOf(sign);
  return <PictogramIcon name={`deflectors:sign:${s.shape}:${hollow ? "hollow" : "solid"}`} color={s.color} paint={signPaint(s.shape, hollow)} size={size} />;
}

/** A mirror as an image, for a legend: the same drawing the board bakes. */
export function DeflectorsMirrorIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="deflectors:mirror" color={MIRROR_COLOR} paint={MIRROR_PAINT} size={size} />;
}
