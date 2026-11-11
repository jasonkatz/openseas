import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { BATTLE_DEF, type BattleConfig, type BattleMove, type BattleState } from "@openseas/engine";
import type { ShipSnapshot } from "@openseas/protocol";
import { content, sfx, useBattleControls, usePirate, useRoundSession, wallClock, type BattleControls, type RoundOutcome, type RoundPhase } from "@openseas/boards";
import { useShip } from "../../state/ShipProvider.jsx";

/** Never "dealing": the captain does not ask for the board, the server deals it on engaging. */
export type BattlePhase = RoundPhase;
export type BattleOutcomeView = RoundOutcome;

export interface BattleApi {
  phase: BattlePhase;
  state: BattleState;
  /** Ms until the ship's next turn, when the plot flies; null between fights. */
  turnLeftMs: number | null;
  turnMs: number;
  /** Bumps when the turn clock runs out: the board flies its plot. */
  commitSignal: number;
  outcome: BattleOutcomeView | null;
  /** True when the board was handed back after a reconnect. */
  resumed: boolean;
  /** The board's handlers and sounds, as the harness proves them. */
  controls: BattleControls;
  /** The captain has read the outcome: clear the board for the next fight. */
  dismiss(): void;
}

const battle = content.puzzles.battle;

/**
 * The captain's space battle aboard (DESIGN.md 3.11, ADR 0021). The server deals the board when the
 * captain engages; the ship's turn clock flies whatever is plotted; every ship turn brings a
 * supply the board logs as the ship's word. A dropped captain gets the board back with its log.
 * Lives above the battle view, which mounts only once the ship says a fight is on: the deal
 * arrives on the same socket right behind that snapshot, and must not be missed.
 */
function useBattle(ship: ShipSnapshot | null): BattleApi {
  const { socket } = usePirate();
  const [commitSignal, setCommitSignal] = useState(0);
  const [turnLeftMs, setTurnLeftMs] = useState<number | null>(null);
  const inBattle = ship?.location.kind === "in-flight" && ship.location.battle !== null;
  const turnMs = ship?.turnMs ?? battle.config.turnSeconds * 1000;

  // The ship says when the fight is over. A board still in play then (the fight was cut short) is
  // dropped after a beat; a scored outcome stays until the captain dismisses it.
  const session = useRoundSession<BattleState, BattleMove, BattleConfig>({
    def: BATTLE_DEF,
    initial: () => BATTLE_DEF.create("deck", battle.config),
    accepts: (m) => m.puzzle === "battle" && m.battle !== undefined,
    inbound: (m) => (m.type === "battle.supply" ? { type: "supply", left: m.left, forward: m.forward, right: m.right, turrets: m.turrets, hull: m.hull } : null),
    over: !inBattle,
    onFinished: () => sfx.end(),
  });
  const { phase } = session;
  const controls = useBattleControls(session);

  // The ship's turn clock flies the plot, as in the original: a reading every 100 ms, a commit at zero.
  const nextTurnAt = ship?.nextTurnAt ?? null;
  const fired = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "playing" || nextTurnAt === null) {
      setTurnLeftMs(null);
      return;
    }
    const id = window.setInterval(() => {
      const left = socket.toLocal(nextTurnAt) - wallClock.now();
      setTurnLeftMs(Math.max(0, left));
      if (left <= 0 && fired.current !== nextTurnAt) {
        fired.current = nextTurnAt;
        setCommitSignal((n) => n + 1);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, nextTurnAt, socket]);

  return {
    phase,
    state: session.state,
    turnLeftMs,
    turnMs,
    commitSignal,
    outcome: session.outcome,
    resumed: session.resumed,
    controls,
    dismiss: session.dismiss,
  };
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
