import { useCallback, type ReactNode } from "react";
import {
  COOLING_DEF,
  PLATING_DEF,
  GUNNERY_DEF,
  NAVIGATION_DEF,
  ENGINES_DEF,
  advanceGunnery,
  advanceNavigation,
  previewSwap,
  type CoolingConfig,
  type CoolingMove,
  type CoolingState,
  type PlatingConfig,
  type PlatingMove,
  type PlatingState,
  type ClearRound,
  type Dir,
  type GunneryConfig,
  type GunneryEvent,
  type GunneryMove,
  type GunneryState,
  type BreachRating,
  type NavigationConfig,
  type NavigationEvent,
  type NavigationMove,
  type NavigationState,
  type Rotation,
  type EnginesClearRound,
  type EnginesConfig,
  type EnginesMove,
  type EnginesState,
} from "@openseas/engine";
import type { PuzzleStarted, ServerMessage, StationWire } from "@openseas/protocol";
import { CoolingBoard, PlatingBoard, GunneryBoard, NavigationBoard, EnginesBoard, content, sfx, useTicked, type CoolingMoveShown } from "@openseas/boards";
import { useDuty, type DutyApi } from "./useDuty.js";

/** What a station adapter hands the frame around it. */
export interface DutyView {
  api: Pick<DutyApi<unknown, unknown>, "phase" | "timeLeft" | "roundSeconds" | "outcome">;
  score: number;
  combo: number;
  board(interactive: boolean): ReactNode;
}

export interface DutyProps {
  active: boolean;
  showMarks: boolean;
  children(view: DutyView): ReactNode;
}

// ---- one adapter per station: the board and its sounds, as in the harness

const cooling = content.puzzles.cooling;
/** The ship's heat arrives as heat events: one with the deal, then one whenever a turn changes it. */
const dealtHeat = (started: PuzzleStarted): CoolingMove[] => (started.duty?.heat !== undefined ? [{ type: "heat", row: started.duty.heat }] : []);
const shipHeat = (m: ServerMessage, sessionId: string): CoolingMove | null => (m.type === "duty.heat" && m.sessionId === sessionId ? { type: "heat", row: m.row } : null);
function CoolingDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<CoolingState, CoolingMove, CoolingConfig>({
    puzzle: "cooling",
    def: COOLING_DEF,
    config: cooling.config,
    roundSeconds: cooling.roundSeconds,
    active,
    dealt: dealtHeat,
    shipMove: shipHeat,
  });
  const { state } = api;
  const onSwap = useCallback(
    (col: number, row: number) => {
      if (api.apply({ type: "swap", col, row })) sfx.swap();
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
    if (causes.has("charge")) sfx.charge();
    if (causes.has("magnet")) sfx.magnet();
    if (causes.has("slag")) sfx.slag();
    if (causes.has("match")) sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
  }, []);
  const onMoveShown = useCallback((m: CoolingMoveShown) => {
    if (m.milestone) sfx.streak(m.milestone);
    else if (m.lostCombo >= 3) sfx.streakLost();
    if (m.heatRows < 0) sfx.vent(-m.heatRows);
  }, []);
  const noHint = useCallback(() => null, []);
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => (
      <CoolingBoard
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
    ),
  });
}

const engines = content.puzzles.engines;
function EnginesDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<EnginesState, EnginesMove, EnginesConfig>({ puzzle: "engines", def: ENGINES_DEF, config: engines.config, roundSeconds: engines.roundSeconds, active });
  const { state } = api;
  const onPlace = useCallback((col: number, row: number, rot: Rotation) => void api.apply({ type: "place", col, row, rot }), [api]);
  const onClear = useCallback((r: EnginesClearRound) => {
    sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
    if (r.groups.some((g) => g.cause === "injector")) sfx.slag();
    if (r.groups.length >= 2) sfx.multi(r.groups.length);
  }, []);
  const onLanded = useCallback(() => sfx.swapQuiet(), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onWipe = useCallback(() => {
    sfx.alarm();
    sfx.streakLost();
  }, []);
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => (
      <EnginesBoard state={state} version={api.version} interactive={interactive} showMarks={showMarks} onPlace={onPlace} onFrame={api.markRendered} onClear={onClear} onLanded={onLanded} onNudge={onNudge} onWipe={onWipe} />
    ),
  });
}

