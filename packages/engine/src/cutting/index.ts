/** Cutting: a prototype puzzle (ADR 0036). This is the stub the real engine replaces. */
import type { PuzzleDef } from "../def.js";
import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";

export interface CuttingConfig {
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_CUTTING_CONFIG: CuttingConfig = { maxMoves: 1000 };

export type CuttingMove = { readonly type: "end" };

export interface CuttingState {
  readonly config: CuttingConfig;
  readonly seed: string;
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly finished: boolean;
}

export function validateCuttingConfig(cfg: CuttingConfig): void {
  if (!Number.isInteger(cfg.maxMoves) || cfg.maxMoves < 1 || cfg.maxMoves > 1_000_000) throw new Error("invalid cutting config");
}

export function createCuttingGame(seed: string, config: CuttingConfig = DEFAULT_CUTTING_CONFIG): CuttingState {
  validateCuttingConfig(config);
  return { config, seed, score: 0, moveCount: 0, combo: 0, bestCombo: 0, finished: false };
}

export function reduceCutting(state: CuttingState, move: CuttingMove): CuttingState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (move.type !== "end") throw new InvalidMoveError("unknown move", move);
  return { ...state, finished: true };
}

export function hashCuttingState(state: CuttingState): string {
  return new Hasher().str(state.seed).int(state.score).int(state.moveCount).int(state.finished ? 1 : 0).digest();
}

export function summarizeCutting(state: CuttingState): { score: number; moves: number; bestCombo: number } {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

export const CUTTING_DEF: PuzzleDef<CuttingState, CuttingMove, CuttingConfig> = {
  id: "cutting",
  defaultConfig: DEFAULT_CUTTING_CONFIG,
  validateConfig: validateCuttingConfig,
  create: createCuttingGame,
  reduce: reduceCutting,
  hash: hashCuttingState,
  summarize: summarizeCutting,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};
