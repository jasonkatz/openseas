import { useCallback, useRef, useState } from "react";
import { performanceRating, tierFor, type PuzzleId } from "@openseas/engine";
import type { PuzzleResult } from "@openseas/protocol";
import { LabClock, content, sfx, usePirate, useRoundSession, wallClock, type LoggedMove, type PuzzleRound, type RoundMessage, type RoundPhase, type TickedHost } from "@openseas/boards";
import type { HarnessPuzzle } from "../puzzles.js";

/** "dealing" while a recorded round waits for the server's deal. */
export type PracticePhase = RoundPhase;
/**
 * Recorded and unrated rounds play exactly what the game deals; a lab round is the harness's own,
 * with a chosen seed, config and clock. A recorded round goes through the server, which verifies
 * and keeps it but moves no standing (ADR 0028); unrated and lab rounds stay in this browser.
 */
export type PracticeMode = "recorded" | "unrated" | "lab";
/** One round's own performance against its puzzle's thresholds: a rating and the tier it falls in (ADR 0028). */
export interface Performance {
  rating: number;
  tier: string;
}
export type PracticeOutcome =
  | { kind: "recorded"; result: PuzzleResult; newBest: boolean }
  | { kind: "rejected"; reason: string }
  | { kind: "unrated"; score: number; moves: number; bestCombo: number; newBest: boolean; performance: Performance }
  | { kind: "lab"; score: number; moves: number; bestCombo: number; newBest: false; performance: Performance };

/** What the server would rate a local round's score at, against the content thresholds. */
export function localPerformance(puzzle: PuzzleId, score: number): Performance {
  const rating = performanceRating(score, content.puzzles[puzzle].thresholds);
  return { rating, tier: tierFor(rating, content.ratingTiers).key };
}

export interface LabScenario<C> {
  seed: string;
  config: C;
  roundSeconds: number;
  /** Clock rate at the start; 1 is real time. */
  speed?: number;
  /** Start with the clock stopped, to step through the opening by hand. */
  paused?: boolean;
}

export interface PracticeOptions<S, M> {
  /** A round begins: recorded, unrated or lab. Where a page zeroes the counters it keeps for one round. */
  onRoundStart?(): void;
  /** Fires after every applied move with the new and previous state, for counters. */
  onMove?(state: S, prev: S): void;
  /** A message the server sends about the recorded round in play, as the move it vouches for (a lone ship's heat), or null. */
  inbound?(message: RoundMessage): M | null;
}

