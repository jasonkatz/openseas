import { scannerViewString, type ScannerState } from "@openseas/engine";
import { t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { ScannerRenderer } from "./renderer.js";

export interface ScannerBoardProps {
  state: ScannerState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  /** Pulse a safe move after a pause: on for practice, off for recorded rounds. */
  hints: boolean;
  onPing(cell: number): void;
  onLock(cell: number): void;
  onFrame(): void;
}

/**
 * Hosts the Scanner canvas (prototype, ADR 0036). All drawing lives in the renderer; every number
 * shown is the engine's. `data-board` is the sector as the player sees it and never says where a
 * hidden contact is.
 */
export function ScannerBoard(props: ScannerBoardProps) {
  const { host } = useBoardHost(
    (el, latest) =>
      new ScannerRenderer(
        el,
        {
          onPing: (cell) => latest.current.onPing(cell),
          onLock: (cell) => latest.current.onLock(cell),
          onFrame: () => latest.current.onFrame(),
        },
        {
          showMarks: props.showMarks,
          labels: {
            ping: t("scanner.switch_ping"),
            lock: t("scanner.switch_lock"),
            bounty: (points) => t("scanner.strip_bounty", { points }),
            pings: (left, par) => t("scanner.strip_pings", { left, par }),
            over: (over) => t("scanner.strip_over", { over }),
            sector: (sector) => t("scanner.strip_sector", { sector }),
            hidden: (left, total) => t("scanner.strip_hidden", { left, total }),
            spooked: t("scanner.spooked"),
            miss: t("scanner.miss"),
            overPar: t("scanner.over_par"),
            sectorClear: t("scanner.sector_clear"),
            clean: t("scanner.clean"),
            saved: (pings, points) => t("scanner.saved", { pings, points }),
            streak: (count) => t("scanner.streak", { count }),
            streakLost: t("scanner.streak_lost"),
          },
        },
      ),
    props,
  );

  return <div ref={host} className="board-host" data-testid="scanner-board" data-board={scannerViewString(props.state)} />;
}
