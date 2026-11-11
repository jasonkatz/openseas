import type { PuzzleRound } from "./round.js";

/**
 * What a board's controls need from whoever runs its round: apply the player's move, read the round
 * in play for engine queries, and mark a frame drawn. The game's round hooks and the harness's
 * practice hook both answer it, so a board's handlers and sounds are written once.
 */
export interface ControlsHost<S, M> {
  /** Apply a player move. False when there is no round or the engine refused it. */
  apply(move: M): boolean;
  current(): PuzzleRound<S, M, unknown> | null;
  markRendered(): void;
}
