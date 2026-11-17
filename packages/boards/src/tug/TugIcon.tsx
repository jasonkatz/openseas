import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { TUG_BLOCK_COLOR, TUG_BLOCK_PAINT, tugClampPaint, tugPod, tugPodPaint } from "./pieces.js";

/** A Tug pod as an image, for a legend: the same drawing the board bakes. */
export function TugPodIcon({ pod, size = 22 }: { pod: number; size?: number }) {
  const p = tugPod(pod);
  return <PictogramIcon name={`tug:pod:${p.id}`} color={p.color} paint={tugPodPaint(pod)} size={size} />;
}

/** The clamp that wants `pod`, as an image for a legend. */
export function TugClampIcon({ pod, size = 22 }: { pod: number; size?: number }) {
  const p = tugPod(pod);
  return <PictogramIcon name={`tug:clamp:${p.id}`} color={p.color} paint={tugClampPaint(pod)} size={size} />;
}

/** A block as an image, for a legend. */
export function TugBlockIcon({ size = 22 }: { size?: number }) {
  return <PictogramIcon name="tug:block" color={TUG_BLOCK_COLOR} paint={TUG_BLOCK_PAINT} size={size} />;
}
