import { PENTOMINO_LETTERS, platingOrient, summarizePlating, type PlatingConfig, type PlatingMove, type PlatingState } from "@openseas/engine";
import { PlatingBoard, TileIcon, content, t, usePlatingControls } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { PLATING } from "../puzzles.js";

const plating = content.puzzles.plating;

export function PlatingPractice() {
  const [showMarks, setShowMarks] = useShowMarks();

  const api = usePractice<PlatingState, PlatingMove, PlatingConfig>({
    puzzle: "plating",
    def: PLATING.def,
    config: plating.config,
    roundSeconds: plating.roundSeconds,
    summarize: summarizePlating,
  });
  const bench = useBench(PLATING, api);
  const controls = usePlatingControls(api);
  const { state } = api;
  const shown = bench.reviewState ?? state;

  const metals = plating.pieces.slice(0, shown.config.pieceKinds);

  return (
    <PracticeShell
      puzzle="plating"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={shown.config.maxMoves < PLATING.config.maxMoves ? shown.config.maxMoves : undefined}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("plating.go")}
      details={
        <div className="stat stat-wide">
          <span className="stat-label">{t("plating.breaches_sealed")}</span>
          <span className="stat-value" data-testid="hud-sealed">
            {shown.sealedCount}
          </span>
        </div>
      }
      resultRows={
        <div>
          <dt>{t("plating.breaches_sealed")}</dt>
          <dd>{state.sealedCount}</dd>
        </div>
      }
      legend={
        <>
          <ul className="kinds">
            {metals.map((p, kind) => (
              <li key={p.nameKey}>
                <TileIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} sprite={{ puzzle: "plating", name: `${["tin", "copper", "steel", "brass"][kind]}-h` }} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("plating.legend_breaches")}</p>
          <p className="muted small legend-note">{t("plating.legend_brush")}</p>
          <ul className="kinds shapes">
            {plating.shapes.map((s, i) => (
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
        <PlatingBoard
          key={bench.reviewKey ?? "live"}
          state={shown}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          {...controls}
        />
      )}
    />
  );
}

/** A tiny SVG of one pentomino for the legend. */
function ShapeIcon({ shape }: { shape: number }) {
  const cells = platingOrient(shape, 0, false);
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
