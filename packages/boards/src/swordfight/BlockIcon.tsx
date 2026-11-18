import type { PieceColor } from "@openseas/content";
import { blockDataUrl, type BlockCut } from "./art.js";

/**
 * A legend block: the same drawing the Swordfighting board makes, as an image. `w` and `h` make it a
 * slab, fitted in the same square. For stone, `ripen` is the drops left before it ripens.
 */
export function BlockIcon(props: { color: PieceColor; cut: BlockCut; kind?: "block" | "breaker" | "scrap"; ripen?: number; w?: number; h?: number; size?: number }) {
  const size = props.size ?? 22;
  const kind = props.kind ?? "block";
  const src = blockDataUrl({ color: props.color, cut: props.cut, kind, ...(kind === "scrap" ? { ripen: props.ripen ?? 0 } : {}) }, size, props.w ?? 1, props.h ?? 1);
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