const plating = content.puzzles.plating;
function PlatingDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<PlatingState, PlatingMove, PlatingConfig>({ puzzle: "plating", def: PLATING_DEF, config: plating.config, roundSeconds: plating.roundSeconds, active });
  const { state } = api;
  const onPlace = useCallback((slot: number, rot: number, flip: boolean, col: number, row: number) => void api.apply({ type: "place", slot, rot, flip, col, row }), [api]);
  const onSealed = useCallback((rating: BreachRating, chain: number) => {
    sfx.plateLift();
    if (rating === "flawless") sfx.clear(Math.min(6, chain), 6);
    else if (rating === "gum") sfx.streakLost();
    else sfx.clear(1, 3);
  }, []);
  const onNailed = useCallback((waste: boolean) => sfx.welder(waste), []);
  const onGrew = useCallback(() => sfx.crack(true), []);
  const onCracked = useCallback((opening: boolean) => sfx.crack(!opening), []);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onBump = useCallback(() => sfx.bump(), []);
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => (
      <PlatingBoard
        state={state}
        version={api.version}
        interactive={interactive}
        showMarks={showMarks}
        onPlace={onPlace}
        onFrame={api.markRendered}
        onSealed={onSealed}
        onNailed={onNailed}
        onGrew={onGrew}
        onCracked={onCracked}
        onNudge={onNudge}
        onBump={onBump}
      />
    ),
  });
}

const gunnery = content.puzzles.gunnery;
const gunneryWait = (tick: number): GunneryMove => ({ type: "wait", tick });
function GunneryDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<GunneryState, GunneryMove, GunneryConfig>({ puzzle: "gunnery", def: GUNNERY_DEF, config: gunnery.config, roundSeconds: gunnery.roundSeconds, active });
  const { shown, moveTick } = useTicked(api, { tickMs: gunnery.config.tickMs, maxTick: gunnery.config.maxTick, advance: advanceGunnery, wait: gunneryWait });
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
      else if (e.type === "fire") sfx.charge();
      else if (e.type === "broadside") sfx.streak(12);
      else if (e.type === "jam") sfx.streakLost();
    }
  }, []);
  return children({
    api,
    score: shown.score,
    combo: shown.combo,
    board: (interactive) => <GunneryBoard state={shown} interactive={interactive} showMarks={showMarks} onArrow={onArrow} onFrame={api.markRendered} onEvents={onEvents} />,
  });
}

const navigation = content.puzzles.navigation;
const navigationWait = (tick: number): NavigationMove => ({ type: "wait", tick });
function NavigationDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<NavigationState, NavigationMove, NavigationConfig>({ puzzle: "navigation", def: NAVIGATION_DEF, config: navigation.config, roundSeconds: navigation.roundSeconds, active });
  const { shown, moveTick } = useTicked(api, { tickMs: navigation.config.tickMs, maxTick: navigation.config.maxTick, advance: advanceNavigation, wait: navigationWait });
  const onRotate = useCallback((ring: number, dir: -1 | 1): boolean => api.apply({ type: "rotate", ring, dir, tick: moveTick() }), [api, moveTick]);
  const onDrop = useCallback(() => void api.apply({ type: "drop", tick: moveTick() }), [api, moveTick]);
  const onNudge = useCallback(() => sfx.tick(false), []);
  const onEvents = useCallback((events: readonly NavigationEvent[]) => {
    for (const e of events) {
      if (e.type === "land") e.onMarker ? sfx.swap() : sfx.swapQuiet();
      else if (e.type === "lost_heading") sfx.streakLost();
      else if (e.type === "charted") sfx.clear(e.completion.chain, e.completion.markers.length);
      else if (e.type === "run") sfx.multi(e.run.slots.length - 1);
    }
  }, []);
  return children({
    api,
    score: shown.score,
    combo: shown.combo,
    board: (interactive) => (
      <NavigationBoard state={shown} interactive={interactive} showMarks={showMarks} showMarkers hints={false} onRotate={onRotate} onDrop={onDrop} onFrame={api.markRendered} onEvents={onEvents} onNudge={onNudge} />
    ),
  });
}

/** The duty board for a station, as a render prop so the frame around it is the station view's. */
export function DutyBoard({ station, ...rest }: DutyProps & { station: StationWire }) {
  switch (station) {
    case "cooling":
      return <CoolingDuty {...rest} />;
    case "engines":
      return <EnginesDuty {...rest} />;
    case "plating":
      return <PlatingDuty {...rest} />;
    case "gunnery":
      return <GunneryDuty {...rest} />;
    case "navigation":
      return <NavigationDuty {...rest} />;
    default: {
      const never: never = station;
      return never;
    }
  }
}
