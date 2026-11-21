import { useEffect } from "react";
import type { PuzzleId } from "@openseas/engine";
import { playCuesOf } from "./cues.js";

/**
 * While a puzzle is on screen (and `on`), its own cues are the ones heard (ADR 0070); as it goes,
 * the game's own cues come back. For the page that shows a board.
 */
export function usePuzzleCues(puzzle: PuzzleId, on = true): void {
  useEffect(() => {
    if (!on) return;
    playCuesOf(puzzle);
    return () => playCuesOf(null);
  }, [puzzle, on]);
}
