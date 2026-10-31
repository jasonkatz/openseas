import { useCallback, useRef, useState } from "react";
import {
  NAVIGATION_DEF,
  navigationColorOf,
  navigationMarkerFilled,
  navigationShapeOf,
  summarizeNavigation,
  type Completion,
  type NavigationMove,
  type NavigationState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { content, t } from "../content.js";
import { NavigationBoard } from "../navigation/NavigationBoard.jsx";
import { StarIcon } from "../navigation/StarIcon.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../puzzles/PracticeShell.jsx";
import { usePractice } from "../puzzles/usePractice.js";

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
  const [showMarks, setShowMarks] = useShowMarks();
  const [showMarkers, setShowMarkersState] = useState(readMarkersFlag);
  const [tally, setTally] = useState({ charted: 0, booched: 0 });
  const counts = useRef({ charted: 0, booched: 0 });

  const setShowMarkers = (on: boolean): void => {
    setShowMarkersState(on);
    try {
      window.localStorage.setItem(MARKERS_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const onMove = useCallback((s: NavigationState) => {
    const r = s.lastMove;
    if (!r) return;
    if (r.completions.length || r.booch) {
      counts.current = { charted: counts.current.charted + r.completions.length, booched: counts.current.booched + (r.booch ? 1 : 0) };
      setTally(counts.current);
    }
  }, []);

  const api = usePractice<NavigationState, NavigationMove, typeof navigation.config>({
    puzzle: "navigation",
    def: NAVIGATION_DEF,
    config: navigation.config,
    roundSeconds: navigation.roundSeconds,
    summarize: summarizeNavigation,
    onMove,
  });
  const { state } = api;

  const onRotate = useCallback((ring: number, dir: -1 | 1) => void api.apply({ type: "rotate", ring, dir }), [api]);
  const onDrop = useCallback(() => void api.apply({ type: "drop" }), [api]);
  const onLanded = useCallback(() => sfx.swapQuiet(), []);
  const onBooch = useCallback(() => sfx.streakLost(), []);
  const onCharted = useCallback((c: Completion) => {
    sfx.clear(c.chain, c.markers.length);
    if (c.chain >= 3) sfx.streak(c.chain);
    if (c.efficient) sfx.barnacle();
  }, []);
  const onNudge = useCallback(() => sfx.tick(false), []);

  const startRound = (start: () => void) => () => {
    counts.current = { charted: 0, booched: 0 };
    setTally(counts.current);
    start();
  };

  const colors = navigation.colors.slice(0, navigation.config.colors);
  const shapes = navigation.shapes.slice(0, navigation.config.shapes);
  const starOf = (kind: number, size: number, hollow = false) => {
    const c = colors[navigationColorOf(navigation.config, kind)]!;
    const s = shapes[navigationShapeOf(navigation.config, kind)]!;
    return <StarIcon shape={s.shape} color={c.color} mark={showMarks ? c.mark : null} hollow={hollow} size={size} />;
  };
  const filled = state.markers.filter((m) => navigationMarkerFilled(state, m)).length;
  const total = state.markers.length;

  const details = (
    <>
      <div className="stat stat-wide">
        <span className="stat-label">{t("navigation.next")}</span>
        <span className="next-pair" data-testid="hud-next">
          {starOf(state.next.kind, 26)}
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
      score={state.score}
      moves={state.moveCount}
      maxMoves={navigation.config.maxDrops}
      combo={state.combo}
      canRate={api.canRate}
      onStartRated={startRound(api.startRated)}
      onStartUnrated={startRound(api.startUnrated)}
      splash={t("navigation.go")}
      howTo={<p className="how how-kbd">{t("navigation.booch_note")}</p>}
      details={details}
      resultRows={
        <>
          <div>
            <dt>{t("navigation.result_charted")}</dt>
            <dd>{tally.charted}</dd>
          </div>
          <div>
            <dt>{t("navigation.result_booched")}</dt>
            <dd>{tally.booched}</dd>
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
          state={state}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          showMarkers={showMarkers}
          onRotate={onRotate}
          onDrop={onDrop}
          onFrame={api.markRendered}
          onLanded={onLanded}
          onBooch={onBooch}
          onCharted={onCharted}
          onNudge={onNudge}
        />
      )}
    />
  );
}
