import { useEffect, useSyncExternalStore } from "react";
import { loadPuzzleSprites, spriteRevision, subscribeSprites, type SpritePuzzle } from "./atlas.js";

/** Legends can mount before the board. Refresh their cached canvas URLs when its atlas arrives. */
export function useSprites(puzzle: SpritePuzzle): void {
  useSyncExternalStore(subscribeSprites, spriteRevision, () => 0);
  useEffect(() => { void loadPuzzleSprites(puzzle); }, [puzzle]);
}
