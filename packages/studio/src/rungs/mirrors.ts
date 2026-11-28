// The puzzles the studio plays on the new engine, each on the page and board its hand-written engine has
// (ADR 0097). An entry is the shipped one with one thing changed: who plays the round.
import type { CoolingConfig, CoolingMove, CoolingState, GunneryConfig, GunneryMove, GunneryState, SalvageConfig, SalvageMove, SalvageState } from "@openseas/engine";
import { SALVAGE } from "../prototypes/salvage.js";
import { COOLING, GUNNERY, type StudioPuzzle } from "../puzzles.js";
import { COOLING_MIRROR } from "./mirror/cooling.js";
import { GUNNERY_MIRROR } from "./mirror/gunnery.js";
import { SALVAGE_MIRROR } from "./mirror/salvage.js";

/** The heat a ship injects is not built on the new engine, so the board keeps its own, as a round off a ship does. */
export const COOLING_RUNG: StudioPuzzle<CoolingState, CoolingMove, CoolingConfig> = { ...COOLING, def: COOLING_MIRROR, config: { ...COOLING.config, shipHeat: false }, locked: [...COOLING.locked, "shipHeat"] };
/** Salvage's page with Paths behind it. */
export const PATHS_RUNG: StudioPuzzle<SalvageState, SalvageMove, SalvageConfig> = { ...SALVAGE, def: SALVAGE_MIRROR };
export const GUNNERY_RUNG: StudioPuzzle<GunneryState, GunneryMove, GunneryConfig> = { ...GUNNERY, def: GUNNERY_MIRROR };
