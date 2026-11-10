import type { Dir, GunneryEvent, GunneryState } from "@openseas/engine";
import { content, t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { GunneryRenderer, gunneryViewString } from "./renderer.js";

export interface GunneryBoardProps {
  /** The state to show: the engine state advanced to the display tick. */
  state: GunneryState;
  interactive: boolean;
  showMarks: boolean;
  onArrow(col: number, row: number, dir: Dir | null): void;
  onFrame(): void;
  onEvents(events: readonly GunneryEvent[]): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function GunneryBoard(props: GunneryBoardProps) {
  const gunnery = content.puzzles.gunnery;
  const { host } = useBoardHost(
    (el, latest) =>
      new GunneryRenderer(
        el,
        gunnery,
        {
          onArrow: (c, row, dir) => latest.current.onArrow(c, row, dir),
          onFrame: () => latest.current.onFrame(),
          onEvents: (events) => latest.current.onEvents(events),
        },
        {
          showMarks: props.showMarks,
          tickMs: gunnery.config.tickMs,
          labels: { jammed: t("gunnery.jammed_callout"), clean: t("gunnery.clean_callout"), next: t("gunnery.next"), broadside: t("gunnery.broadside_callout") },
        },
      ),
    props,
  );

  return <div ref={host} className="board-host" data-testid="gunnery-board" data-board={gunneryViewString(props.state)} />;
}
