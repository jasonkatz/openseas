import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PirateSummary } from "@openseas/protocol";
import { authClient } from "../api/auth.js";
import { ApiError, createPirate, getMe } from "../api/http.js";
import { GameSocket, type SocketStatus } from "../api/socket.js";

export type PiratePhase = "loading" | "offline" | "needs-pirate" | "ready";

export interface PirateContextValue {
  phase: PiratePhase;
  pirate: PirateSummary | null;
  inviteRequired: boolean;
  error: string | null;
  socket: GameSocket;
  socketStatus: SocketStatus;
  createPirate(inviteCode: string | undefined): Promise<void>;
  refresh(): Promise<void>;
  setPirate(p: PirateSummary): void;
}

const Ctx = createContext<PirateContextValue | null>(null);

export function usePirate(): PirateContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePirate outside PirateProvider");
  return v;
}

/**
 * Guest-first (ADR 0007): on first load we sign in anonymously, and if no invite code is needed we
 * create the pirate at once. The visitor never sees a form unless the alpha gate is on.
 */
export function PirateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<PiratePhase>("loading");
  const [pirate, setPirateState] = useState<PirateSummary | null>(null);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("idle");
  const socket = useMemo(() => new GameSocket(), []);
  const booting = useRef(false);

  const refresh = useCallback(async () => {
    try {
      let me = await getMe();
      if (!me.pirate) {
        // Make sure there is at least a guest session.
        const session = await authClient.getSession();
        if (!session.data) {
          const r = await authClient.signIn.anonymous();
          if (r.error) throw new ApiError("internal", 500);
          me = await getMe();
        }
      }
      setInviteRequired(me.inviteRequired);
      if (me.pirate) {
        setPirateState(me.pirate);
        setPhase("ready");
        return;
      }
      if (!me.inviteRequired) {
        const p = await createPirate(undefined);
        setPirateState(p);
        setPhase("ready");
        return;
      }
      setPhase("needs-pirate");
    } catch (e) {
      setPhase("offline");
      setError(e instanceof ApiError ? e.code : "network");
    }
  }, []);

  const create = useCallback(
    async (inviteCode: string | undefined) => {
      setError(null);
      try {
        const p = await createPirate(inviteCode);
        setPirateState(p);
        setPhase("ready");
      } catch (e) {
        setError(e instanceof ApiError ? e.code : "network");
      }
    },
    [],
  );

  useEffect(() => {
    if (booting.current) return;
    booting.current = true;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = socket.onStatus(setSocketStatus);
    if (phase === "ready") socket.connect();
    return () => {
      off();
    };
  }, [phase, socket]);

  useEffect(() => () => socket.disconnect(), [socket]);

  useEffect(
    () =>
      socket.onMessage((m) => {
        if (m.type === "welcome" || m.type === "pirate.updated") setPirateState(m.pirate);
      }),
    [socket],
  );

  const value: PirateContextValue = {
    phase,
    pirate,
    inviteRequired,
    error,
    socket,
    socketStatus,
    createPirate: create,
    refresh,
    setPirate: setPirateState,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
