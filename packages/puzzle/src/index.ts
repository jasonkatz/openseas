/**
 * The puzzle domain engine (ADR 0084, docs/puzzles/DOMAIN.md). A puzzle is a document and its
 * rules; this package runs any such puzzle, and holds none of the game's world.
 */
export * from "./document.js";
export * from "./errors.js";
export * from "./board.js";
export * from "./settings.js";
export * from "./scoring.js";
export * from "./judge.js";
export * from "./check.js";
export * from "./round.js";
export * from "./host.js";
export * from "./skin.js";
export { streamFrom, nextBelow, next32, type StreamState } from "./prng.js";
export { SWAP, SWAP_RULES, SWAP_WITNESSES, swapEngine, findRuns as findRunsForTest, type SwapState } from "./puzzles/swap/index.js";
