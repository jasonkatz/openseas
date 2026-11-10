/**
 * The shape every puzzle engine registers (ADR 0015). It lives apart from the registry so an engine
 * module can export its own definition without importing the registry that lists it.
 */
import type { PuzzleId } from "./registry.js";

/** What every finished round reports. The database row and the result message share this shape. */
export interface PuzzleSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export interface PuzzleDef<S, M, C> {
  readonly id: PuzzleId;
  readonly defaultConfig: C;
  validateConfig(config: C): void;
  create(seed: string, config: C): S;
  /** Throws InvalidMoveError on an illegal move. Never mutates `state`. */
  reduce(state: S, move: M): S;
  hash(state: S): string;
  summarize(state: S): PuzzleSummary;
  isFinished(state: S): boolean;
  /** The longest move log the server accepts for this config. */
  maxMoves(config: C): number;
  /**
   * For engines whose moves carry their own clock (ticks): the ms since round start this move
   * claims to happen at. The server rejects claims ahead of the wall clock. Undefined when moves
   * are untimed.
   */
  moveTimeMs?(move: M, config: C): number;
}
