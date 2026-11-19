import { useCallback } from "react";
import { summarizeTug, tugLitClamps, type TugConfig, type TugDir, type TugMove, type TugState } from "@openseas/engine";
import { content, t, TUG_PODS, TugBlockIcon, TugBoard, TugClampIcon, TugPodIcon } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { TUG } from "../prototypes/tug.js";

const tug = content.puzzles.tug;

/** Tug (prototype, ADR 0036): the shared board in the studio's frame. */
export function TugPractice() {
  const api = usePractice<TugState, TugMove, TugConfig>({
    puzzle: "tug",
    def: TUG.def,
    config: tug.config,
    roundSeconds: tug.roundSeconds,
    summarize: summarizeTug,
  });
  const studio = useStudio(TUG, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onFlick = useCallback((pod: number, dir: TugDir) => void api.apply({ type: "flick", pod, dir }), [api]);
  const onSkip = useCallback(() => void api.apply({ type: "skip" }), [api]);

  const pods = TUG_PODS.slice(0, cfg.pods);
  const lit = tugLitClamps(shown);
  const pairs = shown.clamp2 !== null;

  return (
    <PracticeShell
      puzzle="tug"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("tug.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < TUG.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("tug.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("tug.par_note")}</p>
          {pairs && <p className="how">{t("tug.pairs_note")}</p>}
          <p className="how how-kbd">{t("tug.hint_note")}</p>
        </>
      }
      details={
        <>
          {pairs ? (
            <div className="stat stat-wide">
              <span className="stat-label">{t("tug.clamps")}</span>
              <span
                className="stat-value"
                data-testid="hud-clamp"
                data-clamps={lit.map((c) => `${c.pod}:${c.par}:${c.worth}`).join("|")}
              >
                {lit.map((c, i) => (
                  <span key={i}>
                    <TugPodIcon pod={c.pod} size={18} /> {c.worth === c.par ? t("tug.clamp_par", { par: c.par }) : t("tug.clamp_par_worth", { par: c.par, worth: c.worth })}{" "}
                  </span>
                ))}
                {t("tug.flick_count", { flicks: shown.flicks })}
              </span>
            </div>
          ) : (
            <div className="stat stat-wide">
              <span className="stat-label">{t("tug.clamp")}</span>
              <span className="stat-value" data-testid="hud-clamp" data-clamps={`${shown.clamp.pod}:${shown.clamp.par}:${shown.clamp.worth}`}>
                {t("tug.clamp_value", { par: shown.clamp.par, flicks: shown.flicks })}
              </span>
            </div>
          )}
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
            {shown.clamp2 && (
              <li>
                <TugClampIcon pod={shown.clamp2.pod} />
                <span>{t("tug.legend_pairs")}</span>
              </li>
            )}
            <li>
              <TugBlockIcon />
              <span>{t("tug.legend_block")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("tug.legend_pods")}</p>
          <p className="muted small proto-note">{t("tug.legend_ghosts")}</p>
          <p className="muted small proto-note">{t("tug.par_note")}</p>
          {pairs && <p className="muted small proto-note">{t("tug.pairs_note")}</p>}
          <p className="muted small proto-note">{t("tug.skip_note")}</p>
        </>
      }
      board={(interactive) => (
        <TugBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onFlick={onFlick} onSkip={onSkip} onFrame={api.markRendered} />
      )}
    />
  );
}
