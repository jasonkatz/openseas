import type { ReactNode } from "react";
import {
  COOLING_DEF,
  PLATING_DEF,
  GUNNERY_DEF,
  NAVIGATION_DEF,
  ENGINES_DEF,
  advanceGunnery,
  advanceNavigation,
  type CoolingConfig,
  type CoolingMove,
  type CoolingState,
  type PlatingConfig,
  type PlatingMove,
  type PlatingState,
  type GunneryConfig,
  type GunneryMove,
  type GunneryState,
  type NavigationConfig,
  type NavigationMove,
  type NavigationState,
  type EnginesConfig,
  type EnginesMove,
  type EnginesState,
} from "@openseas/engine";
import type { PuzzleStarted, StationWire } from "@openseas/protocol";
import {
  CoolingBoard,
  PlatingBoard,
  GunneryBoard,
  NavigationBoard,
  EnginesBoard,
  content,
  useCoolingControls,
  useEnginesControls,
  useGunneryControls,
  useNavigationControls,
  usePlatingControls,
  useTicked,
  type RoundMessage,
} from "@openseas/boards";
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

// ---- one adapter per station: the board on its duty round, with the controls the harness proves

const cooling = content.puzzles.cooling;
/** The ship's heat arrives as heat events: one with the deal, then one whenever a turn changes it. */
const dealtHeat = (started: PuzzleStarted): CoolingMove[] => (started.duty?.heat !== undefined ? [{ type: "heat", row: started.duty.heat }] : []);
const shipHeat = (m: RoundMessage): CoolingMove | null => (m.type === "duty.heat" ? { type: "heat", row: m.row } : null);
function CoolingDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<CoolingState, CoolingMove, CoolingConfig>({
    puzzle: "cooling",
    def: COOLING_DEF,
    config: cooling.config,
    roundSeconds: cooling.roundSeconds,
    active,
    dealt: dealtHeat,
    inbound: shipHeat,
  });
  const controls = useCoolingControls(api);
  const { state } = api;
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => <CoolingBoard state={state} report={state.lastMove} version={api.version} interactive={interactive} showMarks={showMarks} hints={false} {...controls} />,
  });
}

const engines = content.puzzles.engines;
function EnginesDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<EnginesState, EnginesMove, EnginesConfig>({ puzzle: "engines", def: ENGINES_DEF, config: engines.config, roundSeconds: engines.roundSeconds, active });
  const controls = useEnginesControls(api);
  const { state } = api;
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => <EnginesBoard state={state} version={api.version} interactive={interactive} showMarks={showMarks} {...controls} />,
  });
}

const plating = content.puzzles.plating;
function PlatingDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<PlatingState, PlatingMove, PlatingConfig>({ puzzle: "plating", def: PLATING_DEF, config: plating.config, roundSeconds: plating.roundSeconds, active });
  const controls = usePlatingControls(api);
  const { state } = api;
  return children({
    api,
    score: state.score,
    combo: state.combo,
    board: (interactive) => <PlatingBoard state={state} version={api.version} interactive={interactive} showMarks={showMarks} {...controls} />,
  });
}

const gunnery = content.puzzles.gunnery;
const gunneryWait = (tick: number): GunneryMove => ({ type: "wait", tick });
function GunneryDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<GunneryState, GunneryMove, GunneryConfig>({ puzzle: "gunnery", def: GUNNERY_DEF, config: gunnery.config, roundSeconds: gunnery.roundSeconds, active });
  const { shown, moveTick } = useTicked(api, { tickMs: gunnery.config.tickMs, maxTick: gunnery.config.maxTick, advance: advanceGunnery, wait: gunneryWait });
  const controls = useGunneryControls(api, moveTick);
  return children({
    api,
    score: shown.score,
    combo: shown.combo,
    board: (interactive) => <GunneryBoard state={shown} interactive={interactive} showMarks={showMarks} {...controls} />,
  });
}

const navigation = content.puzzles.navigation;
const navigationWait = (tick: number): NavigationMove => ({ type: "wait", tick });
function NavigationDuty({ active, showMarks, children }: DutyProps) {
  const api = useDuty<NavigationState, NavigationMove, NavigationConfig>({ puzzle: "navigation", def: NAVIGATION_DEF, config: navigation.config, roundSeconds: navigation.roundSeconds, active });
  const { shown, moveTick } = useTicked(api, { tickMs: navigation.config.tickMs, maxTick: navigation.config.maxTick, advance: advanceNavigation, wait: navigationWait });
  const controls = useNavigationControls(api, moveTick);
  return children({
    api,
    score: shown.score,
    combo: shown.combo,
    board: (interactive) => <NavigationBoard state={shown} interactive={interactive} showMarks={showMarks} showMarkers hints={false} {...controls} />,
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
