import { useCallback, useEffect, useRef, useState } from "react";
import { BATTLE_PERMILLE, summarizeBattle, type BattleConfig, type BattleMove, type BattleState } from "@openseas/engine";
import { BattleBoard, content, t, useBattleControls } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { BATTLE } from "../puzzles.js";

const battle = content.puzzles.battle;
const ARCS_KEY = "openseas.battle.arcs";

function readArcsFlag(): boolean {
  try {
    return window.localStorage.getItem(ARCS_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The captain's practice fight: a raider from content, and a turn clock that flies the plot. */
export function BattlePractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const [showArcs, setShowArcsState] = useState(readArcsFlag);
  const setShowArcs = (on: boolean): void => {
    setShowArcsState(on);
    try {
      window.localStorage.setItem(ARCS_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const api = usePractice<BattleState, BattleMove, BattleConfig>({
    puzzle: "battle",
    def: BATTLE.def,
    config: battle.config,
    roundSeconds: battle.roundSeconds,
    summarize: summarizeBattle,
  });
  const bench = useBench(BATTLE, api);
  const controls = useBattleControls(api);
  const { state } = api;
  const cfg = api.round?.config ?? battle.config;
  const shown = bench.reviewState ?? state;
  const playing = api.phase === "playing";

  // The turn clock: the plot flies when it runs out, as it does aboard. It reads the round's own
  // clock, so a lab round's slowed or paused clock holds the turn too.
  const turnMs = cfg.turnSeconds * 1000;
  const turnEndsAt = useRef<number | null>(null);
  const [turnLeftMs, setTurnLeftMs] = useState<number | null>(null);
  const [commitSignal, setCommitSignal] = useState(0);
  const now = useCallback((): number => api.current()?.now() ?? Date.now(), [api]);
  useEffect(() => {
    if (!playing || state.finished) {
      turnEndsAt.current = null;
      setTurnLeftMs(null);
      return;
    }
    turnEndsAt.current = now() + turnMs;
    setTurnLeftMs(turnMs);
  }, [playing, state.turn, state.finished, turnMs, now]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const ends = turnEndsAt.current;
      if (ends === null) return;
      const left = ends - now();
      setTurnLeftMs(Math.max(0, left));
      if (left <= 0) {
        // Give the engine a beat to take the plot; if it is refused the renderer flies holds instead.
        turnEndsAt.current = now() + turnMs;
        setCommitSignal((n) => n + 1);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, now, turnMs]);

  const me = shown.ships[0];
  const them = shown.ships[1];
  const hull = (d: number): number => Math.round(((BATTLE_PERMILLE - d) * 100) / BATTLE_PERMILLE);
  const b = shown.config.raider;
  const details = (
    <>
      <div className="stat stat-wide">
        <span className="stat-label">{t("battle.your_hull")}</span>
        <span className="heat-row">
          <span className="heat-meter progress-meter" aria-label={`${hull(me.damage)}%`}>
            <i style={{ width: `${hull(me.damage)}%` }} />
          </span>
          <small className="muted" data-testid="hud-hull">
            {hull(me.damage)}%
          </small>
        </span>
      </div>
      <div className="stat stat-wide">
        <span className="stat-label">{t("battle.their_hull")}</span>
        <span className="heat-row">
          <span className="heat-meter progress-meter" aria-label={`${hull(them.damage)}%`}>
            <i style={{ width: `${hull(them.damage)}%` }} />
          </span>
          <small className="muted" data-testid="hud-their-hull">
            {hull(them.damage)}%
          </small>
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("battle.turrets")}</span>
        <span className="stat-value" data-testid="hud-loaded">
          {t("battle.turrets_value", { loaded: me.loaded, total: me.turrets })}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("battle.tokens")}</span>
        <span className="stat-value" data-testid="hud-tokens">
          {me.tokens.left}·{me.tokens.forward}·{me.tokens.right}
        </span>
      </div>
    </>
  );

  return (
    <PracticeShell
      puzzle="battle"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={shown.turn}
      maxMoves={shown.config.maxTurns}
      movesLabel={t("battle.turns")}
      combo={shown.combo}
      canRecord={api.canRecord}
      onStartRecorded={api.startRecorded}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("battle.go")}
      warn={playing && me.damage >= shown.config.grappleDamage}
      howTo={
        <>
          <p className="how">
            <b>{t("battle.practice_raider")}:</b> {t("battle.tier_line", { tokens: b.tokensPerTurn, reload: b.reloadPerTurn, accuracy: b.accuracy, aggression: b.aggression })}
          </p>
          <p className="how how-kbd">{t("battle.how_to_keyboard")}</p>
        </>
      }
      details={details}
      resultRows={
        <>
          <div>
            <dt>{t("battle.result_outcome")}</dt>
            <dd data-testid="result-outcome">{state.outcome ? t(`battle.outcome.${state.outcome}`) : t("battle.outcome.timed_out")}</dd>
          </div>
          <div>
            <dt>{t("battle.result_hits")}</dt>
            <dd>{state.hits}</dd>
          </div>
          <div>
            <dt>{t("battle.result_hits_taken")}</dt>
            <dd>{state.hitsTaken}</dd>
          </div>
          <div>
            <dt>{t("battle.result_turns")}</dt>
            <dd>{state.turn}</dd>
          </div>
        </>
      }
      legend={
        <>
          <p className="muted small legend-note">{t("battle.legend_ships")}</p>
          <p className="muted small legend-note">{t("battle.legend_current")}</p>
          <p className="muted small legend-note">{t("battle.legend_well")}</p>
          <p className="muted small legend-note">{t("battle.legend_asteroid")}</p>
          <p className="muted small legend-note">{t("battle.legend_arc")}</p>
          <p className="muted small legend-note">{t("battle.legend_grapple")}</p>
          <label className="toggle">
            <input type="checkbox" checked={showArcs} onChange={(e) => setShowArcs(e.target.checked)} data-testid="toggle-arcs" />
            <span>
              {t("battle.setting_arcs")} <small className="muted">{t("battle.setting_arcs_hint")}</small>
            </span>
          </label>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <BattleBoard
          key={bench.reviewKey ?? "live"}
          state={shown}
          interactive={interactive}
          showMarks={showMarks}
          showArcs={showArcs}
          turnLeftMs={playing ? turnLeftMs : null}
          turnMs={turnMs}
          commitSignal={commitSignal}
          raiderName={t("battle.raider")}
          {...controls}
        />
      )}
    />
  );
}
