import { useCallback } from "react";
import type { TugDir } from "@openseas/engine";
import { KindIcon, KINDS, SpriteIcon, spriteName, t, TugBoard } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePracticePage } from "../practice/usePracticePage.js";
import { TUG } from "../prototypes/tug.js";

/** Tug (prototype, ADR 0036): the practice frame round the shared board, with the bench beside it. */
export function TugPractice() {
  const page = usePracticePage(TUG);
  const { shown, showMarks } = page;
  const { state, apply } = page.api;
  const cfg = shown.config;

  const onFlick = useCallback((pod: number, dir: TugDir) => void apply({ type: "flick", pod, dir }), [apply]);
  const onSkip = useCallback(() => void apply({ type: "skip" }), [apply]);

  const kinds = KINDS.slice(0, cfg.pods);

  return (
    <PracticeShell
      page={page}
      hud={{ movesLabel: t("tug.moves") }}
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
        </>
      }
      board={(b) => <TugBoard {...b} onFlick={onFlick} onSkip={onSkip} />}
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
