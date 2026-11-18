import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { cuttingOre } from "./pieces.js";

/** One cell of a Cutting ore as an image, for a legend: the same drawing the board bakes. */
export function CuttingOreIcon({ kind, size = 22 }: { kind: number; size?: number }) {
  const o = cuttingOre(kind);
  return <PictogramIcon name={`cutting:ore:${o.id}`} color={o.color} paint={o.paint} size={size} />;
}
