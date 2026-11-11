import { useCallback, useEffect, useRef, useState } from "react";
import type { PuzzleDef, PuzzleId } from "@openseas/engine";
import type { PuzzleStarted, ServerMessage } from "@openseas/protocol";
import { sfx, usePirate, useRoundSession, type PuzzleRound, type RoundMessage, type RoundOutcome, type RoundPhase, type TickedHost } from "@openseas/boards";
import { isRefusalFor } from "../../state/refusals.js";

export type DutyPhase = RoundPhase;
export type DutyOutcome = RoundOutcome;

export interface DutyOptions<S, M, C> {
  puzzle: PuzzleId;
  def: PuzzleDef<S, M, C>;
  /** The content config and round length, for the board shown before the first deal. */
  config: C;
  roundSeconds: number;
  /** True while the pirate is at this station and the ship is in flight: boards are dealt back to back. */
  active: boolean;
  onMove?(state: S, prev: S): void;
  /** Moves the ship injects into a freshly dealt board, from what the deal says (the heat's depth). */
  dealt?(started: PuzzleStarted): M[];
  /** A move the ship injects into the running board from a message about it (the heat's depth at a turn), or null. */
  inbound?(message: RoundMessage, round: PuzzleRound<S, M, C>): M | null;
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
 * pirate is at a station in flight, the board streams its moves like any rated round, and when it ends
 * another is dealt, so a station is always busy, as in the original. Leaving the station, docking
 * or disembarking cuts the board short; the server scores what was played, unrated.
 */
export function useDuty<S, M, C>(opts: DutyOptions<S, M, C>): DutyApi<S, M> {
  const { puzzle, def, config, roundSeconds, active } = opts;
  const { socket, socketStatus } = usePirate();
  const [roundLength, setRoundLength] = useState(roundSeconds);
  const holdUntil = useRef(0);
  const online = socketStatus === "open";

  const session = useRoundSession<S, M, C>({
    def,
    initial: () => def.create("deck", config),
    // A board dealt after the pirate left the station is declined: the server is told at once.
    accepts: (m) => (m.puzzle !== puzzle || m.duty?.station !== puzzle ? false : active ? true : "decline"),
    inbound: (m, r) => opts.inbound?.(m, r) ?? null,
    countdown: true,
    onDeal: (m, r) => {
      setRoundLength(Math.max(1, Math.round(r.lengthMs / 1000)));
      sfx.start();
      for (const move of opts.dealt?.(m) ?? []) r.apply(move, false);
    },
    onMove: (s, prev) => opts.onMove?.(s, prev),
    onFinished: () => sfx.end(),
  });
  const { phase, ask, cancelAsk, drop } = session;

  const deal = useCallback(() => {
    if (Date.now() < holdUntil.current) return;
    ask({ type: "duty.start" });
  }, [ask]);

  // Deal when the station goes live; drop the board when it goes quiet.
  useEffect(() => {
    if (active && online) {
      if (phase === "idle") deal();
      return;
    }
    drop();
  }, [active, online, phase, deal, drop]);

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
        // Refused for now (docked, no station, ashore, or in a fight the station must wait out): try again later.
        // The refusal is the station's alone, so nothing else shows it.
        if (m.type === "error" && isRefusalFor(m, "duty")) {
          holdUntil.current = Date.now() + RETRY_MS;
          cancelAsk();
        }
      }),
    [socket, cancelAsk],
  );

  // The next board follows a finished one after a beat.
  const latestActive = useRef(active);
  latestActive.current = active;
  useEffect(() => {
    if (phase !== "result") return;
    const id = window.setTimeout(() => {
      if (latestActive.current) deal();
      else drop();
    }, RESTART_MS);
    return () => window.clearTimeout(id);
  }, [phase, deal, drop]);

  return {
    phase,
    state: session.state,
    version: session.version,
    timeLeft: phase === "playing" ? (session.secondsLeft ?? roundLength) : roundLength,
    roundSeconds: roundLength,
    outcome: session.outcome,
    apply: session.apply,
    canApply: session.canApply,
    markRendered: session.markRendered,
    current: session.current,
  };
}
