import type { Rotation, EnginesClearRound, EnginesState } from "@openseas/engine";
import { content, t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { EnginesRenderer } from "./renderer.js";

export interface EnginesBoardProps {
  state: EnginesState;
  version: number;
  interactive: boolean;
  showMarks: boolean;
  onPlace(col: number, row: number, rot: Rotation): void;
  onFrame(): void;
  onClear(round: EnginesClearRound): void;
  onLanded(): void;
  onNudge(): void;
  onWipe(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function EnginesBoard(props: EnginesBoardProps) {
  const engines = content.puzzles.engines;
  const { host } = useBoardHost(
    (el, latest) =>
      new EnginesRenderer(
        el,
        engines,
        {
          onPlace: (c, row, rot) => latest.current.onPlace(c, row, rot),
          onFrame: () => latest.current.onFrame(),
          onClear: (round) => latest.current.onClear(round),
          onLanded: () => latest.current.onLanded(),
          onNudge: () => latest.current.onNudge(),
          onWipe: () => latest.current.onWipe(),
        },
        {
          showMarks: props.showMarks,
          fallMs: engines.fallMs,
          softDropMs: engines.softDropMs,
          chainLabel: (chain) => t("practice.chain_label", { chain }),
          injectorLabel: t("engines.injector_cleared"),
          wipeLabel: (points) => t("engines.wipe_label", { points }),
          nextLabel: t("engines.next").toUpperCase(),
        },
      ),
    props,
  );

  return <div ref={host} className="board-host" data-testid="engines-board" data-board={props.state.cells.map((c) => c?.kind ?? -1).join(",")} />;
}
