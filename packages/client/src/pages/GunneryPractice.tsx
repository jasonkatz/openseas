import { useCallback, useEffect, useRef, useState } from "react";
import { GUNNERY_DEF, advanceGunnery, summarizeGunnery, type Dir, type GunneryConfig, type GunneryEvent, type GunneryMove, type GunneryState } from "@openseas/engine";
import { sfx } from "../audio.js";
import { content, t } from "../content.js";
import { GunneryBoard } from "../gunnery/GunneryBoard.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../puzzles/PracticeShell.jsx";
import { gunneryPieceUrl } from "../gunnery/pieces.js";
import { usePractice } from "../puzzles/usePractice.js";

const gunnery = content.puzzles.gunnery;
const { tickMs, maxTick } = gunnery.config;
/** Log a wait after this many ticks without input so loads in flight reach the server. */
const WAIT_EVERY_TICKS = 20;

export function GunneryPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<GunneryState, GunneryMove, GunneryConfig>({
    puzzle: "gunnery",
    def: GUNNERY_DEF,
    config: gunnery.config,
    roundSeconds: gunnery.roundSeconds,
    summarize: summarizeGunnery,
  });
  const { state, phase } = api;
  // What the deck shows: the engine state advanced to the current tick. Display only until a move logs it.
  const [shown, setShown] = useState<GunneryState>(state);
  const finalWaitSent = useRef(false);

  /** The tick the clock says it is now, one behind so a claim never runs ahead of the server's clock. */
  const currentTick = useCallback((): number => {
    const r = api.current();
    if (!r) return 0;
    const start = r.opts.deadlineAt - gunnery.roundSeconds * 1000;
    return Math.max(0, Math.min(maxTick, Math.floor((Date.now() - start) / tickMs) - 1));
  }, [api]);

  useEffect(() => {
    if (phase !== "playing") {
      setShown(state);
      finalWaitSent.current = false;
      return;
    }
    const step = (): void => {
      const r = api.current();
      if (!r || r.isFinished) return;
      const tick = currentTick();
      const msLeft = r.opts.deadlineAt - Date.now();
      if (msLeft < 600 && !finalWaitSent.current) {
        finalWaitSent.current = true;
        api.apply({ type: "wait", tick }, false);
        return;
      }
      if (tick - r.state.tick >= WAIT_EVERY_TICKS) {
        api.apply({ type: "wait", tick }, false);
        return;
      }
      setShown(advanceGunnery(r.state, tick));
    };
    step();
    const id = window.setInterval(step, tickMs);
    return () => window.clearInterval(id);
  }, [phase, api, currentTick]);

  // A logged move resets the display baseline.
  useEffect(() => {
    if (phase === "playing") setShown(advanceGunnery(state, Math.max(state.tick, currentTick())));
  }, [state, phase, currentTick]);

  const onArrow = useCallback(
    (col: number, row: number, dir: Dir | null) => {
      const tick = Math.max(currentTick(), api.current()?.state.tick ?? 0);
      const ok = api.apply(dir === null ? { type: "remove", col, row, tick } : { type: "arrow", col, row, dir, tick });
      if (ok) sfx.tick(false);
    },
    [api, currentTick],
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
          sfx.keg();
          break;
        case "broadside":
          sfx.streak(12);
          break;
        case "foul":
          sfx.streakLost();
          break;
        case "clean":
          sfx.pump(2);
          break;
        case "splash":
          sfx.pump(1);
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
      best={api.best}
      roundSeconds={gunnery.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={state.moveCount}
      maxMoves={gunnery.config.maxMoves}
      combo={shown.combo}
      canRate={api.canRate}
      onStartRated={api.startRated}
      onStartUnrated={api.startUnrated}
      splash={t("gunnery.go")}
      warn={shown.cannons.some((c) => c.fouled)}
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
            <dt>{t("gunnery.result_fouls")}</dt>
            <dd>{state.fouls}</dd>
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
                <img src={gunneryPieceUrl(kind, showMarks ? p.mark : null, 26)} width={26} height={26} alt="" aria-hidden="true" className="tile-icon" draggable={false} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("gunnery.legend_order")}</p>
          <p className="muted small legend-note">{t("gunnery.legend_broadside", { points: gunnery.config.broadsidePoints })}</p>
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
