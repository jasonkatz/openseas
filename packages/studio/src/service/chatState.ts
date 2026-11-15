import type { ChatEvent, ChatState } from "@openseas/protocol";

/**
 * A chat after one event of its stream (ADR 0055). `state` is the whole chat and takes the place
 * of whatever was here; the others change what is here, and mean nothing before a `state` has come.
 * A line is told apart by its id: one already here is replaced where it stands, a new one takes its
 * place in the order the service made them.
 */
export function applyChatEvent(chat: ChatState | null, event: ChatEvent): ChatState | null {
  if (event.type === "state") return event.state;
  if (!chat) return chat;
  if (event.type === "status") {
    // A turn that has ended is writing nothing.
    return { ...chat, ...event.status, live: event.status.running ? chat.live : "" };
  }
  if (event.type === "delta") return { ...chat, live: event.reset ? event.text : chat.live + event.text };
  const { item } = event;
  const at = chat.items.findIndex((i) => i.id === item.id);
  if (at >= 0) return { ...chat, items: chat.items.map((i, n) => (n === at ? item : i)) };
  const after = chat.items.findIndex((i) => i.id > item.id);
  return { ...chat, items: after < 0 ? [...chat.items, item] : [...chat.items.slice(0, after), item, ...chat.items.slice(after)] };
}
