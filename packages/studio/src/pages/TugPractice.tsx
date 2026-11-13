import { useCallback } from "react";
import { summarizeTug, type TugConfig, type TugDir, type TugMove, type TugState } from "@openseas/engine";
import { content, KindIcon, KINDS, SpriteIcon, spriteName, t, TugBoard } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { TUG } from "../prototypes/tug.js";

const tug = content.puzzles.tug;

/** Tug (prototype, ADR 0036): the shared board in the studio's frame. */
export function TugPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
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

  const kinds = KINDS.slice(0, cfg.pods);

  return (
    <PracticeShell
      puzzle="tug"
      eyebrow={t("harness.prototype_eyebrow")}
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
            {kinds.map((k, i) => (
              <li key={k.id}>
                <KindIcon kind={i} marks={showMarks} sprite={{ puzzle: "tug", name: spriteName("pod", i) }} />
                <span>{t(`tug.kind.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <ClampIcon />
              <span>{t("tug.legend_clamp")}</span>
            </li>
            <li>
              <BlockIcon />
              <span>{t("tug.legend_block")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("tug.legend_pods")}</p>
          <p className="muted small proto-note">{t("tug.legend_ghosts")}</p>
          <p className="muted small proto-note">{t("tug.par_note")}</p>
          <p className="muted small proto-note">{t("tug.skip_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      board={(interactive) => (
        <TugBoard state={shown} version={api.version} interactive={interactive} showMarks={showMarks} hints={studio.hints} onFlick={onFlick} onSkip={onSkip} onFrame={api.markRendered} />
      )}
    />
  );
}

function ClampIcon() {
  const vector = (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" fill="none" stroke="#f5d021" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="4.5" fill="#f5d021" fillOpacity="0.12" stroke="#f5d021" strokeWidth="1.6" />
    </svg>
  );
  return <SpriteIcon puzzle="tug" name="clamp-gold" fallback={vector} />;
}

function BlockIcon() {
  const vector = (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#33435f" stroke="#6c7a94" strokeWidth="1.4" />
      <path d="M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="#1c2534" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
  return <SpriteIcon puzzle="tug" name="block" fallback={vector} />;
}
