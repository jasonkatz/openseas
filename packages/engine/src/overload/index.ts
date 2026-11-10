/** Overload: a prototype puzzle (ADR 0036). This is the stub the real engine replaces. */
import type { PuzzleDef } from "../def.js";
import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";

export interface OverloadConfig {
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_OVERLOAD_CONFIG: OverloadConfig = { maxMoves: 1000 };

export type OverloadMove = { readonly type: "end" };

export interface OverloadState {
  readonly config: OverloadConfig;
  readonly seed: string;
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly finished: boolean;
}

export function validateOverloadConfig(cfg: OverloadConfig): void {
  if (!Number.isInteger(cfg.maxMoves) || cfg.maxMoves < 1 || cfg.maxMoves > 1_000_000) throw new Error("invalid overload config");
}

export function createOverloadGame(seed: string, config: OverloadConfig = DEFAULT_OVERLOAD_CONFIG): OverloadState {
  validateOverloadConfig(config);
  return { config, seed, score: 0, moveCount: 0, combo: 0, bestCombo: 0, finished: false };
}

export function reduceOverload(state: OverloadState, move: OverloadMove): OverloadState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (move.type !== "end") throw new InvalidMoveError("unknown move", move);
  return { ...state, finished: true };
}

export function hashOverloadState(state: OverloadState): string {
  return new Hasher().str(state.seed).int(state.score).int(state.moveCount).int(state.finished ? 1 : 0).digest();
}

export function summarizeOverload(state: OverloadState): { score: number; moves: number; bestCombo: number } {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

export const OVERLOAD_DEF: PuzzleDef<OverloadState, OverloadMove, OverloadConfig> = {
  id: "overload",
  defaultConfig: DEFAULT_OVERLOAD_CONFIG,
  validateConfig: validateOverloadConfig,
  create: createOverloadGame,
  reduce: reduceOverload,
  hash: hashOverloadState,
  summarize: summarizeOverload,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};
