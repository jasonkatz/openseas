import { useCallback, useState } from "react";
import {
  NAVIGATION_DEF,
  advanceNavigation,
  navigationColorOf,
  navigationLandingSlot,
  navigationMarkerFilled,
  navigationShapeOf,
  summarizeNavigation,
  type NavigationConfig,
  type NavigationEvent,
  type NavigationMove,
  type NavigationState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { content, t } from "../content.js";
import { NavigationBoard } from "../navigation/NavigationBoard.jsx";
import { StarIcon } from "../navigation/StarIcon.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../puzzles/PracticeShell.jsx";
import { usePractice } from "../puzzles/usePractice.js";
import { useTicked } from "../puzzles/useTicked.js";

const navigation = content.puzzles.navigation;
const { tickMs, maxTick } = navigation.config;
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
    def: NAVIGATION_DEF,
    config: navigation.config,
    roundSeconds: navigation.roundSeconds,
    summarize: summarizeNavigation,
  });
  const { state } = api;
  const { shown, moveTick } = useTicked(api, { tickMs, maxTick, roundSeconds: navigation.roundSeconds, advance: advanceNavigation, wait: waitAt });

  const onRotate = useCallback((ring: number, dir: -1 | 1): boolean => api.apply({ type: "rotate", ring, dir, tick: moveTick() }), [api, moveTick]);
  const onDrop = useCallback(() => void api.apply({ type: "drop", tick: moveTick() }), [api, moveTick]);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onEvents = useCallback((events: readonly NavigationEvent[]) => {
    for (const e of events) {
      switch (e.type) {
        case "land":
          if (e.onMarker) sfx.swap();
          else sfx.swapQuiet();
          break;
        case "booch":
          sfx.streakLost();
          sfx.keg();
          break;
        case "charted":
          sfx.clear(e.completion.chain, e.completion.markers.length);
          if (e.completion.chain >= 3) sfx.streak(e.completion.chain);
          if (e.completion.efficient) sfx.barnacle();
          break;
        case "run":
          sfx.multi(e.run.slots.length - 1);
          break;
        default:
          break;
      }
    }
  }, []);

  const colors = navigation.colors.slice(0, navigation.config.colors);
  const shapes = navigation.shapes.slice(0, navigation.config.shapes);
  const starOf = (kind: number, size: number, hollow = false) => {
    const c = colors[navigationColorOf(navigation.config, kind)]!;
    const s = shapes[navigationShapeOf(navigation.config, kind)]!;
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
        <span className="water-row">
          <span className="water-meter progress-meter" aria-label={t("navigation.progress_label", { filled, total })}>
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
      roundSeconds={navigation.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.landings}
      movesLabel={t("navigation.stars")}
      combo={shown.combo}
      canRate={api.canRate}
      onStartRated={api.startRated}
      onStartUnrated={api.startUnrated}
      splash={t("navigation.go")}
      warn={blocked}
      howTo={
        <>
          <p className="how how-kbd">{t("navigation.booch_note")}</p>
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
            <dt>{t("navigation.result_booched")}</dt>
            <dd>{state.booches}</dd>
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
      board={(interactive) => (
        <NavigationBoard
          state={shown}
          interactive={interactive}
          showMarks={showMarks}
          showMarkers={showMarkers}
          hints={!api.rated}
          onRotate={onRotate}
          onDrop={onDrop}
          onFrame={api.markRendered}
          onEvents={onEvents}
          onNudge={onNudge}
        />
      )}
    />
  );
}
