import { useState } from "react";
import { navigationColorOf, navigationLandingSlot, navigationMarkerFilled, navigationShapeOf } from "@openseas/engine";
import { NavigationBoard, StarIcon, content, t, useNavigationControls } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePracticePage } from "../practice/usePracticePage.js";
import { NAVIGATION } from "../puzzles.js";

const navigation = content.puzzles.navigation;
const MARKERS_KEY = "openseas.navigation.markers";

function readMarkersFlag(): boolean {
  try {
    return window.localStorage.getItem(MARKERS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function NavigationPractice() {
  const [showMarkers, setShowMarkersState] = useState(readMarkersFlag);
  const setShowMarkers = (on: boolean): void => {
    setShowMarkersState(on);
    try {
      window.localStorage.setItem(MARKERS_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const page = usePracticePage(NAVIGATION);
  const controls = useNavigationControls(page.api, page.moveTick);
  const { shown, showMarks } = page;
  const { state } = page.api;

  const colors = navigation.colors.slice(0, shown.config.colors);
  const shapes = navigation.shapes.slice(0, shown.config.shapes);
  const starOf = (kind: number, size: number, hollow = false) => {
    const c = colors[navigationColorOf(shown.config, kind)]!;
    const s = shapes[navigationShapeOf(shown.config, kind)]!;
    return <StarIcon shape={s.shape} color={c.color} mark={showMarks ? c.mark : null} hollow={hollow} size={size} />;
  };
  const filled = shown.markers.filter((m) => navigationMarkerFilled(shown, m)).length;
  const total = shown.markers.length;
  const blocked = page.playing && navigationLandingSlot(shown) === null;

  const details = (
    <>
      <div className="stat stat-wide">
        <span className="stat-label">{t("navigation.next")}</span>
        <span className="next-pair" data-testid="hud-next">
          {starOf(shown.falling.kind, 26)}
          <span className="muted" aria-hidden="true">
            ›
          </span>
          {starOf(shown.next, 22)}
        </span>
      </div>
      <div className="stat stat-wide">
        <span className="stat-label">{t("navigation.progress")}</span>
        <span className="heat-row">
          <span className="heat-meter progress-meter" aria-label={t("navigation.progress_label", { filled, total })}>
            <i style={{ width: `${total ? Math.round((filled / total) * 100) : 0}%` }} />
          </span>
          <small className="muted" data-testid="hud-progress">
            {t("navigation.progress_label", { filled, total })}
          </small>
        </span>
      </div>
    </>
  );

  return (
    <PracticeShell
      page={page}
      hud={{ moves: shown.landings, movesLabel: t("navigation.stars") }}
      warn={blocked}
      howTo={
        <>
          <p className="how how-kbd">{t("navigation.lost_heading_note")}</p>
          <p className="how how-kbd">{t("navigation.hint_note")}</p>
        </>
      }
      details={details}
      resultRows={
        <>
          <div>
            <dt>{t("navigation.result_charted")}</dt>
            <dd>{state.completed}</dd>
          </div>
          <div>
            <dt>{t("navigation.result_runs")}</dt>
            <dd>{state.runsCleared}</dd>
          </div>
          <div>
            <dt>{t("navigation.result_headings_lost")}</dt>
            <dd>{state.lostHeadings}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {colors.map((c) => (
              <li key={c.nameKey}>
                <StarIcon shape="star" color={c.color} mark={showMarks ? c.mark : null} />
                <span>{t(c.nameKey)}</span>
              </li>
            ))}
          </ul>
          <ul className="kinds">
            {shapes.map((s) => (
              <li key={s.nameKey}>
                <StarIcon shape={s.shape} color="#efe3c6" />
                <span>{t(s.nameKey)}</span>
              </li>
            ))}
          </ul>
          <ul className="kinds">
            <li>
              <StarIcon shape="star" color={colors[0]!.color} hollow />
              <span>{t("navigation.legend_marker")}</span>
            </li>
          </ul>
          <p className="muted small legend-note">{t("navigation.legend_landing")}</p>
          <p className="muted small legend-note">{t("navigation.legend_runs")}</p>
          <label className="toggle">
            <input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} data-testid="toggle-markers" />
            <span>
              {t("navigation.setting_markers")} <small className="muted">{t("navigation.setting_markers_hint")}</small>
            </span>
          </label>
        </>
      }
      board={(b) => <NavigationBoard {...b} showMarkers={showMarkers} {...controls} />}
    />
  );
}
