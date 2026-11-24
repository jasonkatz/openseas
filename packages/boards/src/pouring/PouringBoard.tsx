import { useEffect, useRef } from "react";
import { pouringViewString, type PouringState } from "@openseas/engine";
import { t } from "../content.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { PouringRenderer } from "./renderer.js";

export interface PouringBoardProps {
  state: PouringState;
  version?: number;
  interactive: boolean;
  /** Show a pour worth making after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onPour(slot: number, cell: number): void;
  onDrink(slot: number): void;
  onFrame(): void;
}

/** Hosts the Pouring canvas (prototype, ADR 0083). All drawing lives in the renderer; every number shown is the engine's. */
export function PouringBoard(props: PouringBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host, renderer } = useKitBoard<PouringState, PouringRenderer>(
    (el) =>
      new PouringRenderer(
        el,
        {
          onPour: (slot, cell) => latest.current.onPour(slot, cell),
          onDrink: (slot) => latest.current.onDrink(slot),
          onFrame: () => latest.current.onFrame(),
        },
        {
          hints: props.hints,
          labels: {
            preview: (points, count) => (count > 0 ? t("pouring.preview_lines", { points, count }) : t("pouring.preview", { points })),
            previewNoFit: t("pouring.preview_no_fit"),
            previewWipe: t("pouring.preview_wipe"),
            previewDrink: (points) => t("pouring.preview_drink", { points }),
            served: t("pouring.served"),
            servedClean: t("pouring.served_clean"),
            double: t("pouring.double"),
            doubleClean: t("pouring.double_clean"),
            downed: t("pouring.downed"),
            passedOut: t("pouring.passed_out"),
            wiped: t("pouring.wiped"),
            tossed: t("pouring.tossed"),
            stolen: t("pouring.stolen"),
            mustDrink: t("pouring.must_drink"),
            lastCall: t("pouring.last_call"),
            rival: (n) => t("pouring.rival", { n }),
          },
        },
      ),
    props,
  );

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints, renderer]);

  return <div ref={host} className="board-host" data-testid="pouring-board" data-board={pouringViewString(props.state.cells)} />;
}
