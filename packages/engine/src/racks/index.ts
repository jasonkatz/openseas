/** Racks: a prototype puzzle (ADR 0036). This is the stub the real engine replaces. */
import type { PuzzleDef } from "../def.js";
import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";

export interface RacksConfig {
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_RACKS_CONFIG: RacksConfig = { maxMoves: 1000 };

export type RacksMove = { readonly type: "end" };

export interface RacksState {
  readonly config: RacksConfig;
  readonly seed: string;
  readonly score: number;
  readonly moveCount: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly finished: boolean;
}

export function validateRacksConfig(cfg: RacksConfig): void {
  if (!Number.isInteger(cfg.maxMoves) || cfg.maxMoves < 1 || cfg.maxMoves > 1_000_000) throw new Error("invalid racks config");
}

export function createRacksGame(seed: string, config: RacksConfig = DEFAULT_RACKS_CONFIG): RacksState {
  validateRacksConfig(config);
  return { config, seed, score: 0, moveCount: 0, combo: 0, bestCombo: 0, finished: false };
}

export function reduceRacks(state: RacksState, move: RacksMove): RacksState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  if (move.type !== "end") throw new InvalidMoveError("unknown move", move);
  return { ...state, finished: true };
}

export function hashRacksState(state: RacksState): string {
  return new Hasher().str(state.seed).int(state.score).int(state.moveCount).int(state.finished ? 1 : 0).digest();
}

export function summarizeRacks(state: RacksState): { score: number; moves: number; bestCombo: number } {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

export const RACKS_DEF: PuzzleDef<RacksState, RacksMove, RacksConfig> = {
  id: "racks",
  defaultConfig: DEFAULT_RACKS_CONFIG,
  validateConfig: validateRacksConfig,
  create: createRacksGame,
  reduce: reduceRacks,
  hash: hashRacksState,
  summarize: summarizeRacks,
  isFinished: (s) => s.finished,
  maxMoves: (c) => c.maxMoves,
};
