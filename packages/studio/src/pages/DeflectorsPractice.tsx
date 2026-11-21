import { useCallback } from "react";
import { advanceDeflectors, deflectorsOutlook, deflectorsStreakPercentAt, summarizeDeflectors, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { content, DEFLECTORS_SIGNS, DeflectorsBoard, DeflectorsMirrorIcon, DeflectorsSignIcon, t, useTicked } from "@openseas/boards";
import { css, type Token } from "@openseas/boards/look";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { DEFLECTORS } from "../prototypes/deflectors.js";

const deflectors = content.puzzles.deflectors;
const waitAt = (tick: number): DeflectorsMove => ({ type: "wait", tick });
const BEAM_KEYS = ["deflectors.legend_beam_1", "deflectors.legend_beam_2", "deflectors.legend_beam_3"];

/** Deflectors (prototype, ADR 0036): the shared board in the studio's frame. */
export function DeflectorsPractice() {
  const api = usePractice<DeflectorsState, DeflectorsMove, DeflectorsConfig>({
    puzzle: "deflectors",
    def: DEFLECTORS.def,
    config: deflectors.config,
    roundSeconds: deflectors.roundSeconds,
    summarize: summarizeDeflectors,
  });
  const studio = useStudio(DEFLECTORS, api);
  const { state } = api;
  const cfg = api.round?.config ?? deflectors.config;
  const ticked = useTicked(api, { tickMs: cfg.tickMs, maxTick: cfg.maxTick, advance: advanceDeflectors, wait: waitAt });
  const shown = ticked.shown;

  const onFlip = useCallback((cell: number) => void api.apply({ type: "flip", cell, tick: ticked.moveTick() }), [api, ticked]);
  const onFire = useCallback((volley: number) => void api.apply({ type: "fire", volley, tick: ticked.moveTick() }), [api, ticked]);

  // What the waiting volley would do now: the engine's word, as the board's strip shows it.
  const outlook = deflectorsOutlook(shown);
  const signs = DEFLECTORS_SIGNS.slice(0, shown.config.maxBeams);
  // Locks are taught only where the round deals them: a stage with locks off says nothing of them.
  const locks = shown.config.hotVolleys > 0;

  return (
    <PracticeShell
      puzzle="deflectors"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.volleys}
      movesLabel={t("deflectors.moves")}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("deflectors.go")}
      warn={api.phase === "playing" && outlook !== null && !outlook.clean && shown.volley !== null && (shown.volley.fireTick - shown.tick) * shown.config.tickMs <= 3000}
      howTo={
        <>
          <p className="how how-kbd">{t("deflectors.lines_note")}</p>
          <p className="how how-kbd">{t("deflectors.hint_note")}</p>
          {locks && <p className="how how-kbd">{t("deflectors.locks_note")}</p>}
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("deflectors.volley")}</span>
            <span className="stat-value" data-testid="hud-volley">
              {outlook ? t("deflectors.volley_value", { home: outlook.hits, beams: outlook.shots.length }) : t("deflectors.volley_none")}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("deflectors.streak_stat")}</span>
            <span className="stat-value" data-testid="hud-streak">
              {shown.combo > 0 ? t("deflectors.streak_value", { count: shown.combo, percent: deflectorsStreakPercentAt(shown.config, shown.combo) }) : t("deflectors.streak_none")}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("deflectors.result_home")}</dt>
            <dd>{state.hits}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_hull")}</dt>
            <dd>{state.misses}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_perfect")}</dt>
            <dd>{state.perfects}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_longest")}</dt>
            <dd>{t("deflectors.result_longest_value", { turns: state.longest })}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {signs.map((s, i) => (
              <li key={s.shape}>
                <DeflectorsSignIcon sign={i} />
                <span>{t(BEAM_KEYS[i]!)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <DeflectorsSignIcon sign={0} />
              <span>{t("deflectors.legend_entry")}</span>
            </li>
            <li>
              <DeflectorsSignIcon sign={0} hollow />
              <span>{t("deflectors.legend_exit")}</span>
            </li>
            <li>
              <DeflectorsMirrorIcon />
              <span>{t("deflectors.legend_mirror")}</span>
            </li>
            {locks && (
              <li>
                <DeflectorsMirrorIcon locked />
                <span>{t("deflectors.legend_locked")}</span>
              </li>
            )}
            <li>
              <LineIcon look="home" color={signs[0]!.color} />
              <span>{t("deflectors.legend_home")}</span>
            </li>
            <li>
              <LineIcon look="astray" color={signs[0]!.color} />
              <span>{t("deflectors.legend_astray")}</span>
            </li>
            <li>
              <LineIcon look="back" color={signs[0]!.color} />
              <span>{t("deflectors.legend_back")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("deflectors.lines_note")}</p>
          <p className="muted small proto-note">{t("deflectors.streak_note")}</p>
          {locks && <p className="muted small proto-note">{t("deflectors.locks_note")}</p>}
        </>
      }
      board={(interactive) => (
        <DeflectorsBoard
         
          state={shown}
          logged={state}
          version={api.version}
          interactive={interactive}
          hints={studio.hints}
          onFlip={onFlip}
          onFire={onFire}
          onFrame={api.markRendered}
        />
      )}
    />
  );
}

/** The three looks a waiting beam's lines take, as the board draws them: flat, in the beam's colour. */
function LineIcon({ look, color }: { look: "home" | "astray" | "back"; color: Token }) {
  const ink = css(color);
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      {look === "home" && (
        <>
          <path d="M2 17h10V6h10" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7" cy="17" r="2.6" fill={ink} />
          <circle cx="12" cy="11" r="2.6" fill={ink} />
          <circle cx="18" cy="6" r="2.6" fill={ink} />
        </>
      )}
      {look === "astray" && (
        <>
          <path d="M2 17h10V8" fill="none" stroke={ink} strokeWidth="2.4" strokeDasharray="3.5 3" strokeLinecap="round" />
          <path d="M9 2l6 6m0-6l-6 6" stroke={css("danger")} strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
      {look === "back" && <path d="M2 17h10V6h10" fill="none" stroke={ink} strokeWidth="2.6" strokeDasharray="0.1 4" strokeLinecap="round" />}
    </svg>
  );
}
