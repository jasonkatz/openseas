import { useCallback, useEffect, useRef, useState } from "react";
import type { PuzzleDef, PuzzleId } from "@openseas/engine";
import type { PuzzleResult, ServerMessage } from "@openseas/protocol";
import { sfx } from "../audio.js";
import { usePirate } from "../state/PirateProvider.jsx";
import { PuzzleRound } from "./round.js";

export type PracticePhase = "idle" | "starting" | "playing" | "waiting" | "result";
export type PracticeOutcome =
  | { kind: "rated"; result: PuzzleResult; newBest: boolean }
  | { kind: "rejected"; reason: string }
  | { kind: "unrated"; score: number; moves: number; bestCombo: number; newBest: boolean };

export interface PracticeOptions<S, M, C> {
  puzzle: PuzzleId;
  def: PuzzleDef<S, M, C>;
  config: C;
  roundSeconds: number;
  /** Reads the three summary numbers off a state for the unrated result card. */
  summarize(state: S): { score: number; moves: number; bestCombo: number };
  /** Fires after every applied move with the new and previous state, for sound and counters. */
  onMove?(state: S, prev: S): void;
}

export interface PracticeApi<S, M> {
  phase: PracticePhase;
  state: S;
  /** Monotonic counter so the same state object can be re-applied after a reset. */
  version: number;
  timeLeft: number;
  outcome: PracticeOutcome | null;
  best: number;
  canRate: boolean;
  rated: boolean;
  startRated(): void;
  startUnrated(): void;
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

/**
 * The practice-page lifecycle every duty puzzle shares: start rated or unrated, run the clock,
 * stream moves, wait for the ship's verdict, show a result. Puzzle pages add their board and stats.
 */
export function usePractice<S, M, C>(opts: PracticeOptions<S, M, C>): PracticeApi<S, M> {
  const { puzzle, def, config, roundSeconds, summarize, onMove } = opts;
  const { pirate, socket, socketStatus, setPirate } = usePirate();
  const [phase, setPhase] = useState<PracticePhase>("idle");
  // A fixed board sits behind the start card so the page never opens empty.
  const [state, setState] = useState<S>(() => def.create("menu", config));
  const [version, setVersion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(roundSeconds);
  const [outcome, setOutcome] = useState<PracticeOutcome | null>(null);
  const [best, setBest] = useState(() => readBest(puzzle));
  const round = useRef<PuzzleRound<S, M, C> | null>(null);
  const sessionId = useRef<string | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const canRate = socketStatus === "open" && pirate !== null;

  const beginRound = useCallback(
    (seed: string, roundConfig: C, deadlineAt: number, rated: { sessionId: string } | null) => {
      round.current?.abandon();
      const r = new PuzzleRound<S, M, C>({
        def,
        seed,
        config: roundConfig,
        deadlineAt,
        rated: rated ? { socket, sessionId: rated.sessionId } : null,
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
              const newBest = recordBest(puzzle, sum.score);
              if (newBest) setBest(sum.score);
              setOutcome({ kind: "unrated", ...sum, newBest });
            }
            setPhase("result");
          }
        },
      });
      round.current = r;
      sessionId.current = rated?.sessionId ?? null;
      setOutcome(null);
      setTimeLeft(Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)));
      setPhase("playing");
      sfx.start();
    },
    [def, puzzle, socket],
  );

  const startUnrated = useCallback(() => {
    const seed = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    beginRound(seed, config, Date.now() + roundSeconds * 1000, null);
  }, [beginRound, config, roundSeconds]);

  const startRated = useCallback(() => {
    setPhase("starting");
    if (!socket.send({ type: "puzzle.start", puzzle })) startUnrated();
  }, [socket, startUnrated, puzzle]);

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "puzzle.started":
            if (m.puzzle !== puzzle) return;
            beginRound(m.seed, m.config as C, m.deadlineAt - socket.clockOffset, { sessionId: m.sessionId });
            break;
          case "puzzle.result": {
            if (m.sessionId !== sessionId.current) return;
            const newBest = recordBest(puzzle, m.score);
            if (newBest) setBest(m.score);
            setOutcome({ kind: "rated", result: m, newBest });
            setPhase("result");
            if (pirate) {
              const others = pirate.ratings.filter((r) => r.puzzle !== m.rating.puzzle);
              setPirate({ ...pirate, ratings: [...others, m.rating] });
            }
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
    [socket, beginRound, pirate, setPirate, puzzle],
  );

  // Round clock, with a tick for each of the last ten seconds.
  useEffect(() => {
    if (phase !== "playing") return;
    let last = -1;
    const id = window.setInterval(() => {
      const r = round.current;
      if (!r) return;
      const left = Math.max(0, Math.ceil((r.opts.deadlineAt - Date.now()) / 1000));
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

  return {
    phase,
    state,
    version,
    timeLeft: phase === "idle" ? roundSeconds : timeLeft,
    outcome,
    best,
    canRate,
    rated: round.current?.rated ?? false,
    startRated,
    startUnrated,
    apply,
    canApply,
    markRendered,
    current,
  };
}
