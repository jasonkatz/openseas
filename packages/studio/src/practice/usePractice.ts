import { useCallback, useEffect, useRef, useState } from "react";
import { performanceRating, tierFor, type PuzzleDef, type PuzzleId } from "@openseas/engine";
import { LabClock, PuzzleRound, content, sfx, type LoggedMove, type TickedHost } from "@openseas/boards";

export type PracticePhase = "idle" | "playing" | "result";

/** One round's own performance against thresholds: a rating and the tier it falls in (ADR 0028). */
export interface Performance {
  rating: number;
  tier: string;
}

/** How a finished round came out. Nothing here is recorded or rated anywhere: a studio round is local (ADR 0042 decision 3). */
export interface PracticeOutcome {
  score: number;
  moves: number;
  bestCombo: number;
  performance: Performance;
}

export interface Threshold {
  readonly score: number;
  readonly rating: number;
}

/** What the server would rate a score at against these thresholds. */
export function ratePerformance(score: number, thresholds: readonly Threshold[]): Performance {
  const rating = performanceRating(score, thresholds);
  return { rating, tier: tierFor(rating, content.ratingTiers).key };
}

/** Everything a round is dealt on. The studio checks it against the server's rules before it gets here (frame/numbers). */
export interface RoundStart<C> {
  seed: string;
  config: C;
  roundSeconds: number;
  /** What the round's score is rated against. */
  thresholds: readonly Threshold[];
  /** Clock rate at the start; 1 is real time. For a script: the studio has no control for it. */
  speed?: number;
  /** Start with the clock stopped. For a script, as above. */
  paused?: boolean;
}

export interface PracticeOptions<S, M, C> {
  puzzle: PuzzleId;
  def: PuzzleDef<S, M, C>;
  /** The content config and round length: what sits behind the start card until the frame says otherwise. */
  config: C;
  roundSeconds: number;
  /** Reads the three summary numbers off a state for the result card. */
  summarize(state: S): { score: number; moves: number; bestCombo: number };
  /** Fires after every applied move with the new and previous state, for sound and counters. */
  onMove?(state: S, prev: S): void;
}

/** The round in play or last played. */
export interface RoundInfo<C> {
  seed: string;
  config: C;
  roundSeconds: number;
  thresholds: readonly Threshold[];
}

export interface PracticeApi<S, M, C> extends TickedHost<S, M> {
  phase: PracticePhase;
  state: S;
  /** Monotonic counter so the same state object can be re-applied after a reset. */
  version: number;
  timeLeft: number;
  /** Length of the round in play, or the content round length between rounds. */
  roundSeconds: number;
  outcome: PracticeOutcome | null;
  round: RoundInfo<C> | null;
  /** The clock of the round in play or last played. */
  clock: LabClock | null;
  /** Every move applied this round, with the engine's hash after it. */
  log: readonly LoggedMove<M>[];
  start(round: RoundStart<C>): void;
  /** End the round now, as if the clock ran out. */
  stop(): void;
  /** Drop the round or result and show the start card again, with this board behind it. */
  reset(seed?: string, config?: C): void;
  /** Change the board behind the start card without starting a round. Ignored while a round runs. */
  preview(seed: string, config: C): void;
  /** Apply a move to the running round. Returns false when there is no round or the engine refused. */
  apply(move: M, countsAsInput?: boolean): boolean;
  canApply(move: M): boolean;
  markRendered(): void;
  /** The live round, for renderers that need engine queries (ghost pieces, previews). */
  current(): PuzzleRound<S, M, unknown> | null;
}

