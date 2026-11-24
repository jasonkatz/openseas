import { useCallback } from "react";
import { pouringPlace, summarizePouring, type PouringConfig, type PouringMove, type PouringState } from "@openseas/engine";
import { content, POURING_BREWS, POURING_GLASSES, PouringBoard, PouringGlassIcon, PouringPieceIcon, PouringRingIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { POURING } from "../prototypes/pouring.js";

const pouring = content.puzzles.pouring;

/** Pouring (prototype, ADR 0085): the shared board in the studio's frame. */
export function PouringPractice() {
  const api = usePractice<PouringState, PouringMove, PouringConfig>({
    puzzle: "pouring",
    def: POURING.def,
    config: pouring.config,
    roundSeconds: pouring.roundSeconds,
    summarize: summarizePouring,
  });
  const studio = useStudio(POURING, api);
  const { state } = api;
  const cfg = state.config;
  const me = state.seats[0]!;

  const onPour = useCallback((slot: number, cell: number) => void api.apply({ type: "pour", slot, cell }), [api]);
  const onDrink = useCallback((slot: number) => void api.apply({ type: "drink", slot }), [api]);

  const glasses = POURING_GLASSES.slice(0, cfg.glasses);
  const brews = POURING_BREWS.slice(0, cfg.brews);
  const rung = state.rings.filter((r) => r === 0).length;

  return (
    <PracticeShell
      puzzle="pouring"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={state.score}
      moves={me.turns}
      movesLabel={t("pouring.moves")}
      maxMoves={cfg.lastCall}
      combo={state.lastMove?.acts[0]?.lines.length ?? 0}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("pouring.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("pouring.clean_note")}</p>
          <p className="how how-kbd">{t("pouring.double_note")}</p>
          <p className="how how-kbd">{t("pouring.drink_note")}</p>
          {cfg.agePoints > 0 && <p className="how how-kbd">{t("pouring.age_note")}</p>}
          {cfg.icePerBag + cfg.ragsPerBag > 0 && <p className="how how-kbd">{t("pouring.special_note")}</p>}
          <p className="how how-kbd">{t("pouring.hint_note")}</p>
        </>
      }
      details={
        <>
          {cfg.rivals > 0 && (
            <div className="stat stat-wide">
              <span className="stat-label">{t("pouring.place")}</span>
              <span className="stat-value" data-testid="hud-place">
                {t("pouring.place_value", { place: pouringPlace(state), count: state.seats.length })}
              </span>
            </div>
          )}
          <div className="stat stat-wide">
            <span className="stat-label">{t("pouring.drunk")}</span>
            <span className="stat-value" data-testid="hud-drunk">
              {me.asleep ? t("pouring.out_cold") : t("pouring.drunk_value", { count: me.drunk, max: cfg.tolerance })}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          {cfg.rivals > 0 && (
            <>
              <div>
                <dt>{t("pouring.result_place")}</dt>
                <dd>{t("pouring.place_value", { place: pouringPlace(state), count: state.seats.length })}</dd>
              </div>
              <div>
                <dt>{t("pouring.result_rivals")}</dt>
                <dd>{state.seats.slice(1).map((s) => s.score).join(" · ")}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t("pouring.result_lines")}</dt>
            <dd>{me.lines}</dd>
          </div>
          <div>
            <dt>{t("pouring.result_double")}</dt>
            <dd>{state.bestCombo}</dd>
          </div>
          <div>
            <dt>{t("pouring.result_rings")}</dt>
            <dd>{rung}</dd>
          </div>
        </>
      }
      legend={
        <>
          <p className="muted small proto-note">{t("pouring.legend_drinks")}</p>
          <p className="muted small proto-note">{t("pouring.legend_glasses")}</p>
          <ul className="kinds">
            {glasses.map((g, i) => (
              <li key={g.id}>
                <PouringGlassIcon glass={i} />
                <span>{t(`pouring.glass.${g.id}`)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small proto-note">{t("pouring.legend_brews")}</p>
          <ul className="kinds">
            {brews.map((b, i) => (
              <li key={b.id}>
                <PouringPieceIcon glass={0} brew={i} />
                <span>{t(`pouring.brew.${b.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            {cfg.icePerBag > 0 && (
              <li>
                <PouringPieceIcon kind="ice" />
                <span>{t("pouring.legend_ice")}</span>
              </li>
            )}
            {cfg.ragsPerBag > 0 && (
              <li>
                <PouringPieceIcon kind="rag" />
                <span>{t("pouring.legend_rag")}</span>
              </li>
            )}
            <li>
              <PouringRingIcon seat={0} />
              <span>{t("pouring.legend_ring")}</span>
            </li>
            {state.seats.slice(1).map((_, i) => (
              <li key={i}>
                <PouringRingIcon seat={i + 1} />
                <span>{t("pouring.rival", { n: i + 1 })}</span>
              </li>
            ))}
          </ul>
        </>
      }
      board={(interactive) => (
        <PouringBoard state={state} version={api.version} interactive={interactive} hints={studio.hints} onPour={onPour} onDrink={onDrink} onFrame={api.markRendered} />
      )}
    />
  );
}
