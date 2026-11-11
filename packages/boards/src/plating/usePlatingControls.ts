import { useCallback } from "react";
import type { BreachRating, PlatingMove, PlatingState } from "@openseas/engine";
import { sfx } from "../audio.js";
import type { ControlsHost } from "../round/controls.js";
import type { PlatingBoardProps } from "./PlatingBoard.jsx";

/** The Plating board's handlers. */
export type PlatingControls = Pick<PlatingBoardProps, "onPlace" | "onFrame" | "onSealed" | "onNailed" | "onGrew" | "onCracked" | "onNudge" | "onBump">;

/** The Plating board's input and its sounds, the same at a station and on the practice page. */
export function usePlatingControls(host: ControlsHost<PlatingState, PlatingMove>): PlatingControls {
  const { apply, markRendered } = host;
  const onPlace = useCallback((slot: number, rot: number, flip: boolean, col: number, row: number) => void apply({ type: "place", slot, rot, flip, col, row }), [apply]);
  const onSealed = useCallback((rating: BreachRating, chain: number) => {
    sfx.plateLift();
    if (rating === "flawless") {
      sfx.clear(Math.min(6, chain), 6);
      if (chain >= 2) sfx.multi(chain);
    } else if (rating === "gum") sfx.streakLost();
    else sfx.clear(1, 3);
  }, []);
  const onNailed = useCallback((waste: boolean) => sfx.welder(waste), []);
  const onGrew = useCallback(() => sfx.crack(true), []);
  const onCracked = useCallback((opening: boolean) => sfx.crack(!opening), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onBump = useCallback(() => sfx.bump(), []);
  return { onPlace, onFrame: markRendered, onSealed, onNailed, onGrew, onCracked, onNudge, onBump };
}
