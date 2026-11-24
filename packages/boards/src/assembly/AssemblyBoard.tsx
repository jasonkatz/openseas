import { useEffect, useRef } from "react";
import { assemblyTrayString, assemblyViewString, type AssemblyState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { AssemblyRenderer } from "./renderer.js";

export interface AssemblyBoardProps {
  state: AssemblyState;
  version?: number;
  interactive: boolean;
  /** Pulse a move worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onSwap(a: number, b: number): void;
  onFit(slot: number, cell: number): void;
  onFrame(): void;
}

/** The bay and the tray as one string: what the board must draw (`data-board`), checked against what it did draw (`data-view`). */
export const assemblyBoardString = (state: AssemblyState): string => `${assemblyViewString(state.cells)}/${assemblyTrayString(state.tray)}`;

/** Hosts the Assembly canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function AssemblyBoard(props: AssemblyBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<AssemblyState, AssemblyRenderer>(
    (el) =>
      new AssemblyRenderer(
        el,
        {
          onSwap: (a, b) => latest.current.onSwap(a, b),
          onFit: (slot, cell) => latest.current.onFit(slot, cell),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            preview: (points) => t("assembly.preview", { points }),
            previewNone: t("assembly.preview_none"),
            chain: (count) => t("assembly.chain_callout", { count }),
            chainEnded: t("assembly.chain_ended"),
            bigFit: t("assembly.big_fit"),
            coreFit: t("assembly.core_fit"),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="assembly-board" data-board={assemblyBoardString(props.state)} />;
}
