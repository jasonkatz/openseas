import { useSprites } from "../sprites/useSprites.js";
import { discDataUrl, type SailTexture } from "./discs.js";

/** A legend disc: the same painted art the Sailing board uses, as an image. */
export function DiscIcon(props: { color: string; texture: SailTexture; mark?: string | null; size?: number }) {
  useSprites("sailing");
  const size = props.size ?? 22;
  const src = discDataUrl({ color: parseInt(props.color.slice(1), 16), texture: props.texture, mark: props.mark ?? null, showMarks: Boolean(props.mark) }, size);
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
