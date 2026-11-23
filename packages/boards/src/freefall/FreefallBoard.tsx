import { useEffect, useRef } from "react";
import { freefallViewString, type FreefallState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { FreefallRenderer } from "./renderer.js";

export interface FreefallBoardProps {
  state: FreefallState;
  version?: number;
  interactive: boolean;
  /** Pulse a drop worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onDrop(lane: number): void;
  onFrame(): void;
}

/** Hosts the Freefall canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function FreefallBoard(props: FreefallBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<FreefallState, FreefallRenderer>(
    (el) =>
      new FreefallRenderer(
        el,
        {
          onDrop: (lane) => latest.current.onDrop(lane),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            preview: (points, cluster) => (cluster > 1 ? t("freefall.preview_cluster", { points, count: cluster }) : t("freefall.preview", { points })),
            previewRest: t("freefall.preview_rest"),
            cluster: (count) => t("freefall.cluster", { count }),
            cascade: (count) => t("freefall.cascade", { count }),
            rivalScores: (points) => t("freefall.rival_scores", { points }),
            legWon: (leg) => t("freefall.leg_won", { leg }),
            legLost: (leg) => t("freefall.leg_lost", { leg }),
            legOver: (leg) => t("freefall.leg_over", { leg }),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="freefall-board" data-board={freefallViewString(props.state.config, props.state.rockers)} />;
}
