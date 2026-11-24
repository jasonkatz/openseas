import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { MIRROR_COLOR, MIRROR_PAINT, SPLITTER_COLOR, SPLITTER_PAINT, TARGET_COLOR, TARGET_PAINT, lensOf, lensPaint, signOf, signPaint } from "./pieces.js";

/** An emitter's sign as an image, for a legend: the same drawing the board bakes. */
export function DeflectorsSignIcon({ sign, size = 22 }: { sign: number; size?: number }) {
  const s = signOf(sign);
  return <PictogramIcon name={`deflectors:sign:${s.shape}`} color={s.color} paint={signPaint(s.shape)} size={size} />;
}

/** A mirror as an image, for a legend: the same drawing the board bakes. */
export function DeflectorsMirrorIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="deflectors:mirror" color={MIRROR_COLOR} paint={MIRROR_PAINT} size={size} />;
}

/** A lens as an image, for a legend: the same drawing the board bakes. */
export function DeflectorsLensIcon({ kind, size = 22 }: { kind: number; size?: number }) {
  const l = lensOf(kind);
  return <PictogramIcon name={`deflectors:lens:${l.shape}`} color={l.color} paint={lensPaint(l.shape)} size={size} />;
}

/** A splitter as an image, for a legend: the same drawing the board bakes. */
export function DeflectorsSplitterIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="deflectors:splitter" color={SPLITTER_COLOR} paint={SPLITTER_PAINT} size={size} />;
}

/** A target as an image, for a legend: the same drawing the board bakes. */
export function DeflectorsTargetIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="deflectors:target" color={TARGET_COLOR} paint={TARGET_PAINT} size={size} />;
}
