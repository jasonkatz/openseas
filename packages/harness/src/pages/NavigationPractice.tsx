import { useState } from "react";
import {
  advanceNavigation,
  navigationColorOf,
  navigationLandingSlot,
  navigationMarkerFilled,
  navigationShapeOf,
  summarizeNavigation,
  type NavigationConfig,
  type NavigationMove,
  type NavigationState,
} from "@openseas/engine";
import { NavigationBoard, StarIcon, content, t, useNavigationControls, useTicked } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { NAVIGATION } from "../puzzles.js";

const navigation = content.puzzles.navigation;
const MARKERS_KEY = "openseas.navigation.markers";
const waitAt = (tick: number): NavigationMove => ({ type: "wait", tick });

function readMarkersFlag(): boolean {
  try {
    return window.localStorage.getItem(MARKERS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function NavigationPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const [showMarkers, setShowMarkersState] = useState(readMarkersFlag);

  const setShowMarkers = (on: boolean): void => {
    setShowMarkersState(on);
    try {
      window.localStorage.setItem(MARKERS_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const api = usePractice<NavigationState, NavigationMove, NavigationConfig>({
    puzzle: "navigation",
    def: NAVIGATION.def,
    config: navigation.config,
    roundSeconds: navigation.roundSeconds,
    summarize: summarizeNavigation,
  });
  const bench = useBench(NAVIGATION, api);
  const { state } = api;
  const cfg = api.round?.config ?? navigation.config;
  const ticked = useTicked(api, { tickMs: cfg.tickMs, maxTick: cfg.maxTick, advance: advanceNavigation, wait: waitAt });
  const shown = bench.reviewState ?? ticked.shown;
  const controls = useNavigationControls(api, ticked.moveTick);

  const colors = navigation.colors.slice(0, shown.config.colors);
  const shapes = navigation.shapes.slice(0, shown.config.shapes);
  const starOf = (kind: number, size: number, hollow = false) => {
    const c = colors[navigationColorOf(shown.config, kind)]!;
    const s = shapes[navigationShapeOf(shown.config, kind)]!;
    return <StarIcon shape={s.shape} color={c.color} mark={showMarks ? c.mark : null} hollow={hollow} size={size} />;
  };
  const filled = shown.markers.filter((m) => navigationMarkerFilled(shown, m)).length;
  const total = shown.markers.length;
  const blocked = api.phase === "playing" && navigationLandingSlot(shown) === null;

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
      puzzle="navigation"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.landings}
      movesLabel={t("navigation.stars")}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("navigation.go")}
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
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <NavigationBoard
          key={bench.reviewKey ?? "live"}
          state={shown}
          interactive={interactive}
          showMarks={showMarks}
          showMarkers={showMarkers}
          hints={bench.hints}
          {...controls}
        />
      )}
    />
  );
}
