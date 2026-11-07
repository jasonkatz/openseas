import { useCallback, useRef, useState } from "react";
import { summarizeSailing, type Rotation, type SailingClearRound, type SailingConfig, type SailingMove, type SailingState } from "@openseas/engine";
import { DiscIcon, SailingBoard, content, sfx, t } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { SAILING } from "../puzzles.js";

const sailing = content.puzzles.sailing;

export function SailingPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const [platformsCleared, setPlatformsCleared] = useState(0);
  const [wipes, setWipes] = useState(0);
  const cleared = useRef({ platforms: 0, wipes: 0 });

  const onMove = useCallback((s: SailingState, prev: SailingState) => {
    if (prev.moveCount === 0 && s.moveCount <= 1) cleared.current = { platforms: 0, wipes: 0 };
    const n = s.lastMove?.rounds.reduce((sum, r) => sum + r.groups.filter((g) => g.cause === "platform").length, 0) ?? 0;
    if (n) {
      cleared.current.platforms += n;
      setPlatformsCleared(cleared.current.platforms);
    }
    if (s.lastMove?.wipe) {
      cleared.current.wipes += 1;
      setWipes(cleared.current.wipes);
    }
  }, []);

  const api = usePractice<SailingState, SailingMove, SailingConfig>({
    puzzle: "sailing",
    def: SAILING.def,
    config: sailing.config,
    roundSeconds: sailing.roundSeconds,
    summarize: summarizeSailing,
    onMove,
  });
  const bench = useBench(SAILING, api);
  const { state } = api;
  const shown = bench.reviewState ?? state;

  const onPlace = useCallback(
    (col: number, row: number, rot: Rotation) => {
      api.apply({ type: "place", col, row, rot });
    },
    [api],
  );
  const onClear = useCallback((r: SailingClearRound) => {
    const pieces = r.groups.reduce((n, g) => n + g.ids.length, 0);
    sfx.clear(r.chain, pieces);
    if (r.groups.some((g) => g.cause === "platform")) sfx.barnacle();
    if (r.groups.length >= 2) sfx.multi(r.groups.length);
  }, []);
  const onLanded = useCallback(() => sfx.swapQuiet(), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onWipe = useCallback(() => {
    sfx.alarm();
    sfx.streakLost();
  }, []);

  const startRound = (start: () => void) => () => {
    cleared.current = { platforms: 0, wipes: 0 };
    setPlatformsCleared(0);
    setWipes(0);
    start();
  };

  const pieces = sailing.pieces.slice(0, shown.config.pieceKinds);
  const nextPreview = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("sailing.next")}</span>
      <span className="next-pair" data-testid="hud-next">
        <DiscIcon color={pieces[shown.next.a]!.color} texture={pieces[shown.next.a]!.texture} mark={showMarks ? pieces[shown.next.a]!.mark : null} size={26} />
        <DiscIcon color={pieces[shown.next.b]!.color} texture={pieces[shown.next.b]!.texture} mark={showMarks ? pieces[shown.next.b]!.mark : null} size={26} />
      </span>
    </div>
  );

  return (
    <PracticeShell
      puzzle="sailing"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={shown.config.maxMoves < SAILING.config.maxMoves ? shown.config.maxMoves : undefined}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={startRound(api.startRecorded)}
      onStartUnrated={startRound(api.startUnrated)}
      onStartLab={startRound(bench.startLab)}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("sailing.go")}
      details={nextPreview}
      resultRows={
        <>
          <div>
            <dt>{t("sailing.platforms")}</dt>
            <dd>{platformsCleared}</dd>
          </div>
          <div>
            <dt>{t("sailing.wipes")}</dt>
            <dd>{wipes}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {pieces.map((p) => (
              <li key={p.nameKey}>
                <DiscIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("sailing.legend_platform")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <SailingBoard
          key={bench.reviewKey ?? "live"}
          state={shown}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          onPlace={onPlace}
          onFrame={api.markRendered}
          onClear={onClear}
          onLanded={onLanded}
          onNudge={onNudge}
          onWipe={onWipe}
        />
      )}
    />
  );
}
