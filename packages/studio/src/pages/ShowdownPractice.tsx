import { useCallback } from "react";
import { SHOWDOWN_STYLES, showdownOwed, showdownPaceScore, showdownPot, summarizeShowdown, type ShowdownConfig, type ShowdownMove, type ShowdownState } from "@openseas/engine";
import { content, ShowdownBoard, ShowdownIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { SHOWDOWN } from "../prototypes/showdown.js";

const showdown = content.puzzles.showdown;

/** Showdown (prototype, ADR 0036, ADR 0082): the shared board in the studio's frame. */
export function ShowdownPractice() {
  const api = usePractice<ShowdownState, ShowdownMove, ShowdownConfig>({
    puzzle: "showdown",
    def: SHOWDOWN.def,
    config: showdown.config,
    roundSeconds: showdown.roundSeconds,
    summarize: summarizeShowdown,
  });
  const studio = useStudio(SHOWDOWN, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onMove = useCallback((move: ShowdownMove) => void api.apply(move), [api]);
  const onNext = useCallback(() => void api.apply({ type: "next" }), [api]);
  const roundSeconds = api.roundSeconds;
  const paceProject = useCallback((made: number, seconds: number) => showdownPaceScore(cfg, made, seconds, roundSeconds), [cfg, roundSeconds]);
  const styles = SHOWDOWN_STYLES.filter((s) => shown.seats.some((x) => x.style === s));

  return (
    <PracticeShell
      puzzle="showdown"
      eyebrow={t("studio.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      scoreLabel={t("showdown.chips")}
      // The indicator reads the net as it moves, and the engine reads a stretch of it as a sitting.
      pacePoints={shown.seats[0]!.net}
      paceProject={paceProject}
      moves={shown.moveCount}
      movesLabel={t("showdown.moves")}
      // The move bound only keeps the log sane; the hands end a sitting. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < SHOWDOWN.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.bestPot}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("showdown.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("showdown.bank_note", { bank: cfg.bank, hands: cfg.hands })}</p>
          <p className="how how-kbd">{t("showdown.styles_note")}</p>
          <p className="how how-kbd">{t("showdown.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("showdown.hand")}</span>
            <span className="stat-value" data-testid="hud-hand">
              {t("showdown.hand_value", { hand: shown.hand, hands: cfg.hands })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("showdown.pot")}</span>
            <span className="stat-value" data-testid="hud-pot">
              {showdownPot(shown)}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("showdown.to_call")}</span>
            <span className="stat-value" data-testid="hud-to-call">
              {shown.phase === "act" ? showdownOwed(shown) : 0}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("showdown.result_won")}</dt>
            <dd>{state.seats[0]!.net}</dd>
          </div>
          <div>
            <dt>{t("showdown.result_hands")}</dt>
            <dd>{state.handsWon}</dd>
          </div>
          <div>
            <dt>{t("showdown.result_pot")}</dt>
            <dd>{state.bestPot}</dd>
          </div>
          <div>
            <dt>{t("showdown.result_traps")}</dt>
            <dd>{state.traps}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {(["star", "moon", "ring", "comet"] as const).map((suit) => (
              <li key={suit}>
                <ShowdownIcon piece={suit} />
                <span>{t(`showdown.legend_${suit}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            {styles.map((style) => (
              <li key={style}>
                <ShowdownIcon piece={style} />
                <span>{t(`showdown.legend_${style}`)}</span>
              </li>
            ))}
            <li>
              <ShowdownIcon piece="back" />
              <span>{t("showdown.legend_back")}</span>
            </li>
            <li>
              <ShowdownIcon piece="button" />
              <span>{t("showdown.legend_button")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("showdown.legend_ranks")}</p>
        </>
      }
      board={(interactive) => (
        <ShowdownBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onMove={onMove} onNext={onNext} onFrame={api.markRendered} />
      )}
    />
  );
}
