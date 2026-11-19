import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "../frame/RoundFrame.jsx";
import { localSeed, type PracticeApi } from "../practice/usePractice.js";
import type { StudioPuzzle } from "../puzzles.js";
import { replayAgrees, replayRound } from "./replay.js";
import { publishRoundClock } from "./roundClock.js";
import { numbersOf, type RoundNote, type RoundNumbers } from "../frame/rounds.js";

export interface StudioRound {
  /** Start a round on the frame's numbers. With no seed given: the pinned one, or a fresh one when none is pinned. */
  start(seed?: string): void;
  /** False while the current build refuses the draft's numbers: nothing can be dealt. */
  ready: boolean;
  /** Idle hints for the round in play (a link can turn them off). */
  hints: boolean;
}

/**
 * A round's clock, reachable from a script and from nowhere on screen. The guides' capture holds
 * a round still and steps it a tick at a time so each frame lands where it is planned (ADR 0038).
 * The studio's transport bar drives the same clock (ADR 0067, studio/roundClock).
 */
export interface RoundClockHandle {
  pause(): void;
  resume(): void;
  /** Advance a held clock by this many milliseconds; one tick of a ticked puzzle when left out, else a second. */
  step(ms?: number): void;
  readonly paused: boolean;
  /** The tick a ticked puzzle's round is on; null for the others. */
  readonly tick: number | null;
}
declare global {
  interface Window {
    openseasRoundClock?: RoundClockHandle;
  }
}

/** How long the hand must rest on a control before the round is dealt again on the new number. */
const RESTART_MS = 450;
const RESTART_KEY = "openseas.studio.restart";

