/** Reactor: a prototype puzzle (ADR 0036). This is the stub the real engine replaces. */
import type { PuzzleDef } from "../def.js";
import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";

export interface ReactorConfig {
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_REACTOR_CONFIG: ReactorConfig = { maxMoves: 1000 };

export type ReactorMove = { readonly type: "end" };

export interface ReactorState {
  readonly config: ReactorConfig;
  readonly seed: string;
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly finished: boolean;
}

export function validateReactorConfig(cfg: ReactorConfig): void {
  if (!Number.isInteger(cfg.maxMoves) || cfg.maxMoves < 1 || cfg.maxMoves > 1_000_000) throw new Error("invalid reactor config");
}

export function createReactorGame(seed: string, config: ReactorConfig = DEFAULT_REACTOR_CONFIG): ReactorState {
  validateReactorConfig(config);
  return { config, seed, score: 0, moveCount: 0, combo: 0, bestCombo: 0, finished: false };
}

export function reduceReactor(state: ReactorState, move: ReactorMove): ReactorState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (move.type !== "end") throw new InvalidMoveError("unknown move", move);
  return { ...state, finished: true };
}

export function hashReactorState(state: ReactorState): string {
  return new Hasher().str(state.seed).int(state.score).int(state.moveCount).int(state.finished ? 1 : 0).digest();
}

export function summarizeReactor(state: ReactorState): { score: number; moves: number; bestCombo: number } {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

export const REACTOR_DEF: PuzzleDef<ReactorState, ReactorMove, ReactorConfig> = {
  id: "reactor",
  defaultConfig: DEFAULT_REACTOR_CONFIG,
  validateConfig: validateReactorConfig,
  create: createReactorGame,
  reduce: reduceReactor,
  hash: hashReactorState,
  summarize: summarizeReactor,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};
