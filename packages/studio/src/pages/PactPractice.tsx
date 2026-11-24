import { useCallback } from "react";
import { pactPaceScore, pactSideStanding, summarizePact, type PactConfig, type PactMove, type PactState } from "@openseas/engine";
import { content, PactBoard, PactIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { PACT } from "../prototypes/pact.js";

const pact = content.puzzles.pact;

/** Pact (prototype, ADR 0036, ADR 0087): the shared board in the studio's frame. */
export function PactPractice() {
  const api = usePractice<PactState, PactMove, PactConfig>({
    puzzle: "pact",
    def: PACT.def,
    config: pact.config,
    roundSeconds: pact.roundSeconds,
    summarize: summarizePact,
  });
  const studio = useStudio(PACT, api);
  const { state } = api;
  const cfg = state.config;

  const onMove = useCallback((move: PactMove) => void api.apply(move), [api]);
  const onNext = useCallback(() => void api.apply({ type: "next" }), [api]);
  const paceProject = useCallback((made: number, seconds: number) => pactPaceScore(cfg, made, seconds), [cfg]);
  const standing = (side: 0 | 1): string => {
    const s = pactSideStanding(state, side);
    return state.phase === "over" ? String(side === 0 ? state.us.total : state.them.total) : s.bidding ? t("pact.standing_bidding") : t("pact.standing", { took: s.took, pact: s.pact });
  };

  return (
    <PracticeShell
      puzzle="pact"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={state.score}
      scoreLabel={t("pact.points")}
      moves={state.moveCount}
      movesLabel={t("pact.moves")}
      // The move bound only keeps the log sane; the hands end a sitting. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < PACT.config.maxMoves ? cfg.maxMoves : undefined}
      combo={state.bestHand}
      paceProject={paceProject}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("pact.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("pact.sitting_note", { hands: cfg.hands })}</p>
          <p className="how how-kbd">{t("pact.seats_note")}</p>
          <p className="how how-kbd">{t("pact.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("pact.hand")}</span>
            <span className="stat-value" data-testid="hud-hand">
              {t("pact.hand_value", { hand: state.hand, hands: cfg.hands })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("pact.us")}</span>
            <span className="stat-value" data-testid="hud-us">
              {standing(0)}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("pact.them")}</span>
            <span className="stat-value" data-testid="hud-them">
              {standing(1)}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("pact.result_made")}</dt>
            <dd>
              {state.made} / {state.handsDone}
            </dd>
          </div>
          <div>
            <dt>{t("pact.result_nils")}</dt>
            <dd>{state.nils}</dd>
          </div>
          <div>
            <dt>{t("pact.result_sets")}</dt>
            <dd>{state.sets}</dd>
          </div>
          <div>
            <dt>{t("pact.result_best")}</dt>
            <dd>{state.bestHand}</dd>
          </div>
          <div>
            <dt>{t("pact.result_them")}</dt>
            <dd>{state.them.total}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {(["spade", "heart", "diamond", "club"] as const).map((suit) => (
              <li key={suit}>
                <PactIcon piece={suit} />
                <span>{t(`pact.legend_${suit}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <PactIcon piece="trick" />
              <span>{t("pact.legend_partner")}</span>
            </li>
            <li>
              <PactIcon piece="nil" />
              <span>{t("pact.nil")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("pact.legend_scoring")}</p>
        </>
      }
      board={(interactive) => (
        <PactBoard state={state} version={api.version} interactive={interactive} hints={studio.hints} onMove={onMove} onNext={onNext} onFrame={api.markRendered} />
      )}
    />
  );
}
