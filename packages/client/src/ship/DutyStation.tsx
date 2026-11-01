import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  BILGING_DEF,
  CARPENTRY_DEF,
  GUNNERY_DEF,
  NAVIGATION_DEF,
  SAILING_DEF,
  advanceGunnery,
  advanceNavigation,
  previewSwap,
  summarizeBilging,
  summarizeCarpentry,
  summarizeGunnery,
  summarizeNavigation,
  summarizeSailing,
  type BilgingMove,
  type BilgingState,
  type CarpentryMove,
  type CarpentryState,
  type ClearRound,
  type Dir,
  type GunneryConfig,
  type GunneryEvent,
  type GunneryMove,
  type GunneryState,
  type HoleRating,
  type NavigationConfig,
  type NavigationEvent,
  type NavigationMove,
  type NavigationState,
  type PuzzleId,
  type Rotation,
  type SailingClearRound,
  type SailingMove,
  type SailingState,
} from "@openseas/engine";
import { sfx } from "../audio.js";
import { BilgingBoard } from "../bilging/BilgingBoard.jsx";
import type { MoveShown } from "../bilging/renderer.js";
import { CarpentryBoard } from "../carpentry/CarpentryBoard.jsx";
import { content, t } from "../content.js";
import { GunneryBoard } from "../gunnery/GunneryBoard.jsx";
import { NavigationBoard } from "../navigation/NavigationBoard.jsx";
import { useShowMarks, useTally } from "../puzzles/PracticeShell.jsx";
import { usePractice, type PracticeApi } from "../puzzles/usePractice.js";
import { useTicked } from "../puzzles/useTicked.js";
import { SailingBoard } from "../sailing/SailingBoard.jsx";

export interface DutyProps {
  shipId: string;
  /** This station's output last turn, percent of par, or null before the first turn. */
  lastOutput: number | null;
}

const RESTART_MS = 1600;

interface FrameProps {
  station: PuzzleId;
  api: Pick<PracticeApi<unknown, unknown>, "phase" | "timeLeft" | "outcome" | "startRated" | "canRate">;
  score: number;
  combo: number;
  roundSeconds: number;
  lastOutput: number | null;
  board(interactive: boolean): ReactNode;
}

/**
 * The frame around a duty board: a thin strip of numbers, the board, and the board's own life
 * cycle. Boards are dealt as soon as the pirate is at the station and again after each one ends,
 * so a station at sea is always busy, as in the original.
 */
