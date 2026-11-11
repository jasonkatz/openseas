import { useCallback, useRef, useState } from "react";
import { summarizeCooling, type CoolingConfig, type CoolingMove, type CoolingState } from "@openseas/engine";
import { CoolingBoard, TileIcon, content, t, useCoolingControls } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { useSoloHeat } from "../practice/useSoloHeat.js";
import { COOLING } from "../puzzles.js";

const cooling = content.puzzles.cooling;

export function CoolingPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const [vented, setVented] = useState(0);
  /** Rows vented down this round, counted on the client for the result card only. */
  const ventedRef = useRef(0);

  const onMove = useCallback((s: CoolingState, prev: CoolingState) => {
    if (prev.moveCount === 0) ventedRef.current = 0;
    ventedRef.current += Math.max(0, prev.heatRow - s.heatRow);
    setVented(ventedRef.current);
  }, []);

  const api = usePractice<CoolingState, CoolingMove, CoolingConfig>({
    puzzle: "cooling",
    def: COOLING.def,
    config: cooling.config,
    roundSeconds: cooling.roundSeconds,
    summarize: summarizeCooling,
    onMove,
  });
  useSoloHeat(api);
  const bench = useBench(COOLING, api);
  const controls = useCoolingControls(api);
  const { state } = api;
  const shown = bench.reviewState ?? state;
  const playing = api.phase === "playing";

  const heatFrac = shown.heatRow / shown.config.height;
  const danger = heatFrac >= 0.5;
  const pieces = cooling.pieces.slice(0, shown.config.pieceKinds);

  const heat = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("cooling.heat")}</span>
      <span className="heat-row">
        <span className={`heat-meter ${danger ? "danger" : ""}`}>
          <i style={{ width: `${Math.round(heatFrac * 100)}%` }} />
        </span>
        {danger && playing && <em className="heat-warn">{t("cooling.heat_danger")}</em>}
      </span>
    </div>
  );

  return (
    <PracticeShell
      puzzle="cooling"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={shown.config.maxMoves < COOLING.config.maxMoves ? shown.config.maxMoves : undefined}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("cooling.go")}
      warn={danger}
      art={
        <div className="tile-row" aria-hidden="true">
          {pieces.map((p, i) => (
            <span key={p.nameKey} style={{ animationDelay: `${i * 70}ms` }}>
              <TileIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} size={30} />
            </span>
          ))}
        </div>
      }
      howTo={<p className="how how-kbd">{t("cooling.hint_note")}</p>}
      details={heat}
      resultRows={
        <div>
          <dt>{t("cooling.result_vented")}</dt>
          <dd>{vented}</dd>
        </div>
      }
      legend={
        <>
          <ul className="specials">
            {(["charge", "magnet", "slag"] as const).map((k) => (
              <li key={k}>
                <TileIcon color={cooling.specials[k].color} special={k} label={t(`cooling.special.${k}_label`)} />
                <span>
                  <b>{t(cooling.specials[k].nameKey)}</b> {t(`cooling.special.${k}_help`)}
                </span>
              </li>
            ))}
          </ul>
          <ul className="kinds">
            {pieces.map((p) => (
              <li key={p.nameKey}>
                <TileIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <CoolingBoard
          key={bench.reviewKey ?? "live"}
          state={shown}
          report={shown.lastMove}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          hints={playing && bench.hints}
          {...controls}
        />
      )}
    />
  );
}
