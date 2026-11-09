import { useSprites } from "../sprites/useSprites.js";
import { pelletDataUrl, type EnginesTexture } from "./pellets.js";

/** A legend pellet: the same painted art the Engines board uses, as an image. */
export function PelletIcon(props: { color: string; texture: EnginesTexture; mark?: string | null; size?: number }) {
  useSprites("engines");
  const size = props.size ?? 22;
  const src = pelletDataUrl({ color: parseInt(props.color.slice(1), 16), texture: props.texture, mark: props.mark ?? null, showMarks: Boolean(props.mark) }, size);
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
