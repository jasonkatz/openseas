import { useEffect, useRef } from "react";
import { refiningViewString, type RefiningDir, type RefiningState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { RefiningRenderer } from "./renderer.js";

export interface RefiningBoardProps {
  state: RefiningState;
  version?: number;
  interactive: boolean;
  /** Ring a swap worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onSwap(cell: number, dir: RefiningDir): void;
  onDraw(): void;
  onFrame(): void;
}

/** Hosts the Refining canvas (prototype, ADR 0036, ADR 0080). All drawing lives in the renderer; every number shown is the engine's. */
export function RefiningBoard(props: RefiningBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<RefiningState, RefiningRenderer>(
    (el) =>
      new RefiningRenderer(
        el,
        {
          onSwap: (cell, dir) => latest.current.onSwap(cell, dir),
          onDraw: () => latest.current.onDraw(),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            preview: (grade, run, points) => {
              if (grade === "clear") return run >= 2 ? t("refining.preview_run", { run, points }) : t("refining.preview_clear", { points });
              if (grade === "smooth") return t("refining.preview_smooth", { points });
              if (grade === "foul") return t("refining.preview_foul", { points });
              return t(`refining.preview_${grade}`);
            },
            clear: (run) => (run >= 2 ? t("refining.clear_run", { count: run }) : t("refining.clear")),
            smooth: t("refining.smooth"),
            plain: t("refining.plain"),
            foul: t("refining.foul"),
            dump: t("refining.dump"),
            spill: t("refining.spill"),
            smoke: t("refining.smoke"),
            runLost: t("refining.run_lost"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="refining-board" data-board={refiningViewString(props.state.cells)} />;
}
