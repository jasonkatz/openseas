import { useCallback, useRef, useState } from "react";
import { previewSwap, summarizeCooling, type CoolingConfig, type CoolingMove, type CoolingState, type ClearRound } from "@openseas/engine";
import { CoolingBoard, TileIcon, content, sfx, t, type CoolingMoveShown } from "@openseas/boards";
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
    // The lone ship's heat is no swap; the board sounds the vent or the rise itself.
    if (s.lastMove?.move.type === "heat") return;
    if (s.lastMove && s.lastMove.points > 0) sfx.swap();
    else sfx.swapQuiet();
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
  const { state } = api;
  const shown = bench.reviewState ?? state;
  const playing = api.phase === "playing";

  const onSwap = useCallback(
    (col: number, row: number) => {
      api.apply({ type: "swap", col, row });
    },
    [api],
  );
  const preview = useCallback(
    (col: number, row: number): readonly number[] => {
      const r = api.current();
      if (!r || r.isFinished) return [];
      return previewSwap(r.state, col, row).cells;
    },
    [api],
  );
  const onClear = useCallback((r: ClearRound) => {
    const causes = new Set(r.groups.map((g) => g.cause));
    if (causes.has("charge")) sfx.charge();
    if (causes.has("magnet")) sfx.magnet();
    if (causes.has("slag")) sfx.slag();
    if (causes.has("match")) sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
    const runs = r.groups.filter((g) => g.cause === "match" && g.ids.length >= 3).length;
    if (runs >= 2) sfx.multi(runs);
  }, []);
  const onMoveShown = useCallback((m: CoolingMoveShown) => {
    if (m.milestone) sfx.streak(m.milestone);
    else if (m.lostCombo >= 3) sfx.streakLost();
    if (m.heatRows < 0) sfx.vent(-m.heatRows);
    else if (m.heatRows > 0) sfx.rise();
    if (m.enteredDanger) sfx.alarm();
  }, []);
  /** The swap that clears the most pieces right now, for the idle hint. */
  const findHint = useCallback((): { col: number; row: number } | null => {
    const r = api.current();
    if (!r || r.isFinished) return null;
    let best: { col: number; row: number } | null = null;
    let most = 0;
    const { width, height } = r.state.config;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width - 1; col++) {
        const n = previewSwap(r.state, col, row).cells.length;
        if (n > most) {
          most = n;
          best = { col, row };
        }
      }
    }
    return best;
  }, [api]);

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
          onSwap={onSwap}
          preview={preview}
          onFrame={api.markRendered}
          onClear={onClear}
          onMoveShown={onMoveShown}
          hints={playing && bench.hints}
          findHint={findHint}
        />
      )}
    />
  );
}
