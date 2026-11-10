import { useState } from "react";
import type { ShipSnapshot, StationWire } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { fmtClock, stationName, tierName } from "../names.js";
import { useShip } from "../state/ShipProvider.jsx";
import { useMediaQuery } from "../state/settings.js";
import { DutyBoard } from "./duty/DutyBoards.jsx";
import { ShipHud } from "./ShipHud.jsx";

export interface StationViewProps {
  ship: ShipSnapshot;
  me: string;
  station: StationWire;
  showMarks: boolean;
  onBack(): void;
  /** The captain's way to the helm from a station that is waiting for the ship to fly. */
  onHelm(): void;
}

/**
 * A station with its board open, over the deck (DESIGN.md 3.11). The board gets the screen: one
 * thin bar above it carries the way back, the station's name, the board's score and clock, and the
 * ship as two labeled bars (heat, hull) with the turn clock. A tap on them unfolds the full ship
 * status and last turn's output; a wide screen keeps it unfolded in a rail beside the board. Boards
 * are dealt as long as the ship is in flight; docked, the station says what it is waiting for.
 */
export function StationView({ ship, me, station, showMarks, onBack, onHelm }: StationViewProps) {
  const wide = useMediaQuery("(min-width: 900px)");
  const [open, setOpen] = useState(false);
  const details = open || wide;
  const inFlight = ship.location.kind === "in-flight";
  const captain = ship.captainId === me;
  const captainName = ship.crew.find((c) => c.captain)?.name ?? "";
  const lastOutput = ship.lastTurn ? (ship.lastTurn.outputs[station] ?? 0) : null;
  const { engage, evade } = useShip();
  // A raider's hail takes over the bar itself, so nothing above the board moves: the title turns
  // to the hail and pulses, and the captain's two answers stand in for the ship's bars until it passes.
  const hail = ship.location.kind === "in-flight" ? ship.location.hail : null;
  return (
    <section className="station-layer" data-testid={`station-view-${station}`}>
      <DutyBoard station={station} active={inFlight} showMarks={showMarks}>
        {({ api, score, combo, board }) => {
          const playing = api.phase === "playing";
          const lowTime = playing && api.timeLeft <= 10;
          return (
            <>
              <header className={`station-bar ${hail ? "is-hailed" : ""}`}>
                <button className="icon-btn" onClick={onBack} aria-label={t("ship.duty_back")} data-testid="station-back">
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="station-head">
                  {hail ? (
                    <h1 className="station-title station-hail" role="alert" title={captain ? t("ship.hailed", { raider: tierName(hail.tierId) }) : t("ship.hail_wait")} data-testid="station-hail">
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
                        <path d="M12 3l10 18H2z" />
                        <path d="M12 10v5M12 18v.5" />
                      </svg>
                      <span>{t("ship.hailed_bar", { raider: tierName(hail.tierId) })}</span>
                    </h1>
                  ) : (
                    <h1 className="station-title">{stationName(station)}</h1>
                  )}
                  <span className="station-numbers" aria-live="off">
                    <b data-testid="duty-score">{score}</b>
                    {combo > 1 && <i className={`combo-chip ${combo >= 6 ? "hot" : ""}`}>×{combo}</i>}
                    <span className={lowTime ? "urgent" : ""} data-testid="duty-time">
                      {fmtClock(api.timeLeft)}
                    </span>
                  </span>
                </div>
                <span className={`station-ship-slot ${hail && captain ? "is-hailed" : ""}`}>
                  <button className={`station-ship ${details ? "is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={details} aria-label={t("ship.title")} aria-hidden={hail && captain ? true : undefined} tabIndex={hail && captain ? -1 : undefined} data-testid="station-ship-toggle">
                    <ShipHud ship={ship} mini />
                  </button>
                  {hail && captain && (
                    <span className="station-hail-actions">
                      <button className="btn btn-brass btn-small" onClick={engage} data-testid="engage">
                        {t("ship.engage")}
                      </button>
                      <button className="btn btn-ghost btn-small" onClick={evade} data-testid="evade">
                        {t("ship.evade")}
                      </button>
                    </span>
                  )}
                </span>
              </header>
              {details && (
                <aside className="station-details" data-testid="station-details">
                  <ShipHud ship={ship} slim />
                  <p className="last-turn muted small" data-testid="duty-output">
                    {lastOutput === null ? t("ship.last_turn_none") : t("ship.last_turn_output", { percent: lastOutput })}
                  </p>
                </aside>
              )}
              <div className={`board-wrap ${lowTime ? "low-time" : ""} ${playing ? "is-playing" : ""}`} data-testid="duty-board-wrap" data-phase={api.phase}>
                {board(playing)}
                {!playing && (
                  <div className="board-veil">
                    {!inFlight && (
                      <div className="veil-card veil-card-slim" data-testid="duty-docked">
                        <p className="eyebrow">{stationName(station)}</p>
                        <p className="how">{captain ? t("ship.duty_waits_for_launch") : t("ship.waiting_for_captain", { captain: captainName })}</p>
                        <div className="row">
                          {captain && (
                            <button className="btn btn-brass" onClick={onHelm} data-testid="duty-launch">
                              {t("ship.launch")}
                            </button>
                          )}
                          <button className="btn btn-ghost" onClick={onBack}>
                            {t("ship.duty_back")}
                          </button>
                        </div>
                      </div>
                    )}
                    {inFlight && (api.phase === "idle" || api.phase === "dealing") && (
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
