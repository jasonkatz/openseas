import { useCallback } from "react";
import type { BattleEvent, BattleMove, BattlePlan, BattleState } from "@openseas/engine";
import { sfx } from "../audio.js";
import type { ControlsHost } from "../round/controls.js";
import type { BattleBoardProps } from "./BattleBoard.jsx";

/** The battle board's handlers. The turn clock and what it flies are the caller's. */
export type BattleControls = Pick<BattleBoardProps, "onCommit" | "onFrame" | "onEvents" | "onNudge">;

/** The battle board's input and its sounds, the same aboard and on the practice page. */
export function useBattleControls(host: ControlsHost<BattleState, BattleMove>): BattleControls {
  const { apply, markRendered } = host;
  const onCommit = useCallback(
    (plan: BattlePlan) => {
      if (apply({ type: "commit", ...plan })) sfx.swap();
    },
    [apply],
  );
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onEvents = useCallback((events: readonly BattleEvent[]) => {
    for (const e of events) {
      switch (e.type) {
        case "move":
          if (e.damage > 0) sfx.crack(true);
          else sfx.swapQuiet();
          break;
        case "push":
          sfx.vent(1);
          break;
        case "spin":
          sfx.tick(false);
          break;
        case "shot":
          sfx.charge();
          if (e.hit) sfx.clear(e.ship === 0 ? 3 : 1, 4);
          break;
        case "grapple":
          sfx.streak(6);
          break;
        case "ended":
          if (e.outcome === "boarded" || e.outcome === "crippled") sfx.streak(12);
          else if (e.outcome === "boarded_by" || e.outcome === "crippled_by") {
            sfx.alarm();
            sfx.streakLost();
          } else sfx.end();
          break;
        default:
          break;
      }
    }
  }, []);
  return { onCommit, onFrame: markRendered, onEvents, onNudge };
}
