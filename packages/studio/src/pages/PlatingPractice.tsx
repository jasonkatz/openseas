import { useCallback } from "react";
import { PENTOMINO_LETTERS, platingOrient, summarizePlating, type PlatingConfig, type PlatingMove, type PlatingState, type BreachRating } from "@openseas/engine";
import { PlatingBoard, PlatingPlateIcon, content, sfx, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { PLATING } from "../puzzles.js";

const plating = content.puzzles.plating;

export function PlatingPractice() {
  const api = usePractice<PlatingState, PlatingMove, PlatingConfig>({
    puzzle: "plating",
    def: PLATING.def,
    config: plating.config,
    roundSeconds: plating.roundSeconds,
    summarize: summarizePlating,
  });
  const studio = useStudio(PLATING, api);
  const { state } = api;
  const shown = state;

  const onPlace = useCallback(
    (slot: number, rot: number, flip: boolean, col: number, row: number) => {
      api.apply({ type: "place", slot, rot, flip, col, row });
    },
    [api],
  );
  const onSealed = useCallback((rating: BreachRating, chain: number) => {
    sfx.plateLift();
    if (rating === "flawless") {
      sfx.clear(Math.min(6, chain), 6);
      if (chain >= 2) sfx.multi(chain);
    } else if (rating === "gum") sfx.streakLost();
    else sfx.clear(1, 3);
  }, []);
  const onNailed = useCallback((waste: boolean) => sfx.welder(waste), []);
  const onGrew = useCallback(() => sfx.crack(true), []);
  const onCracked = useCallback((opening: boolean) => sfx.crack(!opening), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onBump = useCallback(() => sfx.bump(), []);

  const metals = plating.pieces.slice(0, shown.config.pieceKinds);

  return (
    <PracticeShell
      puzzle="plating"
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={shown.config.maxMoves < PLATING.config.maxMoves ? shown.config.maxMoves : undefined}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("plating.go")}
      details={
        <div className="stat stat-wide">
          <span className="stat-label">{t("plating.breaches_sealed")}</span>
          <span className="stat-value" data-testid="hud-sealed">
            {shown.sealedCount}
          </span>
        </div>
      }
      resultRows={
        <div>
          <dt>{t("plating.breaches_sealed")}</dt>
          <dd>{state.sealedCount}</dd>
        </div>
      }
      legend={
        <>
          <ul className="kinds">
            {metals.map((p) => (
              <li key={p.nameKey}>
                <PlatingPlateIcon color={p.color} cut={p.cut} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("plating.legend_breaches")}</p>
          <p className="muted small legend-note">{t("plating.legend_brush")}</p>
          <ul className="kinds shapes">
            {plating.shapes.map((s, i) => (
              <li key={s.nameKey}>
                <PlatingPlateIcon color="cream" cells={platingOrient(i, 0, false)} size={22} />
                <span>{PENTOMINO_LETTERS[i]}</span>
              </li>
            ))}
          </ul>
        </>
      }
      board={(interactive) => (
        <PlatingBoard
          state={shown}
          version={api.version}
          interactive={interactive}
          onPlace={onPlace}
          onFrame={api.markRendered}
          onSealed={onSealed}
          onNailed={onNailed}
          onGrew={onGrew}
          onCracked={onCracked}
          onNudge={onNudge}
          onBump={onBump}
        />
      )}
    />
  );
}
