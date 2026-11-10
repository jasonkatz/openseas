import { useCallback } from "react";
import { summarizeCutting, type CuttingConfig, type CuttingMove, type CuttingState } from "@openseas/engine";
import { CuttingBoard, KINDS, KindIcon, content, t } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { CUTTING } from "../prototypes/cutting.js";

const cutting = content.puzzles.cutting;

/** The round's yield so far: what was banked from finished slabs as a share of their bests, in whole percent. */
function yieldPercent(state: CuttingState): number | null {
  return state.totalBest > 0 ? Math.round((100 * state.totalGot) / state.totalBest) : null;
}

/** Cutting (prototype, ADR 0036): the practice frame round the shared board, with the bench beside it. */
export function CuttingPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<CuttingState, CuttingMove, CuttingConfig>({
    puzzle: "cutting",
    def: CUTTING.def,
    config: cutting.config,
    roundSeconds: cutting.roundSeconds,
    summarize: summarizeCutting,
  });
  const bench = useBench(CUTTING, api);
  const { state } = api;
  const shown = bench.reviewState ?? state;
  const cfg = shown.config;

  const onCut = useCallback((piece: number, vertical: boolean, at: number) => void api.apply({ type: "cut", piece, vertical, at }), [api]);
  const onDone = useCallback(() => void api.apply({ type: "done" }), [api]);

  const ores = KINDS.slice(0, cfg.ores);
  const roundYield = yieldPercent(shown);
  const finalYield = yieldPercent(state);

  return (
    <PracticeShell
      puzzle="cutting"
      eyebrow={t("harness.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("cutting.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < CUTTING.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("cutting.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("cutting.tap_note")}</p>
          <p className="how how-kbd">{t("cutting.grade_note")}</p>
          <p className="how how-kbd">{t("cutting.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("cutting.slab_stat")}</span>
            <span className="stat-value" data-testid="hud-slab">
              {t("cutting.slab_value", { slab: shown.slab + 1, left: shown.cutsLeft, allowed: shown.cutsAllowed })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("cutting.yield_stat")}</span>
            <span className="stat-value" data-testid="hud-yield">
              {t("cutting.yield_value", { got: shown.slabGot, best: shown.slabBest })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("cutting.round_yield_stat")}</span>
            <span className="stat-value" data-testid="hud-round-yield">
              {roundYield === null ? t("cutting.round_yield_none") : t("cutting.round_yield_value", { percent: roundYield })}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("cutting.result_slabs")}</dt>
            <dd>{state.slabsDone}</dd>
          </div>
          <div>
            <dt>{t("cutting.result_grades")}</dt>
            <dd>{t("cutting.result_grades_value", { flawless: state.flawless, clean: state.clean, rough: state.rough })}</dd>
          </div>
          <div>
            <dt>{t("cutting.result_yield")}</dt>
            <dd>{finalYield === null ? t("cutting.round_yield_none") : t("cutting.result_yield_value", { percent: finalYield })}</dd>
          </div>
          <div>
            <dt>{t("cutting.result_biggest")}</dt>
            <dd>{t("cutting.result_biggest_value", { cells: state.biggest })}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {ores.map((k, i) => (
              <li key={k.id}>
                <KindIcon kind={i} marks={showMarks} />
                <span>{t(`cutting.ore.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small proto-note">{t("cutting.legend_ores")}</p>
          <p className="muted small proto-note">{t("cutting.legend_cut")}</p>
          <p className="muted small proto-note">{t("cutting.legend_strip")}</p>
          <p className="muted small proto-note">{t("cutting.grade_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <CuttingBoard key={bench.reviewKey ?? "live"} state={shown} version={api.version} interactive={interactive} showMarks={showMarks} hints={bench.hints} onCut={onCut} onDone={onDone} onFrame={api.markRendered} />
      )}
    />
  );
}
