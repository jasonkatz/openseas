import { useCallback } from "react";
import type { NavigationEvent, NavigationMove, NavigationState } from "@openseas/engine";
import { sfx } from "../audio.js";
import type { ControlsHost } from "../round/controls.js";
import type { NavigationBoardProps } from "./NavigationBoard.jsx";

/** The Navigation board's handlers. Whether markers and idle hints show is the caller's display choice. */
export type NavigationControls = Pick<NavigationBoardProps, "onRotate" | "onDrop" | "onFrame" | "onEvents" | "onNudge">;

/**
 * The Navigation board's input and its sounds, the same at a station and on the practice page. A
 * move carries the tick `moveTick` gives (the caller's `useTicked`).
 */
export function useNavigationControls(host: ControlsHost<NavigationState, NavigationMove>, moveTick: () => number): NavigationControls {
  const { apply, markRendered } = host;
  const onRotate = useCallback((ring: number, dir: -1 | 1): boolean => apply({ type: "rotate", ring, dir, tick: moveTick() }), [apply, moveTick]);
  const onDrop = useCallback(() => void apply({ type: "drop", tick: moveTick() }), [apply, moveTick]);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onEvents = useCallback((events: readonly NavigationEvent[]) => {
    for (const e of events) {
      switch (e.type) {
        case "land":
          if (e.onMarker) sfx.swap();
          else sfx.swapQuiet();
          break;
        case "lost_heading":
          sfx.streakLost();
          sfx.charge();
          break;
        case "charted":
          sfx.clear(e.completion.chain, e.completion.markers.length);
          if (e.completion.chain >= 3) sfx.streak(e.completion.chain);
          if (e.completion.efficient) sfx.slag();
          break;
        case "run":
          sfx.multi(e.run.slots.length - 1);
          break;
        case "fall":
          sfx.swapQuiet();
          break;
        default:
          break;
      }
    }
  }, []);
  return { onRotate, onDrop, onFrame: markRendered, onEvents, onNudge };
}
