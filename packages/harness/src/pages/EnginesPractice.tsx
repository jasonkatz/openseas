import { useState } from "react";
import { PelletIcon, EnginesBoard, content, t, useEnginesControls } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePracticePage } from "../practice/usePracticePage.js";
import { ENGINES } from "../puzzles.js";

const engines = content.puzzles.engines;

export function EnginesPractice() {
  const [injectorsCleared, setInjectorsCleared] = useState(0);
  const [wipes, setWipes] = useState(0);
  const page = usePracticePage(ENGINES, {
    onRoundStart: () => {
      setInjectorsCleared(0);
      setWipes(0);
    },
    onMove: (s) => {
      const n = s.lastMove?.rounds.reduce((sum, r) => sum + r.groups.filter((g) => g.cause === "injector").length, 0) ?? 0;
      if (n) setInjectorsCleared((c) => c + n);
      if (s.lastMove?.wipe) setWipes((c) => c + 1);
    },
  });
  const controls = useEnginesControls(page.api);
  const { shown, showMarks } = page;

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
      page={page}
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
        </>
      }
      board={(b) => <EnginesBoard {...b} {...controls} />}
    />
  );
}
