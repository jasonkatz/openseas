import { PictogramIcon } from "../kit/PictogramIcon.jsx";
import { assemblyKind } from "./pieces.js";

/** One kind of part as an image, for a legend: the same drawing the board bakes. The core is ASSEMBLY_CORE. */
export function AssemblyPartIcon({ kind, size = 22 }: { kind: number; size?: number }) {
  const k = assemblyKind(kind);
  return <PictogramIcon name={`assembly:${k.id}`} color={k.color} paint={k.paint} size={size} />;
}
