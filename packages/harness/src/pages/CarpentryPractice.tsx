import { useCallback } from "react";
import { PENTOMINO_LETTERS, carpentryOrient, summarizeCarpentry, type CarpentryConfig, type CarpentryMove, type CarpentryState, type HoleRating } from "@openseas/engine";
import { CarpentryBoard, TileIcon, content, sfx, t } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { CARPENTRY } from "../puzzles.js";

const carpentry = content.puzzles.carpentry;

export function CarpentryPractice() {
  const [showMarks, setShowMarks] = useShowMarks();

  const api = usePractice<CarpentryState, CarpentryMove, CarpentryConfig>({
    puzzle: "carpentry",
    def: CARPENTRY.def,
    config: carpentry.config,
    roundSeconds: carpentry.roundSeconds,
    summarize: summarizeCarpentry,
  });
  const bench = useBench(CARPENTRY, api);
  const { state } = api;
  const shown = bench.reviewState ?? state;

  const onPlace = useCallback(
    (slot: number, rot: number, flip: boolean, col: number, row: number) => {
      api.apply({ type: "place", slot, rot, flip, col, row });
    },
    [api],
  );
  const onPatched = useCallback((rating: HoleRating, chain: number) => {
    sfx.plankLift();
    if (rating === "masterpiece") {
      sfx.clear(Math.min(6, chain), 6);
      if (chain >= 2) sfx.multi(chain);
    } else if (rating === "pig") sfx.streakLost();
    else sfx.clear(1, 3);
  }, []);
  const onNailed = useCallback((waste: boolean) => sfx.hammer(waste), []);
  const onGrew = useCallback(() => sfx.crack(true), []);
  const onCracked = useCallback((opening: boolean) => sfx.crack(!opening), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onBump = useCallback(() => sfx.bump(), []);

  const woods = carpentry.pieces.slice(0, shown.config.pieceKinds);

  return (
    <PracticeShell
      puzzle="carpentry"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={shown.config.maxMoves < CARPENTRY.config.maxMoves ? shown.config.maxMoves : undefined}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("carpentry.go")}
      details={
        <div className="stat stat-wide">
          <span className="stat-label">{t("carpentry.holes_patched")}</span>
          <span className="stat-value" data-testid="hud-patched">
            {shown.patchedCount}
          </span>
        </div>
      }
      resultRows={
        <div>
          <dt>{t("carpentry.holes_patched")}</dt>
          <dd>{state.patchedCount}</dd>
        </div>
      }
      legend={
        <>
          <ul className="kinds">
            {woods.map((p, kind) => (
              <li key={p.nameKey}>
                <TileIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} sprite={{ puzzle: "carpentry", name: `${["oak", "teak", "pine", "mahogany"][kind]}-h` }} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("carpentry.legend_holes")}</p>
          <p className="muted small legend-note">{t("carpentry.legend_grain")}</p>
          <ul className="kinds shapes">
            {carpentry.shapes.map((s, i) => (
              <li key={s.nameKey}>
                <ShapeIcon shape={i} />
                <span>{PENTOMINO_LETTERS[i]}</span>
              </li>
            ))}
          </ul>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <CarpentryBoard
          key={bench.reviewKey ?? "live"}
          state={shown}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          onPlace={onPlace}
          onFrame={api.markRendered}
          onPatched={onPatched}
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

/** A tiny SVG of one pentomino for the legend. */
function ShapeIcon({ shape }: { shape: number }) {
  const cells = carpentryOrient(shape, 0, false);
  const w = Math.max(...cells.map(([x]) => x)) + 1;
  const h = Math.max(...cells.map(([, y]) => y)) + 1;
  const u = 20 / Math.max(w, h);
  const x0 = (22 - w * u) / 2;
  const y0 = (22 - h * u) / 2;
  return (
    <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true" className="tile-icon">
      {cells.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x0 + x * u + 0.4} y={y0 + y * u + 0.4} width={u - 0.8} height={u - 0.8} rx={1} fill="#c98a4b" stroke="#3a2412" strokeWidth="0.6" />
      ))}
    </svg>
  );
}
