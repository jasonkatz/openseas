import { useCallback } from "react";
import { advanceRefining, refiningClearValue, summarizeRefining, type RefiningConfig, type RefiningDir, type RefiningKind, type RefiningMove, type RefiningState } from "@openseas/engine";
import { content, RefiningBoard, RefiningIcon, t, useTicked } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { REFINING } from "../prototypes/refining.js";
import type { StudioPuzzle } from "../puzzles.js";

const refining = content.puzzles.refining;
const waitAt = (tick: number): RefiningMove => ({ type: "wait", tick });

/** Refining (prototype, ADR 0036, ADR 0080): the shared board in the studio's frame. The outlet is drawn on the engine's clock (ADR 0015). `entry` is the puzzle this page plays, and `advance` its engine's state at a later tick: the prototype's own, or the same puzzle on another engine (ADR 0097, ADR 0099). */
export function RefiningPractice({ entry = REFINING, advance = advanceRefining }: { entry?: StudioPuzzle<RefiningState, RefiningMove, RefiningConfig>; advance?: (state: RefiningState, tick: number) => RefiningState } = {}) {
  const api = usePractice<RefiningState, RefiningMove, RefiningConfig>({
    puzzle: "refining",
    def: entry.def,
    config: refining.config,
    roundSeconds: refining.roundSeconds,
    summarize: summarizeRefining,
  });
  const studio = useStudio(entry, api);
  const { state } = api;
  const roundCfg = api.round?.config ?? refining.config;
  const ticked = useTicked(api, { tickMs: roundCfg.tickMs, maxTick: roundCfg.maxTick, advance, wait: waitAt });
  const shown = ticked.shown;
  const cfg = shown.config;

  const onSwap = useCallback((cell: number, dir: RefiningDir) => void api.apply({ type: "swap", cell, dir, tick: ticked.moveTick() }), [api, ticked]);
  const onDraw = useCallback(() => void api.apply({ type: "draw", tick: ticked.moveTick() }), [api, ticked]);

  const seconds = Math.max(0, Math.ceil(((shown.nextDraw - shown.tick) * cfg.tickMs) / 1000));
  const kinds: RefiningKind[] = [0, 1, 2];

  return (
    <PracticeShell
      puzzle="refining"
      eyebrow={entry === REFINING ? t("studio.prototype_eyebrow") : t("rungs.eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("refining.moves")}
      combo={shown.run}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("refining.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("refining.cycle_note")}</p>
          {cfg.runCap > 1 && <p className="how how-kbd">{t("refining.run_note")}</p>}
          {cfg.smokeEvery > 0 && <p className="how how-kbd">{t("refining.smoke_note")}</p>}
          <p className="how how-kbd">{t("refining.draw_note")}</p>
          <p className="how how-kbd">{t("refining.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("refining.run")}</span>
            <span className="stat-value" data-testid="hud-run">
              {shown.run > 0 ? t("refining.run_value", { count: shown.run }) : t("refining.run_none")}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("refining.next_draw")}</span>
            <span className="stat-value" data-testid="hud-next-draw">
              {t("refining.next_draw_value", { seconds })}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("refining.result_draws")}</dt>
            <dd>{state.draws}</dd>
          </div>
          <div>
            <dt>{t("refining.result_clears")}</dt>
            <dd>{state.clears}</dd>
          </div>
          <div>
            <dt>{t("refining.result_best_run")}</dt>
            <dd>{state.bestRun}</dd>
          </div>
          <div>
            <dt>{t("refining.result_smooths")}</dt>
            <dd>{state.smooths}</dd>
          </div>
          <div>
            <dt>{t("refining.result_fouls")}</dt>
            <dd>{state.fouls}</dd>
          </div>
          <div>
            <dt>{t("refining.result_spills")}</dt>
            <dd>{state.spills}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {kinds.map((k) => (
              <li key={k}>
                <RefiningIcon kind={k} />
                <span>{t(["refining.legend_vapour", "refining.legend_oil", "refining.legend_tar"][k]!)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            {cfg.smokeEvery > 0 && (
              <li>
                <RefiningIcon kind={3} />
                <span>{t("refining.legend_smoke")}</span>
              </li>
            )}
            {cfg.catalystPermille > 0 && (
              <li>
                <RefiningIcon kind={4} />
                <span>{t("refining.legend_catalyst")}</span>
              </li>
            )}
          </ul>
          <p className="muted small proto-note">{t("refining.legend_links")}</p>
          <p className="muted small proto-note">{t("refining.legend_outlet")}</p>
          {cfg.runCap > 1 && <p className="muted small proto-note">{t("refining.run_note")}</p>}
          <p className="muted small proto-note" data-testid="clear-values">
            {Array.from({ length: Math.min(cfg.runCap, 5) }, (_, i) => refiningClearValue(cfg, i + 1)).join(" · ")}
          </p>
        </>
      }
      board={(interactive) => <RefiningBoard state={shown} interactive={interactive} hints={studio.hints} onSwap={onSwap} onDraw={onDraw} onFrame={api.markRendered} />}
    />
  );
}
