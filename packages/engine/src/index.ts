export * from "./prng.js";
export { Hasher } from "./hash.js";
export * from "./bilging/index.js";
export * from "./rating/index.js";

/** Every puzzle the engine knows about. Extended one at a time per the milestone ladder. */
export const PUZZLE_IDS = ["bilging"] as const;
export type PuzzleId = (typeof PUZZLE_IDS)[number];
