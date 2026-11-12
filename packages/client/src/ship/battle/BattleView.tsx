import { useCallback } from "react";
import type { BattleEvent } from "@openseas/engine";
import type { ShipSnapshot } from "@openseas/protocol";
import { BattleBoard, TierPace, sfx, t, useTierPace } from "@openseas/boards";
import { tierName } from "../../names.js";
import { ShipHud } from "../ShipHud.jsx";
import { useBattleApi } from "./useBattle.js";

export interface BattleViewProps {
  ship: ShipSnapshot;
  showMarks: boolean;
  onBack(): void;
}

/**
 * The captain's board, over the deck (DESIGN.md 3.11): the same frame as a station, the space
 * battle where the puzzle would be, the ship's turn clock flying the plot. The crew keep their
 * stations; the hull, the loads and the tokens they make arrive on the board every turn.
 */
export function BattleView({ ship, showMarks, onBack }: BattleViewProps) {
  const api = useBattleApi();
  const back = useCallback(() => {
    api.dismiss();
    onBack();
  }, [api, onBack]);
  const fight = ship.location.kind === "in-flight" ? ship.location.battle : null;
  const raider = fight ? tierName(fight.tierId) : t("battle.raider");
  const playing = api.phase === "playing";
  const pace = useTierPace({ puzzle: "battle", points: api.state.score, playing });
  const onEvents = useCallback((events: readonly BattleEvent[]) => {
    for (const e of events) {
      if (e.type === "shot") {
        sfx.charge();
        if (e.hit) sfx.clear(e.ship === 0 ? 3 : 1, 4);
      } else if ((e.type === "move" || e.type === "push") && e.damage > 0) sfx.crack(true);
      else if (e.type === "grapple") sfx.streak(6);
      else if (e.type === "ended") {
        if (e.outcome === "boarded" || e.outcome === "crippled") sfx.streak(12);
        else if (e.outcome === "boarded_by" || e.outcome === "crippled_by") sfx.alarm();
      }
    }
  }, []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  return (
    <section className="station-layer battle-layer" data-testid="battle-view" data-phase={api.phase}>
      <header className="station-bar">
        <button className="icon-btn" onClick={back} aria-label={t("ship.battle_back")} data-testid="battle-back">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="station-head">
          <h1 className="station-title">{raider}</h1>
          <span className="station-numbers" aria-live="off">
            <TierPace pace={pace} />
            <b data-testid="battle-score">{api.state.score}</b>
            <span data-testid="battle-turn">{t("battle.turn", { turn: Math.min(api.state.config.maxTurns, api.state.turn + 1), max: api.state.config.maxTurns })}</span>
          </span>
        </div>
        <span className="station-ship">
          <ShipHud ship={ship} mini />
        </span>
      </header>
      <div className={`board-wrap ${playing ? "is-playing" : ""}`} data-testid="battle-board-wrap">
        <BattleBoard
          state={api.state}
          interactive={playing}
          showMarks={showMarks}
          showArcs
          turnLeftMs={api.turnLeftMs}
          turnMs={api.turnMs}
          commitSignal={api.commitSignal}
          raiderName={raider}
          onCommit={api.commit}
          onFrame={api.markRendered}
          onEvents={onEvents}
          onNudge={onNudge}
        />
        {!playing && (
          <div className="board-veil">
            {api.phase === "idle" && (
              <div className="veil-card veil-card-slim" data-testid="battle-idle">
                <p className="how">{fight ? t("ship.battle_dealing") : t("battle.no_fight")}</p>
                <button className="btn btn-ghost" onClick={back}>
                  {t("ship.battle_back")}
                </button>
              </div>
            )}
            {api.phase === "waiting" && (
              <p className="status">
                <span className="spinner" aria-hidden="true" />
                {t("practice.waiting_result")}
              </p>
            )}
            {api.phase === "result" && api.outcome && (
              <div className="veil-card veil-card-slim" data-testid="battle-result">
                <p className="eyebrow">{t("battle.over")}</p>
                {api.outcome.kind === "rejected" ? (
                  <p className="error">{t("practice.result_rejected", { reason: t(`practice.reject.${api.outcome.reason}`) })}</p>
                ) : (
                  <>
                    <p className="how">{api.state.outcome ? t(`battle.outcome.${api.state.outcome}`) : t("battle.outcome.broke_off")}</p>
                    <p className="result-tier" data-testid="battle-result-tier">
                      {t("practice.round_tier", { tier: t(`tier.${api.outcome.result.performance.tier}`) })}
                    </p>
                    <p className="result-score">{api.outcome.result.score}</p>
                  </>
                )}
                <button className="btn btn-brass" onClick={back}>
                  {t("ship.battle_back")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
