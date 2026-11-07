import { useCallback } from "react";
import { swordfightStanding, type SwordfightEvent, type SwordfightState } from "@openseas/engine";
import type { ShipSnapshot } from "@openseas/protocol";
import { SwordfightBoard, sfx, t } from "@openseas/boards";
import { tierName } from "../../names.js";
import { ShipHud } from "../ShipHud.jsx";
import { useMeleeApi } from "./useMelee.js";

export interface MeleeViewProps {
  ship: ShipSnapshot;
  showMarks: boolean;
  onBack(): void;
}

/**
 * The rail, over the deck (DESIGN.md 3.11): the pirate's own swordfight board with every other
 * board in the melee beside it, the same frame as a station. The fight runs until a side is
 * beaten; the outcome stays up until the pirate has read it.
 */
/** The pirate's attack per minute, without the win band a won fight carries in its score. */
function attackRate(s: SwordfightState): number {
  return s.outcome === "won" ? s.score - s.config.winPoints : s.score;
}

export function MeleeView({ ship, showMarks, onBack }: MeleeViewProps) {
  const api = useMeleeApi();
  const back = useCallback(() => {
    api.dismiss();
    onBack();
  }, [api, onBack]);
  const brigand = ship.melee ? tierName(ship.melee.tierId) : t("swordfight.title");
  const playing = api.phase === "playing";
  const onEvents = useCallback((events: readonly SwordfightEvent[]) => {
    for (const e of events) {
      const mine = e.board === 0;
      if (e.type === "broke" && mine) sfx.clear(e.chain, e.groups.reduce((n, g) => n + g.cells.length, 0));
      else if (e.type === "fused" && mine) sfx.barnacle();
      else if (e.type === "attack" && mine && e.wrack > 0) sfx.streak(Math.min(12, e.wrack));
      else if (e.type === "incoming") sfx.alarm();
      else if (e.type === "landed" && mine) sfx.crack(true);
      else if (e.type === "out" && mine) sfx.streakLost();
      else if (e.type === "ended") (e.outcome === "won" ? sfx.streak(16) : sfx.streakLost());
    }
  }, []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const mine = api.state.boards[0]!;
  const foesStanding = api.others.filter((b) => b.side === 1 && !b.out).length;
  const foesTotal = api.others.filter((b) => b.side === 1).length;
  const crewStanding = swordfightStanding(api.state, 0) + api.others.filter((b) => b.side === 0 && !b.out).length;
  return (
    <section className="station-layer melee-layer" data-testid="melee-view" data-phase={api.phase}>
      <header className="station-bar">
        <button className="icon-btn" onClick={back} aria-label={t("ship.melee_back")} data-testid="melee-back" disabled={playing}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="station-head">
          <h1 className="station-title">{brigand}</h1>
          <span className="station-numbers" aria-live="off">
            <b data-testid="melee-score" title={t("swordfight.attack_rate")}>
              {attackRate(api.state)}
            </b>
            <span data-testid="melee-standing">{t("swordfight.standing_value", { yours: crewStanding, theirs: foesTotal ? foesStanding : "?" })}</span>
            {mine.bestChain > 1 && <i className="combo-chip">×{mine.bestChain}</i>}
          </span>
        </div>
        <span className="station-ship">
          <ShipHud ship={ship} mini />
        </span>
      </header>
      <div className={`board-wrap ${playing ? "is-playing" : ""}`} data-testid="melee-board-wrap">
        <SwordfightBoard state={api.state} remote={api.others} interactive={playing} showMarks={showMarks} onPlace={api.place} onFrame={api.markRendered} onEvents={onEvents} onNudge={onNudge} />
        {!playing && (
          <div className="board-veil">
            {(api.phase === "idle" || api.phase === "dealing") && (
              <div className="veil-card veil-card-slim" data-testid="melee-idle">
                <p className="how">{ship.melee ? t("ship.melee_dealing") : t("swordfight.no_fight")}</p>
                <button className="btn btn-ghost" onClick={back}>
                  {t("ship.melee_back")}
                </button>
              </div>
            )}
            {api.phase === "waiting" && (
              <p className="status">
                <span className="spinner" aria-hidden="true" />
                {ship.melee ? t("ship.melee_waiting") : t("practice.waiting_result")}
              </p>
            )}
            {api.phase === "result" && api.outcome && (
              <div className="veil-card veil-card-slim" data-testid="melee-result">
                <p className="eyebrow">{t("swordfight.over")}</p>
                {api.outcome.kind === "rejected" ? (
                  <p className="error">{t("practice.result_rejected", { reason: t(`practice.reject.${api.outcome.reason}`) })}</p>
                ) : (
                  <>
                    <h2 className={`fight-outcome ${api.state.outcome ?? ""}`}>{api.state.outcome ? t(`swordfight.outcome.${api.state.outcome}`) : t("swordfight.outcome.undecided")}</h2>
                    <p className="result-score">{attackRate(api.state)}</p>
                    <p className="muted small">{t("swordfight.result_rate", { broken: api.state.boards[0]?.broken ?? 0 })}</p>
                    {ship.melee && <p className="muted small">{t("ship.melee_crew_fighting")}</p>}
                  </>
                )}
                <button className="btn btn-brass" onClick={back}>
                  {t("ship.melee_back")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {playing && (
        <button className="btn btn-ghost btn-mini melee-yield" onClick={api.yieldFight} data-testid="melee-yield">
          {t("swordfight.yield")}
        </button>
      )}
    </section>
  );
}
