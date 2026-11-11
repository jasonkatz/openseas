import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SWORDFIGHT_DEF, advanceSwordfight, swordfightPlaceIllegalReason, type SwordRotation, type SwordfightConfig, type SwordfightMove, type SwordfightState } from "@openseas/engine";
import type { MeleeBoardWire, ServerMessage, ShipSnapshot } from "@openseas/protocol";
import { content, sfx, t, usePirate, useRoundSession, useTicked, type MeleeRemoteBoard, type RoundOutcome, type RoundPhase, type SwordfightPlaceAnswer } from "@openseas/boards";
import { useShip } from "../../state/ShipProvider.jsx";

export type MeleePhase = RoundPhase;
export type MeleeOutcomeView = RoundOutcome;

export interface MeleeApi {
  phase: MeleePhase;
  /** The board as shown: the round's state advanced to the current tick. */
  state: SwordfightState;
  /** Every other board in the melee, as the server last described them. */
  others: readonly MeleeRemoteBoard[];
  outcome: MeleeOutcomeView | null;
  /** The player's pair came to rest: taken, not yet, or never there. */
  place(col: number, rot: SwordRotation): SwordfightPlaceAnswer;
  /** The pirate yields: their board is lost. */
  yieldFight(): void;
  /** The pirate has read the outcome: clear the board. */
  dismiss(): void;
  markRendered(): void;
}

const swordfight = content.puzzles.swordfight;
const waitAt = (tick: number): SwordfightMove => ({ type: "wait", tick });
const JOIN_RETRY_MS = 3000;

/**
 * The pirate's board at the airlock (DESIGN.md 3.3, ADR 0022). The server deals it when a boarding
 * opens the melee; scrap from the raider crew arrives as incoming moves the board logs as the
 * server's word; the end of the melee is the server's word too. A pirate aboard without a board
 * while the melee is on asks for one.
 */
function useMelee(ship: ShipSnapshot | null): MeleeApi {
  const { socket, pirate } = usePirate();
  const [others, setOthers] = useState<readonly MeleeRemoteBoard[]>([]);
  const askedAt = useRef(0);
  /** A board was dealt in the melee under way: a beaten pirate does not ask for another. */
  const fought = useRef(false);
  const inMelee = ship?.melee !== null && ship?.melee !== undefined;
  const me = pirate?.id ?? "";

  const session = useRoundSession<SwordfightState, SwordfightMove, SwordfightConfig>({
    def: SWORDFIGHT_DEF,
    initial: () => SWORDFIGHT_DEF.create("deck", { ...swordfight.config, foes: [] }),
    accepts: (m) => m.puzzle === "swordfight" && m.melee !== undefined,
    inbound: (m, r): SwordfightMove | null => {
      if (m.type === "melee.incoming") return r.isFinished ? null : { type: "incoming", board: 0, scrap: m.scrap, blade: m.blade, tick: ticked.moveTick() };
      // The melee is decided outside this board: the server logged the end itself.
      if (m.type === "melee.over") r.settleLocal({ type: "end", won: m.won, tick: Math.max(r.state.tick, m.tick) });
      return null;
    },
    over: !inMelee,
    onDeal: (_m, r, handedBack) => {
      fought.current = true;
      if (!handedBack && !r.isFinished) sfx.start();
    },
    onClear: () => setOthers([]),
  });
  const { phase, state, ask, cancelAsk, current } = session;
  const ticked = useTicked(session, { tickMs: state.config.tickMs, maxTick: state.config.maxTick, advance: advanceSwordfight, wait: waitAt, waitEveryTicks: 5 });
  const { moveTick } = ticked;

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        if (m.type !== "melee.boards") return;
        let foe = 0;
        setOthers(
          m.boards
            .filter((b: MeleeBoardWire) => b.pirateId !== me)
            .map((b: MeleeBoardWire, i: number): MeleeRemoteBoard => ({
              key: b.pirateId ?? `raider:${i}`,
              name: b.pirateId === null ? t("swordfight.foe", { n: ++foe }) : b.name,
              side: b.side,
              cells: b.cells,
              pending: b.pending,
              out: b.out,
              points: b.points,
            })),
        );
      }),
    [socket, me],
  );

  // Aboard in a melee without a board: ask for one, now and then until it comes. A pirate whose
  // board in this melee is already over does not get another.
  useEffect(() => {
    if (!inMelee) fought.current = false;
  }, [inMelee]);
  useEffect(() => {
    if (!inMelee || phase !== "idle" || fought.current) return;
    const join = (): void => {
      if (Date.now() - askedAt.current < JOIN_RETRY_MS) return;
      askedAt.current = Date.now();
      ask({ type: "melee.join" });
    };
    join();
    const id = window.setInterval(join, JOIN_RETRY_MS);
    return () => window.clearInterval(id);
  }, [inMelee, phase, ask]);
  useEffect(() => {
    if (phase !== "dealing") return;
    const id = window.setTimeout(cancelAsk, JOIN_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [phase, cancelAsk]);

  const place = useCallback(
    (col: number, rot: SwordRotation): SwordfightPlaceAnswer => {
      const r = current();
      if (!r || r.isFinished) return "refused";
      const tick = moveTick();
      if (r.apply({ type: "place", col, rot, tick }) !== null) return "placed";
      return swordfightPlaceIllegalReason(r.state, col, rot, tick) === "too soon" ? "wait" : "refused";
    },
    [current, moveTick],
  );
  const yieldFight = useCallback(() => {
    const r = current();
    if (!r || r.isFinished) return;
    r.apply({ type: "end", won: false, tick: moveTick() }, false);
  }, [current, moveTick]);

  return {
    phase,
    state: phase === "playing" ? ticked.shown : state,
    others,
    outcome: session.outcome,
    place,
    yieldFight,
    dismiss: session.dismiss,
    markRendered: session.markRendered,
  };
}

const Ctx = createContext<MeleeApi | null>(null);

export function MeleeProvider({ children }: { children: ReactNode }) {
  const { ship } = useShip();
  const api = useMelee(ship);
  return createElement(Ctx.Provider, { value: api }, children);
}

export function useMeleeApi(): MeleeApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMeleeApi outside MeleeProvider");
  return v;
}