function DutyFrame(p: FrameProps) {
  const { phase, startRated, canRate } = p.api;
  const playing = phase === "playing";
  const score = useTally(p.score);
  const timeLeft = p.api.timeLeft;
  const lowTime = playing && timeLeft <= 10;
  const start = useRef(startRated);
  start.current = startRated;

  useEffect(() => {
    if (phase === "idle" && canRate) start.current();
  }, [phase, canRate]);

  useEffect(() => {
    if (phase !== "result" || !canRate) return;
    const id = window.setTimeout(() => start.current(), RESTART_MS);
    return () => window.clearTimeout(id);
  }, [phase, canRate]);

  const outcome = p.api.outcome;
  return (
    <section className="duty" data-testid={`duty-${p.station}`}>
      <div className="hud-strip duty-strip" aria-live="off">
        <div className="stat stat-score">
          <span className="stat-label">{t("ship.duty_score")}</span>
          <span className="stat-value" data-testid="duty-score">
            <span key={p.score} className={p.score ? "bump" : undefined}>
              {score}
            </span>
            {p.combo > 1 && (
              <b className={`combo-chip ${p.combo >= 6 ? "hot" : ""}`} key={p.combo}>
                ×{p.combo}
              </b>
            )}
          </span>
        </div>
        <div className={`stat ${lowTime ? "stat-urgent" : ""}`}>
          <span className="stat-label">{t("ship.duty_board")}</span>
          <span className={`stat-value ${lowTime ? "urgent" : ""}`}>{fmt(playing ? timeLeft : p.roundSeconds)}</span>
          <span className="bar" aria-hidden="true">
            <i style={{ width: `${((playing ? timeLeft : p.roundSeconds) / p.roundSeconds) * 100}%` }} />
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("ship.duty_output")}</span>
          <span className="stat-value" data-testid="duty-output">
            {p.lastOutput === null ? "–" : `${p.lastOutput}%`}
          </span>
        </div>
      </div>
      <div className={`board-wrap ${lowTime ? "low-time" : ""} ${playing ? "is-playing" : ""}`}>
        {p.board(playing)}
        {!playing && (
          <div className="board-veil">
            {(phase === "idle" || phase === "starting") && (
              <p className="status">
                <span className="spinner" aria-hidden="true" />
                {canRate ? t("ship.duty_dealing") : t("app.offline")}
              </p>
            )}
            {phase === "waiting" && (
              <p className="status">
                <span className="spinner" aria-hidden="true" />
                {t("practice.waiting_result")}
              </p>
            )}
            {phase === "result" && outcome && (
              <div className="veil-card veil-card-slim" data-testid="duty-result">
                <p className="eyebrow">{t("ship.duty_board_done")}</p>
                {outcome.kind === "rejected" ? (
                  <p className="error">{t("practice.result_rejected", { reason: t(`practice.reject.${outcome.reason}`) })}</p>
                ) : (
                  <>
                    <p className="result-score">{outcome.kind === "rated" ? outcome.result.score : outcome.score}</p>
                    {outcome.kind === "rated" && outcome.result.rating && outcome.result.tierChange && (
                      <p className={`tier-line tier-${outcome.result.tierChange}`}>
                        {t(`practice.tier_${outcome.result.tierChange}`, { tier: t(`tier.${outcome.result.rating.tier}`) })}
                      </p>
                    )}
                    {outcome.kind === "rated" && !outcome.result.rating && <p className="muted small">{t("ship.duty_unrated")}</p>}
                  </>
                )}
                <p className="muted small">{t("ship.duty_next_board")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---- one adapter per station: the board and its sounds, as on the practice page

const bilging = content.puzzles.bilging;
function BilgingDuty({ shipId, lastOutput }: DutyProps) {
  const [showMarks] = useShowMarks();
  const api = usePractice<BilgingState, BilgingMove, typeof bilging.config>({
    puzzle: "bilging",
    def: BILGING_DEF,
    config: bilging.config,
    roundSeconds: bilging.roundSeconds,
    summarize: summarizeBilging,
    duty: { shipId, station: "bilging" },
  });
  const { state } = api;
  const onSwap = useCallback(
    (col: number, row: number) => {
      const ok = api.apply({ type: "swap", col, row });
      if (ok) sfx.swap();
    },
    [api],
  );
  const preview = useCallback(
    (col: number, row: number): readonly number[] => {
      const r = api.current();
      if (!r || r.isFinished || !api.canApply({ type: "swap", col, row })) return [];
      return previewSwap(r.state, col, row).cells;
    },
    [api],
  );
  const onClear = useCallback((r: ClearRound) => {
    const causes = new Set(r.groups.map((g) => g.cause));
    if (causes.has("keg")) sfx.keg();
    if (causes.has("ink")) sfx.ink();
    if (causes.has("barnacle")) sfx.barnacle();
    if (causes.has("match")) sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
  }, []);
  const onMoveShown = useCallback((m: MoveShown) => {
    if (m.milestone) sfx.streak(m.milestone);
    else if (m.lostCombo >= 3) sfx.streakLost();
    if (m.waterRows < 0) sfx.pump(-m.waterRows);
  }, []);
  const noHint = useCallback(() => null, []);
  return (
    <DutyFrame
      station="bilging"
      api={api}
      score={state.score}
      combo={state.combo}
      roundSeconds={bilging.roundSeconds}
      lastOutput={lastOutput}
      board={(interactive) => (
        <BilgingBoard
          state={state}
          report={state.lastMove}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          onSwap={onSwap}
          preview={preview}
          onFrame={api.markRendered}
          onClear={onClear}
          onMoveShown={onMoveShown}
          hints={false}
          findHint={noHint}
        />
      )}
    />
  );
}

const sailing = content.puzzles.sailing;
function SailingDuty({ shipId, lastOutput }: DutyProps) {
  const [showMarks] = useShowMarks();
  const api = usePractice<SailingState, SailingMove, typeof sailing.config>({
    puzzle: "sailing",
    def: SAILING_DEF,
    config: sailing.config,
    roundSeconds: sailing.roundSeconds,
    summarize: summarizeSailing,
    duty: { shipId, station: "sailing" },
  });
  const { state } = api;
  const onPlace = useCallback((col: number, row: number, rot: Rotation) => void api.apply({ type: "place", col, row, rot }), [api]);
  const onClear = useCallback((r: SailingClearRound) => {
    sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
    if (r.groups.some((g) => g.cause === "platform")) sfx.barnacle();
  }, []);
  const onLanded = useCallback(() => sfx.swapQuiet(), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onWipe = useCallback(() => sfx.alarm(), []);
  return (
    <DutyFrame
      station="sailing"
      api={api}
      score={state.score}
      combo={state.combo}
      roundSeconds={sailing.roundSeconds}
      lastOutput={lastOutput}
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
          onWipe={onWipe}
        />
      )}
    />
  );
}

const carpentry = content.puzzles.carpentry;
function CarpentryDuty({ shipId, lastOutput }: DutyProps) {
  const [showMarks] = useShowMarks();
  const api = usePractice<CarpentryState, CarpentryMove, typeof carpentry.config>({
    puzzle: "carpentry",
    def: CARPENTRY_DEF,
    config: carpentry.config,
    roundSeconds: carpentry.roundSeconds,
    summarize: summarizeCarpentry,
    duty: { shipId, station: "carpentry" },
  });
  const { state } = api;
  const onPlace = useCallback(
    (slot: number, rot: number, flip: boolean, col: number, row: number) => void api.apply({ type: "place", slot, rot, flip, col, row }),
    [api],
  );
  const onPatched = useCallback((rating: HoleRating, chain: number) => {
    sfx.plankLift();
    if (rating === "masterpiece") sfx.clear(Math.min(6, chain), 6);
    else if (rating === "pig") sfx.streakLost();
    else sfx.clear(1, 3);
  }, []);
  const onNailed = useCallback((waste: boolean) => sfx.hammer(waste), []);
  const onGrew = useCallback(() => sfx.crack(true), []);
  const onCracked = useCallback((opening: boolean) => sfx.crack(!opening), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onBump = useCallback(() => sfx.bump(), []);
  return (
    <DutyFrame
      station="carpentry"
      api={api}
      score={state.score}
      combo={state.combo}
      roundSeconds={carpentry.roundSeconds}
      lastOutput={lastOutput}
      board={(interactive) => (
        <CarpentryBoard
          state={state}
          version={api.version}
          interactive={interactive}
          showMarks={showMarks}
          onPlace={onPlace}
          onFrame={api.markRendered}
          onPatched={onPatched}
          onNailed={onNailed}
          onGrew={onGrew}
          onCracked={onCracked}
          onNudge={onNudge}
          onBump={onBump}
        />
      )}
    />
  );
}

const gunnery = content.puzzles.gunnery;
const gunneryWait = (tick: number): GunneryMove => ({ type: "wait", tick });
function GunneryDuty({ shipId, lastOutput }: DutyProps) {
  const [showMarks] = useShowMarks();
  const api = usePractice<GunneryState, GunneryMove, GunneryConfig>({
    puzzle: "gunnery",
    def: GUNNERY_DEF,
    config: gunnery.config,
    roundSeconds: gunnery.roundSeconds,
    summarize: summarizeGunnery,
    duty: { shipId, station: "gunnery" },
  });
  const { shown, moveTick } = useTicked(api, {
    tickMs: gunnery.config.tickMs,
    maxTick: gunnery.config.maxTick,
    roundSeconds: gunnery.roundSeconds,
    advance: advanceGunnery,
    wait: gunneryWait,
  });
  const onArrow = useCallback(
    (col: number, row: number, dir: Dir | null) => {
      const tick = moveTick();
      if (api.apply(dir === null ? { type: "remove", col, row, tick } : { type: "arrow", col, row, dir, tick })) sfx.tick(false);
    },
    [api, moveTick],
  );
  const onEvents = useCallback((events: readonly GunneryEvent[]) => {
    for (const e of events) {
      if (e.type === "load") sfx.swap();
      else if (e.type === "loaded") sfx.clear(2, 5);
      else if (e.type === "fire") sfx.keg();
      else if (e.type === "broadside") sfx.streak(12);
      else if (e.type === "foul") sfx.streakLost();
    }
  }, []);
  return (
    <DutyFrame
      station="gunnery"
      api={api}
      score={shown.score}
      combo={shown.combo}
      roundSeconds={gunnery.roundSeconds}
      lastOutput={lastOutput}
      board={(interactive) => <GunneryBoard state={shown} interactive={interactive} showMarks={showMarks} onArrow={onArrow} onFrame={api.markRendered} onEvents={onEvents} />}
    />
  );
}

const navigation = content.puzzles.navigation;
const navigationWait = (tick: number): NavigationMove => ({ type: "wait", tick });
function NavigationDuty({ shipId, lastOutput }: DutyProps) {
  const [showMarks] = useShowMarks();
  const api = usePractice<NavigationState, NavigationMove, NavigationConfig>({
    puzzle: "navigation",
    def: NAVIGATION_DEF,
    config: navigation.config,
    roundSeconds: navigation.roundSeconds,
    summarize: summarizeNavigation,
    duty: { shipId, station: "navigation" },
  });
  const { shown, moveTick } = useTicked(api, {
    tickMs: navigation.config.tickMs,
    maxTick: navigation.config.maxTick,
    roundSeconds: navigation.roundSeconds,
    advance: advanceNavigation,
    wait: navigationWait,
  });
  const onRotate = useCallback((ring: number, dir: -1 | 1): boolean => api.apply({ type: "rotate", ring, dir, tick: moveTick() }), [api, moveTick]);
  const onDrop = useCallback(() => void api.apply({ type: "drop", tick: moveTick() }), [api, moveTick]);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onEvents = useCallback((events: readonly NavigationEvent[]) => {
    for (const e of events) {
      if (e.type === "land") e.onMarker ? sfx.swap() : sfx.swapQuiet();
      else if (e.type === "booch") sfx.streakLost();
      else if (e.type === "charted") sfx.clear(e.completion.chain, e.completion.markers.length);
      else if (e.type === "run") sfx.multi(e.run.slots.length - 1);
    }
  }, []);
  return (
    <DutyFrame
      station="navigation"
      api={api}
      score={shown.score}
      combo={shown.combo}
      roundSeconds={navigation.roundSeconds}
      lastOutput={lastOutput}
      board={(interactive) => (
        <NavigationBoard
          state={shown}
          interactive={interactive}
          showMarks={showMarks}
          showMarkers
          hints={false}
          onRotate={onRotate}
          onDrop={onDrop}
          onFrame={api.markRendered}
          onEvents={onEvents}
          onNudge={onNudge}
        />
      )}
    />
  );
}

/** The duty board for a station aboard a ship at sea. */
export function DutyStation({ station, shipId, lastOutput }: DutyProps & { station: PuzzleId }) {
  switch (station) {
    case "bilging":
      return <BilgingDuty shipId={shipId} lastOutput={lastOutput} />;
    case "sailing":
      return <SailingDuty shipId={shipId} lastOutput={lastOutput} />;
    case "carpentry":
      return <CarpentryDuty shipId={shipId} lastOutput={lastOutput} />;
    case "gunnery":
      return <GunneryDuty shipId={shipId} lastOutput={lastOutput} />;
    case "navigation":
      return <NavigationDuty shipId={shipId} lastOutput={lastOutput} />;
    default: {
      const never: never = station;
      return never;
    }
  }
}
