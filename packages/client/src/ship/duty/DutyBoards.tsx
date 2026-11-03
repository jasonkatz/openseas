import { useCallback, type ReactNode } from "react";
import {
  BILGING_DEF,
  CARPENTRY_DEF,
  GUNNERY_DEF,
  NAVIGATION_DEF,
  SAILING_DEF,
  advanceGunnery,
  advanceNavigation,
  previewSwap,
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
  type Rotation,
  type SailingClearRound,
  type SailingMove,
  type SailingState,
} from "@openseas/engine";
import type { StationWire } from "@openseas/protocol";
import { BilgingBoard, CarpentryBoard, GunneryBoard, NavigationBoard, SailingBoard, content, sfx, useTicked, type BilgingMoveShown } from "@openseas/boards";
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

const bilging = content.puzzles.bilging;
function BilgingDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<BilgingState, BilgingMove, typeof bilging.config>({ puzzle: "bilging", def: BILGING_DEF, config: bilging.config, roundSeconds: bilging.roundSeconds, active });
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
    if (causes.has("keg")) sfx.keg();
    if (causes.has("ink")) sfx.ink();
    if (causes.has("barnacle")) sfx.barnacle();
    if (causes.has("match")) sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
  }, []);
  const onMoveShown = useCallback((m: BilgingMoveShown) => {
    if (m.milestone) sfx.streak(m.milestone);
    else if (m.lostCombo >= 3) sfx.streakLost();
    if (m.waterRows < 0) sfx.pump(-m.waterRows);
  }, []);
  const noHint = useCallback(() => null, []);
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => (
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
    ),
  });
}

const sailing = content.puzzles.sailing;
function SailingDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<SailingState, SailingMove, typeof sailing.config>({ puzzle: "sailing", def: SAILING_DEF, config: sailing.config, roundSeconds: sailing.roundSeconds, active });
  const { state } = api;
  const onPlace = useCallback((col: number, row: number, rot: Rotation) => void api.apply({ type: "place", col, row, rot }), [api]);
  const onClear = useCallback((r: SailingClearRound) => {
    sfx.clear(r.chain, r.groups.reduce((n, g) => n + g.ids.length, 0));
    if (r.groups.some((g) => g.cause === "platform")) sfx.barnacle();
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
      <SailingBoard state={state} version={api.version} interactive={interactive} showMarks={showMarks} onPlace={onPlace} onFrame={api.markRendered} onClear={onClear} onLanded={onLanded} onNudge={onNudge} onWipe={onWipe} />
    ),
  });
}

const carpentry = content.puzzles.carpentry;
function CarpentryDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<CarpentryState, CarpentryMove, typeof carpentry.config>({ puzzle: "carpentry", def: CARPENTRY_DEF, config: carpentry.config, roundSeconds: carpentry.roundSeconds, active });
  const { state } = api;
  const onPlace = useCallback((slot: number, rot: number, flip: boolean, col: number, row: number) => void api.apply({ type: "place", slot, rot, flip, col, row }), [api]);
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
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => (
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
      else if (e.type === "fire") sfx.keg();
      else if (e.type === "broadside") sfx.streak(12);
      else if (e.type === "foul") sfx.streakLost();
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
      else if (e.type === "booch") sfx.streakLost();
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
    case "bilging":
      return <BilgingDuty {...rest} />;
    case "sailing":
      return <SailingDuty {...rest} />;
    case "carpentry":
      return <CarpentryDuty {...rest} />;
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
