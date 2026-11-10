import { tugStateViewString, type TugDir, type TugState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { TugRenderer } from "./renderer.js";

export interface TugBoardProps {
  state: TugState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Show the first flick of a par route after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onFlick(pod: number, dir: TugDir): void;
  onSkip(): void;
  onFrame(): void;
}

/** Hosts the Tug canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function TugBoard(props: TugBoardProps) {
  const { host } = useBoardHost(
    (el, latest) =>
      new TugRenderer(
        el,
        {
          onFlick: (pod, dir) => latest.current.onFlick(pod, dir),
          onSkip: () => latest.current.onSkip(),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          hints: props.hints,
          labels: {
            status: (par, flicks) => t("tug.status", { par, flicks }),
            skip: t("tug.skip"),
            clean: (streak) => (streak >= 2 ? t("tug.clean_streak", { count: streak }) : t("tug.clean")),
            full: t("tug.full"),
            slow: t("tug.slow"),
            skipped: t("tug.skipped"),
            tally: (flicks, par) => t("tug.tally", { flicks, par }),
            par: (par) => t("tug.par", { par }),
          },
        },
      ),
    props,
  );

  return <div ref={host} className="board-host" data-testid="tug-board" data-board={tugStateViewString(props.state)} />;
}
