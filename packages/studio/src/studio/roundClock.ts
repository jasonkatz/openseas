import { useSyncExternalStore } from "react";
import type { LabClock } from "@openseas/boards";

/**
 * The clock of the round on the board, where the transport bar under it can reach it (ADR 0068).
 * The puzzle's page owns the round (studio/useStudio) and publishes its clock here; the studio's
 * shell reads it to pause, step and change speed from any mode. Nothing here is a score or a
 * move: the bar only drives time, as a script could through `window.openseasRoundClock`.
 */
export interface RoundClockState {
  readonly clock: LabClock | null;
  /** One tick of a ticked puzzle, in milliseconds; null for the others. */
  readonly tickMs: number | null;
}

const NONE: RoundClockState = { clock: null, tickMs: null };
let current: RoundClockState = NONE;
const listeners = new Set<() => void>();

export function publishRoundClock(clock: LabClock | null, tickMs: number | null): void {
  if (current.clock === clock && current.tickMs === tickMs) return;
  current = clock ? { clock, tickMs } : NONE;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The published clock, and whether it is paused and how fast it runs, kept current as they change. */
export function useRoundClock(): RoundClockState & { readonly paused: boolean; readonly speed: number } {
  const state = useSyncExternalStore(subscribe, () => current, () => NONE);
  const clock = state.clock;
  const paused = useSyncExternalStore(
    (fn) => clock?.onChange(fn) ?? (() => undefined),
    () => clock?.isPaused ?? false,
    () => false,
  );
  const speed = useSyncExternalStore(
    (fn) => clock?.onChange(fn) ?? (() => undefined),
    () => clock?.speed ?? 1,
    () => 1,
  );
  return { ...state, paused, speed };
}

/** The speeds the bar offers, slowest first. */
export const SPEEDS = [0.5, 1, 2] as const;
