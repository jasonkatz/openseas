import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthProvider, PirateSummary } from "@openseas/protocol";
import { authClient } from "../api/auth.js";
import { ApiError, createPirate, getMe } from "../api/http.js";
import { GameSocket, type SocketStatus } from "../api/socket.js";

/**
 * Where sign-in stands. `signed-out` is a browser that has held a linked account and has no session
 * now: it is offered sign-in, not a fresh guest, so a returning pirate is never made a stranger.
 */
export type PiratePhase = "loading" | "offline" | "needs-pirate" | "signed-out" | "ready";

export interface PirateContextValue {
  phase: PiratePhase;
  pirate: PirateSummary | null;
  inviteRequired: boolean;
  error: string | null;
  socket: GameSocket;
  socketStatus: SocketStatus;
  /** Accounts this server can sign in with (DESIGN.md 3.8). */
  providers: AuthProvider[];
  /** Accounts linked to the signed-in pirate; empty for a guest. */
  linked: AuthProvider[];
  createPirate(inviteCode: string | undefined): Promise<void>;
  refresh(): Promise<void>;
  setPirate(p: PirateSummary): void;
  /**
   * Sign in with, or link, an account. A guest's pirate goes with them onto the account; a browser
   * with no session signs straight in. Leaves the page for the provider and comes back to it.
   */
  signInWith(provider: AuthProvider): Promise<void>;
  /** From `signed-out`: play on as a new guest instead. */
  playAsGuest(): Promise<void>;
}

/** Set once this browser has seen a linked account, so signing out offers sign-in rather than a new guest. */
const RETURNING_KEY = "openseas.returning";
/** The pirate this browser had before leaving for a provider, to tell a link from a sign-in on return. */
export const LINK_FROM_KEY = "openseas.link-from";

function remember(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: nothing remembered, nothing lost */
  }
}
function recall(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

const Ctx = createContext<PirateContextValue | null>(null);

export function usePirate(): PirateContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePirate outside PirateProvider");
  return v;
}

/**
 * Guest-first (ADR 0007): on first load we sign in anonymously, and if no invite code is needed we
 * create the pirate at once. The visitor never sees a form unless the alpha gate is on. With
 * `offerSignIn`, a browser that has held a linked account and has no session waits at `signed-out`
 * instead, so the returning pirate signs in rather than becoming someone new. With `connect` off
 * nothing is asked of the server at all: no session, no pirate, no socket. The studio's `/play`
 * pages run so (ADR 0042), where a round is local and a tester signs in to nothing.
 */
export function PirateProvider({ children, offerSignIn = false, connect = true }: { children: ReactNode; offerSignIn?: boolean; connect?: boolean }) {
  const [phase, setPhase] = useState<PiratePhase>(connect ? "loading" : "offline");
  const [pirate, setPirateState] = useState<PirateSummary | null>(null);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("idle");
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [linked, setLinked] = useState<AuthProvider[]>([]);
  const socket = useMemo(() => new GameSocket(), []);
  const booting = useRef(false);

  const boot = useCallback(async (asGuest: boolean) => {
    try {
      let me = await getMe();
      setProviders(me.providers);
      setLinked(me.linked);
      if (!me.pirate) {
        // Make sure there is at least a guest session.
        const session = await authClient.getSession();
        if (!session.data) {
          if (offerSignIn && !asGuest && recall(RETURNING_KEY) === "1" && me.providers.length > 0) {
            setInviteRequired(me.inviteRequired);
            setPhase("signed-out");
            return;
          }
          const r = await authClient.signIn.anonymous();
          if (r.error) throw new ApiError("internal", 500);
          me = await getMe();
        }
      }
      setInviteRequired(me.inviteRequired);
      if (me.pirate) {
        if (me.linked.length > 0) remember(RETURNING_KEY, "1");
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
  }, [offerSignIn]);
  const refresh = useCallback(() => boot(false), [boot]);
  const playAsGuest = useCallback(async () => {
    setPhase("loading");
    await boot(true);
  }, [boot]);

  const signInWith = useCallback(
    async (provider: AuthProvider) => {
      setError(null);
      const here = `${window.location.origin}${window.location.pathname}`;
      remember(LINK_FROM_KEY, pirate?.id ?? "");
      const signedIn = (await authClient.getSession()).data;
      // A guest, or nobody, signs in with the provider (the guest's pirate goes along); someone
      // already signed in to an account links the provider to it as well.
      const go = signedIn?.user && !signedIn.user.isAnonymous ? authClient.linkSocial : authClient.signIn.social;
      const r = await go({ provider, callbackURL: `${here}?signed_in=${provider}`, errorCallbackURL: `${here}?auth_error=${provider}` });
      if (r?.error) setError("link_failed");
    },
    [pirate],
  );

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
    if (!connect || booting.current) return;
    booting.current = true;
    void refresh();
  }, [connect, refresh]);

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
    providers,
    linked,
    createPirate: create,
    refresh,
    setPirate: setPirateState,
    signInWith,
    playAsGuest,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
