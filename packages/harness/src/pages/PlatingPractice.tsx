import { PENTOMINO_LETTERS, platingOrient } from "@openseas/engine";
import { PlatingBoard, TileIcon, content, t, usePlatingControls } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePracticePage } from "../practice/usePracticePage.js";
import { PLATING } from "../puzzles.js";

const plating = content.puzzles.plating;

export function PlatingPractice() {
  const page = usePracticePage(PLATING);
  const controls = usePlatingControls(page.api);
  const { shown, showMarks } = page;
  const { state } = page.api;

  const metals = plating.pieces.slice(0, shown.config.pieceKinds);

  return (
    <PracticeShell
      page={page}
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
        </>
      }
      board={(b) => <PlatingBoard {...b} {...controls} />}
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
