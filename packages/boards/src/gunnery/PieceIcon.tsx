import { useSprites } from "../sprites/useSprites.js";
import { gunneryPieceUrl } from "./pieces.js";

export function GunneryPieceIcon(props: { kind: number; mark: string | null; size?: number }) {
  useSprites("gunnery");
  const size = props.size ?? 26;
  return <img src={gunneryPieceUrl(props.kind, props.mark, size)} width={size} height={size} alt="" aria-hidden="true" className="tile-icon" draggable={false} />;
}
