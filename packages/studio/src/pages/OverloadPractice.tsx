import { useCallback } from "react";
import { advanceOverload, overloadDrawBand, overloadStreakPercentAt, summarizeOverload, type OverloadConfig, type OverloadMove, type OverloadState } from "@openseas/engine";
import { CapacitorIcon, content, OverloadBoard, t, useTicked } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { OVERLOAD } from "../prototypes/overload.js";

const overload = content.puzzles.overload;
const waitAt = (tick: number): OverloadMove => ({ type: "wait", tick });

/** Overload (prototype, ADR 0036): the shared board in the studio's frame. Its taps come back on the engine's clock (ADR 0015). */
export function OverloadPractice() {
  const api = usePractice<OverloadState, OverloadMove, OverloadConfig>({
    puzzle: "overload",
    def: OVERLOAD.def,
    config: overload.config,
    roundSeconds: overload.roundSeconds,
    summarize: summarizeOverload,
  });
  const studio = useStudio(OVERLOAD, api);
  const { state } = api;
  const roundCfg = api.round?.config ?? overload.config;
  const ticked = useTicked(api, { tickMs: roundCfg.tickMs, maxTick: roundCfg.maxTick, advance: advanceOverload, wait: waitAt });
  const shown = ticked.shown;
  const cfg = shown.config;
  const band = overloadDrawBand(shown);

  const onTap = useCallback((cell: number): boolean => api.apply({ type: "tap", cell, tick: ticked.moveTick() }), [api, ticked]);

  return (
    <PracticeShell
      puzzle="overload"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("overload.moves")}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("overload.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("overload.streak_note")}</p>
          {band && <p className="how">{t("overload.draw_note")}</p>}
          <p className="how how-kbd">{t("overload.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("overload.taps")}</span>
            <span className="stat-value" data-testid="hud-taps">
              {t("overload.taps_label", { count: shown.taps, max: cfg.tapCap })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("overload.streak_stat")}</span>
            <span className="stat-value" data-testid="hud-streak">
              {shown.combo > 0 ? t("overload.streak_value", { count: shown.combo, percent: overloadStreakPercentAt(cfg, shown.combo) }) : t("overload.streak_none")}
            </span>
          </div>
          {band && (
            <div className="stat stat-wide">
              <span className="stat-label">{t("overload.draw_stat")}</span>
              <span className="stat-value" data-testid="hud-draw" data-draw={`${band.min}-${band.max}`}>
                {band.min === band.max ? t("overload.draw_value_one", { min: band.min, percent: band.percent }) : t("overload.draw_value", { min: band.min, max: band.max, percent: band.percent })}
              </span>
            </div>
          )}
          <div className="stat stat-wide">
            <span className="stat-label">{t("overload.best_chain")}</span>
            <span className="stat-value" data-testid="hud-best-chain">
              {shown.bestChain}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("overload.result_chains")}</dt>
            <dd>{state.chains}</dd>
          </div>
          <div>
            <dt>{t("overload.result_longest")}</dt>
            <dd>{state.bestChain}</dd>
          </div>
          <div>
            <dt>{t("overload.result_bursts")}</dt>
            <dd>{state.bursts}</dd>
          </div>
          <div>
            <dt>{t("overload.result_refunds")}</dt>
            <dd>{state.refunds}</dd>
          </div>
          {state.config.drawSizes.length > 0 && (
            <div>
              <dt>{t("overload.result_draws")}</dt>
              <dd data-testid="result-draws">{state.draws}</dd>
            </div>
          )}
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {[0, 1, 2].map((charge) => (
              <li key={charge}>
                <CapacitorIcon charge={charge} />
                <span>{t(charge === 1 ? "overload.legend_charge" : "overload.legend_charges", { count: charge })}</span>
              </li>
            ))}
            <li>
              <CapacitorIcon charge={3} />
              <span>{t("overload.legend_full")}</span>
            </li>
          </ul>
          <ul className="specials">
            <li>
              <CapacitorIcon charge={2} booster />
              <span>{t("overload.legend_booster")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("overload.legend_ring")}</p>
          <p className="muted small proto-note">{t("overload.streak_note")}</p>
          <p className="muted small proto-note">{t("overload.refund_note")}</p>
          {band && <p className="muted small proto-note">{t("overload.legend_draw")}</p>}
        </>
      }
      board={(interactive) => (
        <OverloadBoard state={shown} interactive={interactive} hints={studio.hints} onTap={onTap} onFrame={api.markRendered} />
      )}
    />
  );
}
