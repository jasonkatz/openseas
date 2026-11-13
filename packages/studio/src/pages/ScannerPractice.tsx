import { useCallback } from "react";
import { scannerContactsLeft, scannerPingsLeft, scannerStreakPercentAt, summarizeScanner, type ScannerConfig, type ScannerMove, type ScannerState } from "@openseas/engine";
import { content, ScannerBoard, SpriteIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { SCANNER } from "../prototypes/scanner.js";

const scanner = content.puzzles.scanner;

/** Scanner (prototype, ADR 0036): the shared board in the studio's frame. */
export function ScannerPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
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
      eyebrow={t("harness.prototype_eyebrow")}
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
              <CellIcon kind="fog" />
              <span>{t("scanner.legend_fog")}</span>
            </li>
            <li>
              <CellIcon kind="clear" marks={showMarks} />
              <span>{t("scanner.legend_clear")}</span>
            </li>
            <li>
              <CellIcon kind="ping" />
              <span>{t("scanner.legend_ping")}</span>
            </li>
            <li>
              <CellIcon kind="found" marks={showMarks} />
              <span>{t("scanner.legend_found")}</span>
            </li>
            <li>
              <CellIcon kind="spooked" marks={showMarks} />
              <span>{t("scanner.legend_spooked")}</span>
            </li>
            <li>
              <CellIcon kind="miss" />
              <span>{t("scanner.legend_miss")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("scanner.live_note")}</p>
          <p className="muted small proto-note">{t("scanner.par_note")}</p>
          <p className="muted small proto-note">{t("scanner.fair_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      board={(interactive) => (
        <ScannerBoard state={shown} version={api.version} interactive={interactive} showMarks={showMarks} hints={studio.hints} onPing={onPing} onLock={onLock} onFrame={api.markRendered} />
      )}
    />
  );
}

/** One of the six things a cell can show, drawn as the board draws it. */
function CellIcon({ kind, marks = false }: { kind: "fog" | "clear" | "ping" | "found" | "spooked" | "miss"; marks?: boolean }) {
  const fog = kind === "fog";
  const vector = (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <rect x="2" y="2" width="20" height="20" rx="4" fill={fog ? "#2b4369" : "#0b1627"} stroke="#24395c" />
      {fog &&
        [
          [7, 7],
          [17, 7],
          [12, 12],
          [7, 17],
          [17, 17],
        ].map(([x, y]) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.1" fill="#fff" fillOpacity="0.35" />)}
      {kind === "clear" && marks && <rect x="9.5" y="11.4" width="5" height="1.2" fill="#8ea0bd" />}
      {kind === "ping" && (
        <>
          <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" fill="#7fd7ff" fillOpacity="0.14" stroke="#7fd7ff" strokeWidth="1.2" />
          <text x="12" y="16.200" textAnchor="middle" fontSize="11.500" fontWeight="900" fill="#fff">
            3
          </text>
        </>
      )}
      {kind === "found" && (
        <>
          <circle cx="12" cy="12" r="4.6" fill="#f5d58a" stroke="#7a6a45" strokeWidth="1.1" />
          <path d="M4.5 8V4.5H8M16 4.500h3.500V8M19.500 16v3.500H16M8 19.500H4.500V16" fill="none" stroke="#f5d58a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          {marks && <circle cx="12" cy="12" r="1.15" fill="#000" fillOpacity="0.78" />}
        </>
      )}
      {kind === "spooked" && (
        <>
          <circle cx="12" cy="12" r="5.4" fill="none" stroke="#ec8171" strokeWidth="1.8" strokeDasharray="4.200 4.200" strokeLinecap="round" />
          <path d="M5.500 18.500l13-13" stroke="#ec8171" strokeWidth="1.800" strokeLinecap="round" />
          {marks && (
            <>
              <circle cx="10.4" cy="10.4" r="1.05" fill="#e8e2cf" />
              <circle cx="13.6" cy="13.6" r="1.05" fill="#e8e2cf" />
            </>
          )}
        </>
      )}
      {kind === "miss" && <path d="M7.500 7.500l9 9M16.500 7.500l-9 9" stroke="#f0604d" strokeWidth="2.400" strokeLinecap="round" />}
    </svg>
  );
  return (
    <SpriteIcon puzzle="scanner" name={kind} fallback={vector}>
      {kind === "ping" && (
        <text x="12" y="16.2" textAnchor="middle" fontSize="11.5" fontWeight="900" fill="#fff" stroke="#0a1424" strokeWidth="2.2" paintOrder="stroke">
          3
        </text>
      )}
      {kind === "clear" && marks && <rect x="9.5" y="11.4" width="5" height="1.2" fill="#8ea0bd" />}
      {kind === "found" && marks && <circle cx="12" cy="12" r="1.15" fill="#000" fillOpacity="0.78" />}
      {kind === "spooked" && marks && (
        <>
          <circle cx="10.4" cy="10.4" r="1.05" fill="#e8e2cf" />
          <circle cx="13.6" cy="13.6" r="1.05" fill="#e8e2cf" />
        </>
      )}
    </SpriteIcon>
  );
}
