import { useEffect, useRef } from "react";
import { tractorViewString, type TractorState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { TractorRenderer } from "./renderer.js";

export interface TractorBoardProps {
  state: TractorState;
  version?: number;
  interactive: boolean;
  /** Pulse a swap worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onSwap(cell: number): void;
  onFrame(): void;
}

/** Hosts the Tractor canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function TractorBoard(props: TractorBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<TractorState, TractorRenderer>(
    (el) =>
      new TractorRenderer(
        el,
        {
          onSwap: (cell) => latest.current.onSwap(cell),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            preview: (points, caches) => (caches > 0 ? t("tractor.preview_caches", { points, caches }) : t("tractor.preview", { points })),
            previewDud: t("tractor.preview_dud"),
            wave: (count) => t("tractor.wave", { count }),
            longRun: t("tractor.long_run"),
            cross: t("tractor.cross"),
            saltire: t("tractor.saltire"),
            chain: t("tractor.chain"),
            caches: (count) => (count === 1 ? t("tractor.cache_one") : t("tractor.cache_many", { count })),
            scrambled: t("tractor.scrambled"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="tractor-board" data-board={tractorViewString(props.state.cells)} />;
}
