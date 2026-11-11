import { useCallback } from "react";
import type { CuttingState } from "@openseas/engine";
import { CuttingBoard, KindIcon, KINDS, spriteName, t } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePracticePage } from "../practice/usePracticePage.js";
import { CUTTING } from "../prototypes/cutting.js";

/** The round's yield so far: what was banked from finished slabs as a share of their bests, in whole percent. */
function yieldPercent(state: CuttingState): number | null {
  return state.totalBest > 0 ? Math.round((100 * state.totalGot) / state.totalBest) : null;
}

/** Cutting (prototype, ADR 0036): the practice frame round the shared board, with the bench beside it. */
export function CuttingPractice() {
  const page = usePracticePage(CUTTING);
  const { shown, showMarks } = page;
  const { state, apply } = page.api;
  const cfg = shown.config;

  const onCut = useCallback((piece: number, vertical: boolean, at: number) => void apply({ type: "cut", piece, vertical, at }), [apply]);
  const onDone = useCallback(() => void apply({ type: "done" }), [apply]);

  const ores = KINDS.slice(0, cfg.ores);
  const roundYield = yieldPercent(shown);
  const finalYield = yieldPercent(state);

  return (
    <PracticeShell
      page={page}
      hud={{ movesLabel: t("cutting.moves") }}
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
                <KindIcon kind={i} marks={showMarks} sprite={{ puzzle: "cutting", name: spriteName("ore", i), fill: true }} />
                <span>{t(`cutting.ore.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small proto-note">{t("cutting.legend_ores")}</p>
          <p className="muted small proto-note">{t("cutting.legend_cut")}</p>
          <p className="muted small proto-note">{t("cutting.legend_strip")}</p>
          <p className="muted small proto-note">{t("cutting.grade_note")}</p>
        </>
      }
      board={(b) => <CuttingBoard {...b} onCut={onCut} onDone={onDone} />}
    />
  );
}
