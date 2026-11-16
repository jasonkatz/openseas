import type { ChatEvent, ChatState, ChatSummary } from "@openseas/protocol";

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
    return { ...chat, ...event.status, live: event.status.chat.running ? chat.live : "" };
  }
  if (event.type === "delta") return { ...chat, live: event.reset ? event.text : chat.live + event.text };
  const { item } = event;
  const at = chat.items.findIndex((i) => i.id === item.id);
  if (at >= 0) return { ...chat, items: chat.items.map((i, n) => (n === at ? item : i)) };
  const after = chat.items.findIndex((i) => i.id > item.id);
  return { ...chat, items: after < 0 ? [...chat.items, item] : [...chat.items.slice(0, after), item, ...chat.items.slice(after)] };
}

/**
 * Which chat to open on arriving at a puzzle's page: the one last open here, if it is still there;
 * else one whose turn is running on the draft; else the one last spoken in on the draft. None of
 * them, a new chat: one from an earlier draft is in the list for the owner to choose.
 */
export function chatToOpen(chats: readonly ChatSummary[], draftId: string | null, kept: string | null): string | null {
  if (kept && chats.some((c) => c.id === kept)) return kept;
  const mine = chats.filter((c) => draftId !== null && c.draft === draftId);
  return (mine.find((c) => c.running) ?? mine[0])?.id ?? null;
}
