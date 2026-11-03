import { useState } from "react";
import type { ShipSnapshot, StationWire } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { fmtClock, stationName } from "../names.js";
import { HailBanner } from "../shell/HailBanner.jsx";
import { useMediaQuery } from "../state/settings.js";
import { DutyBoard } from "./duty/DutyBoards.jsx";
import { ShipHud } from "./ShipHud.jsx";

export interface StationViewProps {
  ship: ShipSnapshot;
  me: string;
  station: StationWire;
  showMarks: boolean;
  onBack(): void;
}

/**
 * A station with its board open, over the deck (DESIGN.md 3.11). The board gets the screen: one
 * thin bar above it carries the way back, the station's name, the board's score and clock, and the
 * ship as three small bars (bilge, hull, the turn). A tap on them unfolds the full ship status and
 * last turn's output; a wide screen shows it unfolded. Boards are dealt as long as the ship is at sea.
 */
export function StationView({ ship, me, station, showMarks, onBack }: StationViewProps) {
  const wide = useMediaQuery("(min-width: 900px)");
  const [open, setOpen] = useState(false);
  const details = open || wide;
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
                <div className="station-head">
                  <h1 className="station-title">{stationName(station)}</h1>
                  <span className="station-numbers" aria-live="off">
                    <b data-testid="duty-score">{score}</b>
                    {combo > 1 && <i className={`combo-chip ${combo >= 6 ? "hot" : ""}`}>×{combo}</i>}
                    <span className={lowTime ? "urgent" : ""} data-testid="duty-time">
                      {fmtClock(api.timeLeft)}
                    </span>
                  </span>
                </div>
                <button className={`station-ship ${details ? "is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={details} aria-label={t("ship.title")} data-testid="station-ship-toggle">
                  <ShipHud ship={ship} slim mini />
                </button>
              </header>
              {details && (
                <div className="station-details" data-testid="station-details">
                  <ShipHud ship={ship} slim />
                  <div className="duty-strip">
                    <div className="stat">
                      <span className="stat-label">{t("ship.duty_output")}</span>
                      <span className="stat-value" data-testid="duty-output">
                        {lastOutput === null ? t("ship.output_none") : t("ship.output_percent", { percent: lastOutput })}
                      </span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">{t("ship.duty_board")}</span>
                      <span className="stat-value">{fmtClock(api.timeLeft)}</span>
                      <span className="bar" aria-hidden="true">
                        <i style={{ width: `${(api.timeLeft / Math.max(1, api.roundSeconds)) * 100}%` }} />
                      </span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">{t("ship.duty_score")}</span>
                      <span className="stat-value">{score}</span>
                    </div>
                  </div>
                </div>
              )}
              <HailBanner ship={ship} me={me} inline />
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
