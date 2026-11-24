import { useCallback } from "react";
import { SHOWDOWN_STYLES, showdownOwed, showdownPot, showdownStanding, summarizeShowdown, type ShowdownConfig, type ShowdownMove, type ShowdownState } from "@openseas/engine";
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
  // The indicator reads where the player stands: the rivals out, and those still in with fewer chips.
  const standing = showdownStanding(shown);
  const paceProject = useCallback(() => standing, [standing]);
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
      pacePoints={standing}
      paceProject={paceProject}
      moves={shown.moveCount}
      movesLabel={t("showdown.moves")}
      // The move bound only keeps the log sane; a knockout ends the round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < SHOWDOWN.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.bestPot}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("showdown.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("showdown.stack_note", { stack: cfg.stack })}</p>
          <p className="how how-kbd">{t("showdown.styles_note")}</p>
          <p className="how how-kbd">{t("showdown.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("showdown.hand")}</span>
            <span className="stat-value" data-testid="hud-hand">
              {t("showdown.hand_value", { hand: shown.hand })}
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
            <dt>{t("showdown.result_place")}</dt>
            <dd data-testid="result-place">
              {state.won
                ? t("showdown.place_won")
                : state.seats[0]!.out
                  ? t("showdown.place_out", { hand: state.hand })
                  : state.hand >= cfg.hands && state.phase === "over"
                    ? t("showdown.place_last", { hand: state.hand })
                    : t("showdown.place_left")}
            </dd>
          </div>
          <div>
            <dt>{t("showdown.rivals_out")}</dt>
            <dd>{state.seats.slice(1).filter((x) => x.out).length}</dd>
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
