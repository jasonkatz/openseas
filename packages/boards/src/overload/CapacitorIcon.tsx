import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { overloadColor, overloadPaint } from "./pieces.js";

/** One Overload capacitor as an image, for a legend: the same drawing the board bakes. */
export function CapacitorIcon({ charge, booster = false, size = 22 }: { charge: number; booster?: boolean; size?: number }) {
  return <PictogramIcon name={`overload:${booster ? "booster" : "cap"}:${charge}`} color={overloadColor(charge)} paint={overloadPaint(charge, booster)} size={size} />;
}
