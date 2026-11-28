import { useCallback } from "react";
import { TRACTOR_CACHE, summarizeTractor, type TractorConfig, type TractorMove, type TractorState } from "@openseas/engine";
import { content, TRACTOR_KINDS, TractorBeaconIcon, TractorBoard, TractorCacheIcon, TractorLootIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { TRACTOR } from "../prototypes/tractor.js";
import type { StudioPuzzle } from "../puzzles.js";

const tractor = content.puzzles.tractor;

/** Tractor (prototype, ADR 0036): the shared board in the studio's frame. `entry` is the puzzle this page plays: the prototype, or the same puzzle on another engine (ADR 0097, ADR 0099). */
export function TractorPractice({ entry = TRACTOR }: { entry?: StudioPuzzle<TractorState, TractorMove, TractorConfig> } = {}) {
  const api = usePractice<TractorState, TractorMove, TractorConfig>({
    puzzle: "tractor",
    def: entry.def,
    config: tractor.config,
    roundSeconds: tractor.roundSeconds,
    summarize: summarizeTractor,
  });
  const studio = useStudio(entry, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onSwap = useCallback((cell: number) => void api.apply({ type: "swap", cell }), [api]);

  const caches = shown.cells.filter((p) => p.kind === TRACTOR_CACHE).length;
  const kinds = TRACTOR_KINDS.slice(0, cfg.kinds);
  const beaconIn = cfg.beaconEvery > 0 ? cfg.beaconEvery - (shown.clears % cfg.beaconEvery) : 0;

  return (
    <PracticeShell
      puzzle="tractor"
      eyebrow={entry === TRACTOR ? t("studio.prototype_eyebrow") : t("rungs.eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("tractor.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < entry.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.lastMove?.waves.length ?? 0}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("tractor.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("tractor.cascade_note")}</p>
          {cfg.beaconEvery > 0 && <p className="how how-kbd">{t("tractor.beacon_note")}</p>}
          <p className="how how-kbd">{t("tractor.hint_note")}</p>
        </>
      }
      details={
        <>
          {cfg.maxCaches > 0 && (
            <div className="stat stat-wide">
              <span className="stat-label">{t("tractor.caches")}</span>
              <span className="stat-value" data-testid="hud-caches">
                {t("tractor.caches_label", { count: caches, max: cfg.maxCaches })}
              </span>
            </div>
          )}
          <div className="stat stat-wide">
            <span className="stat-label">{t("tractor.next_beacon")}</span>
            <span className="stat-value" data-testid="hud-beacon">
              {cfg.beaconEvery > 0 ? t("tractor.next_beacon_value", { count: beaconIn }) : t("tractor.next_beacon_none")}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("tractor.result_longest")}</dt>
            <dd>{state.longest}</dd>
          </div>
          <div>
            <dt>{t("tractor.result_waves")}</dt>
            <dd>{state.bestCombo}</dd>
          </div>
          {cfg.maxCaches > 0 && (
            <>
              <div>
                <dt>{t("tractor.result_caches")}</dt>
                <dd>{state.cachesHauled}</dd>
              </div>
              <div>
                <dt>{t("tractor.result_best_caches")}</dt>
                <dd>{state.bestCaches}</dd>
              </div>
            </>
          )}
          {cfg.beaconEvery > 0 && (
            <div>
              <dt>{t("tractor.result_beacons")}</dt>
              <dd>{state.beaconsFired}</dd>
            </div>
          )}
          <div>
            <dt>{t("tractor.result_duds")}</dt>
            <dd>{state.duds}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {kinds.map((k, i) => (
              <li key={k.id}>
                <TractorLootIcon kind={i} />
                <span>{t(`tractor.kind.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <TractorCacheIcon />
              <span>{t("tractor.legend_cache")}</span>
            </li>
            <li>
              <TractorBeaconIcon kind={0} mark="cross" />
              <span>{t("tractor.legend_cross")}</span>
            </li>
            <li>
              <TractorBeaconIcon kind={0} mark="saltire" />
              <span>{t("tractor.legend_saltire")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("tractor.legend_hatch")}</p>
          <p className="muted small proto-note">{t("tractor.cascade_note")}</p>
        </>
      }
      board={(interactive) => (
        <TractorBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onSwap={onSwap} onFrame={api.markRendered} />
      )}
    />
  );
}
