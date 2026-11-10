/** Deflectors: a prototype puzzle (ADR 0036). This is the stub the real engine replaces. */
import type { PuzzleDef } from "../def.js";
import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";

export interface DeflectorsConfig {
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_DEFLECTORS_CONFIG: DeflectorsConfig = { maxMoves: 1000 };

export type DeflectorsMove = { readonly type: "end" };

export interface DeflectorsState {
  readonly config: DeflectorsConfig;
  readonly seed: string;
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly finished: boolean;
}

export function validateDeflectorsConfig(cfg: DeflectorsConfig): void {
  if (!Number.isInteger(cfg.maxMoves) || cfg.maxMoves < 1 || cfg.maxMoves > 1_000_000) throw new Error("invalid deflectors config");
}

export function createDeflectorsGame(seed: string, config: DeflectorsConfig = DEFAULT_DEFLECTORS_CONFIG): DeflectorsState {
  validateDeflectorsConfig(config);
  return { config, seed, score: 0, moveCount: 0, combo: 0, bestCombo: 0, finished: false };
}

export function reduceDeflectors(state: DeflectorsState, move: DeflectorsMove): DeflectorsState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (move.type !== "end") throw new InvalidMoveError("unknown move", move);
  return { ...state, finished: true };
}

export function hashDeflectorsState(state: DeflectorsState): string {
  return new Hasher().str(state.seed).int(state.score).int(state.moveCount).int(state.finished ? 1 : 0).digest();
}

export function summarizeDeflectors(state: DeflectorsState): { score: number; moves: number; bestCombo: number } {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

export const DEFLECTORS_DEF: PuzzleDef<DeflectorsState, DeflectorsMove, DeflectorsConfig> = {
  id: "deflectors",
  defaultConfig: DEFAULT_DEFLECTORS_CONFIG,
  validateConfig: validateDeflectorsConfig,
  create: createDeflectorsGame,
  reduce: reduceDeflectors,
  hash: hashDeflectorsState,
  summarize: summarizeDeflectors,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};