/** The round in play or last played. */
export interface RoundInfo<C> {
  mode: PracticeMode;
  seed: string;
  config: C;
  roundSeconds: number;
  sessionId: string | null;
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
  best: number;
  canRecord: boolean;
  /** True while the round in play goes through the server. */
  recorded: boolean;
  round: RoundInfo<C> | null;
  /** The lab clock of a lab round in play or last played; null for the game's own modes. */
  clock: LabClock | null;
  /** Every move applied this round, with the engine's hash after it. */
  log: readonly LoggedMove<M>[];
  startRecorded(): void;
  startUnrated(): void;
  startLab(scenario: LabScenario<C>): void;
  /** End the round now, as if the clock ran out. A recorded round is scored by the server as it stands. */
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

function bestKey(puzzle: PuzzleId): string {
  return `openseas.${puzzle}.best`;
}

function readBest(puzzle: PuzzleId): number {
  try {
    return Number(window.localStorage.getItem(bestKey(puzzle))) || 0;
  } catch {
    return 0;
  }
}

/** Records a finished round's score; true when it beats the stored best. Display only, per device. */
function recordBest(puzzle: PuzzleId, score: number): boolean {
  if (score <= readBest(puzzle)) return false;
  try {
    window.localStorage.setItem(bestKey(puzzle), String(score));
  } catch {
    /* private mode */
  }
  return true;
}

/** A seed for a local round, the way the game's unrated practice makes one. */
export function localSeed(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The practice-page lifecycle every duty puzzle shares: start a round, run the clock, stream moves,
 * wait for the ship's verdict, show a result. The round itself, dealt or local, is the board's round
 * session; this adds the modes and the local result. Recorded and unrated rounds play what the game
 * deals; a lab round adds a chosen seed, config and a clock the harness drives. Every result carries
 * the round's performance rating; none moves the pirate's standing (ADR 0028).
 */
export function usePractice<S, M, C>(puzzle: HarnessPuzzle<S, M, C>, opts: PracticeOptions<S, M> = {}): PracticeApi<S, M, C> {
  const { id, def, config, roundSeconds } = puzzle;
  const { pirate, socketStatus } = usePirate();
  const [outcome, setOutcome] = useState<PracticeOutcome | null>(null);
  const [best, setBest] = useState(() => readBest(id));
  const [roundInfo, setRoundInfo] = useState<RoundInfo<C> | null>(null);
  const info = useRef<RoundInfo<C> | null>(null);
  const labClock = useRef<LabClock | null>(null);
  const canRecord = socketStatus === "open" && pirate !== null;

  // The page's callbacks are read through a ref so the start callbacks below stay stable.
  const latest = useRef(opts);
  latest.current = opts;

  /** A round is in play, dealt or local. A board handed back on a reconnect is the same round going on (ADR 0024). */
  const began = useCallback((next: RoundInfo<C>, handedBack = false): void => {
    if (!handedBack) latest.current.onRoundStart?.();
    info.current = next;
    setRoundInfo(next);
    setOutcome(null);
    sfx.start();
  }, []);

  const session = useRoundSession<S, M, C>({
    def,
    // A fixed board sits behind the start card so the page never opens empty.
    initial: () => def.create("menu", config),
    accepts: (m) => m.puzzle === id,
    inbound: (m) => opts.inbound?.(m) ?? null,
    countdown: true,
    onDeal: (m, r, handedBack) => {
      labClock.current = null;
      began({ mode: "recorded", seed: m.seed, config: m.config as C, roundSeconds: Math.round(r.lengthMs / 1000), sessionId: m.sessionId }, handedBack);
    },
    onMove: (s, prev) => opts.onMove?.(s, prev),
    onFinished: (s, rated) => {
      sfx.end();
      if (rated) return;
      const sum = def.summarize(s);
      const performance = localPerformance(id, sum.score);
      if (info.current?.mode === "lab") setOutcome({ kind: "lab", ...sum, newBest: false, performance });
      else {
        const newBest = recordBest(id, sum.score);
        if (newBest) setBest(sum.score);
        setOutcome({ kind: "unrated", ...sum, newBest, performance });
      }
    },
    onVerdict: (o) => {
      if (o.kind === "rejected") {
        setOutcome(o);
        return;
      }
      const newBest = recordBest(id, o.result.score);
      if (newBest) setBest(o.result.score);
      setOutcome({ kind: "recorded", result: o.result, newBest });
    },
  });
  const { phase, ask, start, show, drop, current } = session;

  const startUnrated = useCallback(() => {
    labClock.current = null;
    const seed = localSeed();
    start({ seed, config, roundMs: roundSeconds * 1000, clock: wallClock });
    began({ mode: "unrated", seed, config, roundSeconds, sessionId: null });
  }, [start, began, config, roundSeconds]);

  const startRecorded = useCallback(() => {
    if (!ask({ type: "puzzle.start", puzzle: id })) startUnrated();
  }, [ask, startUnrated, id]);

  const startLab = useCallback(
    (scenario: LabScenario<C>) => {
      const clock = new LabClock(scenario.speed ?? 1, scenario.paused ?? false);
      labClock.current = clock;
      start({ seed: scenario.seed, config: scenario.config, roundMs: scenario.roundSeconds * 1000, clock });
      began({ mode: "lab", seed: scenario.seed, config: scenario.config, roundSeconds: scenario.roundSeconds, sessionId: null });
    },
    [start, began],
  );

  const stop = useCallback(() => current()?.finish(), [current]);

  const preview = useCallback(
    (seed: string, cfg: C) => {
      const r = current();
      if (r && !r.isFinished) return;
      try {
        show(def.create(seed, cfg));
      } catch {
        /* an invalid config; the caller shows the validation error */
      }
    },
    [current, show, def],
  );

  const reset = useCallback(
    (seed?: string, cfg?: C) => {
      drop();
      setOutcome(null);
      try {
        show(def.create(seed ?? "menu", cfg ?? config));
      } catch {
        /* keep the last board */
      }
    },
    [drop, show, def, config],
  );

  const inRound = phase === "playing" || phase === "waiting" || phase === "result";
  const r = current();
  return {
    phase,
    state: session.state,
    version: session.version,
    timeLeft: phase === "idle" ? roundSeconds : (session.secondsLeft ?? roundSeconds),
    roundSeconds: inRound && roundInfo ? roundInfo.roundSeconds : roundSeconds,
    outcome,
    best,
    canRecord,
    recorded: r?.rated ?? false,
    round: roundInfo,
    clock: roundInfo?.mode === "lab" ? labClock.current : null,
    log: r?.log ?? [],
    startRecorded,
    startUnrated,
    startLab,
    stop,
    reset,
    preview,
    apply: session.apply,
    canApply: session.canApply,
    markRendered: session.markRendered,
    current,
  };
}
