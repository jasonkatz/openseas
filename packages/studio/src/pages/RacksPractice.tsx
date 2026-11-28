import { useCallback } from "react";
import { racksCrateFits, racksCrateWouldShip, racksNextShipment, summarizeRacks, type RacksConfig, type RacksMove, type RacksState } from "@openseas/engine";
import { content, RACKS_KINDS, RacksBoard, RacksCellIcon, RacksCrateIcon, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { PracticeShell } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { RACKS } from "../prototypes/racks.js";
import type { StudioPuzzle } from "../puzzles.js";

const racks = content.puzzles.racks;

/** Racks (prototype, ADR 0036): the shared board in the studio's frame. `entry` is the puzzle this page plays: the prototype, or the same puzzle on another engine (ADR 0097, ADR 0099). */
export function RacksPractice({ entry = RACKS }: { entry?: StudioPuzzle<RacksState, RacksMove, RacksConfig> } = {}) {
  const api = usePractice<RacksState, RacksMove, RacksConfig>({
    puzzle: "racks",
    def: entry.def,
    config: racks.config,
    roundSeconds: racks.roundSeconds,
    summarize: summarizeRacks,
  });
  const studio = useStudio(entry, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onMove = useCallback((from: number, to: number) => void api.apply({ type: "move", from, to }), [api]);
  const onCall = useCallback(() => void api.apply({ type: "call" }), [api]);

  const fits = racksCrateFits(shown);
  const next = racksNextShipment(shown);
  const moves = shown.crate.lands;
  const kinds = RACKS_KINDS.slice(0, cfg.kinds);

  return (
    <PracticeShell
      puzzle="racks"
      eyebrow={entry === RACKS ? t("studio.prototype_eyebrow") : t("rungs.eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("racks.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < entry.config.maxMoves ? cfg.maxMoves : undefined}
      combo={shown.combo}
      warn={api.phase === "playing" && !fits}
      onStart={studio.start}
      ready={studio.ready}
      splash={t("racks.go")}
      howTo={
        <>
          <p className="how">{t("racks.chain_note")}</p>
          <p className="how how-kbd">{t("racks.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("racks.crate_stat")}</span>
            <span className={`stat-value ${fits ? "" : "urgent"}`} data-testid="hud-crate">
              {t(!fits ? "racks.crate_no_room" : racksCrateWouldShip(shown) ? "racks.crate_will_ship" : "racks.crate_lands", { moves })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("racks.chain_stat")}</span>
            <span className="stat-value" data-testid="hud-chain">
              {shown.combo > 0 ? t("racks.chain_value", { count: next.chain, points: next.points }) : t("racks.chain_none")}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">{t("racks.shipped_stat")}</span>
            <span className="stat-value" data-testid="hud-shipped">
              {shown.shipped}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("racks.result_shipped")}</dt>
            <dd>{state.shipped}</dd>
          </div>
          <div>
            <dt>{t("racks.result_chain")}</dt>
            <dd>{state.bestCombo}</dd>
          </div>
          <div>
            <dt>{t("racks.result_by_crate")}</dt>
            <dd>{state.shippedByCrate}</dd>
          </div>
          <div>
            <dt>{t("racks.result_calls")}</dt>
            <dd>{state.calls}</dd>
          </div>
          <div>
            <dt>{t("racks.result_spills")}</dt>
            <dd>{state.spills}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {kinds.map((k, i) => (
              <li key={k.id}>
                <RacksCellIcon kind={i} />
                <span>{t(`racks.kind.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <RacksCrateIcon />
              <span>{t("racks.legend_crate")}</span>
            </li>
            <li>
              <RacksCrateIcon tight />
              <span>{t("racks.legend_no_room")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("racks.legend_ghost")}</p>
          <p className="muted small proto-note">{t("racks.chain_note")}</p>
        </>
      }
      board={(interactive) => (
        <RacksBoard state={shown} version={api.version} interactive={interactive} hints={studio.hints} onMove={onMove} onCall={onCall} onFrame={api.markRendered} />
      )}
    />
  );
}
