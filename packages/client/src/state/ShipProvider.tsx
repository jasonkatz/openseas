import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BoardShip, ClientMessage, ErrorCode, ServerMessage, ShipEventWire, ShipSnapshot, StationWire } from "@openseas/protocol";
import { usePirate } from "@openseas/boards";
import { isRefusalFor } from "./refusals.js";

export interface ShipNotice {
  id: number;
  event: ShipEventWire;
  at: number;
}

export interface ShipContextValue {
  /** The ship the pirate is aboard, as the server last described it. */
  ship: ShipSnapshot | null;
  /** The last few things that happened aboard, newest last. */
  notices: ShipNotice[];
  /** Local ms when the snapshot arrived. */
  receivedAt: number;
  /** The last ship error the server sent, cleared on the next successful state or action. */
  error: ErrorCode | null;
  /** The notice board as last listed: ships with crews at the pirate's outpost and in flight. */
  board: { outpostId: string; ships: BoardShip[]; at: number } | null;
  /** The ship the pirate just left, for the camera to pull back from. */
  left: { shipId: string; reason: "left" | "timed_out"; at: number } | null;
  boardShip(shipId: string): void;
  leave(): void;
  takeStation(station: StationWire | null): void;
  launch(laneId: string): void;
  evade(): void;
  /** Captain only: fight the raider that hailed. The battle board is dealt as a puzzle session. */
  engage(): void;
  handHelm(pirateId: string): void;
  /** Captain only: send a bot to a station, or stand it down with null. */
  assign(pirateId: string, station: StationWire | null): void;
  lock(inviteOnly: boolean): void;
  listBoard(): void;
  buyShip(classId: string): void;
  clearError(): void;
}

const Ctx = createContext<ShipContextValue | null>(null);

export function useShip(): ShipContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShip outside ShipProvider");
  return v;
}

/** Everything the client knows about the ship it is aboard comes from `ship.state`; nothing is simulated here. */
export function ShipProvider({ children }: { children: ReactNode }) {
  const { socket } = usePirate();
  const [ship, setShip] = useState<ShipSnapshot | null>(null);
  const [notices, setNotices] = useState<ShipNotice[]>([]);
  const [receivedAt, setReceivedAt] = useState(0);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [board, setBoard] = useState<ShipContextValue["board"]>(null);
  const [left, setLeft] = useState<ShipContextValue["left"]>(null);
  const noticeId = useRef(0);

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "ship.state":
            setShip(m.ship);
            setReceivedAt(Date.now());
            setLeft(null);
            setError(null);
            if (m.events.length) {
              const at = Date.now();
              setNotices((n) => [...n, ...m.events.map((event) => ({ id: ++noticeId.current, event, at }))].slice(-8));
            }
            break;
          case "ship.left":
            setShip(null);
            setNotices([]);
            setLeft({ shipId: m.shipId, reason: m.reason, at: Date.now() });
            break;
          case "board.ships":
            setBoard({ outpostId: m.outpostId, ships: m.ships, at: Date.now() });
            break;
          case "error":
            if (isRefusalFor(m, "ship")) setError(m.code);
            break;
          default:
            break;
        }
      }),
    [socket],
  );

  // A closed socket means the seat is held but the view is stale; the server re-sends on reconnect.
  useEffect(
    () =>
      socket.onStatus((s) => {
        if (s === "closed") {
          setShip(null);
          setBoard(null);
        }
      }),
    [socket],
  );

  const send = useCallback(
    (msg: ClientMessage) => {
      setError(null);
      socket.send(msg);
    },
    [socket],
  );

  const value = useMemo<ShipContextValue>(
    () => ({
      ship,
      notices,
      receivedAt,
      error,
      board,
      left,
      boardShip: (shipId) => send({ type: "ship.board", shipId }),
      leave: () => send({ type: "ship.leave" }),
      takeStation: (station) => send({ type: "ship.station", station }),
      launch: (laneId) => send({ type: "ship.launch", laneId }),
      evade: () => send({ type: "ship.evade" }),
      engage: () => send({ type: "ship.engage" }),
      handHelm: (pirateId) => send({ type: "ship.helm", pirateId }),
      assign: (pirateId, station) => send({ type: "ship.assign", pirateId, station }),
      lock: (inviteOnly) => send({ type: "ship.lock", inviteOnly }),
      listBoard: () => void socket.send({ type: "board.list" }),
      buyShip: (classId) => send({ type: "shipyard.buy", classId }),
      clearError: () => setError(null),
    }),
    [ship, notices, receivedAt, error, board, left, send, socket],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
