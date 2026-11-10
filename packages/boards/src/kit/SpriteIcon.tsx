import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { loadPuzzleSprites, spriteCrop, spriteRevision, subscribeSprites, type SpritePuzzle } from "../sprites/atlas.js";

export interface SpriteIconProps {
  puzzle: SpritePuzzle;
  /** The atlas frame. A name the atlas does not hold shows the fallback, as the board draws that piece in code. */
  name: string;
  size?: number;
  /** The frame's art runs to its edges (an ore tile), with no padding to trim. */
  fill?: boolean;
  /** The code-drawn icon, shown until the atlas is decoded and for good if it never is. */
  fallback: ReactNode;
  /** SVG drawn over the sprite in a 24 by 24 box: a mark, a numeral. */
  children?: ReactNode;
}

/**
 * A legend's icon from the board's own atlas (ADR 0037), so the legend shows the piece the board
 * draws. The page may mount it before the board has loaded the atlas: it asks for the atlas itself
 * and redraws when it lands.
 */
export function SpriteIcon({ puzzle, name, size = 22, fill = false, fallback, children }: SpriteIconProps) {
  useSyncExternalStore(subscribeSprites, spriteRevision, () => 0);
  useEffect(() => {
    void loadPuzzleSprites(puzzle);
  }, [puzzle]);
  const crop = spriteCrop(puzzle, name);
  if (!crop) return <>{fallback}</>;
  // A frame is 192 pixels with its art fitted in the middle 176.
  const pad = fill ? 0 : 8;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      <svg x="0" y="0" width="24" height="24" viewBox={`${crop.x + pad} ${crop.y + pad} ${crop.size - pad * 2} ${crop.size - pad * 2}`}>
        <image href={crop.url} width={crop.width} height={crop.height} />
      </svg>
      {children}
    </svg>
  );
}
