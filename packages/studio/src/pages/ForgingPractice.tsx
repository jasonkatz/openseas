import { useCallback } from "react";
import { FORGING_MARKS, forgingDealt, summarizeForging, type ForgingConfig, type ForgingMove, type ForgingState } from "@openseas/engine";
import { content, ForgingBoard, ForgingMarkIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { FORGING } from "../prototypes/forging.js";
import type { StudioPuzzle } from "../puzzles.js";

const forging = content.puzzles.forging;

/** Forging (prototype, ADR 0036, ADR 0083): the shared board in the studio's frame. `entry` is the puzzle this page plays: the prototype, or the same puzzle on another engine (ADR 0097, ADR 0099). */
export function ForgingPractice({ entry = FORGING }: { entry?: StudioPuzzle<ForgingState, ForgingMove, ForgingConfig> } = {}) {
  const api = usePractice<ForgingState, ForgingMove, ForgingConfig>({
    puzzle: "forging",
    def: entry.def,
    config: forging.config,
    roundSeconds: forging.roundSeconds,
    summarize: summarizeForging,
  });
  const studio = useStudio(entry, api);
  const { state } = api;
  const cfg = state.config;

  const onStrike = useCallback((cell: number) => void api.apply({ type: "strike", cell }), [api]);

  const left = state.cells.reduce((n, c) => n + c.heat, 0);
  const sets = cfg.setPoints > 0;
  const marks = FORGING_MARKS.filter((m) => (m === "spark" ? cfg.sparks : forgingDealt(cfg, m)));

  return (
    <PracticeShell
      puzzle="forging"
      eyebrow={entry === FORGING ? t("studio.prototype_eyebrow") : t("rungs.eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      // No clock to play against: the round ends when the press has nowhere to land, or the plate is set.
      untimed
      resultHeadline={api.phase === "result" ? (state.stalled ? t("forging.stall") : left === 0 ? t("forging.plate_done") : undefined) : undefined}
      score={state.score}
      moves={state.moveCount}
      movesLabel={t("forging.moves")}
      // The move bound only keeps the log sane; the plate or a stall ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < entry.config.maxMoves ? cfg.maxMoves : undefined}
      combo={state.weave}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("forging.go")}
      howTo={
        <>
          {sets && <p className="how how-kbd">{t("forging.sets_note")}</p>}
          {cfg.sparks && <p className="how how-kbd">{t("forging.spark_note")}</p>}
          <p className="how how-kbd">{t("forging.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("forging.left")}</span>
            <span className="stat-value" data-testid="hud-left">
              {t("forging.left_value", { count: left })}
            </span>
          </div>
          {sets && (
            <>
              <div className="stat stat-wide">
                <span className="stat-label">{t("forging.set_progress")}</span>
                <span className="stat-value" data-testid="hud-set">
                  {t("forging.set_progress_value", { count: state.run.length })}
                </span>
              </div>
              <div className="stat stat-wide">
                <span className="stat-label">{t("forging.weave")}</span>
                <span className="stat-value" data-testid="hud-weave">
                  {t("forging.weave_value", { count: state.weave })}
                </span>
              </div>
            </>
          )}
        </>
      }
      resultRows={
        <>
          {sets && (
            <>
              <div>
                <dt>{t("forging.result_sets")}</dt>
                <dd>{state.sets}</dd>
              </div>
              <div>
                <dt>{t("forging.result_weave")}</dt>
                <dd>{state.bestWeave}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t("forging.result_chain")}</dt>
            <dd>{state.bestChain}</dd>
          </div>
          <div>
            <dt>{t("forging.result_left")}</dt>
            <dd>{left}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="specials">
            {marks.map((m) => (
              <li key={m}>
                <ForgingMarkIcon mark={m} />
                <span>{t(`forging.mark.${m}`)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small proto-note">{t("forging.legend_heat")}</p>
          <p className="muted small proto-note">{t("forging.legend_lit")}</p>
          <p className="muted small proto-note">{t("forging.legend_lead")}</p>
        </>
      }
      board={(interactive) => <ForgingBoard state={state} version={api.version} interactive={interactive} hints={studio.hints} onStrike={onStrike} onFrame={api.markRendered} />}
    />
  );
}
