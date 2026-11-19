import { useCallback } from "react";
import { reactorHotCount, reactorPipelineLeft, reactorPressureWarning, summarizeReactor, type ReactorConfig, type ReactorDir, type ReactorMove, type ReactorState } from "@openseas/engine";
import { content, ReactorBoard, ReactorPortIcon, ReactorRodIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { REACTOR } from "../prototypes/reactor.js";

const reactor = content.puzzles.reactor;

/** Reactor (prototype, ADR 0036): the shared board in the studio's frame. */
export function ReactorPractice() {
  const api = usePractice<ReactorState, ReactorMove, ReactorConfig>({
    puzzle: "reactor",
    def: REACTOR.def,
    config: reactor.config,
    roundSeconds: reactor.roundSeconds,
    summarize: summarizeReactor,
  });
  const studio = useStudio(REACTOR, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onSwipe = useCallback((dir: ReactorDir): boolean => api.apply({ type: "swipe", dir }), [api]);

  const hot = reactorHotCount(cfg, shown.cells);
  const left = reactorPipelineLeft(shown);
  const grades = Array.from({ length: cfg.hotGrade - 1 }, (_, i) => i + 1);
  // A stage before a layer switches it off (ADR 0066): its notes and its line of the HUD go with it.
  const salvoOn = cfg.salvoPercent.some((p) => p > 100);
  const pipelineOn = cfg.pipelinePercent.some((p) => p > 100);
  const gauged = cfg.pressureLimit > 0;
  const venting = reactorPressureWarning(shown);

  return (
    <PracticeShell
      puzzle="reactor"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("reactor.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < REACTOR.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("reactor.go")}
      warn={hot >= cfg.criticalHot - 1 || venting}
      howTo={
        <>
          {salvoOn && <p className="how how-kbd">{t("reactor.salvo_note")}</p>}
          {pipelineOn && <p className="how how-kbd">{t("reactor.pipeline_note")}</p>}
          {gauged && <p className="how how-kbd">{t("reactor.pressure_note")}</p>}
          <p className="how how-kbd">{t("reactor.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("reactor.stat_next")}</span>
            <span className="stat-value" data-testid="hud-next">
              <ReactorRodIcon grade={shown.next} size={26} />
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("reactor.stat_hot")}</span>
            <span className={`stat-value ${hot >= cfg.criticalHot - 1 ? "urgent" : ""}`} data-testid="hud-hot">
              {t("reactor.stat_hot_value", { count: hot, max: cfg.criticalHot })}
            </span>
          </div>
          {gauged && (
            <div className="stat stat-wide">
              <span className="stat-label">{t("reactor.stat_pressure")}</span>
              <span className={`stat-value ${venting ? "urgent" : ""}`} data-testid="hud-pressure" data-pressure={`${shown.pressure}:${cfg.pressureLimit}`}>
                {t(venting ? "reactor.stat_pressure_warn" : "reactor.stat_pressure_value", { count: shown.pressure, max: cfg.pressureLimit })}
              </span>
            </div>
          )}
          {pipelineOn && (
            <div className="stat stat-wide">
              <span className="stat-label">{t("reactor.stat_pipeline")}</span>
              <span className="stat-value" data-testid="hud-pipeline">
                {left > 0 ? t("reactor.stat_pipeline_value", { count: shown.combo, left }) : t("reactor.stat_pipeline_none")}
              </span>
            </div>
          )}
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("reactor.result_discharges")}</dt>
            <dd>{state.discharges}</dd>
          </div>
          <div>
            <dt>{t("reactor.result_salvos")}</dt>
            <dd>{state.salvos}</dd>
          </div>
          <div>
            <dt>{t("reactor.result_scrams")}</dt>
            <dd>{state.scrams}</dd>
          </div>
          {gauged && (
            <div>
              <dt>{t("reactor.result_pressure")}</dt>
              <dd>{state.pressureScrams}</dd>
            </div>
          )}
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {grades.map((grade) => (
              <li key={grade}>
                <ReactorRodIcon grade={grade} />
                <span>{t("reactor.legend_grade", { grade })}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <ReactorRodIcon grade={cfg.hotGrade} hot />
              <span>{t("reactor.legend_hot")}</span>
            </li>
            <li>
              <ReactorPortIcon status="idle" />
              <span>{t("reactor.legend_port_idle")}</span>
            </li>
            <li>
              <ReactorPortIcon status="ready" />
              <span>{t("reactor.legend_port_ready")}</span>
            </li>
            <li>
              <ReactorPortIcon status="blocked" />
              <span>{t("reactor.legend_port_blocked")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("reactor.legend_heat")}</p>
          {gauged && <p className="muted small proto-note">{t("reactor.legend_pressure")}</p>}
          {salvoOn && <p className="muted small proto-note">{t("reactor.salvo_note")}</p>}
          {pipelineOn && <p className="muted small proto-note">{t("reactor.pipeline_note")}</p>}
        </>
      }
      board={(interactive) => (
        <ReactorBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onSwipe={onSwipe} onFrame={api.markRendered} />
      )}
    />
  );
}
