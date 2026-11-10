/** Scanner: a prototype puzzle (ADR 0036). This is the stub the real engine replaces. */
import type { PuzzleDef } from "../def.js";
import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";

export interface ScannerConfig {
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = { maxMoves: 1000 };

export type ScannerMove = { readonly type: "end" };

export interface ScannerState {
  readonly config: ScannerConfig;
  readonly seed: string;
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly finished: boolean;
}

export function validateScannerConfig(cfg: ScannerConfig): void {
  if (!Number.isInteger(cfg.maxMoves) || cfg.maxMoves < 1 || cfg.maxMoves > 1_000_000) throw new Error("invalid scanner config");
}

export function createScannerGame(seed: string, config: ScannerConfig = DEFAULT_SCANNER_CONFIG): ScannerState {
  validateScannerConfig(config);
  return { config, seed, score: 0, moveCount: 0, combo: 0, bestCombo: 0, finished: false };
}

export function reduceScanner(state: ScannerState, move: ScannerMove): ScannerState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (move.type !== "end") throw new InvalidMoveError("unknown move", move);
  return { ...state, finished: true };
}

export function hashScannerState(state: ScannerState): string {
  return new Hasher().str(state.seed).int(state.score).int(state.moveCount).int(state.finished ? 1 : 0).digest();
}

export function summarizeScanner(state: ScannerState): { score: number; moves: number; bestCombo: number } {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

export const SCANNER_DEF: PuzzleDef<ScannerState, ScannerMove, ScannerConfig> = {
  id: "scanner",
  defaultConfig: DEFAULT_SCANNER_CONFIG,
  validateConfig: validateScannerConfig,
  create: createScannerGame,
  reduce: reduceScanner,
  hash: hashScannerState,
  summarize: summarizeScanner,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};
