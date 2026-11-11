import { useCallback } from "react";
import type { Dir, GunneryEvent, GunneryMove, GunneryState } from "@openseas/engine";
import { sfx } from "../audio.js";
import type { ControlsHost } from "../round/controls.js";
import type { GunneryBoardProps } from "./GunneryBoard.jsx";

/** The Gunnery board's handlers. */
export type GunneryControls = Pick<GunneryBoardProps, "onArrow" | "onFrame" | "onEvents">;

/**
 * The Gunnery board's input and its sounds, the same at a station and on the practice page. A move
 * carries the tick `moveTick` gives (the caller's `useTicked`).
 */
export function useGunneryControls(host: ControlsHost<GunneryState, GunneryMove>, moveTick: () => number): GunneryControls {
  const { apply, markRendered } = host;
  const onArrow = useCallback(
    (col: number, row: number, dir: Dir | null) => {
      const tick = moveTick();
      if (apply(dir === null ? { type: "remove", col, row, tick } : { type: "arrow", col, row, dir, tick })) sfx.tick(false);
    },
    [apply, moveTick],
  );
  const onEvents = useCallback((events: readonly GunneryEvent[]) => {
    for (const e of events) {
      switch (e.type) {
        case "load":
          sfx.swap();
          break;
        case "loaded":
          sfx.clear(Math.min(6, 2 + Math.floor((e.points ?? 0) / 50)), 5);
          break;
        case "fire":
          sfx.charge();
          break;
        case "broadside":
          sfx.streak(12);
          break;
        case "jam":
          sfx.streakLost();
          break;
        case "clean":
          sfx.vent(2);
          break;
        case "splash":
          sfx.vent(1);
          break;
        case "exit":
          sfx.swapQuiet();
          break;
        default:
          break;
      }
    }
  }, []);
  return { onArrow, onFrame: markRendered, onEvents };
}
