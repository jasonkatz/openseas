import { useCallback } from "react";
import {
  advanceSwordfight,
  summarizeSwordfight,
  swordfightColHeight,
  swordfightPlaceIllegalReason,
  swordfightStanding,
  type SwordRotation,
  type SwordfightConfig,
  type SwordfightEvent,
  type SwordfightMove,
  type SwordfightState,
} from "@openseas/engine";
import { BlockIcon, SwordfightBoard, content, sfx, t, useTicked, type SwordfightPlaceAnswer } from "@openseas/boards";
import { useBench } from "../bench/useBench.jsx";
import { MarksToggle, PracticeShell, useShowMarks } from "../practice/PracticeShell.jsx";
import { usePractice } from "../practice/usePractice.js";
import { SWORDFIGHT } from "../puzzles.js";

const swordfight = content.puzzles.swordfight;
const waitAt = (tick: number): SwordfightMove => ({ type: "wait", tick });

/** The practice fight: the player's board against brigands from content, every drop on the fight's clock. */
export function SwordfightPractice() {
  const [showMarks, setShowMarks] = useShowMarks();
  const api = usePractice<SwordfightState, SwordfightMove, SwordfightConfig>({
    puzzle: "swordfight",
    def: SWORDFIGHT.def,
    config: swordfight.config,
    roundSeconds: swordfight.roundSeconds,
    summarize: summarizeSwordfight,
  });
  const bench = useBench(SWORDFIGHT, api);
  const { state } = api;
  const cfg = api.round?.config ?? swordfight.config;
  const ticked = useTicked(api, { tickMs: cfg.tickMs, maxTick: cfg.maxTick, advance: advanceSwordfight, wait: waitAt, waitEveryTicks: 5 });
  const shown = bench.reviewState ?? ticked.shown;
  const playing = api.phase === "playing";

  const onPlace = useCallback(
    (col: number, rot: SwordRotation): SwordfightPlaceAnswer => {
      const tick = ticked.moveTick();
      if (api.apply({ type: "place", col, rot, tick })) return "placed";
      const r = api.current();
      return r && swordfightPlaceIllegalReason(r.state, col, rot, tick) === "too soon" ? "wait" : "refused";
    },
    [api, ticked],
  );
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onEvents = useCallback((events: readonly SwordfightEvent[]) => {
    for (const e of events) {
      const mine = e.board === 0;
      switch (e.type) {
        case "placed":
          if (mine) sfx.swapQuiet();
          break;
        case "fused":
          if (mine) sfx.barnacle();
          break;
        case "broke":
          if (mine) {
            sfx.clear(e.chain, e.groups.reduce((n, g) => n + g.cells.length, 0));
            if (e.groups.length >= 2) sfx.multi(e.groups.length);
          } else sfx.swapQuiet();
          break;
        case "ripened":
          if (mine) sfx.pump(1);
          break;
        case "attack":
          if (mine && e.wrack > 0) sfx.streak(Math.min(12, e.wrack));
          else if (e.to === 0) sfx.alarm();
          break;
        case "landed":
          if (mine) sfx.crack(true);
          break;
        case "out":
          if (mine) {
            sfx.alarm();
            sfx.streakLost();
          } else sfx.keg();
          break;
        case "ended":
          if (e.outcome === "won") sfx.streak(16);
          else sfx.streakLost();
          break;
        default:
          break;
      }
    }
  }, []);

  const player = shown.boards[0]!;
  const pieces = swordfight.pieces.slice(0, shown.config.colors);
  const piece = (p: { color: number; breaker: boolean }, size = 26) => {
    const st = swordfight.pieces[p.color]!;
    return <BlockIcon color={st.color} texture={st.texture} mark={showMarks ? st.mark : null} kind={p.breaker ? "breaker" : "block"} size={size} />;
  };
  const pending = player.pending.reduce((n, p) => n + p.wrack, 0);
  const yoursStanding = swordfightStanding(shown, 0);
  const theirsStanding = swordfightStanding(shown, 1);
  const top = Math.max(...Array.from({ length: shown.config.width }, (_, c) => swordfightColHeight(shown.config, player.cells, c)));
  const foe = shown.config.foes[0] ?? null;
  const bladeName = (i: number): string => t(`swordfight.blade.${shown.config.blades[i]?.id ?? "cutlass"}`);

  const details = (
    <>
      <div className="stat stat-wide">
        <span className="stat-label">{t("swordfight.next")}</span>
        {/* Upright, as it will fall: b above a. */}
        <span className="next-pair next-pair-upright" data-testid="hud-next">
          {piece(player.next.b)}
          {piece(player.next.a)}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("swordfight.incoming")}</span>
        <span className="stat-value" data-testid="hud-incoming">
          {pending}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("swordfight.sent")}</span>
        <span className="stat-value" data-testid="hud-sent">
          {player.sent}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("swordfight.standing")}</span>
        <span className="stat-value" data-testid="hud-standing">
          {t("swordfight.standing_value", { yours: yoursStanding, theirs: theirsStanding })}
        </span>
      </div>
    </>
  );

  return (
    <PracticeShell
      puzzle="swordfight"
      phase={api.phase}
      outcome={api.outcome}
      best={api.best}
      roundSeconds={api.roundSeconds}
      timeLeft={api.timeLeft}
      score={shown.score}
      moves={player.drops}
      movesLabel={t("swordfight.drops")}
      combo={player.bestChain}
      canRate={api.canRate}
      onStartRated={api.startRated}
      onStartUnrated={api.startUnrated}
      onStartLab={bench.startLab}
      labReady={bench.labReady}
      labSummary={bench.labSummary}
      splash={t("swordfight.go")}
      warn={playing && (top >= shown.config.height - 3 || pending >= shown.config.width * 2)}
      howTo={
        <>
          {foe && (
            <p className="how">
              <b>{t("swordfight.practice_foe")}:</b>{" "}
              {t("swordfight.foe_line", { seconds: Math.round((foe.thinkTicks * shown.config.tickMs) / 100) / 10, skill: foe.skill, blade: bladeName(foe.blade) })}
            </p>
          )}
          <p className="how">
            <b>{t("swordfight.your_blade")}:</b> {bladeName(shown.config.blade)}
          </p>
          <p className="how how-kbd">{t("swordfight.how_to_keyboard")}</p>
        </>
      }
      details={details}
      resultRows={
        <>
          <div>
            <dt>{t("swordfight.result_outcome")}</dt>
            <dd data-testid="result-outcome">{state.outcome ? t(`swordfight.outcome.${state.outcome}`) : t("swordfight.outcome.undecided")}</dd>
          </div>
          <div>
            <dt>{t("swordfight.result_sent")}</dt>
            <dd>{state.boards[0]!.sent}</dd>
          </div>
          <div>
            <dt>{t("swordfight.result_chain")}</dt>
            <dd>{state.boards[0]!.bestChain}</dd>
          </div>
          <div>
            <dt>{t("swordfight.result_drops")}</dt>
            <dd>{state.boards[0]!.drops}</dd>
          </div>
        </>
      }
      legend={
        <>
          <ul className="kinds">
            {pieces.map((p) => (
              <li key={p.nameKey}>
                <BlockIcon color={p.color} texture={p.texture} mark={showMarks ? p.mark : null} />
                <span>{t(p.nameKey)}</span>
              </li>
            ))}
            <li>
              <BlockIcon color={pieces[0]!.color} texture={pieces[0]!.texture} mark={showMarks ? pieces[0]!.mark : null} kind="breaker" />
              <span>{t("swordfight.legend_breaker")}</span>
            </li>
            <li>
              <span className="stages">
                {[2, 1].map((ripen) => (
                  <BlockIcon key={ripen} color={pieces[0]!.color} texture={pieces[0]!.texture} mark={showMarks ? pieces[0]!.mark : null} kind="wrack" ripen={ripen} />
                ))}
              </span>
              <span>{t("swordfight.legend_wrack")}</span>
            </li>
          </ul>
          <p className="muted small legend-note">{t("swordfight.legend_slab")}</p>
          <p className="muted small legend-note">{t("swordfight.legend_blades")}</p>
          <MarksToggle showMarks={showMarks} onChange={setShowMarks} />
        </>
      }
      bench={bench.bench}
      reviewBar={bench.reviewBar}
      board={(interactive) => (
        <SwordfightBoard key={bench.reviewKey ?? "live"} state={shown} interactive={interactive} showMarks={showMarks} onPlace={onPlace} onFrame={api.markRendered} onEvents={onEvents} onNudge={onNudge} />
      )}
    />
  );
}
