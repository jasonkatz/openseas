import { useEffect, useRef } from "react";
import { deflectorsViewString, type DeflectorsState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { DeflectorsRenderer } from "./renderer.js";

export interface DeflectorsBoardProps {
  /** The state as shown: the engine advanced to the current tick. */
  state: DeflectorsState;
  /**
   * The engine's last logged state. Its report is played as well as the shown state's, so a shot
   * fired on the last instant of a tick is still seen to fire once the shown state has moved on.
   */
  logged?: DeflectorsState;
  version?: number;
  interactive: boolean;
  /** Pulse where the next piece would make the shot worth more, after a pause: on for practice, off for recorded rounds. */
  hints?: boolean;
  onPlace?(cell: number): void;
  onTurn?(): void;
  onFire?(): void;
  onFrame(): void;
}

/** Hosts the Deflectors canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function DeflectorsBoard(props: DeflectorsBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<DeflectorsState, DeflectorsRenderer>(
    (el) =>
      new DeflectorsRenderer(
        el,
        {
          onPlace: (cell) => latest.current.onPlace?.(cell),
          onTurn: () => latest.current.onTurn?.(),
          onFire: () => latest.current.onFire?.(),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints ?? false,
          labels: {
            outlook: (points, lit, percent) => (lit > 1 ? t("deflectors.outlook", { points, lit, times: percent / 100 }) : t("deflectors.outlook_one", { points })),
            outlookNone: t("deflectors.outlook_none"),
            lit: (count, percent) => t("deflectors.lit", { count, times: percent / 100 }),
            longRoute: (turns) => t("deflectors.long_route", { turns }),
            dropped: t("deflectors.dropped"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints ?? false);
  }, [props.hints, renderer]);

  useEffect(() => {
    const events = props.logged?.lastMove?.events;
    if (events) renderer.current?.noteEvents(events);
  }, [props.logged, renderer]);

  const s = props.state;
  return <div ref={host} className="board-host" data-testid="deflectors-board" data-board={deflectorsViewString(s.mirrors, s.targets, s.queue)} />;
}
