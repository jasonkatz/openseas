import { useCallback } from "react";
import { scannerContactsLeft, scannerPingsLeft, scannerStreakPercentAt, summarizeScanner, type ScannerConfig, type ScannerMove, type ScannerState } from "@openseas/engine";
import { content, ScannerBoard, ScannerCellIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { SCANNER } from "../prototypes/scanner.js";

const scanner = content.puzzles.scanner;

/** Scanner (prototype, ADR 0036): the shared board in the studio's frame. */
export function ScannerPractice() {
  const api = usePractice<ScannerState, ScannerMove, ScannerConfig>({
    puzzle: "scanner",
    def: SCANNER.def,
    config: scanner.config,
    roundSeconds: scanner.roundSeconds,
    summarize: summarizeScanner,
  });
  const studio = useStudio(SCANNER, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onPing = useCallback((cell: number) => void api.apply({ type: "ping", cell }), [api]);
  const onLock = useCallback((cell: number) => void api.apply({ type: "lock", cell }), [api]);

  const pingsLeft = scannerPingsLeft(shown);

  return (
    <PracticeShell
      puzzle="scanner"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("scanner.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < SCANNER.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("scanner.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("scanner.live_note")}</p>
          <p className="how how-kbd">{t("scanner.par_note")}</p>
          <p className="how how-kbd">{t("scanner.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("scanner.sector_stat")}</span>
            <span className="stat-value" data-testid="hud-sector">
              {t("scanner.sector_value", { sector: shown.sector + 1, left: scannerContactsLeft(shown), total: shown.contacts.length })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("scanner.pings_stat")}</span>
            <span className="stat-value" data-testid="hud-pings">
              {pingsLeft >= 0 ? t("scanner.pings_value", { left: pingsLeft, par: shown.par }) : t("scanner.pings_over", { over: -pingsLeft })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("scanner.streak_stat")}</span>
            <span className="stat-value" data-testid="hud-streak">
              {shown.combo > 0 ? t("scanner.streak_value", { count: shown.combo, percent: scannerStreakPercentAt(cfg, shown.combo) }) : t("scanner.streak_none")}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("scanner.result_sectors")}</dt>
            <dd>{state.sectorsCleared}</dd>
          </div>
          <div>
            <dt>{t("scanner.result_clean")}</dt>
            <dd>{state.cleanSectors}</dd>
          </div>
          <div>
            <dt>{t("scanner.result_found")}</dt>
            <dd>{state.contactsFound}</dd>
          </div>
          <div>
            <dt>{t("scanner.result_saved")}</dt>
            <dd>{state.pingsSaved}</dd>
          </div>
          <div>
            <dt>{t("scanner.result_spooked")}</dt>
            <dd>{state.contactsSpooked}</dd>
          </div>
          <div>
            <dt>{t("scanner.result_wrong")}</dt>
            <dd>{state.wrongLocks}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="specials">
            <li>
              <ScannerCellIcon cell="fog" />
              <span>{t("scanner.legend_fog")}</span>
            </li>
            <li>
              <ScannerCellIcon cell="clear" />
              <span>{t("scanner.legend_clear")}</span>
            </li>
            <li>
              <ScannerCellIcon cell="ping" />
              <span>{t("scanner.legend_ping")}</span>
            </li>
            <li>
              <ScannerCellIcon cell="found" />
              <span>{t("scanner.legend_found")}</span>
            </li>
            <li>
              <ScannerCellIcon cell="spooked" />
              <span>{t("scanner.legend_spooked")}</span>
            </li>
            <li>
              <ScannerCellIcon cell="miss" />
              <span>{t("scanner.legend_miss")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("scanner.live_note")}</p>
          <p className="muted small proto-note">{t("scanner.par_note")}</p>
          <p className="muted small proto-note">{t("scanner.fair_note")}</p>
        </>
      }
      board={(interactive) => (
        <ScannerBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onPing={onPing} onLock={onLock} onFrame={api.markRendered} />
      )}
    />
  );
}
