/**
 * Swap, the first puzzle written for the domain engine (ADR 0080): the game's Cooling, as a puzzle
 * document and its rules, holding nothing from the game's world.
 */
import type { PuzzleDoc } from "../../document.js";
import type { WitnessRound } from "../../host.js";
import { engine, type Engine, type EngineOptions } from "../../round.js";
import puzzle from "./puzzle.json" with { type: "json" };
import witnesses from "./witness.json" with { type: "json" };
import { SWAP_RULES, type SwapState } from "./rules.js";

export const SWAP = puzzle as unknown as PuzzleDoc;
export const SWAP_WITNESSES = witnesses as unknown as readonly WitnessRound[];
export { SWAP_RULES, findRuns, type SwapState } from "./rules.js";

/** The engine for Swap on a host's scale. */
export const swapEngine = (options: EngineOptions): Engine<SwapState> => engine(SWAP, SWAP_RULES, options);
