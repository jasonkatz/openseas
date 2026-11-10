/** Tug: a prototype puzzle (ADR 0036). This is the stub the real engine replaces. */
import type { PuzzleDef } from "../def.js";
import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";

export interface TugConfig {
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_TUG_CONFIG: TugConfig = { maxMoves: 1000 };

export type TugMove = { readonly type: "end" };

export interface TugState {
  readonly config: TugConfig;
  readonly seed: string;
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly finished: boolean;
}

export function validateTugConfig(cfg: TugConfig): void {
  if (!Number.isInteger(cfg.maxMoves) || cfg.maxMoves < 1 || cfg.maxMoves > 1_000_000) throw new Error("invalid tug config");
}

export function createTugGame(seed: string, config: TugConfig = DEFAULT_TUG_CONFIG): TugState {
  validateTugConfig(config);
  return { config, seed, score: 0, moveCount: 0, combo: 0, bestCombo: 0, finished: false };
}

export function reduceTug(state: TugState, move: TugMove): TugState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (move.type !== "end") throw new InvalidMoveError("unknown move", move);
  return { ...state, finished: true };
}

export function hashTugState(state: TugState): string {
  return new Hasher().str(state.seed).int(state.score).int(state.moveCount).int(state.finished ? 1 : 0).digest();
}

export function summarizeTug(state: TugState): { score: number; moves: number; bestCombo: number } {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

export const TUG_DEF: PuzzleDef<TugState, TugMove, TugConfig> = {
  id: "tug",
  defaultConfig: DEFAULT_TUG_CONFIG,
  validateConfig: validateTugConfig,
  create: createTugGame,
  reduce: reduceTug,
  hash: hashTugState,
  summarize: summarizeTug,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};
