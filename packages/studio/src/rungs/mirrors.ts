// The puzzles the studio plays on the new engine, each on the page and board its hand-written engine has
// (ADR 0097). An entry is the shipped one with one thing changed: who plays the round.
import type { CoolingConfig, CoolingMove, CoolingState, EnginesConfig, EnginesMove, EnginesState, NavigationConfig, NavigationMove, NavigationState, PlatingConfig, PlatingMove, PlatingState, GunneryConfig, GunneryMove, GunneryState, SalvageConfig, SalvageMove, SalvageState, ForgingConfig, ForgingMove, ForgingState, AssemblyConfig, AssemblyMove, AssemblyState, RacksConfig, RacksMove, RacksState, CuttingConfig, CuttingMove, CuttingState, ScannerConfig, ScannerMove, ScannerState, TugConfig, TugMove, TugState, ReactorConfig, ReactorMove, ReactorState, TractorConfig, TractorMove, TractorState, FreefallConfig, FreefallMove, FreefallState, PouringConfig, PouringMove, PouringState, OverloadConfig, OverloadMove, OverloadState, RefiningConfig, RefiningMove, RefiningState, DeflectorsConfig, DeflectorsMove, DeflectorsState } from "@openseas/engine";
import { SALVAGE } from "../prototypes/salvage.js";
import { COOLING, ENGINES, GUNNERY, NAVIGATION, PLATING, type StudioPuzzle } from "../puzzles.js";
import { COOLING_MIRROR } from "./mirror/cooling.js";
import { ENGINES_MIRROR } from "./mirror/engines.js";
import { NAVIGATION_MIRROR } from "./mirror/navigation.js";
import { PLATING_MIRROR } from "./mirror/plating.js";
import { GUNNERY_MIRROR } from "./mirror/gunnery.js";
import { SALVAGE_MIRROR } from "./mirror/salvage.js";
import { FORGING } from "../prototypes/forging.js";
import { FORGING_MIRROR } from "./mirror/forging.js";
import { ASSEMBLY } from "../prototypes/assembly.js";
import { ASSEMBLY_MIRROR } from "./mirror/assembly.js";
import { RACKS } from "../prototypes/racks.js";
import { RACKS_MIRROR } from "./mirror/racks.js";
import { CUTTING } from "../prototypes/cutting.js";
import { CUTTING_MIRROR } from "./mirror/cutting.js";
import { SCANNER } from "../prototypes/scanner.js";
import { SCANNER_MIRROR } from "./mirror/scanner.js";
import { TUG } from "../prototypes/tug.js";
import { TUG_MIRROR } from "./mirror/tug.js";
import { REACTOR } from "../prototypes/reactor.js";
import { REACTOR_MIRROR } from "./mirror/reactor.js";
import { TRACTOR } from "../prototypes/tractor.js";
import { TRACTOR_MIRROR } from "./mirror/tractor.js";
import { FREEFALL } from "../prototypes/freefall.js";
import { FREEFALL_MIRROR } from "./mirror/freefall.js";
import { POURING } from "../prototypes/pouring.js";
import { POURING_MIRROR } from "./mirror/pouring.js";
import { OVERLOAD } from "../prototypes/overload.js";
import { OVERLOAD_MIRROR } from "./mirror/overload.js";
import { REFINING } from "../prototypes/refining.js";
import { REFINING_MIRROR } from "./mirror/refining.js";
import { DEFLECTORS } from "../prototypes/deflectors.js";
import { DEFLECTORS_MIRROR } from "./mirror/deflectors.js";

/** The heat a ship injects is not built on the new engine, so the board keeps its own, as a round off a ship does. */
export const COOLING_RUNG: StudioPuzzle<CoolingState, CoolingMove, CoolingConfig> = { ...COOLING, def: COOLING_MIRROR, config: { ...COOLING.config, shipHeat: false }, locked: [...COOLING.locked, "shipHeat"] };
/** Salvage's page with Paths behind it. */
export const PATHS_RUNG: StudioPuzzle<SalvageState, SalvageMove, SalvageConfig> = { ...SALVAGE, def: SALVAGE_MIRROR };
export const GUNNERY_RUNG: StudioPuzzle<GunneryState, GunneryMove, GunneryConfig> = { ...GUNNERY, def: GUNNERY_MIRROR };
export const ENGINES_RUNG: StudioPuzzle<EnginesState, EnginesMove, EnginesConfig> = { ...ENGINES, def: ENGINES_MIRROR };
export const PLATING_RUNG: StudioPuzzle<PlatingState, PlatingMove, PlatingConfig> = { ...PLATING, def: PLATING_MIRROR };
export const NAVIGATION_RUNG: StudioPuzzle<NavigationState, NavigationMove, NavigationConfig> = { ...NAVIGATION, def: NAVIGATION_MIRROR };

/** The solo prototypes, each on its own page and board with the new engine playing the round (ADR 0099). */
export const FORGING_RUNG: StudioPuzzle<ForgingState, ForgingMove, ForgingConfig> = { ...FORGING, def: FORGING_MIRROR };
export const ASSEMBLY_RUNG: StudioPuzzle<AssemblyState, AssemblyMove, AssemblyConfig> = { ...ASSEMBLY, def: ASSEMBLY_MIRROR };
export const RACKS_RUNG: StudioPuzzle<RacksState, RacksMove, RacksConfig> = { ...RACKS, def: RACKS_MIRROR };
export const CUTTING_RUNG: StudioPuzzle<CuttingState, CuttingMove, CuttingConfig> = { ...CUTTING, def: CUTTING_MIRROR };
export const SCANNER_RUNG: StudioPuzzle<ScannerState, ScannerMove, ScannerConfig> = { ...SCANNER, def: SCANNER_MIRROR };
export const TUG_RUNG: StudioPuzzle<TugState, TugMove, TugConfig> = { ...TUG, def: TUG_MIRROR };
export const REACTOR_RUNG: StudioPuzzle<ReactorState, ReactorMove, ReactorConfig> = { ...REACTOR, def: REACTOR_MIRROR };
export const TRACTOR_RUNG: StudioPuzzle<TractorState, TractorMove, TractorConfig> = { ...TRACTOR, def: TRACTOR_MIRROR };
export const FREEFALL_RUNG: StudioPuzzle<FreefallState, FreefallMove, FreefallConfig> = { ...FREEFALL, def: FREEFALL_MIRROR };
export const POURING_RUNG: StudioPuzzle<PouringState, PouringMove, PouringConfig> = { ...POURING, def: POURING_MIRROR };
export const OVERLOAD_RUNG: StudioPuzzle<OverloadState, OverloadMove, OverloadConfig> = { ...OVERLOAD, def: OVERLOAD_MIRROR };
export const REFINING_RUNG: StudioPuzzle<RefiningState, RefiningMove, RefiningConfig> = { ...REFINING, def: REFINING_MIRROR };
export const DEFLECTORS_RUNG: StudioPuzzle<DeflectorsState, DeflectorsMove, DeflectorsConfig> = { ...DEFLECTORS, def: DEFLECTORS_MIRROR };
