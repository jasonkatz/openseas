import { GunneryBoard, GunneryPieceIcon, content, t, useGunneryControls } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePracticePage } from "../practice/usePracticePage.js";
import { GUNNERY } from "../puzzles.js";

const gunnery = content.puzzles.gunnery;

export function GunneryPractice() {
  const page = usePracticePage(GUNNERY);
  const controls = useGunneryControls(page.api, page.moveTick);
  const { shown, showMarks } = page;
  const { state } = page.api;

  const pieces = gunnery.pieces;
  const loadsStat = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("gunnery.loads")}</span>
      <span className="stat-value" data-testid="hud-loads">
        {shown.loads}
      </span>
    </div>
  );
  const broadsideStat = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("gunnery.broadside")}</span>
      <span className="stat-value" data-testid="hud-broadside">
        <span className="broadside-lamps" aria-label={t("gunnery.broadside_lamps", { lit: shown.firedSince.filter(Boolean).length, total: shown.firedSince.length })}>
          {shown.firedSince.map((lit, i) => (
            <i key={i} className={lit ? "lit" : ""} />
          ))}
        </span>
        {shown.broadsides > 0 && <small>×{shown.broadsides}</small>}
      </span>
    </div>
  );
  const arrowStat = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("gunnery.arrows")}</span>
      <span className="stat-value" data-testid="hud-arrows">
        {shown.arrows.length}
      </span>
    </div>
  );

  return (
    <PracticeShell
      page={page}
      hud={{ maxMoves: shown.config.maxMoves }}
      warn={shown.turrets.some((c) => c.jammed)}
      details={
        <>
          {broadsideStat}
          {loadsStat}
          {arrowStat}
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("gunnery.result_loads")}</dt>
            <dd>{state.loads}</dd>
          </div>
          <div>
            <dt>{t("gunnery.result_broadsides")}</dt>
            <dd>{state.broadsides}</dd>
          </div>
          <div>
            <dt>{t("gunnery.result_jams")}</dt>
            <dd>{state.jams}</dd>
          </div>
          <div>
            <dt>{t("gunnery.result_arrows")}</dt>
            <dd>{state.arrowsPlaced}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {pieces.map((p, kind) => (
              <li key={p.nameKey}>
                <GunneryPieceIcon kind={kind} mark={showMarks ? p.mark : null} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("gunnery.legend_order")}</p>
          <p className="muted small legend-note">{t("gunnery.legend_broadside", { points: shown.config.broadsidePoints })}</p>
          <p className="muted small legend-note">{t("gunnery.legend_badges")}</p>
          <p className="muted small legend-note">{t("gunnery.legend_arrow")}</p>
        </>
      }
      board={(b) => <GunneryBoard {...b} {...controls} />}
    />
  );
}