/** A seed for a fresh round, the way the game's unrated practice makes one. */
export function localSeed(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The round every puzzle page runs: start on a seed and a set of numbers, run the clock, apply
 * moves through the engine, show a result. It all happens in this browser: the studio sends no
 * round to a server, and what holds an engine to replay is the check after every round
 * (studio/useStudio) and the engine's own tests (ADR 0042).
 */
export function usePractice<S, M, C>(opts: PracticeOptions<S, M, C>): PracticeApi<S, M, C> {
  const { def, config, roundSeconds } = opts;
  const [phase, setPhase] = useState<PracticePhase>("idle");
  // A fixed board sits behind the start card so the page never opens empty.
  const [state, setState] = useState<S>(() => def.create("menu", config));
  const [version, setVersion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(roundSeconds);
  const [outcome, setOutcome] = useState<PracticeOutcome | null>(null);
  const [roundInfo, setRoundInfo] = useState<RoundInfo<C> | null>(null);
  const round = useRef<PuzzleRound<S, M, C> | null>(null);
  const roundClock = useRef<LabClock | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  const start = useCallback(
    (s: RoundStart<C>) => {
      round.current?.abandon();
      const clock = new LabClock(s.speed ?? 1, s.paused ?? false);
      roundClock.current = clock;
      const startedAt = clock.now();
      const deadlineAt = startedAt + s.roundSeconds * 1000;
      const r = new PuzzleRound<S, M, C>({
        def,
        seed: s.seed,
        config: s.config,
        startedAt,
        deadlineAt,
        clock,
        rated: null,
        onChange: (next, prev) => {
          setState(next);
          setVersion((v) => v + 1);
          if (prev !== null) latest.current.onMove?.(next, prev);
        },
        onFinished: () => {
          sfx.end();
          const last = round.current?.state;
          if (last) {
            const sum = latest.current.summarize(last);
            setOutcome({ ...sum, performance: ratePerformance(sum.score, s.thresholds) });
          }
          setPhase("result");
        },
      });
      round.current = r;
      setRoundInfo({ seed: s.seed, config: s.config, roundSeconds: s.roundSeconds, thresholds: s.thresholds });
      setOutcome(null);
      setTimeLeft(s.roundSeconds);
      setPhase("playing");
      sfx.start();
    },
    [def],
  );

  // Round clock, with a tick for each of the last ten seconds. Reads the round's own clock.
  useEffect(() => {
    if (phase !== "playing") return;
    let last = -1;
    const id = window.setInterval(() => {
      const r = round.current;
      if (!r) return;
      const left = Math.max(0, Math.ceil((r.opts.deadlineAt - r.opts.clock.now()) / 1000));
      setTimeLeft(left);
      if (left !== last && left > 0 && left <= 10) sfx.tick(left <= 5);
      last = left;
      if (left <= 0) r.finish();
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, roundInfo]);

  useEffect(() => () => round.current?.abandon(), []);

  const apply = useCallback((move: M, countsAsInput = true): boolean => round.current?.apply(move, countsAsInput) !== null && round.current !== null, []);
  const canApply = useCallback((move: M): boolean => round.current?.canApply(move) ?? false, []);
  const markRendered = useCallback(() => round.current?.metrics.markRendered(), []);
  const current = useCallback(() => round.current as PuzzleRound<S, M, unknown> | null, []);
  const stop = useCallback(() => round.current?.finish(), []);

  const preview = useCallback(
    (seed: string, cfg: C) => {
      if (round.current && !round.current.isFinished) return;
      try {
        setState(def.create(seed, cfg));
        setVersion((v) => v + 1);
      } catch {
        /* an invalid config; the frame shows why it will not play */
      }
    },
    [def],
  );

  const reset = useCallback(
    (seed?: string, cfg?: C) => {
      round.current?.abandon();
      round.current = null;
      setOutcome(null);
      setPhase("idle");
      setTimeLeft(roundSeconds);
      try {
        setState(def.create(seed ?? "menu", cfg ?? config));
        setVersion((v) => v + 1);
      } catch {
        /* keep the last board */
      }
    },
    [def, config, roundSeconds],
  );

  return {
    phase,
    state,
    version,
    timeLeft: phase === "idle" ? roundSeconds : timeLeft,
    roundSeconds: phase !== "idle" && roundInfo ? roundInfo.roundSeconds : roundSeconds,
    outcome,
    round: roundInfo,
    clock: phase === "idle" ? null : roundClock.current,
    log: round.current?.log ?? [],
    start,
    stop,
    reset,
    preview,
    apply,
    canApply,
    markRendered,
    current,
  };
}
