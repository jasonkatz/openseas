import { useCallback } from "react";
import { advanceGunnery, summarizeGunnery, type Dir, type GunneryConfig, type GunneryEvent, type GunneryMove, type GunneryState } from "@openseas/engine";
import { GunneryBoard, GunneryPieceIcon, content, sfx, t, useTicked } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
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
  const studio = useStudio(GUNNERY, api);
  const { state } = api;
  // The clock runs on the round's own config: a lab round may have changed maxTick.
  const cfg = api.round?.config ?? gunnery.config;
  const ticked = useTicked(api, { tickMs: cfg.tickMs, maxTick: cfg.maxTick, advance: advanceGunnery, wait: waitAt });
  const shown = ticked.shown;

  const onArrow = useCallback(
    (col: number, row: number, dir: Dir | null) => {
      const tick = ticked.moveTick();
      const ok = api.apply(dir === null ? { type: "remove", col, row, tick } : { type: "arrow", col, row, dir, tick });
      if (ok) sfx.tick(false);
    },
    [api, ticked],
  );

  const onEvents = useCallback((events: readonly GunneryEvent[]) => {
    for (const e of events) {
      switch (e.type) {
        case "load":
          sfx.swap();
          break;
        case "loaded":
          sfx.clear(Math.min(6, 2 + Math.floor((e.points ?? 0) / 50)), 5);
          break;
        case "fire":
          sfx.charge();
          break;
        case "broadside":
          sfx.streak(12);
          break;
        case "jam":
          sfx.streakLost();
          break;
        case "clean":
          sfx.vent(2);
          break;
        case "splash":
          sfx.vent(1);
          break;
        case "exit":
          sfx.swapQuiet();
          break;
        default:
          break;
      }
    }
  }, []);

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
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      maxMoves={shown.config.maxMoves}
      combo={shown.combo}
      onStart={studio.start}
      ready={studio.ready}
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
      board={(interactive) => (
        <GunneryBoard state={shown} interactive={interactive} showMarks={showMarks} onArrow={onArrow} onFrame={api.markRendered} onEvents={onEvents} />
      )}
    />
  );
}
