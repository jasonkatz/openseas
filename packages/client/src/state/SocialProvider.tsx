import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatChannel, ChatMessage, CrewTag, PirateLookWire, ServerMessage, WalkSpot } from "@openseas/protocol";
import { usePirate } from "@openseas/boards";

export interface SocialContextValue {
  /** Everyone at the pirate's outpost, as last pushed by the server. */
  presence: { outpostId: string; pirates: { pirateId: string; name: string; crew?: CrewTag | null | undefined; look?: PirateLookWire | null | undefined }[] } | null;
  /** The last few lines of each channel, oldest first. Ephemeral: chat is not stored (DESIGN.md 3.7). */
  chat: Record<ChatChannel, ChatMessage[]>;
  /** Lines that arrived since the channel was last looked at. */
  unread: Record<ChatChannel, number>;
  say(channel: ChatChannel, text: string): void;
  markRead(channel: ChatChannel): void;
  askWho(): void;
  /** Where others last walked to (ADR 0032): on the pirate's outpost, and on the deck of their ship. */
  walks: { outpost: Record<string, WalkSpot>; ship: Record<string, WalkSpot> };
  /** Tell the place where the pirate is walking, paced to a few a second. */
  walkTo(at: WalkSpot): void;
}

const Ctx = createContext<SocialContextValue | null>(null);

export function useSocial(): SocialContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSocial outside SocialProvider");
  return v;
}

const KEEP = 60;
/** The least time between two walks sent; one sooner waits and the latest goes when it may. */
const WALK_PACE_MS = 180;

export function SocialProvider({ children }: { children: ReactNode }) {
  const { socket } = usePirate();
  const [presence, setPresence] = useState<SocialContextValue["presence"]>(null);
  const [chat, setChat] = useState<Record<ChatChannel, ChatMessage[]>>({ ship: [], outpost: [], crew: [] });
  const [unread, setUnread] = useState<Record<ChatChannel, number>>({ ship: 0, outpost: 0, crew: 0 });
  const [walks, setWalks] = useState<SocialContextValue["walks"]>({ outpost: {}, ship: {} });

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "outpost.presence": {
            setPresence({ outpostId: m.outpostId, pirates: m.pirates });
            const outpost: Record<string, WalkSpot> = {};
            for (const p of m.pirates) if (p.at) outpost[p.pirateId] = p.at;
            setWalks((w) => {
              // Keep a walk heard since for anyone still here: presence carries the last one the server had.
              for (const p of m.pirates) if (!p.at && w.outpost[p.pirateId]) outpost[p.pirateId] = w.outpost[p.pirateId]!;
              return { ...w, outpost };
            });
            break;
          }
          case "walk.moved":
            setWalks((w) => ({ ...w, [m.scope]: { ...w[m.scope], [m.pirateId]: { x: m.x, z: m.z } } }));
            break;
          case "walk.where": {
            const at: Record<string, WalkSpot> = {};
            for (const p of m.walkers) at[p.pirateId] = { x: p.x, z: p.z };
            setWalks((w) => ({ ...w, [m.scope]: at }));
            break;
          }
          case "chat.message":
            setChat((c) => ({ ...c, [m.channel]: [...c[m.channel], m].slice(-KEEP) }));
            setUnread((u) => ({ ...u, [m.channel]: u[m.channel] + 1 }));
            break;
          case "ship.left":
            // Ship chat belongs to the ship; a new ship starts clean.
            setChat((c) => ({ ...c, ship: [] }));
            setUnread((u) => ({ ...u, ship: 0 }));
            setWalks((w) => ({ ...w, ship: {} }));
            break;
          default:
            break;
        }
      }),
    [socket],
  );

  useEffect(
    () =>
      socket.onStatus((s) => {
        if (s === "closed") {
          setPresence(null);
          setWalks({ outpost: {}, ship: {} });
        }
      }),
    [socket],
  );

  const say = useCallback(
    (channel: ChatChannel, text: string) => {
      const trimmed = text.trim().slice(0, 280);
      if (trimmed) socket.send({ type: "chat.send", channel, text: trimmed });
    },
    [socket],
  );
  const markRead = useCallback((channel: ChatChannel) => setUnread((u) => (u[channel] === 0 ? u : { ...u, [channel]: 0 })), []);
  const askWho = useCallback(() => void socket.send({ type: "outpost.who" }), [socket]);

  // Walks are paced: the latest spot goes at most every WALK_PACE_MS, and a burst ends on where the pirate stopped.
  const walkPace = useRef<{ lastAt: number; pending: WalkSpot | null; timer: number | null }>({ lastAt: 0, pending: null, timer: null });
  const walkTo = useCallback(
    (at: WalkSpot) => {
      const clamp = (v: number): number => Math.round(Math.max(-4, Math.min(4, v)) * 1000) / 1000;
      const spot = { x: clamp(at.x), z: clamp(at.z) };
      const pace = walkPace.current;
      const flush = (): void => {
        pace.timer = null;
        if (!pace.pending) return;
        pace.lastAt = Date.now();
        socket.send({ type: "walk.to", x: pace.pending.x, z: pace.pending.z });
        pace.pending = null;
      };
      pace.pending = spot;
      const wait = WALK_PACE_MS - (Date.now() - pace.lastAt);
      if (wait <= 0 && pace.timer === null) flush();
      else if (pace.timer === null) pace.timer = window.setTimeout(flush, Math.max(0, wait));
    },
    [socket],
  );
  useEffect(
    () => () => {
      if (walkPace.current.timer !== null) window.clearTimeout(walkPace.current.timer);
    },
    [],
  );

  const value = useMemo<SocialContextValue>(() => ({ presence, chat, unread, say, markRead, askWho, walks, walkTo }), [presence, chat, unread, say, markRead, askWho, walks, walkTo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
