import { racksViewString, type RacksState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { RacksRenderer } from "./renderer.js";

export interface RacksBoardProps {
  state: RacksState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Pulse an action worth taking after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onMove(from: number, to: number): void;
  onCall(): void;
  onFrame(): void;
}

/** Hosts the Racks canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function RacksBoard(props: RacksBoardProps) {
  const { host } = useBoardHost(
    (el, latest) =>
      new RacksRenderer(
        el,
        {
          onMove: (from, to) => latest.current.onMove(from, to),
          onCall: () => latest.current.onCall(),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          hints: props.hints,
          labels: {
            lands: (moves) => t(moves === 1 ? "racks.strip_lands_one" : "racks.strip_lands", { moves }),
            noRoom: (moves) => t(moves === 1 ? "racks.strip_no_room_one" : "racks.strip_no_room", { moves }),
            willShip: (moves) => t(moves === 1 ? "racks.strip_will_ship_one" : "racks.strip_will_ship", { moves }),
            chainLive: (count, points) => t("racks.strip_chain", { count, points }),
            chain: (count) => t("racks.chain", { count }),
            delivered: t("racks.delivered"),
            smashed: t("racks.smashed"),
          },
        },
      ),
    props,
  );

  return <div ref={host} className="board-host" data-testid="racks-board" data-board={racksViewString(props.state.racks, props.state.crate)} />;
}
