import { useEffect, useRef } from "react";
import { overloadViewString, type OverloadState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { OverloadRenderer } from "./renderer.js";

export interface OverloadBoardProps {
  /** The engine state advanced to the current tick (ADR 0015): the taps held are read off it. */
  state: OverloadState;
  version?: number;
  interactive: boolean;
  /** Mark a tap worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  /** The player tapped a capacitor. Returns false when the round did not take the tap. */
  onTap(cell: number): boolean;
  onFrame(): void;
}

/** Hosts the Overload canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function OverloadBoard(props: OverloadBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<OverloadState, OverloadRenderer>(
    (el) =>
      new OverloadRenderer(
        el,
        {
          onTap: (cell) => latest.current.onTap(cell),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            chain: (count, points) => t("overload.chain", { count, points }),
            streak: (count, percent) => t("overload.streak", { count, percent }),
            streakMax: t("overload.streak_max"),
            streakLost: t("overload.streak_lost"),
            bigChain: t("overload.big_chain"),
            hugeChain: t("overload.huge_chain"),
            refund: (count) => t("overload.refund", { count }),
            noTaps: t("overload.no_taps"),
            draw: (min, max, percent) => (min === max ? t("overload.draw_one", { min, times: percent / 100 }) : t("overload.draw", { min, max, times: percent / 100 })),
            previewMet: (count) => t("overload.preview_met", { count }),
            previewShort: (count) => t("overload.preview_short", { count }),
            previewOver: (count) => t("overload.preview_over", { count }),
            drawMet: t("overload.draw_met"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="overload-board" data-board={overloadViewString(props.state.cells)} />;
}
