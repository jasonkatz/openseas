import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { BATTLE_DEF, type BattleConfig, type BattleMove, type BattlePlan, type BattleState } from "@openseas/engine";
import type { PuzzleResult, ServerMessage, ShipSnapshot } from "@openseas/protocol";
import { PuzzleRound, content, sfx, usePirate, wallClock } from "@openseas/boards";
import { useShip } from "../../state/ShipProvider.jsx";

export type BattlePhase = "idle" | "playing" | "waiting" | "result";
export type BattleOutcomeView = { kind: "scored"; result: PuzzleResult } | { kind: "rejected"; reason: string };

export interface BattleApi {
  phase: BattlePhase;
  state: BattleState;
  /** Ms until the ship's next turn, when the plot sails; null between fights. */
  turnLeftMs: number | null;
  turnMs: number;
  /** Bumps when the turn clock runs out: the board sails its plot. */
  commitSignal: number;
  outcome: BattleOutcomeView | null;
  /** True when the board was handed back after a reconnect. */
  resumed: boolean;
  commit(plan: BattlePlan): void;
  /** The captain has read the outcome: clear the board for the next fight. */
  dismiss(): void;
  markRendered(): void;
}

const battle = content.puzzles.battle;

/**
 * The captain's sea battle aboard (DESIGN.md 3.11, ADR 0021). The server deals the board when the
 * captain engages; the ship's turn clock sails whatever is plotted; every ship turn brings a
 * supply the board logs as the ship's word. A dropped captain gets the board back with its log.
 * Lives above the battle view, which mounts only once the ship says a fight is on: the deal
 * arrives on the same socket right behind that snapshot, and must not be missed.
 */
function useBattle(ship: ShipSnapshot | null): BattleApi {
  const { socket } = usePirate();
  const [phase, setPhase] = useState<BattlePhase>("idle");
  const [state, setState] = useState<BattleState>(() => BATTLE_DEF.create("deck", battle.config));
  const [outcome, setOutcome] = useState<BattleOutcomeView | null>(null);
  const [resumed, setResumed] = useState(false);
  const [commitSignal, setCommitSignal] = useState(0);
  const [turnLeftMs, setTurnLeftMs] = useState<number | null>(null);
  const round = useRef<PuzzleRound<BattleState, BattleMove, BattleConfig> | null>(null);
  const sessionId = useRef<string | null>(null);
  const inBattle = ship?.location.kind === "at-sea" && ship.location.battle !== null;
  const turnMs = ship?.turnMs ?? battle.config.turnSeconds * 1000;

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "puzzle.started": {
            if (m.puzzle !== "battle" || !m.battle) return;
            // The same board handed back is rebuilt from the server's log; abandoning it would end it there.
            if (m.sessionId === sessionId.current) round.current?.discard();
            else round.current?.abandon();
            const startedAt = m.serverNow - socket.clockOffset;
            const deadlineAt = m.deadlineAt - socket.clockOffset;
            const replay = (m.resume?.moves ?? []) as BattleMove[];
            const r = new PuzzleRound<BattleState, BattleMove, BattleConfig>({
              def: BATTLE_DEF,
              seed: m.seed,
              config: m.config,
              startedAt,
              deadlineAt,
              clock: wallClock,
              rated: { socket, sessionId: m.sessionId },
              replay,
              onChange: (s) => setState(s),
              onFinished: () => {
                sfx.end();
                setPhase("waiting");
              },
            });
            round.current = r;
            sessionId.current = m.sessionId;
            setOutcome(null);
            setResumed(replay.length > 0);
            if (!r.isFinished) setPhase("playing");
            break;
          }
          case "battle.supply": {
            const sid = sessionId.current;
            const r = round.current;
            if (!sid || !r || m.sessionId !== sid) return;
            r.apply({ type: "supply", left: m.left, forward: m.forward, right: m.right, cannons: m.cannons, hull: m.hull }, false);
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
          default:
            break;
        }
      }),
    [socket],
  );

  // The ship says when the fight is over. A board still in play with nothing scored (the fight was
  // cut short) is dropped after a beat; a scored outcome stays until the captain dismisses it.
  useEffect(() => {
    if (inBattle || phase === "idle" || phase === "result") return;
    round.current?.abandon();
    round.current = null;
    sessionId.current = null;
    const id = window.setTimeout(() => {
      setPhase("idle");
      setOutcome(null);
    }, 2400);
    return () => window.clearTimeout(id);
  }, [inBattle, phase]);

  // The ship's turn clock sails the plot, as in the original: a reading every 100 ms, a commit at zero.
  const nextTurnAt = ship?.nextTurnAt ?? null;
  const fired = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "playing" || nextTurnAt === null) {
      setTurnLeftMs(null);
      return;
    }
    const id = window.setInterval(() => {
      const left = nextTurnAt - socket.clockOffset - wallClock.now();
      setTurnLeftMs(Math.max(0, left));
      if (left <= 0 && fired.current !== nextTurnAt) {
        fired.current = nextTurnAt;
        setCommitSignal((n) => n + 1);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, nextTurnAt, socket]);

  useEffect(() => () => round.current?.abandon(), []);

  const commit = useCallback((plan: BattlePlan) => {
    const r = round.current;
    if (!r || r.isFinished) return;
    if (r.apply({ type: "commit", ...plan }) !== null) sfx.swap();
  }, []);
  const markRendered = useCallback(() => round.current?.metrics.markRendered(), []);
  const dismiss = useCallback(() => {
    if (round.current && !round.current.isFinished) return;
    round.current = null;
    sessionId.current = null;
    setPhase("idle");
    setOutcome(null);
  }, []);

  return { phase, state, turnLeftMs, turnMs, commitSignal, outcome, resumed, commit, dismiss, markRendered };
}

const Ctx = createContext<BattleApi | null>(null);

export function BattleProvider({ children }: { children: ReactNode }) {
  const { ship } = useShip();
  const api = useBattle(ship);
  return createElement(Ctx.Provider, { value: api }, children);
}

export function useBattleApi(): BattleApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBattleApi outside BattleProvider");
  return v;
}
