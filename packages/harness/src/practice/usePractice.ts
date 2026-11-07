import { useCallback, useEffect, useRef, useState } from "react";
import { performanceRating, tierFor, type PuzzleDef, type PuzzleId } from "@openseas/engine";
import type { PuzzleResult, ServerMessage } from "@openseas/protocol";
import { LabClock, PuzzleRound, content, sfx, usePirate, wallClock, type Clock, type LoggedMove, type TickedHost } from "@openseas/boards";

export type PracticePhase = "idle" | "starting" | "playing" | "waiting" | "result";
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

export interface PracticeOptions<S, M, C> {
  puzzle: PuzzleId;
  def: PuzzleDef<S, M, C>;
  /** What recorded and unrated rounds play with: the content config and round length. */
  config: C;
  roundSeconds: number;
  /** Reads the three summary numbers off a state for the local result card. */
  summarize(state: S): { score: number; moves: number; bestCombo: number };
  /** Fires after every applied move with the new and previous state, for sound and counters. */
  onMove?(state: S, prev: S): void;
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
 * wait for the ship's verdict, show a result. Recorded and unrated rounds play what the game deals;
 * a lab round adds a chosen seed, config and a clock the harness drives. Every result carries the
 * round's performance rating; none moves the pirate's standing (ADR 0028).
 */
export function usePractice<S, M, C>(opts: PracticeOptions<S, M, C>): PracticeApi<S, M, C> {
  const { puzzle, def, config, roundSeconds, summarize, onMove } = opts;
  const { pirate, socket, socketStatus } = usePirate();
  const [phase, setPhase] = useState<PracticePhase>("idle");
  // A fixed board sits behind the start card so the page never opens empty.
  const [state, setState] = useState<S>(() => def.create("menu", config));
  const [version, setVersion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(roundSeconds);
  const [outcome, setOutcome] = useState<PracticeOutcome | null>(null);
  const [best, setBest] = useState(() => readBest(puzzle));
  const [roundInfo, setRoundInfo] = useState<RoundInfo<C> | null>(null);
  const round = useRef<PuzzleRound<S, M, C> | null>(null);
  const labClock = useRef<LabClock | null>(null);
  const sessionId = useRef<string | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const canRecord = socketStatus === "open" && pirate !== null;

  const beginRound = useCallback(
    (info: RoundInfo<C>, startedAt: number, deadlineAt: number, clock: Clock) => {
      round.current?.abandon();
      const rated = info.mode === "recorded" && info.sessionId ? { socket, sessionId: info.sessionId } : null;
      const r = new PuzzleRound<S, M, C>({
        def,
        seed: info.seed,
        config: info.config,
        startedAt,
        deadlineAt,
        clock,
        rated,
        onChange: (s, prev) => {
          setState(s);
          setVersion((v) => v + 1);
          if (prev !== null) latest.current.onMove?.(s, prev);
        },
        onFinished: () => {
          sfx.end();
          if (rated) setPhase("waiting");
          else {
            const s = round.current?.state;
            if (s) {
              const sum = latest.current.summarize(s);
              const performance = localPerformance(puzzle, sum.score);
              if (info.mode === "lab") setOutcome({ kind: "lab", ...sum, newBest: false, performance });
              else {
                const newBest = recordBest(puzzle, sum.score);
                if (newBest) setBest(sum.score);
                setOutcome({ kind: "unrated", ...sum, newBest, performance });
              }
            }
            setPhase("result");
          }
        },
      });
      round.current = r;
      sessionId.current = info.sessionId;
      setRoundInfo(info);
      setOutcome(null);
      setTimeLeft(Math.max(0, Math.ceil((deadlineAt - clock.now()) / 1000)));
      setPhase("playing");
      sfx.start();
    },
    [def, puzzle, socket],
  );

  const startUnrated = useCallback(() => {
    labClock.current = null;
    const now = wallClock.now();
    beginRound({ mode: "unrated", seed: localSeed(), config, roundSeconds, sessionId: null }, now, now + roundSeconds * 1000, wallClock);
  }, [beginRound, config, roundSeconds]);

  const startRecorded = useCallback(() => {
    setPhase("starting");
    if (!socket.send({ type: "puzzle.start", puzzle })) startUnrated();
  }, [socket, startUnrated, puzzle]);

  const startLab = useCallback(
    (scenario: LabScenario<C>) => {
      const clock = new LabClock(scenario.speed ?? 1, scenario.paused ?? false);
      labClock.current = clock;
      const now = clock.now();
      beginRound(
        { mode: "lab", seed: scenario.seed, config: scenario.config, roundSeconds: scenario.roundSeconds, sessionId: null },
        now,
        now + scenario.roundSeconds * 1000,
        clock,
      );
    },
    [beginRound],
  );

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "puzzle.started": {
            if (m.puzzle !== puzzle) return;
            labClock.current = null;
            const startedAt = m.serverNow - socket.clockOffset;
            const deadlineAt = m.deadlineAt - socket.clockOffset;
            beginRound(
              { mode: "recorded", seed: m.seed, config: m.config as C, roundSeconds: Math.round((deadlineAt - startedAt) / 1000), sessionId: m.sessionId },
              startedAt,
              deadlineAt,
              wallClock,
            );
            break;
          }
          case "puzzle.result": {
            if (m.sessionId !== sessionId.current) return;
            const newBest = recordBest(puzzle, m.score);
            if (newBest) setBest(m.score);
            setOutcome({ kind: "recorded", result: m, newBest });
            setPhase("result");
            break;
          }
          case "puzzle.rejected":
            if (m.sessionId !== sessionId.current) return;
            round.current?.abandon();
            setOutcome({ kind: "rejected", reason: m.reason });
            setPhase("result");
            break;
          default:
            break;
        }
      }),
    [socket, beginRound, puzzle],
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
  }, [phase]);

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
        /* an invalid config; the caller shows the validation error */
      }
    },
    [def],
  );

  const reset = useCallback(
    (seed?: string, cfg?: C) => {
      round.current?.abandon();
      round.current = null;
      sessionId.current = null;
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

  const inRound = phase === "playing" || phase === "waiting" || phase === "result";
  return {
    phase,
    state,
    version,
    timeLeft: phase === "idle" ? roundSeconds : timeLeft,
    roundSeconds: inRound && roundInfo ? roundInfo.roundSeconds : roundSeconds,
    outcome,
    best,
    canRecord,
    recorded: round.current?.rated ?? false,
    round: roundInfo,
    clock: roundInfo?.mode === "lab" ? labClock.current : null,
    log: round.current?.log ?? [],
    startRecorded,
    startUnrated,
    startLab,
    stop,
    reset,
    preview,
    apply,
    canApply,
    markRendered,
    current,
  };
}
