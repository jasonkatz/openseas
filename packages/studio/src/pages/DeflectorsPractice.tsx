import { useCallback } from "react";
import { advanceDeflectors, deflectorsOutlook, deflectorsRecipeLenses, summarizeDeflectors, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { content, DEFLECTORS_LENSES, DEFLECTORS_SIGNS, DeflectorsBoard, DeflectorsLensIcon, DeflectorsMirrorIcon, DeflectorsSignIcon, DeflectorsTargetIcon, t, useTicked } from "@openseas/boards";
import { css, type Token } from "@openseas/boards/look";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { DEFLECTORS } from "../prototypes/deflectors.js";

const deflectors = content.puzzles.deflectors;
const waitAt = (tick: number): DeflectorsMove => ({ type: "wait", tick });
const EMITTER_KEYS = ["deflectors.legend_emitter_1", "deflectors.legend_emitter_2", "deflectors.legend_emitter_3"];
const LENS_KEYS = ["deflectors.legend_lens_1", "deflectors.legend_lens_2", "deflectors.legend_lens_3"];

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

  const onPlace = useCallback((cell: number) => void api.apply({ type: "place", cell, tick: ticked.moveTick() }), [api, ticked]);
  const onTurn = useCallback(() => void api.apply({ type: "turn", tick: ticked.moveTick() }), [api, ticked]);
  const onBin = useCallback(() => void api.apply({ type: "bin", tick: ticked.moveTick() }), [api, ticked]);
  const onFire = useCallback(() => void api.apply({ type: "fire", tick: ticked.moveTick() }), [api, ticked]);

  // What a shot now would do: the engine's word, as the board's strip shows it.
  const outlook = deflectorsOutlook(shown);
  const signs = DEFLECTORS_SIGNS.slice(0, Math.min(DEFLECTORS_SIGNS.length, shown.config.emitters));
  const recipes = deflectorsRecipeLenses(shown.config) > 0;
  const lenses = recipes ? DEFLECTORS_LENSES : [];

  return (
    <PracticeShell
      puzzle="deflectors"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.shots}
      movesLabel={t("deflectors.moves")}
      combo={shown.bestLit}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("deflectors.go")}
      warn={false}
      howTo={
        <>
          <p className="how how-kbd">{t("deflectors.shot_note")}</p>
          {recipes && <p className="how how-kbd">{t("deflectors.recipe_note")}</p>}
          <p className="how how-kbd">{t("deflectors.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("deflectors.shot")}</span>
            <span className="stat-value" data-testid="hud-shot">
              {outlook.lit > 0 ? t("deflectors.shot_value", { points: outlook.points, lit: outlook.lit }) : t("deflectors.shot_none")}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("deflectors.queue_stat")}</span>
            <span className="stat-value" data-testid="hud-queue">
              {t("deflectors.queue_value", { count: shown.left + shown.queue.length, size: shown.config.pieces })}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("deflectors.result_lit")}</dt>
            <dd>{state.lit}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_best")}</dt>
            <dd>{state.bestShot}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_most")}</dt>
            <dd>{state.bestLit}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_binned")}</dt>
            <dd>{state.binned}</dd>
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
                <span>{t(EMITTER_KEYS[i]!)}</span>
              </li>
            ))}
            {lenses.map((l, i) => (
              <li key={l.shape}>
                <DeflectorsLensIcon kind={i} />
                <span>{t(LENS_KEYS[i]!)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <DeflectorsSignIcon sign={0} />
              <span>{t("deflectors.legend_emitter")}</span>
            </li>
            <li>
              <DeflectorsTargetIcon />
              <span>{t("deflectors.legend_target")}</span>
            </li>
            <li>
              <DeflectorsMirrorIcon />
              <span>{t("deflectors.legend_mirror")}</span>
            </li>
            {recipes && (
              <li>
                <DeflectorsLensIcon kind={0} />
                <span>{t("deflectors.legend_recipe")}</span>
              </li>
            )}
            <li>
              <DeflectorsMirrorIcon />
              <span>{t("deflectors.legend_queue")}</span>
            </li>
            <li>
              <BinIcon />
              <span>{t("deflectors.legend_bin")}</span>
            </li>
            <li>
              <LineIcon look="lit" color={signs[0]!.color} />
              <span>{t("deflectors.legend_lit")}</span>
            </li>
            <li>
              <LineIcon look="miss" color={signs[0]!.color} />
              <span>{t("deflectors.legend_miss")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("deflectors.shot_note")}</p>
          <p className="muted small proto-note">{t("deflectors.lines_note")}</p>
          {recipes && <p className="muted small proto-note">{t("deflectors.recipe_note")}</p>}
          {shown.config.spend && <p className="muted small proto-note">{t("deflectors.spend_note")}</p>}
        </>
      }
      board={(interactive) => (
        <DeflectorsBoard
          state={shown}
          logged={state}
          version={api.version}
          interactive={interactive}
          hints={studio.hints}
          onPlace={onPlace}
          onTurn={onTurn}
          onBin={onBin}
          onFire={onFire}
          onFrame={api.markRendered}
        />
      )}
    />
  );
}

/** The two looks a beam's route takes, as the board draws them: flat, in the emitter's colour. */
function LineIcon({ look, color }: { look: "lit" | "miss"; color: Token }) {
  const ink = css(color);
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      {look === "lit" && (
        <>
          <path d="M2 17h10V6h10" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7" cy="17" r="2.6" fill={ink} />
          <circle cx="12" cy="11" r="2.6" fill={ink} />
          <circle cx="18" cy="6" r="2.6" fill={ink} />
        </>
      )}
      {look === "miss" && <path d="M2 17h10V6h10" fill="none" stroke={ink} strokeWidth="1.8" strokeDasharray="3.5 3" strokeLinecap="round" />}
    </svg>
  );
}

/** The bin beside the queue, as the board draws it: an open tub under a lid. */
function BinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.75">
        <path d="M6 8h12l-1.6 12H7.6z" />
        <path d="M4 6h16M10 6V4h4v2M10 11v6M14 11v6" />
      </g>
    </svg>
  );
}
