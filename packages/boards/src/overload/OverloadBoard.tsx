import { overloadViewString, type OverloadState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { OverloadRenderer } from "./renderer.js";

export interface OverloadBoardProps {
  /** The engine state advanced to the current tick (ADR 0015): the taps held are read off it. */
  state: OverloadState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Mark a tap worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  /** The player tapped a capacitor. Returns false when the round did not take the tap. */
  onTap(cell: number): boolean;
  onFrame(): void;
}

/** Hosts the Overload canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function OverloadBoard(props: OverloadBoardProps) {
  const { host } = useBoardHost(
    (el, latest) =>
      new OverloadRenderer(
        el,
        {
          onTap: (cell) => latest.current.onTap(cell),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          labels: {
            chain: (count, points) => t("overload.chain", { count, points }),
            streak: (count, percent) => t("overload.streak", { count, percent }),
            streakMax: t("overload.streak_max"),
            streakLost: t("overload.streak_lost"),
            bigChain: t("overload.big_chain"),
            hugeChain: t("overload.huge_chain"),
            refund: (count) => t("overload.refund", { count }),
            noTaps: t("overload.no_taps"),
          },
        },
      ),
    props,
  );

  return <div ref={host} className="board-host" data-testid="overload-board" data-board={overloadViewString(props.state.cells)} />;
}
