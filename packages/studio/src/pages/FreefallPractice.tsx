import { useCallback } from "react";
import { summarizeFreefall, type FreefallConfig, type FreefallMove, type FreefallState } from "@openseas/engine";
import { content, FreefallBoard, FreefallIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { FREEFALL } from "../prototypes/freefall.js";

const freefall = content.puzzles.freefall;

/** Freefall (prototype, ADR 0036, ADR 0081): the shared board in the studio's frame. */
export function FreefallPractice() {
  const api = usePractice<FreefallState, FreefallMove, FreefallConfig>({
    puzzle: "freefall",
    def: FREEFALL.def,
    config: freefall.config,
    roundSeconds: freefall.roundSeconds,
    summarize: summarizeFreefall,
  });
  const studio = useStudio(FREEFALL, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onDrop = useCallback((lane: number) => void api.apply({ type: "drop", lane }), [api]);
  const last = shown.lastMove?.drops[0];

  return (
    <PracticeShell
      puzzle="freefall"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      // The indicator reads the lead as it moves, falling when the rival scores.
      pacePoints={shown.totals[0] - shown.totals[1]}
      moves={shown.moveCount}
      movesLabel={t("freefall.moves")}
      // The move bound only keeps the log sane; the legs and the clock end a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < FREEFALL.config.maxMoves ? cfg.maxMoves : undefined}
      combo={last ? last.landed.reduce((n, l) => n + l.ids.length, 0) : 0}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("freefall.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("freefall.legs_note")}</p>
          {cfg.rival && <p className="how how-kbd">{t("freefall.rival_note")}</p>}
          <p className="how how-kbd">{t("freefall.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("freefall.leg")}</span>
            <span className="stat-value" data-testid="hud-leg">
              {t("freefall.leg_value", { leg: shown.leg + 1 })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("freefall.quota")}</span>
            <span className="stat-value" data-testid="hud-quota">
              {t("freefall.quota_value", { you: shown.legPoints[0], quota: cfg.quotas[shown.leg] ?? 0 })}
            </span>
          </div>
          {cfg.rival && (
            <div className="stat stat-wide">
              <span className="stat-label">{t("freefall.rival")}</span>
              <span className="stat-value" data-testid="hud-rival">
                {t("freefall.quota_value", { you: shown.legPoints[1], quota: cfg.quotas[shown.leg] ?? 0 })}
              </span>
            </div>
          )}
        </>
      }
      resultRows={
        <>
          {cfg.rival && (
            <>
              <div>
                <dt>{t("freefall.you")}</dt>
                <dd>{state.totals[0]}</dd>
              </div>
              <div>
                <dt>{t("freefall.result_rival")}</dt>
                <dd>{state.totals[1]}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t("freefall.result_legs")}</dt>
            <dd>{state.legsWon}</dd>
          </div>
          <div>
            <dt>{t("freefall.result_cluster")}</dt>
            <dd>{state.bestCluster}</dd>
          </div>
          <div>
            <dt>{t("freefall.result_pods")}</dt>
            <dd>{state.bestCombo}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="specials">
            <li>
              <FreefallIcon piece="pod" />
              <span>{t("freefall.legend_pod")}</span>
            </li>
            <li>
              <FreefallIcon piece="pod" />
              <span>{t("freefall.legend_cluster")}</span>
            </li>
            <li>
              <FreefallIcon piece="cradle" />
              <span>{t("freefall.legend_cradle")}</span>
            </li>
            <li>
              <FreefallIcon piece="arm" />
              <span>{t("freefall.legend_arm")}</span>
            </li>
            <li>
              <FreefallIcon piece="berth" />
              <span>{t("freefall.legend_bay")}</span>
            </li>
          </ul>
        </>
      }
      board={(interactive) => (
        <FreefallBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onDrop={onDrop} onFrame={api.markRendered} />
      )}
    />
  );
}
