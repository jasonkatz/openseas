import { useCallback, useRef, useState } from "react";
import { SAILING_DEF, summarizeSailing, type Rotation, type SailingClearRound, type SailingMove, type SailingState } from "@openseas/engine";
import { sfx } from "../audio.js";
import { content, t } from "../content.js";
import { MarksToggle, PracticeShell, useShowMarks } from "../puzzles/PracticeShell.jsx";
import { TileIcon } from "../puzzles/TileIcon.jsx";
import { usePractice } from "../puzzles/usePractice.js";
import { SailingBoard } from "../sailing/SailingBoard.jsx";

const sailing = content.puzzles.sailing;

export function SailingPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const [platformsCleared, setPlatformsCleared] = useState(0);
  const cleared = useRef(0);

  const onMove = useCallback((s: SailingState, prev: SailingState) => {
    if (prev.moveCount === 0 && s.moveCount <= 1) cleared.current = 0;
    const n = s.lastMove?.rounds.reduce((sum, r) => sum + r.groups.filter((g) => g.cause === "platform").length, 0) ?? 0;
    if (n) {
      cleared.current += n;
      setPlatformsCleared(cleared.current);
    }
  }, []);

  const api = usePractice<SailingState, SailingMove, typeof sailing.config>({
    puzzle: "sailing",
    def: SAILING_DEF,
    config: sailing.config,
    roundSeconds: sailing.roundSeconds,
    summarize: summarizeSailing,
    onMove,
  });
  const { state } = api;

  const onPlace = useCallback(
    (col: number, rot: Rotation) => {
      api.apply({ type: "place", col, rot });
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

  const startRound = (start: () => void) => () => {
    cleared.current = 0;
    setPlatformsCleared(0);
    start();
  };

  const pieces = sailing.pieces.slice(0, sailing.config.pieceKinds);
  const nextPreview = (
    <div className="stat stat-wide">
      <span className="stat-label">{t("sailing.next")}</span>
      <span className="next-pair" data-testid="hud-next">
        <TileIcon color={pieces[state.next.a]!.color} texture={pieces[state.next.a]!.texture} mark={showMarks ? pieces[state.next.a]!.mark : null} size={26} />
        <TileIcon color={pieces[state.next.b]!.color} texture={pieces[state.next.b]!.texture} mark={showMarks ? pieces[state.next.b]!.mark : null} size={26} />
      </span>
    </div>
  );

  return (
    <PracticeShell
      puzzle="sailing"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={sailing.roundSeconds}
      timeLeft={api.timeLeft}
      score={state.score}
      moves={state.moveCount}
      maxMoves={sailing.config.maxMoves}
      combo={state.combo}
      canRate={api.canRate}
      onStartRated={startRound(api.startRated)}
      onStartUnrated={startRound(api.startUnrated)}
      splash={t("sailing.go")}
      details={nextPreview}
      resultRows={
        <div>
          <dt>{t("sailing.platforms")}</dt>
          <dd>{platformsCleared}</dd>
        </div>
      }
      legend={
        <>
          <ul className="kinds">
            {pieces.map((p) => (
              <li key={p.nameKey}>
                <TileIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small legend-note">{t("sailing.legend_platform")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      board={(interactive) => (
        <SailingBoard
          state={state}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          onPlace={onPlace}
          onFrame={api.markRendered}
          onClear={onClear}
          onLanded={onLanded}
          onNudge={onNudge}
        />
      )}
    />
  );
}
