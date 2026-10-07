import type { Rng } from '../rng';

export type PuzzleId = 'bilging' | 'sailing' | 'carpentry' | 'gunnery' | 'navigation' | 'swordfight';

export const PUZZLE_IDS: readonly PuzzleId[] = ['bilging', 'sailing', 'carpentry', 'gunnery', 'navigation', 'swordfight'];

export interface PuzzleConfig {
  /** Difficulty 0..1 (affects speed, piece variety). Default 0.4. */
  difficulty?: number;
  /** Optional hard time limit in ms; engines may ignore. */
  durationMs?: number;
}

export interface PuzzleScore {
  /** Total points accumulated. */
  points: number;
  /** Smoothed recent-window rating 0..1. Drives ship stats. */
  performance: number;
  /** Human label e.g. "Excellent". */
  label: string;
}

/** Every engine state must carry its RNG and elapsed time. */
export interface BasePuzzleState {
  rng: Rng;
  elapsedMs: number;
  over: boolean;
}

export interface PuzzleDef<S extends BasePuzzleState, A> {
  id: PuzzleId;
  name: string;
  /** One-line tutorial text. */
  blurb: string;
  init(seed: number, config?: PuzzleConfig): S;
  /** Pure. Must return the same reference when nothing changes. */
  reduce(state: S, action: A): S;
  /** Pure time step. dtMs is an integer. */
  tick(state: S, dtMs: number): S;
  isOver(state: S): boolean;
  score(state: S): PuzzleScore;
}

/** A recorded, replayable action log entry. */
export interface LogEntry<A = unknown> {
  /** elapsed ms at which the action was applied (integer). */
  at: number;
  a: A;
}

export function ratingLabel(p: number): string {
  if (p >= 0.95) return 'Incredible';
  if (p >= 0.85) return 'Excellent';
  if (p >= 0.7) return 'Great';
  if (p >= 0.5) return 'Good';
  if (p >= 0.3) return 'Fine';
  if (p >= 0.15) return 'Poor';
  return 'Booched';
}

/**
 * Replays a log against an engine, interleaving ticks and actions so the
 * server can verify a client-reported score. Returns the final state.
 */
export function replay<S extends BasePuzzleState, A>(
  def: PuzzleDef<S, A>,
  seed: number,
  config: PuzzleConfig | undefined,
  log: readonly LogEntry<A>[],
  finalElapsedMs: number,
): S {
  let s = def.init(seed, config);
  let t = 0;
  for (const e of log) {
    const at = Math.max(t, Math.floor(e.at));
    if (at > t) {
      s = def.tick(s, at - t);
      t = at;
    }
    s = def.reduce(s, e.a);
  }
  const end = Math.max(t, Math.floor(finalElapsedMs));
  if (end > t) s = def.tick(s, end - t);
  return s;
}

/** Exponential moving average helper used by engines for `performance`. */
export function ema(prev: number, sample: number, alpha: number): number {
  return prev + alpha * (sample - prev);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
