import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SWORDFIGHT_DEF, advanceSwordfight, swordfightPlaceIllegalReason, type SwordRotation, type SwordfightConfig, type SwordfightMove, type SwordfightState } from "@openseas/engine";
import type { MeleeBoardWire, PuzzleResult, ServerMessage, ShipSnapshot } from "@openseas/protocol";
import { PuzzleRound, content, sfx, t, usePirate, wallClock, useTicked, type MeleeRemoteBoard, type SwordfightPlaceAnswer } from "@openseas/boards";
import { useShip } from "../../state/ShipProvider.jsx";

export type MeleePhase = "idle" | "dealing" | "playing" | "waiting" | "result";
export type MeleeOutcomeView = { kind: "scored"; result: PuzzleResult } | { kind: "rejected"; reason: string };

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
 * The pirate's board at the rail (DESIGN.md 3.3, ADR 0022). The server deals it when a boarding
 * opens the melee; wrack from the brigand crew arrives as incoming moves the board logs as the
 * server's word; the end of the melee is the server's word too. A pirate aboard without a board
 * while the melee is on asks for one.
 */
function useMelee(ship: ShipSnapshot | null): MeleeApi {
  const { socket, pirate } = usePirate();
  const [phase, setPhase] = useState<MeleePhase>("idle");
  const [state, setState] = useState<SwordfightState>(() => SWORDFIGHT_DEF.create("deck", { ...swordfight.config, foes: [] }));
  const [others, setOthers] = useState<readonly MeleeRemoteBoard[]>([]);
  const [outcome, setOutcome] = useState<MeleeOutcomeView | null>(null);
  const round = useRef<PuzzleRound<SwordfightState, SwordfightMove, SwordfightConfig> | null>(null);
  const sessionId = useRef<string | null>(null);
  const askedAt = useRef(0);
  /** A board was dealt in the melee under way: a beaten pirate does not ask for another. */
  const fought = useRef(false);
  const inMelee = ship?.melee !== null && ship?.melee !== undefined;
  const me = pirate?.id ?? "";

  const current = useCallback(() => round.current as PuzzleRound<SwordfightState, SwordfightMove, unknown> | null, []);
  const apply = useCallback((move: SwordfightMove, countsAsInput = true): boolean => round.current !== null && round.current.apply(move, countsAsInput) !== null, []);
  const host = { state, phase, current, apply };
  const cfg = round.current?.opts.config ?? swordfight.config;
  const ticked = useTicked(host, { tickMs: cfg.tickMs, maxTick: cfg.maxTick, advance: advanceSwordfight, wait: waitAt, waitEveryTicks: 5 });
  const tickedRef = useRef(ticked);
  tickedRef.current = ticked;
  /** The tick a move made now carries: never behind the board, never ahead of the clock. */
  const tickNow = useCallback((): number => Math.max(round.current?.state.tick ?? 0, tickedRef.current.moveTick()), []);

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "puzzle.started": {
            if (m.puzzle !== "swordfight" || !m.melee) return;
            // The same board handed back is rebuilt from the server's log; abandoning it would end it there.
            const handedBack = m.sessionId === sessionId.current;
            if (handedBack) round.current?.discard();
            else round.current?.abandon();
            const startedAt = m.serverNow - socket.clockOffset;
            const deadlineAt = m.deadlineAt - socket.clockOffset;
            const replay = (m.resume?.moves ?? []) as SwordfightMove[];
            const r = new PuzzleRound<SwordfightState, SwordfightMove, SwordfightConfig>({
              def: SWORDFIGHT_DEF,
              seed: m.seed,
              config: m.config,
              startedAt,
              deadlineAt,
              clock: wallClock,
              rated: { socket, sessionId: m.sessionId },
              replay,
              onChange: (s) => setState(s),
              onFinished: () => setPhase("waiting"),
            });
            round.current = r;
            sessionId.current = m.sessionId;
            fought.current = true;
            setOutcome(null);
            if (!r.isFinished) {
              setPhase("playing");
              if (!handedBack) sfx.start();
            }
            break;
          }
          case "melee.incoming": {
            const r = round.current;
            if (!r || m.sessionId !== sessionId.current || r.isFinished) return;
            r.apply({ type: "incoming", board: 0, wrack: m.wrack, blade: m.blade, tick: tickNow() }, false);
            break;
          }
          case "melee.boards": {
            let foe = 0;
            setOthers(
              m.boards
                .filter((b: MeleeBoardWire) => b.pirateId !== me)
                .map((b: MeleeBoardWire, i: number): MeleeRemoteBoard => ({
                  key: b.pirateId ?? `brigand:${i}`,
                  name: b.pirateId === null ? t("swordfight.foe", { n: ++foe }) : b.name,
                  side: b.side,
                  cells: b.cells,
                  pending: b.pending,
                  out: b.out,
                  points: b.points,
                })),
            );
            break;
          }
          case "melee.over": {
            const r = round.current;
            if (!r || m.sessionId !== sessionId.current) return;
            r.settleLocal({ type: "end", won: m.won, tick: Math.max(r.state.tick, m.tick) });
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
    [socket, me, tickNow],
  );

  // Aboard in a melee without a board: ask for one, now and then until it comes. A pirate whose
  // board in this melee is already over does not get another.
  useEffect(() => {
    if (!inMelee) fought.current = false;
  }, [inMelee]);
  useEffect(() => {
    if (!inMelee || phase !== "idle" || fought.current) return;
    const ask = (): void => {
      if (Date.now() - askedAt.current < JOIN_RETRY_MS) return;
      askedAt.current = Date.now();
      if (socket.send({ type: "melee.join" })) setPhase("dealing");
    };
    ask();
    const id = window.setInterval(ask, JOIN_RETRY_MS);
    return () => window.clearInterval(id);
  }, [inMelee, phase, socket]);
  useEffect(() => {
    if (phase !== "dealing") return;
    const id = window.setTimeout(() => setPhase((p) => (p === "dealing" ? "idle" : p)), JOIN_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  // The ship says when the melee is over. A board still in play with nothing scored is dropped after a beat; a scored outcome stays until dismissed.
  useEffect(() => {
    if (inMelee || phase === "idle" || phase === "result") return;
    round.current?.abandon();
    round.current = null;
    sessionId.current = null;
    const id = window.setTimeout(() => {
      setPhase("idle");
      setOutcome(null);
      setOthers([]);
    }, 2400);
    return () => window.clearTimeout(id);
  }, [inMelee, phase]);

  // The round's own clock: when it runs out the board is finished as it stands.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      const r = round.current;
      if (r && r.opts.deadlineAt - r.opts.clock.now() <= 0) r.finish();
    }, 500);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => round.current?.abandon(), []);

  const place = useCallback(
    (col: number, rot: SwordRotation): SwordfightPlaceAnswer => {
      const r = round.current;
      if (!r || r.isFinished) return "refused";
      const tick = tickNow();
      if (r.apply({ type: "place", col, rot, tick }) !== null) return "placed";
      return swordfightPlaceIllegalReason(r.state, col, rot, tick) === "too soon" ? "wait" : "refused";
    },
    [tickNow],
  );
  const yieldFight = useCallback(() => {
    const r = round.current;
    if (!r || r.isFinished) return;
    r.apply({ type: "end", won: false, tick: tickNow() }, false);
  }, [tickNow]);
  const markRendered = useCallback(() => round.current?.metrics.markRendered(), []);
  const dismiss = useCallback(() => {
    if (round.current && !round.current.isFinished) return;
    round.current = null;
    sessionId.current = null;
    setPhase("idle");
    setOutcome(null);
    setOthers([]);
  }, []);

  return { phase, state: phase === "playing" ? ticked.shown : state, others, outcome, place, yieldFight, dismiss, markRendered };
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
