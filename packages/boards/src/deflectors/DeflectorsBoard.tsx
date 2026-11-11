import { useEffect } from "react";
import { deflectorsViewString, type DeflectorsState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { DEFLECTORS_SIGNS, DeflectorsRenderer } from "./renderer.js";

export interface DeflectorsBoardProps {
  /** The state as shown: the engine advanced to the current tick. */
  state: DeflectorsState;
  /**
   * The engine's last logged state. Its report is played as well as the shown state's, so a volley
   * fired on the last instant of a tick is still seen to fire once the shown state has moved on.
   */
  logged?: DeflectorsState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Pulse the next mirror to flip after a pause: on for practice, off for recorded rounds. */
  hints?: boolean;
  onFlip?(cell: number): void;
  onFire?(volley: number): void;
  onFrame(): void;
}

/** Hosts the Deflectors canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function DeflectorsBoard(props: DeflectorsBoardProps) {
  const { host, renderer } = useBoardHost(
    (el, latest) =>
      new DeflectorsRenderer(
        el,
        {
          onFlip: (cell) => latest.current.onFlip?.(cell),
          onFire: (volley) => latest.current.onFire?.(volley),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          labels: {
            outlook: (points, best) => t("deflectors.outlook", { points, best }),
            outlookPerfect: (points) => t("deflectors.outlook_perfect", { points }),
            outlookAstray: (home, beams, best) => t("deflectors.outlook_astray", { home, beams, best }),
            perfect: t("deflectors.perfect"),
            streak: (count) => t("deflectors.streak", { count }),
            longRoute: (turns) => t("deflectors.long_route", { turns }),
            hull: t("deflectors.hull"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    const events = props.logged?.lastMove?.events;
    if (events) renderer.current?.noteEvents(events);
  }, [props.logged, renderer]);

  return <div ref={host} className="board-host" data-testid="deflectors-board" data-board={deflectorsViewString(props.state.mirrors, props.state.volley?.beams ?? [])} />;
}

/** The sign each beam of a volley wears, for a page's legend: a kit kind and the color it is drawn in. */
DeflectorsBoard.signs = DEFLECTORS_SIGNS;
