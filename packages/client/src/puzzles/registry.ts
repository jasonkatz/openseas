import type { ComponentType } from 'react';
import type { BasePuzzleState, PuzzleId } from '@tidebound/shared';

/**
 * Props every puzzle renderer receives from PuzzleHost.
 * - `state` is the current engine state (re-rendered every animation frame).
 * - `dispatch` applies an action through the engine and records it in the log.
 * - `now` is a monotonically increasing ms clock for purely visual animation.
 * - `others` is for versus puzzles (opponent/ally boards), optional.
 */
export interface PuzzleViewProps<S extends BasePuzzleState = BasePuzzleState, A = unknown> {
  state: S;
  dispatch: (a: A) => void;
  width: number;
  height: number;
  now: number;
  focused: boolean;
  others?: { id: string; name: string; side: number; state: S; ko: boolean; isSelf: boolean }[];
}

export type PuzzleView = ComponentType<PuzzleViewProps<any, any>>;

export const puzzleViews: Partial<Record<PuzzleId, PuzzleView>> = {};

export function registerPuzzleView(id: PuzzleId, view: PuzzleView): void {
  puzzleViews[id] = view;
}
