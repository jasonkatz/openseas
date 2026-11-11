import { useCallback, useEffect, useRef, useState } from "react";
import type { PuzzleRound } from "./round.js";

/** What the tick clock needs from whoever runs the round: the live round and a way to log a wait. */
export interface TickedHost<S, M> {
  readonly state: S;
  /** "playing" while a round runs; anything else freezes the display at the engine state. */
  readonly phase: string;
  current(): PuzzleRound<S, M, unknown> | null;
  apply(move: M, countsAsInput?: boolean): boolean;
}

export interface TickedOptions<S, M> {
  tickMs: number;
  maxTick: number;
  /** The engine's "state at a later tick" without logging a move. */
  advance(state: S, tick: number): S;
  /** The engine's wait move at a tick. */
  wait(tick: number): M;
  /** Log a wait after this many ticks without input so events in flight reach the server. Default 20. */
  waitEveryTicks?: number;
}

export interface TickedApi<S> {
  /** What the board shows: the engine state advanced to the current tick. Display only until a move logs it. */
  shown: S;
  /** The tick a move made right now should carry: never behind the engine, never ahead of the clock. */
  moveTick(): number;
}

/**
 * The clock for engines whose moves carry ticks (ADR 0015). Each tick the displayed state advances;
 * every so often, and once more right before the deadline, a wait is logged so the server sees the
 * same passage of time. The tick runs one behind the round's clock so a claim never gets ahead of
 * the server's view of it. Time is read from the round's clock, so a harness can slow or pause it.
 *
 * Without options the clock is off: it shows the host's state as it is, logs nothing and claims
 * tick 0, so a caller that runs untimed and timed boards alike can always call it.
 */
export function useTicked<S extends { readonly tick: number }, M>(host: TickedHost<S, M>, opts: TickedOptions<S, M> | null): TickedApi<S> {
  const timed = opts !== null;
  const tickMs = opts?.tickMs ?? 0;
  const maxTick = opts?.maxTick ?? 0;
  const waitEvery = opts?.waitEveryTicks ?? 20;
  const { state, phase } = host;
  const [shown, setShown] = useState<S>(state);
  const finalWaitSent = useRef(false);
  // The host and options are read through refs so the interval below outlives re-renders.
  const latest = useRef({ host, opts });
  latest.current = { host, opts };

  const currentTick = useCallback((): number => {
    const r = latest.current.host.current();
    if (!r || tickMs <= 0) return 0;
    return Math.max(0, Math.min(maxTick, Math.floor(r.elapsedMs() / tickMs) - 1));
  }, [maxTick, tickMs]);

  useEffect(() => {
    if (!timed) return;
    if (phase !== "playing") {
      setShown(latest.current.host.state);
      finalWaitSent.current = false;
      return;
    }
    const step = (): void => {
      const { host: h, opts: o } = latest.current;
      const r = h.current();
      if (!o || !r || r.isFinished) return;
      const tick = currentTick();
      if (r.msLeft() < 600 && !finalWaitSent.current) {
        finalWaitSent.current = true;
        h.apply(o.wait(tick), false);
        return;
      }
      if (tick - r.state.tick >= waitEvery) {
        h.apply(o.wait(tick), false);
        return;
      }
      setShown(o.advance(r.state, tick));
    };
    step();
    const id = window.setInterval(step, tickMs);
    return () => window.clearInterval(id);
  }, [timed, phase, currentTick, tickMs, waitEvery]);

  // A logged move resets the display baseline.
  useEffect(() => {
    if (!timed) return;
    const o = latest.current.opts;
    if (phase === "playing" && o) setShown(o.advance(state, Math.max(state.tick, currentTick())));
    else setShown(state);
  }, [timed, state, phase, currentTick]);

  const moveTick = useCallback((): number => (timed ? Math.max(currentTick(), latest.current.host.current()?.state.tick ?? 0) : 0), [timed, currentTick]);

  return { shown: timed ? shown : state, moveTick };
}
