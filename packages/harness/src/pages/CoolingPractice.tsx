import { useState } from "react";
import { CoolingBoard, TileIcon, content, t, useCoolingControls } from "@openseas/boards";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { serverHeat, useSoloHeat } from "../practice/useSoloHeat.js";
import { usePracticePage } from "../practice/usePracticePage.js";
import { COOLING } from "../puzzles.js";

const cooling = content.puzzles.cooling;

export function CoolingPractice() {
  /** Rows vented down this round, counted on the client for the result card only. */
  const [vented, setVented] = useState(0);
  const page = usePracticePage(COOLING, {
    onRoundStart: () => setVented(0),
    onMove: (s, prev) => {
      if (prev.heatRow > s.heatRow) setVented((n) => n + prev.heatRow - s.heatRow);
    },
    inbound: serverHeat,
  });
  useSoloHeat(page.api);
  const controls = useCoolingControls(page.api);
  const { shown, playing, showMarks } = page;

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
      page={page}
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
        </>
      }
      board={(b) => <CoolingBoard {...b} report={shown.lastMove} {...controls} />}
    />
  );
}
