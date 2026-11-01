import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BoardShip, ClientMessage, ErrorCode, ServerMessage, ShipEventWire, ShipSnapshot, StationWire } from "@openseas/protocol";
import { usePirate } from "./PirateProvider.jsx";

export interface ShipNotice {
  id: number;
  event: ShipEventWire;
}

export interface ShipContextValue {
  /** The ship the pirate is aboard, as the server last described it. */
  ship: ShipSnapshot | null;
  /** The last few things that happened aboard, newest last. */
  notices: ShipNotice[];
  /** Server clock when the snapshot arrived, in local ms. */
  receivedAt: number;
  /** The last ship error the server sent, cleared on the next successful state. */
  error: ErrorCode | null;
  /** The notice board as last listed. */
  board: { islandId: string; ships: BoardShip[] } | null;
  boardShip(shipId: string): void;
  leave(): void;
  takeStation(station: StationWire | null): void;
  sail(routeId: string): void;
  evade(): void;
  handWheel(pirateId: string): void;
  lock(inviteOnly: boolean): void;
  listBoard(): void;
  clearError(): void;
}

const Ctx = createContext<ShipContextValue | null>(null);

export function useShip(): ShipContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShip outside ShipProvider");
  return v;
}

const SHIP_ERRORS = new Set<ErrorCode>([
  "no_ship",
  "ship_elsewhere",
  "ship_full",
  "ship_locked",
  "already_aboard",
  "not_aboard",
  "not_captain",
  "not_owner",
  "not_docked",
  "not_at_sea",
  "bad_route",
  "station_taken",
  "no_station",
  "not_hailed",
]);

/** Everything the client knows about the ship it is aboard comes from `ship.state`; nothing is simulated here. */
export function ShipProvider({ children }: { children: ReactNode }) {
  const { socket } = usePirate();
  const [ship, setShip] = useState<ShipSnapshot | null>(null);
  const [notices, setNotices] = useState<ShipNotice[]>([]);
  const [receivedAt, setReceivedAt] = useState(0);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [board, setBoard] = useState<{ islandId: string; ships: BoardShip[] } | null>(null);
  const noticeId = useRef(0);

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "ship.state":
            setShip(m.ship);
            setReceivedAt(Date.now());
            setError(null);
            if (m.events.length) {
              setNotices((n) => [...n, ...m.events.map((event) => ({ id: ++noticeId.current, event }))].slice(-6));
            }
            break;
          case "ship.left":
            setShip(null);
            setNotices([]);
            break;
          case "board.ships":
            setBoard({ islandId: m.islandId, ships: m.ships });
            break;
          case "error":
            if (SHIP_ERRORS.has(m.code)) setError(m.code);
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
        if (s === "closed") setShip(null);
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
      boardShip: (shipId) => send({ type: "ship.board", shipId }),
      leave: () => send({ type: "ship.leave" }),
      takeStation: (station) => send({ type: "ship.station", station }),
      sail: (routeId) => send({ type: "ship.sail", routeId }),
      evade: () => send({ type: "ship.evade" }),
      handWheel: (pirateId) => send({ type: "ship.wheel", pirateId }),
      lock: (inviteOnly) => send({ type: "ship.lock", inviteOnly }),
      listBoard: () => socket.send({ type: "board.list" }),
      clearError: () => setError(null),
    }),
    [ship, notices, receivedAt, error, board, send, socket],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
