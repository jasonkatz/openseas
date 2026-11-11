import { useCallback } from "react";
import { previewSwap, type ClearRound, type CoolingMove, type CoolingState } from "@openseas/engine";
import { sfx } from "../audio.js";
import type { ControlsHost } from "../round/controls.js";
import type { BoardProps } from "./CoolingBoard.jsx";
import type { MoveShown } from "./renderer.js";

/** The Cooling board's handlers. Whether idle hints show is the caller's display choice. */
export type CoolingControls = Pick<BoardProps, "onSwap" | "preview" | "onFrame" | "onClear" | "onMoveShown" | "findHint">;

/**
 * The Cooling board's input and its sounds, the same at a station and on the practice page. A swap
 * that scores sounds bright and one that does not sounds quiet. The ship's heat is no swap: the board
 * sounds its vent or its rise as it shows the move.
 */
export function useCoolingControls(host: ControlsHost<CoolingState, CoolingMove>): CoolingControls {
  const { apply, current, markRendered } = host;
  const onSwap = useCallback(
    (col: number, row: number) => {
      if (!apply({ type: "swap", col, row })) return;
      const report = current()?.state.lastMove;
      if (report && report.points > 0) sfx.swap();
      else sfx.swapQuiet();
    },
    [apply, current],
  );
  const preview = useCallback(
    (col: number, row: number): readonly number[] => {
      const r = current();
      if (!r || r.isFinished) return [];
      return previewSwap(r.state, col, row).cells;
    },
    [current],
  );
  const onClear = useCallback((r: ClearRound) => {
    const causes = new Set(r.groups.map((g) => g.cause));
    if (causes.has("charge")) sfx.charge();
    if (causes.has("magnet")) sfx.magnet();
    if (causes.has("slag")) sfx.slag();
    if (causes.has("match")) sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
    const runs = r.groups.filter((g) => g.cause === "match" && g.ids.length >= 3).length;
    if (runs >= 2) sfx.multi(runs);
  }, []);
  const onMoveShown = useCallback((m: MoveShown) => {
    if (m.milestone) sfx.streak(m.milestone);
    else if (m.lostCombo >= 3) sfx.streakLost();
    if (m.heatRows < 0) sfx.vent(-m.heatRows);
    else if (m.heatRows > 0) sfx.rise();
    if (m.enteredDanger) sfx.alarm();
  }, []);
  /** The swap that clears the most pieces right now, for the idle hint. */
  const findHint = useCallback((): { col: number; row: number } | null => {
    const r = current();
    if (!r || r.isFinished) return null;
    let best: { col: number; row: number } | null = null;
    let most = 0;
    const { width, height } = r.state.config;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width - 1; col++) {
        const n = previewSwap(r.state, col, row).cells.length;
        if (n > most) {
          most = n;
          best = { col, row };
        }
      }
    }
    return best;
  }, [current]);
  return { onSwap, preview, onFrame: markRendered, onClear, onMoveShown, findHint };
}
