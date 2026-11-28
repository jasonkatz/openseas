import { useCallback } from "react";
import { summarizeTug, type TugConfig, type TugDir, type TugMove, type TugState } from "@openseas/engine";
import { content, t, TUG_PODS, TugBlockIcon, TugBoard, TugClampIcon, TugPodIcon } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { TUG } from "../prototypes/tug.js";
import type { StudioPuzzle } from "../puzzles.js";

const tug = content.puzzles.tug;

/** Tug (prototype, ADR 0036): the shared board in the studio's frame. `entry` is the puzzle this page plays: the prototype, or the same puzzle on another engine (ADR 0097, ADR 0099). */
export function TugPractice({ entry = TUG }: { entry?: StudioPuzzle<TugState, TugMove, TugConfig> } = {}) {
  const api = usePractice<TugState, TugMove, TugConfig>({
    puzzle: "tug",
    def: entry.def,
    config: tug.config,
    roundSeconds: tug.roundSeconds,
    summarize: summarizeTug,
  });
  const studio = useStudio(entry, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onFlick = useCallback((pod: number, dir: TugDir) => void api.apply({ type: "flick", pod, dir }), [api]);
  const onSkip = useCallback(() => void api.apply({ type: "skip" }), [api]);

  const pods = TUG_PODS.slice(0, cfg.pods);

  return (
    <PracticeShell
      puzzle="tug"
      eyebrow={entry === TUG ? t("studio.prototype_eyebrow") : t("rungs.eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("tug.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < entry.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("tug.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("tug.par_note")}</p>
          <p className="how how-kbd">{t("tug.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("tug.clamp")}</span>
            <span className="stat-value" data-testid="hud-clamp">
              {t("tug.clamp_value", { par: shown.clamp.par, flicks: shown.flicks })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("tug.delivered")}</span>
            <span className="stat-value" data-testid="hud-delivered">
              {t("tug.delivered_value", { count: shown.delivered, clean: shown.clean })}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("tug.result_delivered")}</dt>
            <dd>{state.delivered}</dd>
          </div>
          <div>
            <dt>{t("tug.result_clean")}</dt>
            <dd>{state.clean}</dd>
          </div>
          <div>
            <dt>{t("tug.result_best_par")}</dt>
            <dd>{state.bestPar}</dd>
          </div>
          <div>
            <dt>{t("tug.result_skipped")}</dt>
            <dd>{state.skipped}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {pods.map((p, i) => (
              <li key={p.id}>
                <TugPodIcon pod={i} />
                <span>{t(`tug.pod.${p.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <TugClampIcon pod={shown.clamp.pod} />
              <span>{t("tug.legend_clamp")}</span>
            </li>
            <li>
              <TugBlockIcon />
              <span>{t("tug.legend_block")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("tug.legend_pods")}</p>
          <p className="muted small proto-note">{t("tug.legend_ghosts")}</p>
          <p className="muted small proto-note">{t("tug.par_note")}</p>
          <p className="muted small proto-note">{t("tug.skip_note")}</p>
        </>
      }
      board={(interactive) => (
        <TugBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onFlick={onFlick} onSkip={onSkip} onFrame={api.markRendered} />
      )}
    />
  );
}
