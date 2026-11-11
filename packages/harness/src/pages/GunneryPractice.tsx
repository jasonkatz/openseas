import { advanceGunnery, summarizeGunnery, type GunneryConfig, type GunneryMove, type GunneryState } from "@openseas/engine";
import { GunneryBoard, GunneryPieceIcon, content, t, useGunneryControls, useTicked } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { GUNNERY } from "../puzzles.js";

const gunnery = content.puzzles.gunnery;
const waitAt = (tick: number): GunneryMove => ({ type: "wait", tick });

export function GunneryPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<GunneryState, GunneryMove, GunneryConfig>({
    puzzle: "gunnery",
    def: GUNNERY.def,
    config: gunnery.config,
    roundSeconds: gunnery.roundSeconds,
    summarize: summarizeGunnery,
  });
  const bench = useBench(GUNNERY, api);
  const { state } = api;
  // The clock runs on the round's own config: a lab round may have changed maxTick.
  const cfg = api.round?.config ?? gunnery.config;
  const ticked = useTicked(api, { tickMs: cfg.tickMs, maxTick: cfg.maxTick, advance: advanceGunnery, wait: waitAt });
  const shown = bench.reviewState ?? ticked.shown;
  const controls = useGunneryControls(api, ticked.moveTick);

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
      puzzle="gunnery"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      maxMoves={shown.config.maxMoves}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("gunnery.go")}
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
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <GunneryBoard key={bench.reviewKey ?? "live"} state={shown} interactive={interactive} showMarks={showMarks} {...controls} />
      )}
    />
  );
}
