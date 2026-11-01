import { useCallback, useEffect, useRef, useState } from "react";
import type { PracticeApi } from "./usePractice.js";

export interface TickedOptions<S, M> {
  tickMs: number;
  maxTick: number;
  roundSeconds: number;
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
 * same passage of time. The tick runs one behind the wall clock so a claim never gets ahead of the
 * server's view of it.
 */
export function useTicked<S extends { readonly tick: number }, M>(api: PracticeApi<S, M>, opts: TickedOptions<S, M>): TickedApi<S> {
  const { tickMs, maxTick, roundSeconds } = opts;
  const waitEvery = opts.waitEveryTicks ?? 20;
  const { state, phase } = api;
  const [shown, setShown] = useState<S>(state);
  const finalWaitSent = useRef(false);
  // The practice api and options are read through refs so the interval below outlives re-renders.
  const latest = useRef({ api, opts });
  latest.current = { api, opts };

  const currentTick = useCallback((): number => {
    const r = latest.current.api.current();
    if (!r) return 0;
    const start = r.opts.deadlineAt - roundSeconds * 1000;
    return Math.max(0, Math.min(maxTick, Math.floor((Date.now() - start) / tickMs) - 1));
  }, [roundSeconds, maxTick, tickMs]);

  useEffect(() => {
    if (phase !== "playing") {
      setShown(latest.current.api.state);
      finalWaitSent.current = false;
      return;
    }
    const step = (): void => {
      const { api: a, opts: o } = latest.current;
      const r = a.current();
      if (!r || r.isFinished) return;
      const tick = currentTick();
      const msLeft = r.opts.deadlineAt - Date.now();
      if (msLeft < 600 && !finalWaitSent.current) {
        finalWaitSent.current = true;
        a.apply(o.wait(tick), false);
        return;
      }
      if (tick - r.state.tick >= waitEvery) {
        a.apply(o.wait(tick), false);
        return;
      }
      setShown(o.advance(r.state, tick));
    };
    step();
    const id = window.setInterval(step, tickMs);
    return () => window.clearInterval(id);
  }, [phase, currentTick, tickMs, waitEvery]);

  // A logged move resets the display baseline.
  useEffect(() => {
    if (phase === "playing") setShown(latest.current.opts.advance(state, Math.max(state.tick, currentTick())));
  }, [state, phase, currentTick]);

  const moveTick = useCallback((): number => Math.max(currentTick(), latest.current.api.current()?.state.tick ?? 0), [currentTick]);

  return { shown, moveTick };
}
