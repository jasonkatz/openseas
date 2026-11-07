import { useSprites } from "../sprites/useSprites.js";
import { tileDataUrl, type SpecialName, type TileTexture } from "../bilging/tiles.js";

/** A legend tile: the same painted art the boards use, as an image. */
export function TileIcon(props: { color: string; texture?: TileTexture; mark?: string | null; special?: SpecialName; label?: string; size?: number }) {
  useSprites("bilging");
  const size = props.size ?? 22;
  const src = tileDataUrl(
    {
      color: parseInt(props.color.slice(1), 16),
      texture: props.texture ?? null,
      mark: props.mark ?? null,
      special: props.special ?? null,
      label: props.label ?? "",
      showMarks: Boolean(props.mark),
    },
    size,
  );
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
