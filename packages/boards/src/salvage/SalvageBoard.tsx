import { salvageViewString, type SalvageState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { SalvageRenderer } from "./renderer.js";

export interface SalvageBoardProps {
  state: SalvageState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Pulse a line worth drawing after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onTether(cells: readonly number[], loop: boolean): void;
  onFrame(): void;
}

/** Hosts the Salvage canvas (prototype, ADR 0036). All drawing lives in the renderer; every number shown is the engine's. */
export function SalvageBoard(props: SalvageBoardProps) {
  const { host } = useBoardHost(
    (el, latest) =>
      new SalvageRenderer(
        el,
        {
          onTether: (cells, loop) => latest.current.onTether(cells, loop),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          hints: props.hints,
          labels: {
            preview: (pieces, points) => (points > 0 ? t("salvage.preview", { pieces, points }) : t("salvage.preview_short", { pieces })),
            previewNet: (crates, points) => t(crates > 0 ? "salvage.preview_net" : "salvage.preview_net_empty", { crates, points }),
            net: (crates) => t("salvage.net", { crates }),
            netEmpty: t("salvage.net_empty"),
            longHaul: t("salvage.long_haul"),
            mightyHaul: t("salvage.mighty_haul"),
            streak: (count) => t("salvage.streak", { count }),
            scrambled: t("salvage.scrambled"),
            crateFloor: t("salvage.crate_floor"),
          },
        },
      ),
    props,
  );

  return <div ref={host} className="board-host" data-testid="salvage-board" data-board={salvageViewString(props.state.cells)} />;
}
