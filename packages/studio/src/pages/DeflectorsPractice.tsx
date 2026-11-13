import { useCallback } from "react";
import { advanceDeflectors, deflectorsOutlook, deflectorsStreakPercentAt, summarizeDeflectors, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { content, DeflectorsBoard, KindIcon, SpriteIcon, t, useTicked } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { DEFLECTORS } from "../prototypes/deflectors.js";

const deflectors = content.puzzles.deflectors;
const waitAt = (tick: number): DeflectorsMove => ({ type: "wait", tick });
const BEAM_KEYS = ["deflectors.legend_beam_1", "deflectors.legend_beam_2", "deflectors.legend_beam_3"];

/** Deflectors (prototype, ADR 0036): the practice frame round the shared board, with the bench beside it. */
export function DeflectorsPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<DeflectorsState, DeflectorsMove, DeflectorsConfig>({
    puzzle: "deflectors",
    def: DEFLECTORS.def,
    config: deflectors.config,
    roundSeconds: deflectors.roundSeconds,
    summarize: summarizeDeflectors,
  });
  const bench = useBench(DEFLECTORS, api);
  const { state } = api;
  const cfg = api.round?.config ?? deflectors.config;
  const ticked = useTicked(api, { tickMs: cfg.tickMs, maxTick: cfg.maxTick, advance: advanceDeflectors, wait: waitAt });
  const shown = bench.reviewState ?? ticked.shown;

  const onFlip = useCallback((cell: number) => void api.apply({ type: "flip", cell, tick: ticked.moveTick() }), [api, ticked]);
  const onFire = useCallback((volley: number) => void api.apply({ type: "fire", volley, tick: ticked.moveTick() }), [api, ticked]);

  // What the waiting volley would do now: the engine's word, as the board's strip shows it.
  const outlook = deflectorsOutlook(shown);
  const signs = DeflectorsBoard.signs.slice(0, shown.config.maxBeams);
  const first = signs[0]!;

  return (
    <PracticeShell
      puzzle="deflectors"
      eyebrow={t("harness.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.volleys}
      movesLabel={t("deflectors.moves")}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("deflectors.go")}
      warn={api.phase === "playing" && outlook !== null && !outlook.clean && shown.volley !== null && (shown.volley.fireTick - shown.tick) * shown.config.tickMs <= 3000}
      howTo={
        <>
          <p className="how how-kbd">{t("deflectors.lines_note")}</p>
          <p className="how how-kbd">{t("deflectors.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("deflectors.volley")}</span>
            <span className="stat-value" data-testid="hud-volley">
              {outlook ? t("deflectors.volley_value", { home: outlook.hits, beams: outlook.shots.length }) : t("deflectors.volley_none")}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("deflectors.streak_stat")}</span>
            <span className="stat-value" data-testid="hud-streak">
              {shown.combo > 0 ? t("deflectors.streak_value", { count: shown.combo, percent: deflectorsStreakPercentAt(shown.config, shown.combo) }) : t("deflectors.streak_none")}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("deflectors.result_home")}</dt>
            <dd>{state.hits}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_hull")}</dt>
            <dd>{state.misses}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_perfect")}</dt>
            <dd>{state.perfects}</dd>
          </div>
          <div>
            <dt>{t("deflectors.result_longest")}</dt>
            <dd>{t("deflectors.result_longest_value", { turns: state.longest })}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {signs.map((s, i) => (
              <li key={s.kind}>
                <KindIcon kind={s.kind} color={s.color} marks={showMarks} sprite={{ puzzle: "deflectors", name: `sign-${s.id}` }} />
                <span>{t(BEAM_KEYS[i]!)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <KindIcon kind={first.kind} color={first.color} marks={showMarks} sprite={{ puzzle: "deflectors", name: `sign-${first.id}` }} />
              <span>{t("deflectors.legend_entry")}</span>
            </li>
            <li>
              <KindIcon kind={first.kind} color={first.color} hollow sprite={{ puzzle: "deflectors", name: `target-${first.id}` }} />
              <span>{t("deflectors.legend_exit")}</span>
            </li>
            <li>
              <MirrorIcon />
              <span>{t("deflectors.legend_mirror")}</span>
            </li>
            <li>
              <LineIcon look="home" />
              <span>{t("deflectors.legend_home")}</span>
            </li>
            <li>
              <LineIcon look="astray" />
              <span>{t("deflectors.legend_astray")}</span>
            </li>
            <li>
              <LineIcon look="back" />
              <span>{t("deflectors.legend_back")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("deflectors.lines_note")}</p>
          <p className="muted small proto-note">{t("deflectors.streak_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <DeflectorsBoard
          key={bench.reviewKey ?? "live"}
          state={shown}
          logged={bench.reviewState ?? state}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          hints={bench.hints}
          onFlip={onFlip}
          onFire={onFire}
          onFrame={api.markRendered}
        />
      )}
    />
  );
}

function MirrorIcon() {
  const vector = (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <path d="M5 19L19 5" stroke="#55606e" strokeWidth="6" strokeLinecap="round" />
      <path d="M5 19L19 5" stroke="#dfe9f5" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="#d4a548" stroke="#6a5324" />
    </svg>
  );
  return <SpriteIcon puzzle="deflectors" name="mirror-slash" fallback={vector} />;
}

/** The three looks a waiting beam's lines take, as the board draws them. */
function LineIcon({ look }: { look: "home" | "astray" | "back" }) {
  const color = "#f5d021";
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      {look === "home" && (
        <>
          <path d="M2 17h10V6h10" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7" cy="17" r="1.5" fill="#fff" />
          <circle cx="12" cy="10" r="1.5" fill="#fff" />
          <circle cx="18" cy="6" r="1.5" fill="#fff" />
        </>
      )}
      {look === "astray" && (
        <>
          <path d="M2 17h10V8" fill="none" stroke="#c9b458" strokeWidth="2.4" strokeDasharray="3.5 2.6" strokeLinecap="round" />
          <path d="M9 2l6 6m0-6l-6 6" stroke="#f0604d" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
      {look === "back" && <path d="M2 17h10V6h10" fill="none" stroke={color} strokeWidth="2.6" strokeDasharray="0.1 4" strokeLinecap="round" />}
    </svg>
  );
}
