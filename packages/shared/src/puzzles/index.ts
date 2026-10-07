// Puzzle engine registry. Each engine lives in its own folder and is pure/deterministic.
import type { BasePuzzleState, PuzzleDef, PuzzleId } from './types';

export const puzzleDefs: Partial<Record<PuzzleId, PuzzleDef<any, any>>> = {};

export function registerPuzzle<S extends BasePuzzleState, A>(def: PuzzleDef<S, A>): PuzzleDef<S, A> {
  puzzleDefs[def.id] = def as PuzzleDef<any, any>;
  return def;
}

export function getPuzzle(id: PuzzleId): PuzzleDef<any, any> {
  const d = puzzleDefs[id];
  if (!d) throw new Error(`puzzle not registered: ${id}`);
  return d;
}
