import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChatChannel, ChatMessage, ServerMessage } from "@openseas/protocol";
import { usePirate } from "@openseas/boards";

export interface SocialContextValue {
  /** Everyone ashore at the pirate's island, as last pushed by the server. */
  presence: { islandId: string; pirates: { pirateId: string; name: string }[] } | null;
  /** The last few lines of each channel, oldest first. Ephemeral: chat is not stored (DESIGN.md 3.7). */
  chat: Record<ChatChannel, ChatMessage[]>;
  /** Lines that arrived since the channel was last looked at. */
  unread: Record<ChatChannel, number>;
  say(channel: ChatChannel, text: string): void;
  markRead(channel: ChatChannel): void;
  askWho(): void;
}

const Ctx = createContext<SocialContextValue | null>(null);

export function useSocial(): SocialContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSocial outside SocialProvider");
  return v;
}

const KEEP = 60;

export function SocialProvider({ children }: { children: ReactNode }) {
  const { socket } = usePirate();
  const [presence, setPresence] = useState<SocialContextValue["presence"]>(null);
  const [chat, setChat] = useState<Record<ChatChannel, ChatMessage[]>>({ ship: [], island: [] });
  const [unread, setUnread] = useState<Record<ChatChannel, number>>({ ship: 0, island: 0 });

  useEffect(
    () =>
      socket.onMessage((m: ServerMessage) => {
        switch (m.type) {
          case "island.presence":
            setPresence({ islandId: m.islandId, pirates: m.pirates });
            break;
          case "chat.message":
            setChat((c) => ({ ...c, [m.channel]: [...c[m.channel], m].slice(-KEEP) }));
            setUnread((u) => ({ ...u, [m.channel]: u[m.channel] + 1 }));
            break;
          case "ship.left":
            // Ship chat belongs to the ship; a new ship starts clean.
            setChat((c) => ({ ...c, ship: [] }));
            setUnread((u) => ({ ...u, ship: 0 }));
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
        if (s === "closed") setPresence(null);
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
  const askWho = useCallback(() => void socket.send({ type: "island.who" }), [socket]);

  const value = useMemo<SocialContextValue>(() => ({ presence, chat, unread, say, markRead, askWho }), [presence, chat, unread, say, markRead, askWho]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
