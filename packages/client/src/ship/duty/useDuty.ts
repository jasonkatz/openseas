import { useCallback, useEffect, useRef, useState } from "react";
import type { PuzzleDef, PuzzleId } from "@openseas/engine";
import type { PuzzleResult, PuzzleStarted, ServerMessage } from "@openseas/protocol";
import { PuzzleRound, sfx, usePirate, wallClock, type TickedHost } from "@openseas/boards";

export type DutyPhase = "idle" | "dealing" | "playing" | "waiting" | "result";
export type DutyOutcome = { kind: "scored"; result: PuzzleResult } | { kind: "rejected"; reason: string };

export interface DutyOptions<S, M, C> {
  puzzle: PuzzleId;
  def: PuzzleDef<S, M, C>;
  /** The content config and round length, for the board shown before the first deal. */
  config: C;
  roundSeconds: number;
  /** True while the pirate is at this station and the ship is at sea: boards are dealt back to back. */
  active: boolean;
  onMove?(state: S, prev: S): void;
  /** Moves the ship injects into a freshly dealt board, from what the deal says (the bilge's depth). */
  dealt?(started: PuzzleStarted): M[];
  /** A move the ship injects into the running board from a server message, or null. */
  shipMove?(message: ServerMessage, sessionId: string): M | null;
}

export interface DutyApi<S, M> extends TickedHost<S, M> {
  phase: DutyPhase;
  state: S;
  version: number;
  timeLeft: number;
  roundSeconds: number;
  outcome: DutyOutcome | null;
  apply(move: M, countsAsInput?: boolean): boolean;
  canApply(move: M): boolean;
  markRendered(): void;
  current(): PuzzleRound<S, M, unknown> | null;
}

const RESTART_MS = 1600;
const RETRY_MS = 3000;

/**
 * The life of a duty board at a station (DESIGN.md 3.11): the server deals a board the moment the
 * pirate is at a station at sea, the board streams its moves like any rated round, and when it ends
 * another is dealt, so a station is always busy, as in the original. Leaving the station, docking
 * or going ashore cuts the board short; the server scores what was played, unrated.
 */
export function useDuty<S, M, C>(opts: DutyOptions<S, M, C>): DutyApi<S, M> {
  const { puzzle, def, config, roundSeconds, active } = opts;
  const { socket, socketStatus } = usePirate();
  const [phase, setPhase] = useState<DutyPhase>("idle");
  const [state, setState] = useState<S>(() => def.create("deck", config));
  const [version, setVersion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(roundSeconds);
  const [outcome, setOutcome] = useState<DutyOutcome | null>(null);
  const [roundLength, setRoundLength] = useState(roundSeconds);
  const round = useRef<PuzzleRound<S, M, C> | null>(null);
  const sessionId = useRef<string | null>(null);
  const holdUntil = useRef(0);
  const latest = useRef(opts);
  latest.current = opts;
  const online = socketStatus === "open";

  const deal = useCallback(() => {
    if (Date.now() < holdUntil.current) return;
    if (socket.send({ type: "duty.start" })) setPhase("dealing");
  }, [socket]);

  // Deal when the station goes live; drop the board when it goes quiet.
  useEffect(() => {
    if (active && online) {
      if (phase === "idle") deal();
      return;
    }
    round.current?.abandon();
    round.current = null;
    sessionId.current = null;
    if (phase !== "idle") {
      setPhase("idle");
      setOutcome(null);
    }
  }, [active, online, phase, deal]);

  // A dealt board that was refused (the ship docked between the tap and the deal) tries again later.
  useEffect(() => {
    if (phase !== "idle" || !active || !online) return;
    const wait = holdUntil.current - Date.now();
    if (wait <= 0) return;
    const id = window.setTimeout(deal, wait);
    return () => window.clearTimeout(id);
  }, [phase, active, online, deal]);

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "puzzle.started": {
            if (m.puzzle !== puzzle || !m.duty || m.duty.station !== puzzle) return;
            if (!latest.current.active) {
              socket.send({ type: "puzzle.abandon", sessionId: m.sessionId });
              return;
            }
            const startedAt = m.serverNow - socket.clockOffset;
            const deadlineAt = m.deadlineAt - socket.clockOffset;
            round.current?.abandon();
            const r = new PuzzleRound<S, M, C>({
              def,
              seed: m.seed,
              config: m.config as C,
              startedAt,
              deadlineAt,
              clock: wallClock,
              rated: { socket, sessionId: m.sessionId },
              onChange: (s, prev) => {
                setState(s);
                setVersion((v) => v + 1);
                if (prev !== null) latest.current.onMove?.(s, prev);
              },
              onFinished: () => {
                sfx.end();
                setPhase("waiting");
              },
            });
            round.current = r;
            sessionId.current = m.sessionId;
            setRoundLength(Math.max(1, Math.round((deadlineAt - startedAt) / 1000)));
            setTimeLeft(Math.max(0, Math.ceil((deadlineAt - wallClock.now()) / 1000)));
            setOutcome(null);
            setPhase("playing");
            sfx.start();
            for (const move of latest.current.dealt?.(m) ?? []) r.apply(move, false);
            break;
          }
          case "puzzle.result":
            if (m.sessionId !== sessionId.current) return;
            sessionId.current = null;
            setOutcome({ kind: "scored", result: m });
            setPhase("result");
            break;
          case "puzzle.rejected":
            if (m.sessionId !== sessionId.current) return;
            sessionId.current = null;
            round.current?.abandon();
            setOutcome({ kind: "rejected", reason: m.reason });
            setPhase("result");
            break;
          case "duty.water": {
            const sid = sessionId.current;
            const r = round.current;
            if (!sid || !r || m.sessionId !== sid) return;
            const move = latest.current.shipMove?.(m, sid);
            if (move !== null && move !== undefined) r.apply(move, false);
            break;
          }
          case "error":
            if (m.code === "not_at_sea" || m.code === "no_station" || m.code === "not_aboard") {
              holdUntil.current = Date.now() + RETRY_MS;
              setPhase((p) => (p === "dealing" ? "idle" : p));
            }
            break;
          default:
            break;
        }
      }),
    [socket, def, puzzle],
  );

  // The next board follows a finished one after a beat.
  useEffect(() => {
    if (phase !== "result") return;
    const id = window.setTimeout(() => {
      if (latest.current.active) deal();
      else setPhase("idle");
    }, RESTART_MS);
    return () => window.clearTimeout(id);
  }, [phase, deal]);

  // Round clock, with a tick for each of the last ten seconds.
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

  const apply = useCallback((move: M, countsAsInput = true): boolean => round.current !== null && round.current.apply(move, countsAsInput) !== null, []);
  const canApply = useCallback((move: M): boolean => round.current?.canApply(move) ?? false, []);
  const markRendered = useCallback(() => round.current?.metrics.markRendered(), []);
  const current = useCallback(() => round.current as PuzzleRound<S, M, unknown> | null, []);

  return {
    phase,
    state,
    version,
    timeLeft: phase === "playing" ? timeLeft : roundLength,
    roundSeconds: roundLength,
    outcome,
    apply,
    canApply,
    markRendered,
    current,
  };
}
