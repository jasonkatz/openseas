import { cuttingViewString, type CuttingState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { CuttingRenderer } from "./renderer.js";

export interface CuttingBoardProps {
  state: CuttingState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Pulse a cut from a best plan after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onCut(piece: number, vertical: boolean, at: number): void;
  /** Give the slab up for the next one. */
  onDone(): void;
  onFrame(): void;
}

/** Hosts the Cutting canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function CuttingBoard(props: CuttingBoardProps) {
  const { host } = useBoardHost(
    (el, latest) =>
      new CuttingRenderer(
        el,
        {
          onCut: (piece, vertical, at) => latest.current.onCut(piece, vertical, at),
          onDone: () => latest.current.onDone(),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          hints: props.hints,
          labels: {
            cuts: (left) => t("cutting.cuts_left", { left }),
            banked: (got, best) => t("cutting.banked", { got, best }),
            next: t("cutting.next_slab"),
            flawless: (bonus) => t("cutting.flawless", { bonus }),
            clean: (bonus) => t("cutting.clean", { bonus }),
            rough: t("cutting.rough"),
            streak: (count) => t("cutting.streak", { count }),
          },
        },
      ),
    props,
  );

  return (
    <div
      ref={host}
      className="board-host"
      data-testid="cutting-board"
      data-board={cuttingViewString(props.state.ores, props.state.config.width, props.state.pieces)}
      data-slab={props.state.slab}
      data-cuts={props.state.cutsLeft}
    />
  );
}
