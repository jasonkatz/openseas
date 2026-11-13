import { useCallback } from "react";
import { racksCrateFits, racksCrateWouldShip, racksNextShipment, summarizeRacks, type RacksConfig, type RacksMove, type RacksState } from "@openseas/engine";
import { content, KindIcon, KINDS, RacksBoard, spriteName, t } from "@openseas/boards";
import { useStudio } from "../studio/useStudio.js";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { RACKS } from "../prototypes/racks.js";

const racks = content.puzzles.racks;

/** Racks (prototype, ADR 0036): the shared board in the studio's frame. */
export function RacksPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<RacksState, RacksMove, RacksConfig>({
    puzzle: "racks",
    def: RACKS.def,
    config: racks.config,
    roundSeconds: racks.roundSeconds,
    summarize: summarizeRacks,
  });
  const studio = useStudio(RACKS, api);
  const { state } = api;
  const shown = state;
  const cfg = shown.config;

  const onMove = useCallback((from: number, to: number) => void api.apply({ type: "move", from, to }), [api]);
  const onCall = useCallback(() => void api.apply({ type: "call" }), [api]);

  const fits = racksCrateFits(shown);
  const next = racksNextShipment(shown);
  const moves = shown.crate.lands;
  const kinds = KINDS.slice(0, cfg.kinds);

  return (
    <PracticeShell
      puzzle="racks"
      eyebrow={t("harness.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("racks.moves")}
      // The move bound only keeps the log sane; the clock ends a round. A lab's tighter cap is shown.
      maxMoves={cfg.maxMoves < RACKS.config.maxMoves ? cfg.maxMoves : undefined}
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
                <KindIcon kind={i} marks={showMarks} sprite={{ puzzle: "racks", name: spriteName("cell", i) }} />
                <span>{t(`racks.kind.${k.id}`)}</span>
              </li>
            ))}
          </ul>
          <ul className="specials">
            <li>
              <CrateIcon />
              <span>{t("racks.legend_crate")}</span>
            </li>
            <li>
              <CrateIcon tight />
              <span>{t("racks.legend_no_room")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("racks.legend_ghost")}</p>
          <p className="muted small proto-note">{t("racks.chain_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      board={(interactive) => (
        <RacksBoard state={shown} version={api.version} interactive={interactive} showMarks={showMarks} hints={studio.hints} onMove={onMove} onCall={onCall} onFrame={api.markRendered} />
      )}
    />
  );
}

/** The crate on its trolley, as the board draws it: brass, or red when it has no room. */
function CrateIcon({ tight = false }: { tight?: boolean }) {
  const trolley = tight ? "#f0604d" : "#d4a548";
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      <rect x="2" y="3.5" width="20" height="2" rx="1" fill="#8a6b2f" />
      <rect x="7" y="1.5" width="10" height="6" rx="2" fill={trolley} stroke="#53361b" strokeWidth="1" />
      <path d="M9 7.5v3M15 7.5v3" stroke="#8a5e33" strokeWidth="1.2" />
      <rect x="6" y="10.5" width="12" height="12" rx="2" fill="#3a2a1a" stroke="#c98a4b" strokeWidth="1.6" />
      <path d="M7 16.5h10" stroke="#c98a4b" strokeOpacity="0.5" />
    </svg>
  );
}
