import { useCallback } from "react";
import type { EnginesClearRound, EnginesMove, EnginesState, Rotation } from "@openseas/engine";
import { sfx } from "../audio.js";
import type { ControlsHost } from "../round/controls.js";
import type { EnginesBoardProps } from "./EnginesBoard.jsx";

/** The Engines board's handlers. */
export type EnginesControls = Pick<EnginesBoardProps, "onPlace" | "onFrame" | "onClear" | "onLanded" | "onNudge" | "onWipe">;

/** The Engines board's input and its sounds, the same at a station and on the practice page. */
export function useEnginesControls(host: ControlsHost<EnginesState, EnginesMove>): EnginesControls {
  const { apply, markRendered } = host;
  const onPlace = useCallback((col: number, row: number, rot: Rotation) => void apply({ type: "place", col, row, rot }), [apply]);
  const onClear = useCallback((r: EnginesClearRound) => {
    sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
    if (r.groups.some((g) => g.cause === "injector")) sfx.slag();
    if (r.groups.length >= 2) sfx.multi(r.groups.length);
  }, []);
  const onLanded = useCallback(() => sfx.swapQuiet(), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onWipe = useCallback(() => {
    sfx.alarm();
    sfx.streakLost();
  }, []);
  return { onPlace, onFrame: markRendered, onClear, onLanded, onNudge, onWipe };
}