/** Whether a changed number deals the round again by itself. On unless the owner pinned it off. */
export function readRestart(): boolean {
  try {
    return window.localStorage.getItem(RESTART_KEY) !== "0";
  } catch {
    return true;
  }
}
export function writeRestart(on: boolean): void {
  try {
    window.localStorage.setItem(RESTART_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

/**
 * What stands between a puzzle's page and the frame around it (frame/RoundFrame): it deals the
 * round on the frame's numbers, shows them behind the start card, deals the same seed again when
 * a number changes or the shipped numbers are held up for comparison, and replays every finished
 * round from its seed, reporting only whether that agreed (ADR 0042 decision 3).
 */
export function useStudio<S, M, C>(puzzle: StudioPuzzle<S, M, C>, api: PracticeApi<S, M, C>): StudioRound {
  const frame = useFrame();
  const { scenario, setScenario, numbers, setReport, comparing } = frame;
  // The shipped numbers always play; only the draft can be refused.
  const ready = comparing || frame.refusals.length === 0;
  const config = numbers.config as C;

  // What the round on the board was dealt on, read as it is dealt: a number changed mid-round with
  // dealing again pinned off does not change what that round was played on (frame/rounds).
  const dealtOn = useRef<{ tuned: boolean; changes: RoundNote["changes"]; numbers: RoundNumbers }>({ tuned: true, changes: [], numbers: numbersOf(scenario) });
  const start = useCallback(
    (seed?: string) => {
      if (!ready) return;
      dealtOn.current = comparing
        ? { tuned: false, changes: [], numbers: { stage: scenario.stage, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null } }
        : { tuned: true, changes: frame.changes, numbers: numbersOf(scenario) };
      api.start({
        seed: seed ?? scenario.seed ?? localSeed(),
        config,
        roundSeconds: numbers.roundSeconds,
        thresholds: numbers.thresholds,
        speed: scenario.speed,
        paused: scenario.paused,
      });
    },
    [api, config, numbers, ready, scenario, comparing, frame.changes],
  );

  // The board behind the start card shows the draft: its seed and config. Only the stable parts
  // of the api are dependencies; the api object itself is rebuilt every render and would loop.
  const { phase, preview } = api;
  useEffect(() => {
    if (phase === "idle" && ready) preview(scenario.seed ?? "menu", config);
  }, [phase, preview, scenario.seed, config, ready]);

  // A page opened with ?start= gets going on its own.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (!scenario.autostart) return;
    start();
    setScenario({ ...scenario, autostart: null });
  }, [scenario, setScenario, start]);

  // A number changed under a round: deal the same seed again on the new numbers, once the hand
  // rests. Holding the shipped numbers up, or letting them go, does it at once.
  const latest = useRef({ start, phase, seed: api.round?.seed ?? null });
  latest.current = { start, phase, seed: api.round?.seed ?? null };
  const dealt = useRef({ numbers, comparing });
  useEffect(() => {
    const was = dealt.current;
    if (was.numbers === numbers) return;
    const compared = was.comparing !== comparing;
    dealt.current = { numbers, comparing };
    if (!ready || latest.current.phase === "idle") return;
    if (!compared && !readRestart()) return;
    const id = window.setTimeout(
      () => {
        const now = latest.current;
        if (now.phase !== "idle" && now.seed) now.start(now.seed);
      },
      compared ? 0 : RESTART_MS,
    );
    return () => window.clearTimeout(id);
  }, [numbers, comparing, ready]);

  // Replay the finished round from its seed and compare every hash: the determinism check.
  const replayMismatch = useMemo((): boolean => {
    if (api.phase !== "result") return false;
    const round = api.round;
    if (!round || api.log.length === 0) return false;
    try {
      return !replayAgrees(
        replayRound(
          puzzle.def,
          round.seed,
          round.config,
          api.log.map((m) => m.move),
          api.log.map((m) => m.hash),
        ),
      );
    } catch {
      return true;
    }
    // api.log is a live array; api.version changes whenever it grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.phase, api.round, api.version, puzzle.def]);
  const roundSeed = api.phase === "idle" ? null : (api.round?.seed ?? null);
  useEffect(() => setReport({ seed: roundSeed, replayMismatch }), [setReport, roundSeed, replayMismatch]);

  // Every finished round is remembered in a line: what a message to the agent carries about how play went (ADR 0042 decision 5).
  const { noteRound } = frame;
  const noted = useRef<unknown>(null);
  useEffect(() => {
    const { round, outcome } = api;
    if (api.phase !== "result" || !round || !outcome || noted.current === round) return;
    noted.current = round;
    const on = dealtOn.current;
    noteRound({
      summary: { seed: round.seed, score: outcome.score, tier: outcome.performance.tier, seconds: Math.max(0, api.roundSeconds - api.timeLeft), moves: outcome.moves, tuned: on.tuned },
      bestCombo: outcome.bestCombo,
      changes: on.changes,
      numbers: on.numbers,
    });
    // The round's own fields are read once, as it ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.phase, api.round, api.outcome, noteRound]);

  // The round's clock, for a script (see RoundClockHandle).
  const clock = api.clock;
  const tickMs = puzzle.ticked?.tickMs ?? null;
  useEffect(() => {
    if (!clock) return;
    const startedAt = api.current()?.opts.startedAt ?? clock.now();
    const handle: RoundClockHandle = {
      pause: () => clock.pause(),
      resume: () => clock.resume(),
      step: (ms) => clock.step(ms ?? tickMs ?? 1000),
      get paused() {
        return clock.isPaused;
      },
      get tick() {
        return tickMs ? Math.max(0, Math.floor(Math.max(0, clock.now() - startedAt) / tickMs) - 1) : null;
      },
    };
    window.openseasRoundClock = handle;
    // And for the transport bar under the board (ADR 0067).
    publishRoundClock(clock, tickMs);
    return () => {
      if (window.openseasRoundClock === handle) delete window.openseasRoundClock;
      publishRoundClock(null, null);
    };
    // api.current is stable; the round it reads changes with the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, tickMs]);

  return { start, ready, hints: scenario.hints };
}
