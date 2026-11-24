import { useEffect, useRef } from "react";
import { forgingViewString, type ForgingState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { ForgingRenderer } from "./renderer.js";

export interface ForgingBoardProps {
  state: ForgingState;
  version?: number;
  interactive: boolean;
  /** Ring a strike worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onStrike(cell: number): void;
  onFrame(): void;
}

/** Hosts the Forging canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function ForgingBoard(props: ForgingBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<ForgingState, ForgingRenderer>(
    (el) =>
      new ForgingRenderer(
        el,
        {
          onStrike: (cell) => latest.current.onStrike(cell),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            next: t("forging.next_strip"),
            chain: (count, points) => t("forging.chain", { count, points }),
            chainRunning: (count) => t("forging.chain_running", { count }),
            count: t("forging.count"),
            span: t("forging.span"),
            weave: (count) => t("forging.weave_call", { count }),
            setLost: t("forging.set_lost"),
            stall: (points) => t("forging.stall", { points }),
            free: t("forging.stall_free"),
            spark: t("forging.spark_call"),
            done: t("forging.plate_done"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="forging-board" data-board={forgingViewString(props.state.cells)} />;
}
