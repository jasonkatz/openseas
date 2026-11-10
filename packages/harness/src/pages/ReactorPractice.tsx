import { useCallback } from "react";
import { reactorHotCount, reactorPipelineLeft, summarizeReactor, type ReactorConfig, type ReactorDir, type ReactorMove, type ReactorState } from "@openseas/engine";
import { ReactorBoard, content, t } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { REACTOR } from "../prototypes/reactor.js";

const reactor = content.puzzles.reactor;
/** The board's own colors, a grade each, for the legend's icons. */
const GRADE_COLORS = ["#58c4f6", "#7bd88f", "#f5d021", "#ff9f43", "#b48cff", "#f78fb3", "#f2f0e6", "#9fb4d8"];

/** Reactor (prototype, ADR 0036): the practice frame round the shared board, with the bench beside it. */
export function ReactorPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<ReactorState, ReactorMove, ReactorConfig>({
    puzzle: "reactor",
    def: REACTOR.def,
    config: reactor.config,
    roundSeconds: reactor.roundSeconds,
    summarize: summarizeReactor,
  });
  const bench = useBench(REACTOR, api);
  const { state } = api;
  const shown = bench.reviewState ?? state;
  const cfg = shown.config;

  const onSwipe = useCallback((dir: ReactorDir): boolean => api.apply({ type: "swipe", dir }), [api]);

  const hot = reactorHotCount(cfg, shown.cells);
  const left = reactorPipelineLeft(shown);
  const grades = Array.from({ length: cfg.hotGrade - 1 }, (_, i) => i + 1);

  return (
    <PracticeShell
      puzzle="reactor"
      eyebrow={t("harness.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("reactor.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < REACTOR.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("reactor.go")}
      warn={hot >= cfg.criticalHot - 1}
      howTo={
        <>
          <p className="how how-kbd">{t("reactor.salvo_note")}</p>
          <p className="how how-kbd">{t("reactor.pipeline_note")}</p>
          <p className="how how-kbd">{t("reactor.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("reactor.stat_next")}</span>
            <span className="stat-value" data-testid="hud-next">
              <RodIcon grade={shown.next} hot={false} marks={showMarks} size={26} />
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("reactor.stat_hot")}</span>
            <span className={`stat-value ${hot >= cfg.criticalHot - 1 ? "urgent" : ""}`} data-testid="hud-hot">
              {t("reactor.stat_hot_value", { count: hot, max: cfg.criticalHot })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("reactor.stat_pipeline")}</span>
            <span className="stat-value" data-testid="hud-pipeline">
              {left > 0 ? t("reactor.stat_pipeline_value", { count: shown.combo, left }) : t("reactor.stat_pipeline_none")}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("reactor.result_discharges")}</dt>
            <dd>{state.discharges}</dd>
          </div>
          <div>
            <dt>{t("reactor.result_salvos")}</dt>
            <dd>{state.salvos}</dd>
          </div>
          <div>
            <dt>{t("reactor.result_scrams")}</dt>
            <dd>{state.scrams}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {grades.map((grade) => (
              <li key={grade}>
                <RodIcon grade={grade} hot={false} marks={showMarks} />
                <span>{t("reactor.legend_grade", { grade })}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <RodIcon grade={cfg.hotGrade} hot marks={showMarks} />
              <span>{t("reactor.legend_hot")}</span>
            </li>
            <li>
              <PortIcon status="idle" />
              <span>{t("reactor.legend_port_idle")}</span>
            </li>
            <li>
              <PortIcon status="ready" />
              <span>{t("reactor.legend_port_ready")}</span>
            </li>
            <li>
              <PortIcon status="blocked" />
              <span>{t("reactor.legend_port_blocked")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("reactor.legend_heat")}</p>
          <p className="muted small proto-note">{t("reactor.salvo_note")}</p>
          <p className="muted small proto-note">{t("reactor.pipeline_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <ReactorBoard key={bench.reviewKey ?? "live"} state={shown} version={api.version} interactive={interactive} showMarks={showMarks} hints={bench.hints} onSwipe={onSwipe} onFrame={api.markRendered} />
      )}
    />
  );
}

/** A rod as the board draws it: a casing with a bar a grade, or the toothed disc of a hot rod. */
function RodIcon({ grade, hot, marks, size = 22 }: { grade: number; hot: boolean; marks: boolean; size?: number }) {
  const color = GRADE_COLORS[(grade - 1) % GRADE_COLORS.length]!;
  const bars = Math.min(4, grade);
  const span = bars * 2.6 + (bars - 1) * 1.8;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      {hot ? (
        <>
          <path
            d={Array.from({ length: 20 }, (_, i) => {
              const r = i % 2 === 0 ? 11 : 8.6;
              const a = -Math.PI / 2 + (i * Math.PI) / 10;
              return `${i === 0 ? "M" : "L"}${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`;
            }).join(" ")}
            fill="#ff5a3c"
            stroke="#7d2a1b"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="6.2" fill="#ffa57a" />
          <circle cx="12" cy="12" r="3.9" fill="#fff0b8" />
        </>
      ) : (
        <>
          <rect x="2" y="2" width="20" height="20" rx="4" fill={color} stroke="#0a1424" strokeOpacity="0.55" strokeWidth="1.2" />
          {Array.from({ length: bars }, (_, i) => (
            <rect key={i} x={12 - span / 2 + i * 4.4} y="7" width="2.6" height="10.5" rx="1.3" fill="#0a1424" fillOpacity="0.72" />
          ))}
        </>
      )}
      {marks && (
        <text x="18.5" y="8.5" fontSize="8" fontWeight="700" textAnchor="middle" fill="#0a1424" stroke="#ffffff" strokeWidth="2.4" paintOrder="stroke">
          {grade}
        </text>
      )}
    </svg>
  );
}

/** A port's gate in each of its three states, told apart by its mark as well as its color. */
function PortIcon({ status }: { status: "idle" | "ready" | "blocked" }) {
  const color = status === "blocked" ? "#f5b942" : "#5fe3a1";
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <rect x="2" y="7" width="20" height="10" rx="4" fill={status === "ready" ? color : "#17362f"} stroke={color} strokeWidth="1.6" />
      {status === "idle" && <circle cx="12" cy="12" r="1.6" fill={color} />}
      {status === "ready" && <path d="M8 15l4-5 4 5" fill="none" stroke="#0a1424" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
      {status === "blocked" && <path d="M7 12h10" stroke="#ffe2a3" strokeWidth="2.6" strokeLinecap="round" />}
    </svg>
  );
}
