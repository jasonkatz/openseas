import { blockDataUrl, type SwordTexture } from "./art.js";

/** A legend block: the same painted art the Swordfight board uses, as an image. For wrack, `ripen` is the drops left before it ripens. */
export function BlockIcon(props: { color: string; texture: SwordTexture; mark?: string | null; kind?: "block" | "breaker" | "wrack"; ripen?: number; size?: number }) {
  const size = props.size ?? 22;
  const src = blockDataUrl({ color: parseInt(props.color.slice(1), 16), texture: props.texture, mark: props.mark ?? null, kind: props.kind ?? "block", showMarks: Boolean(props.mark), ripen: props.ripen ?? 0 }, size);
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
