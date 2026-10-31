import { useCallback } from "react";
import { CARPENTRY_DEF, PENTOMINO_LETTERS, carpentryOrient, summarizeCarpentry, type CarpentryMove, type CarpentryState, type HoleRating } from "@openseas/engine";
import { sfx } from "../audio.js";
import { content, t } from "../content.js";
import { MarksToggle, PracticeShell, useShowMarks } from "../puzzles/PracticeShell.jsx";
import { TileIcon } from "../puzzles/TileIcon.jsx";
import { usePractice } from "../puzzles/usePractice.js";
import { CarpentryBoard } from "../carpentry/CarpentryBoard.jsx";

const carpentry = content.puzzles.carpentry;

export function CarpentryPractice() {
  const [showMarks, setShowMarks] = useShowMarks();

  const api = usePractice<CarpentryState, CarpentryMove, typeof carpentry.config>({
    puzzle: "carpentry",
    def: CARPENTRY_DEF,
    config: carpentry.config,
    roundSeconds: carpentry.roundSeconds,
    summarize: summarizeCarpentry,
  });
  const { state } = api;

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

  const woods = carpentry.pieces.slice(0, carpentry.config.pieceKinds);

  return (
    <PracticeShell
      puzzle="carpentry"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={carpentry.roundSeconds}
      timeLeft={api.timeLeft}
      score={state.score}
      moves={state.moveCount}
      maxMoves={carpentry.config.maxMoves}
      combo={state.combo}
      canRate={api.canRate}
      onStartRated={api.startRated}
      onStartUnrated={api.startUnrated}
      splash={t("carpentry.go")}
      details={
        <div className="stat stat-wide">
          <span className="stat-label">{t("carpentry.holes_patched")}</span>
          <span className="stat-value" data-testid="hud-patched">
            {state.patchedCount}
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
            {woods.map((p) => (
              <li key={p.nameKey}>
                <TileIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} />
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
      board={(interactive) => (
        <CarpentryBoard
          state={state}
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
