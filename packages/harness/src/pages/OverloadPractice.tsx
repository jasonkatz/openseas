import { useCallback } from "react";
import { advanceOverload, overloadStreakPercentAt, summarizeOverload, type OverloadConfig, type OverloadMove, type OverloadState } from "@openseas/engine";
import { OverloadBoard, content, t, useTicked } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { OVERLOAD } from "../prototypes/overload.js";

const overload = content.puzzles.overload;
const waitAt = (tick: number): OverloadMove => ({ type: "wait", tick });

/** Overload (prototype, ADR 0036): the practice frame round the shared board, with the bench beside it. Its taps come back on the engine's clock (ADR 0015). */
export function OverloadPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<OverloadState, OverloadMove, OverloadConfig>({
    puzzle: "overload",
    def: OVERLOAD.def,
    config: overload.config,
    roundSeconds: overload.roundSeconds,
    summarize: summarizeOverload,
  });
  const bench = useBench(OVERLOAD, api);
  const { state } = api;
  const roundCfg = api.round?.config ?? overload.config;
  const ticked = useTicked(api, { tickMs: roundCfg.tickMs, maxTick: roundCfg.maxTick, advance: advanceOverload, wait: waitAt });
  const shown = bench.reviewState ?? ticked.shown;
  const cfg = shown.config;

  const onTap = useCallback((cell: number): boolean => api.apply({ type: "tap", cell, tick: ticked.moveTick() }), [api, ticked]);

  return (
    <PracticeShell
      puzzle="overload"
      eyebrow={t("harness.prototype_eyebrow")}
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.moveCount}
      movesLabel={t("overload.moves")}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("overload.go")}
      howTo={
        <>
          <p className="how how-kbd">{t("overload.streak_note")}</p>
          <p className="how how-kbd">{t("overload.hint_note")}</p>
        </>
      }
      details={
        <>
          <div className="stat stat-wide">
            <span className="stat-label">{t("overload.taps")}</span>
            <span className="stat-value" data-testid="hud-taps">
              {t("overload.taps_label", { count: shown.taps, max: cfg.tapCap })}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("overload.streak_stat")}</span>
            <span className="stat-value" data-testid="hud-streak">
              {shown.combo > 0 ? t("overload.streak_value", { count: shown.combo, percent: overloadStreakPercentAt(cfg, shown.combo) }) : t("overload.streak_none")}
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="stat-label">{t("overload.best_chain")}</span>
            <span className="stat-value" data-testid="hud-best-chain">
              {shown.bestChain}
            </span>
          </div>
        </>
      }
      resultRows={
        <>
          <div>
            <dt>{t("overload.result_chains")}</dt>
            <dd>{state.chains}</dd>
          </div>
          <div>
            <dt>{t("overload.result_longest")}</dt>
            <dd>{state.bestChain}</dd>
          </div>
          <div>
            <dt>{t("overload.result_bursts")}</dt>
            <dd>{state.bursts}</dd>
          </div>
          <div>
            <dt>{t("overload.result_refunds")}</dt>
            <dd>{state.refunds}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {[0, 1, 2].map((charge) => (
              <li key={charge}>
                <CapacitorIcon charge={charge} marks={showMarks} />
                <span>{t(charge === 1 ? "overload.legend_charge" : "overload.legend_charges", { count: charge })}</span>
              </li>
            ))}
            <li>
              <CapacitorIcon charge={3} marks={showMarks} />
              <span>{t("overload.legend_full")}</span>
            </li>
          </ul>
          <ul className="specials">
            <li>
              <CapacitorIcon charge={2} booster marks={showMarks} />
              <span>{t("overload.legend_booster")}</span>
            </li>
          </ul>
          <p className="muted small proto-note">{t("overload.legend_ring")}</p>
          <p className="muted small proto-note">{t("overload.streak_note")}</p>
          <p className="muted small proto-note">{t("overload.refund_note")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <OverloadBoard key={bench.reviewKey ?? "live"} state={shown} interactive={interactive} showMarks={showMarks} hints={bench.hints} onTap={onTap} onFrame={api.markRendered} />
      )}
    />
  );
}

const CHARGE_COLORS = ["#4a5f86", "#58c4f6", "#f5d021", "#ff6b5e"];

/** A capacitor as the board draws it: a ring cut in three with one part lit for each charge, a bolt at three, a second ring and lugs on a booster. */
function CapacitorIcon({ charge, booster = false, marks }: { charge: number; booster?: boolean; marks: boolean }) {
  const color = CHARGE_COLORS[charge]!;
  const armed = charge >= 3;
  const r = booster ? 8 : 9.5;
  const rr = r * 0.7;
  const arcs = [0, 1, 2].map((i) => {
    const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3 + 0.24;
    const a1 = a0 + (Math.PI * 2) / 3 - 0.48;
    const p = (a: number): string => `${(12 + Math.cos(a) * rr).toFixed(2)} ${(12 + Math.sin(a) * rr).toFixed(2)}`;
    return <path key={i} d={`M${p(a0)} A${rr} ${rr} 0 0 1 ${p(a1)}`} fill="none" stroke={i < charge ? color : "#2a3d60"} strokeWidth={r * 0.2} strokeLinecap="round" />;
  });
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="kind-icon">
      {booster && (
        <>
          <path d="M12 0.6l2.2 3.2h-4.4zM12 23.4l2.2-3.2h-4.4zM0.6 12l3.2-2.2v4.4zM23.4 12l-3.2-2.2v4.4z" fill="#d4a548" />
          <circle cx="12" cy="12" r={r * 1.12} fill="none" stroke="#d4a548" strokeWidth="0.9" />
        </>
      )}
      <circle cx="12" cy="12" r={r} fill="#1a2942" stroke={booster ? "#aa843a" : "#4d6b9c"} strokeWidth="1" />
      {arcs}
      <circle cx="12" cy="12" r={r * 0.42} fill={armed ? color : "#101928"} />
      {!armed && charge > 0 && !marks && <circle cx="12" cy="12" r={r * 0.42 * 0.3 * charge} fill={color} />}
      {marks ? (
        <text x="12" y="14.6" textAnchor="middle" fontSize="7" fontWeight="700" fill={armed ? "#000" : "#fff"}>
          {charge}
        </text>
      ) : (
        armed && <path d="M12.6 8.9l-2.4 3.6h1.7l-0.5 2.6 2.4-3.6h-1.7z" fill="#33150f" />
      )}
    </svg>
  );
}
