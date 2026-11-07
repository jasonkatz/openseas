import { useCallback, useRef, useState } from "react";
import { previewSwap, summarizeBilging, type BilgingConfig, type BilgingMove, type BilgingState, type ClearRound } from "@openseas/engine";
import { BilgingBoard, TileIcon, content, sfx, t, type BilgingMoveShown } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { useSoloBilge } from "../practice/useSoloBilge.js";
import { BILGING } from "../puzzles.js";

const bilging = content.puzzles.bilging;

export function BilgingPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const [pumped, setPumped] = useState(0);
  /** Rows pumped down this round, counted on the client for the result card only. */
  const pumpedRef = useRef(0);

  const onMove = useCallback((s: BilgingState, prev: BilgingState) => {
    if (prev.moveCount === 0) pumpedRef.current = 0;
    pumpedRef.current += Math.max(0, prev.waterRow - s.waterRow);
    setPumped(pumpedRef.current);
    // The lone ship's water is no swap; the board sounds the pump or the rise itself.
    if (s.lastMove?.move.type === "water") return;
    if (s.lastMove && s.lastMove.points > 0) sfx.swap();
    else sfx.swapQuiet();
  }, []);

  const api = usePractice<BilgingState, BilgingMove, BilgingConfig>({
    puzzle: "bilging",
    def: BILGING.def,
    config: bilging.config,
    roundSeconds: bilging.roundSeconds,
    summarize: summarizeBilging,
    onMove,
  });
  useSoloBilge(api);
  const bench = useBench(BILGING, api);
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
    if (causes.has("keg")) sfx.keg();
    if (causes.has("ink")) sfx.ink();
    if (causes.has("barnacle")) sfx.barnacle();
    if (causes.has("match")) sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
    const runs = r.groups.filter((g) => g.cause === "match" && g.ids.length >= 3).length;
    if (runs >= 2) sfx.multi(runs);
  }, []);
  const onMoveShown = useCallback((m: BilgingMoveShown) => {
    if (m.milestone) sfx.streak(m.milestone);
    else if (m.lostCombo >= 3) sfx.streakLost();
    if (m.waterRows < 0) sfx.pump(-m.waterRows);
    else if (m.waterRows > 0) sfx.rise();
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

  const waterFrac = shown.waterRow / shown.config.height;
  const danger = waterFrac >= 0.5;
  const pieces = bilging.pieces.slice(0, shown.config.pieceKinds);

  const water = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("bilging.water")}</span>
      <span className="water-row">
        <span className={`water-meter ${danger ? "danger" : ""}`}>
          <i style={{ width: `${Math.round(waterFrac * 100)}%` }} />
        </span>
        {danger && playing && <em className="water-warn">{t("bilging.water_danger")}</em>}
      </span>
    </div>
  );

  return (
    <PracticeShell
      puzzle="bilging"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      maxMoves={shown.config.maxMoves}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("bilging.go")}
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
      howTo={<p className="how how-kbd">{t("bilging.hint_note")}</p>}
      details={water}
      resultRows={
        <div>
          <dt>{t("bilging.result_pumped")}</dt>
          <dd>{pumped}</dd>
        </div>
      }
      legend={
        <>
          <ul className="specials">
            {(["keg", "ink", "barnacle"] as const).map((k) => (
              <li key={k}>
                <TileIcon color={bilging.specials[k].color} special={k} label={t(`bilging.special.${k}_label`)} />
                <span>
                  <b>{t(bilging.specials[k].nameKey)}</b> {t(`bilging.special.${k}_help`)}
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
        <BilgingBoard
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
