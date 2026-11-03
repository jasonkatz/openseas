import type { ShipSnapshot, StationWire } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { fmtClock, stationName } from "../names.js";
import { DutyBoard } from "./duty/DutyBoards.jsx";
import { ShipHud } from "./ShipHud.jsx";

export interface StationViewProps {
  ship: ShipSnapshot;
  station: StationWire;
  showMarks: boolean;
  onBack(): void;
}

/**
 * A station with its board open, over the deck (DESIGN.md 3.11): a slim HUD with the ship's vitals
 * and the board's own numbers, the board below, and the way back to the deck. Boards are dealt as
 * long as the ship is at sea.
 */
export function StationView({ ship, station, showMarks, onBack }: StationViewProps) {
  const atSea = ship.location.kind === "at-sea";
  const lastOutput = ship.lastTurn ? (ship.lastTurn.outputs[station] ?? 0) : null;
  return (
    <section className="station-layer" data-testid={`station-view-${station}`}>
      <DutyBoard station={station} active={atSea} showMarks={showMarks}>
        {({ api, score, combo, board }) => {
          const playing = api.phase === "playing";
          const lowTime = playing && api.timeLeft <= 10;
          return (
            <>
              <header className="station-bar">
                <button className="icon-btn" onClick={onBack} aria-label={t("ship.duty_back")} data-testid="station-back">
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <h1 className="station-title">{stationName(station)}</h1>
                <span className="station-ship muted">{ship.name}</span>
              </header>
              <ShipHud ship={ship} slim />
              <div className="duty-strip" aria-live="off">
                <div className="stat stat-score">
                  <span className="stat-label">{t("ship.duty_score")}</span>
                  <span className="stat-value" data-testid="duty-score">
                    <span key={score} className={score ? "bump" : undefined}>
                      {score}
                    </span>
                    {combo > 1 && (
                      <b className={`combo-chip ${combo >= 6 ? "hot" : ""}`} key={combo}>
                        ×{combo}
                      </b>
                    )}
                  </span>
                </div>
                <div className={`stat ${lowTime ? "stat-urgent" : ""}`}>
                  <span className="stat-label">{t("ship.duty_board")}</span>
                  <span className={`stat-value ${lowTime ? "urgent" : ""}`} data-testid="duty-time">
                    {fmtClock(api.timeLeft)}
                  </span>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${(api.timeLeft / Math.max(1, api.roundSeconds)) * 100}%` }} />
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">{t("ship.duty_output")}</span>
                  <span className="stat-value" data-testid="duty-output">
                    {lastOutput === null ? t("ship.output_none") : t("ship.output_percent", { percent: lastOutput })}
                  </span>
                </div>
              </div>
              <div className={`board-wrap ${lowTime ? "low-time" : ""} ${playing ? "is-playing" : ""}`} data-testid="duty-board-wrap" data-phase={api.phase}>
                {board(playing)}
                {!playing && (
                  <div className="board-veil">
                    {!atSea && (
                      <div className="veil-card veil-card-slim">
                        <p className="how">{t("ship.duty_waits_for_sea")}</p>
                      </div>
                    )}
                    {atSea && (api.phase === "idle" || api.phase === "dealing") && (
                      <p className="status">
                        <span className="spinner" aria-hidden="true" />
                        {t("ship.duty_dealing")}
                      </p>
                    )}
                    {api.phase === "waiting" && (
                      <p className="status">
                        <span className="spinner" aria-hidden="true" />
                        {t("practice.waiting_result")}
                      </p>
                    )}
                    {api.phase === "result" && api.outcome && (
                      <div className="veil-card veil-card-slim" data-testid="duty-result">
                        <p className="eyebrow">{t("ship.duty_board_done")}</p>
                        {api.outcome.kind === "rejected" ? (
                          <p className="error">{t("practice.result_rejected", { reason: t(`practice.reject.${api.outcome.reason}`) })}</p>
                        ) : (
                          <>
                            <p className="result-score">{api.outcome.result.score}</p>
                            {api.outcome.result.rating && api.outcome.result.tierChange ? (
                              <p className={`tier-line tier-${api.outcome.result.tierChange}`}>
                                {t(`practice.tier_${api.outcome.result.tierChange}`, { tier: t(`tier.${api.outcome.result.rating.tier}`) })}
                              </p>
                            ) : (
                              <p className="muted small">{t("ship.duty_unrated")}</p>
                            )}
                          </>
                        )}
                        <p className="muted small">{t("ship.duty_next_board")}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          );
        }}
      </DutyBoard>
    </section>
  );
}
