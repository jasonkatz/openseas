import { useCallback, useRef, useState } from "react";
import { summarizeEngines, type Rotation, type EnginesClearRound, type EnginesConfig, type EnginesMove, type EnginesState } from "@openseas/engine";
import { PelletIcon, EnginesBoard, content, sfx, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { ENGINES } from "../puzzles.js";

const engines = content.puzzles.engines;

export function EnginesPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const [injectorsCleared, setInjectorsCleared] = useState(0);
  const [wipes, setWipes] = useState(0);
  const cleared = useRef({ injectors: 0, wipes: 0 });

  const onMove = useCallback((s: EnginesState, prev: EnginesState) => {
    if (prev.moveCount === 0 && s.moveCount <= 1) cleared.current = { injectors: 0, wipes: 0 };
    const n = s.lastMove?.rounds.reduce((sum, r) => sum + r.groups.filter((g) => g.cause === "injector").length, 0) ?? 0;
    if (n) {
      cleared.current.injectors += n;
      setInjectorsCleared(cleared.current.injectors);
    }
    if (s.lastMove?.wipe) {
      cleared.current.wipes += 1;
      setWipes(cleared.current.wipes);
    }
  }, []);

  const api = usePractice<EnginesState, EnginesMove, EnginesConfig>({
    puzzle: "engines",
    def: ENGINES.def,
    config: engines.config,
    roundSeconds: engines.roundSeconds,
    summarize: summarizeEngines,
    onMove,
  });
  const studio = useStudio(ENGINES, api);
  const { state } = api;
  const shown = state;

  const onPlace = useCallback(
    (col: number, row: number, rot: Rotation) => {
      api.apply({ type: "place", col, row, rot });
    },
    [api],
  );
  const onClear = useCallback((r: EnginesClearRound) => {
    const pieces = r.groups.reduce((n, g) => n + g.ids.length, 0);
    sfx.clear(r.chain, pieces);
    if (r.groups.some((g) => g.cause === "injector")) sfx.slag();
    if (r.groups.length >= 2) sfx.multi(r.groups.length);
  }, []);
  const onLanded = useCallback(() => sfx.swapQuiet(), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onWipe = useCallback(() => {
    sfx.alarm();
    sfx.streakLost();
  }, []);

  const startRound = (start: () => void) => () => {
    cleared.current = { injectors: 0, wipes: 0 };
    setInjectorsCleared(0);
    setWipes(0);
    start();
  };

  const pieces = engines.pieces.slice(0, shown.config.pieceKinds);
  const nextPreview = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("engines.next")}</span>
      <span className="next-pair" data-testid="hud-next">
        <PelletIcon color={pieces[shown.next.a]!.color} texture={pieces[shown.next.a]!.texture} mark={showMarks ? pieces[shown.next.a]!.mark : null} size={26} />
        <PelletIcon color={pieces[shown.next.b]!.color} texture={pieces[shown.next.b]!.texture} mark={showMarks ? pieces[shown.next.b]!.mark : null} size={26} />
      </span>
    </div>
  );

  return (
    <PracticeShell
      puzzle="engines"
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={shown.config.maxMoves < ENGINES.config.maxMoves ? shown.config.maxMoves : undefined}
      combo={shown.combo}
      onStart={startRound(studio.start)}
      ready={studio.ready}
      splash={t("engines.go")}
      details={nextPreview}
      resultRows={
        <>
          <div>
            <dt>{t("engines.injectors")}</dt>
            <dd>{injectorsCleared}</dd>
          </div>
          <div>
            <dt>{t("engines.wipes")}</dt>
            <dd>{wipes}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {pieces.map((p) => (
              <li key={p.nameKey}>
                <PelletIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("engines.legend_injector")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      board={(interactive) => (
        <EnginesBoard
         
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
