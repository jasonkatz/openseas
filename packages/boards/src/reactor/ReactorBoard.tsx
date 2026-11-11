import { reactorLegalDirs, reactorViewString, type ReactorDir, type ReactorState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { ReactorRenderer } from "./renderer.js";

export interface ReactorBoardProps {
  state: ReactorState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Point at a swipe that would discharge a rod after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  /** Returns false when the round refused the swipe. */
  onSwipe(dir: ReactorDir): boolean;
  onFrame(): void;
}

/** Hosts the Reactor canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function ReactorBoard(props: ReactorBoardProps) {
  const { host } = useBoardHost(
    (el, latest) =>
      new ReactorRenderer(
        el,
        {
          onSwipe: (dir) => latest.current.onSwipe(dir),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          labels: {
            next: t("reactor.next"),
            hot: t("reactor.hot"),
            pipeline: (percent) => t("reactor.pipeline_running", { percent }),
            pipelineIdle: t("reactor.pipeline_idle"),
            pipelineLost: t("reactor.pipeline_lost"),
            run: (count) => t("reactor.run", { count }),
            salvo: (count) => t("reactor.salvo", { count }),
            hotRod: t("reactor.hot_rod"),
            critical: (penalty) => t("reactor.scram_critical", { penalty }),
            jammed: (penalty) => t("reactor.scram_jammed", { penalty }),
          },
        },
      ),
    props,
  );

  // The legal swipes ride along for the smoke test: which ways the core will take right now.
  return (
    <div
      ref={host}
      className="board-host"
      data-testid="reactor-board"
      data-board={reactorViewString(props.state.cells, props.state.ports)}
      data-legal={reactorLegalDirs(props.state).join("")}
    />
  );
}
