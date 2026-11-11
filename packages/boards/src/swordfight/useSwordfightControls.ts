import { useCallback } from "react";
import { swordfightPlaceIllegalReason, type SwordRotation, type SwordfightEvent, type SwordfightMove, type SwordfightState } from "@openseas/engine";
import { sfx } from "../audio.js";
import type { ControlsHost } from "../round/controls.js";
import type { SwordfightBoardProps } from "./SwordfightBoard.jsx";
import type { PlaceAnswer } from "./renderer.js";

/** The swordfight board's handlers. The other boards in a melee are the caller's to show. */
export type SwordfightControls = Pick<SwordfightBoardProps, "onPlace" | "onFrame" | "onEvents" | "onNudge">;

/**
 * The swordfight board's input and its sounds, the same in the melee aboard and on the practice
 * page. The player's board is board 0. A pair carries the tick `moveTick` gives (the caller's
 * `useTicked`); one that comes to rest too soon is asked for again, and one the engine refuses for
 * any other reason is lifted clear. Scrap arriving from outside the board sounds the alarm: only
 * the melee's server sends it.
 */
export function useSwordfightControls(host: ControlsHost<SwordfightState, SwordfightMove>, moveTick: () => number): SwordfightControls {
  const { apply, current, markRendered } = host;
  const onPlace = useCallback(
    (col: number, rot: SwordRotation): PlaceAnswer => {
      const r = current();
      if (!r || r.isFinished) return "refused";
      const tick = moveTick();
      if (apply({ type: "place", col, rot, tick })) return "placed";
      return swordfightPlaceIllegalReason(r.state, col, rot, tick) === "too soon" ? "wait" : "refused";
    },
    [apply, current, moveTick],
  );
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onEvents = useCallback((events: readonly SwordfightEvent[]) => {
    for (const e of events) {
      const mine = e.board === 0;
      switch (e.type) {
        case "placed":
          if (mine) sfx.swapQuiet();
          break;
        case "fused":
          if (mine) sfx.slag();
          break;
        case "broke":
          if (mine) {
            sfx.clear(e.chain, e.groups.reduce((n, g) => n + g.cells.length, 0));
            if (e.groups.length >= 2) sfx.multi(e.groups.length);
          } else sfx.swapQuiet();
          break;
        case "ripened":
          if (mine) sfx.vent(1);
          break;
        case "attack":
          if (mine && e.scrap > 0) sfx.streak(Math.min(12, e.scrap));
          else if (e.to === 0) sfx.alarm();
          break;
        case "incoming":
          sfx.alarm();
          break;
        case "landed":
          if (mine) sfx.crack(true);
          break;
        case "out":
          if (mine) {
            sfx.alarm();
            sfx.streakLost();
          } else sfx.charge();
          break;
        case "ended":
          if (e.outcome === "won") sfx.streak(16);
          else sfx.streakLost();
          break;
        default:
          break;
      }
    }
  }, []);
  return { onPlace, onFrame: markRendered, onEvents, onNudge };
}
