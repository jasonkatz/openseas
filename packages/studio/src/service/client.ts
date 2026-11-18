import { ChatEventSchema, ChatListSchema, ChatSentSchema, ChatStateSchema, ChatSummarySchema, DraftListSchema, DraftSchema, SaveStartedSchema, StudioMeSchema, TesterLinkIdSchema, TesterLinkListSchema, TesterLinkSchema, type CreateTesterLink, type ChatEvent, type ChatList, type ChatState, type ChatSummary, type Draft, type DraftNumbers, type SaveStarted, type SendChat, type StudioMe, type TesterLink } from "@openseas/protocol";

/**
 * The studio's service (ADR 0042 decision 4, ADR 0043), as this site reaches it. Empty when the
 * build was given none: the studio then tunes, plays and copies `/play` links as it always could,
 * and only tester links by id are missing. Nothing here is needed to play a round.
 */
export const SERVICE_URL: string = ((import.meta.env.VITE_STUDIO_SERVICE_URL as string | undefined) ?? "").replace(/\/$/, "");

/** Whether a `/play/<x>` address could be a tester link's: its id has the shape of one. */
export const looksLikeLinkId = (id: string): boolean => TesterLinkIdSchema.safeParse(id).success;

export type LinkLookup = { ok: true; link: TesterLink } | { ok: false; reason: "not_found" | "withdrawn" | "unreachable" };

/** A tester link by id. Public: no cookie is sent, so a pull request's preview of this site can read one too. */
export async function fetchLink(id: string): Promise<LinkLookup> {
  if (!SERVICE_URL) return { ok: false, reason: "unreachable" };
  try {
    const r = await fetch(`${SERVICE_URL}/links/${encodeURIComponent(id)}`, { credentials: "omit" });
    if (r.status === 404) return { ok: false, reason: "not_found" };
    if (r.status === 410) return { ok: false, reason: "withdrawn" };
    if (!r.ok) return { ok: false, reason: "unreachable" };
    const link = TesterLinkSchema.safeParse(await r.json());
    return link.success ? { ok: true, link: link.data } : { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

async function owned(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SERVICE_URL}${path}`, { ...init, credentials: "include", headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
}

/** Who the service takes this browser for; null when it cannot be reached. */
export async function fetchMe(): Promise<StudioMe | null> {
  try {
    const r = await owned("/auth/me");
    const me = r.ok ? StudioMeSchema.safeParse(await r.json()) : null;
    return me?.success ? me.data : null;
  } catch {
    return null;
  }
}

export async function listLinks(puzzle: string): Promise<TesterLink[] | null> {
  try {
    const r = await owned(`/links?puzzle=${encodeURIComponent(puzzle)}`);
    const list = r.ok ? TesterLinkListSchema.safeParse(await r.json()) : null;
    return list?.success ? list.data.links : null;
  } catch {
    return null;
  }
}

export async function createLink(input: CreateTesterLink): Promise<TesterLink | null> {
  try {
    const r = await owned("/links", { method: "POST", body: JSON.stringify(input) });
    const link = r.ok ? TesterLinkSchema.safeParse(await r.json()) : null;
    return link?.success ? link.data : null;
  } catch {
    return null;
  }
}

export async function withdrawLink(id: string): Promise<boolean> {
  try {
    return (await owned(`/links/${encodeURIComponent(id)}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

/** The signed-in owner's open drafts, one puzzle's or all of them; null when the service did not answer. */
export async function listDrafts(puzzle?: string): Promise<Draft[] | null> {
  try {
    const r = await owned(`/drafts${puzzle ? `?puzzle=${encodeURIComponent(puzzle)}` : ""}`);
    const list = r.ok ? DraftListSchema.safeParse(await r.json()) : null;
    return list?.success ? list.data.drafts : null;
  } catch {
    return null;
  }
}

/**
 * What became of a save. `conflict`: the draft was saved from somewhere else since this page read
 * it (or, opening one, the puzzle already has a draft). `gone`: it was discarded. `failed`: the
 * service did not answer, or refused.
 */
export type DraftSave = { ok: true; draft: Draft } | { ok: false; reason: "conflict" | "gone" | "failed" };

async function draftSave(path: string, method: "POST" | "PUT", body: unknown): Promise<DraftSave> {
  try {
    // keepalive: a save sent as the page is left still arrives.
    const r = await owned(path, { method, body: JSON.stringify(body), keepalive: true });
    if (r.status === 409) return { ok: false, reason: "conflict" };
    if (r.status === 404) return { ok: false, reason: "gone" };
    const draft = r.ok ? DraftSchema.safeParse(await r.json()) : null;
    return draft?.success ? { ok: true, draft: draft.data } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Open a puzzle's draft on these numbers. */
export const createDraft = (puzzle: string, numbers: DraftNumbers): Promise<DraftSave> => draftSave("/drafts", "POST", { puzzle, numbers });

/** Save a draft's numbers over the revision this page last saw. */
export const saveDraft = (id: string, numbers: DraftNumbers, revision: number): Promise<DraftSave> => draftSave(`/drafts/${encodeURIComponent(id)}`, "PUT", { numbers, revision });

/** What became of asking for a Save: started, with the tester link it made at once; or why not, as for a save of numbers. */
export type SaveStart = { ok: true; started: SaveStarted } | { ok: false; reason: "conflict" | "gone" | "failed" };

/** Save a draft (ADR 0046): the service makes a tester link at once and then writes the draft's branch and pull request, which the page watches for. */
export async function startSave(id: string, revision: number, name: string): Promise<SaveStart> {
  try {
    const r = await owned(`/drafts/${encodeURIComponent(id)}/save`, { method: "POST", body: JSON.stringify({ revision, name }) });
    if (r.status === 409) return { ok: false, reason: "conflict" };
    if (r.status === 404) return { ok: false, reason: "gone" };
    const started = r.ok ? SaveStartedSchema.safeParse(await r.json()) : null;
    return started?.success ? { ok: true, started: started.data } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Ask the service to merge the base branch into a draft's branch. The draft as it now stands, or null when the service would not. */
export async function startUpdate(id: string): Promise<Draft | null> {
  try {
    const r = await owned(`/drafts/${encodeURIComponent(id)}/update`, { method: "POST" });
    const draft = r.ok ? DraftSchema.safeParse(await r.json()) : null;
    return draft?.success ? draft.data : null;
  } catch {
    return null;
  }
}

/** The owner's chats on a puzzle (ADR 0060), its open draft's and those whose draft is gone, the one last spoken in first. Null when the service did not answer. */
export async function listChats(puzzle: string): Promise<ChatList | null> {
  try {
    const r = await owned(`/chats?puzzle=${encodeURIComponent(puzzle)}`);
    const list = r.ok ? ChatListSchema.safeParse(await r.json()) : null;
    return list?.success ? list.data : null;
  } catch {
    return null;
  }
}

/** One chat (ADR 0047): every line of it, whether a turn is running, and what has been spent. Null when the service did not answer. */
export async function fetchChat(id: string): Promise<ChatState | null> {
  try {
    const r = await owned(`/chats/${encodeURIComponent(id)}`);
    const state = r.ok ? ChatStateSchema.safeParse(await r.json()) : null;
    return state?.success ? state.data : null;
  } catch {
    return null;
  }
}

/** How long the stream may say nothing, the service's own beat included, before it is taken for dead. The service beats every 15 seconds. */
const STREAM_QUIET_MS = 40_000;
/** The longest wait before asking for the stream again. */
const STREAM_RETRY_MS = 15_000;

/**
 * A chat as it happens (ADR 0055): the whole of it first, then each line, each word of the
 * reply being written and each change of the turn or the money, as the service tells them. `link`
 * says whether the stream is alive; when it is not, this keeps asking for it, more and more
 * slowly, and the whole chat comes again when it answers. The answer ends the watch.
 */
export function watchChat(id: string, on: { event(event: ChatEvent): void; link(alive: boolean): void }): () => void {
  let source: EventSource | null = null;
  let over = false;
  let tries = 0;
  let again: number | undefined;
  let quiet: number | undefined;
  const retry = (): void => {
    window.clearTimeout(quiet);
    source?.close();
    source = null;
    on.link(false);
    if (over) return;
    window.clearTimeout(again);
    again = window.setTimeout(open, Math.min(STREAM_RETRY_MS, 500 * 2 ** tries++));
  };
  // A connection can die without a word, on a laptop that slept or a network that changed: silence past the service's beat is taken for that.
  const heard = (): void => {
    window.clearTimeout(quiet);
    quiet = window.setTimeout(retry, STREAM_QUIET_MS);
  };
  function open(): void {
    if (over) return;
    try {
      source = new EventSource(`${SERVICE_URL}/chats/${encodeURIComponent(id)}/events`, { withCredentials: true });
    } catch {
      return retry();
    }
    heard();
    source.addEventListener("ping", heard);
    source.onmessage = (message: MessageEvent<string>): void => {
      heard();
      let event: ReturnType<typeof ChatEventSchema.safeParse>;
      try {
        event = ChatEventSchema.safeParse(JSON.parse(message.data));
      } catch {
        return;
      }
      if (!event.success) return;
      // Alive once it has said the whole chat: a connection that opens and says nothing is no use.
      if (event.data.type === "state") {
        tries = 0;
        on.link(true);
      }
      on.event(event.data);
    };
    // The browser asks again by itself after a drop, and gives up after a refusal. Either way the stream is asked for afresh, so every connection starts with the whole chat.
    source.onerror = retry;
  }
  open();
  return () => {
    over = true;
    window.clearTimeout(again);
    window.clearTimeout(quiet);
    source?.close();
  };
}

/**
 * What became of a message to the agent: the chat it went to, or why it did not go. `capped`: the
 * spend cap is reached. `saving`: the draft's branch is being saved. `busy`: another chat's turn
 * runs on the draft (ADR 0060).
 */
export type ChatSend = { ok: true; chat: string } | { ok: false; reason: "capped" | "saving" | "busy" | "failed" };

/** A message to a chat on a draft, or to a new one when `message.chat` is null. */
export async function sendChat(draftId: string, message: SendChat): Promise<ChatSend> {
  try {
    const r = await owned(`/drafts/${encodeURIComponent(draftId)}/chat`, { method: "POST", body: JSON.stringify(message) });
    if (r.ok) {
      const sent = ChatSentSchema.safeParse(await r.json());
      return sent.success ? { ok: true, chat: sent.data.chat } : { ok: false, reason: "failed" };
    }
    if (r.status !== 409) return { ok: false, reason: "failed" };
    const code = ((await r.json()) as { error?: unknown }).error;
    return { ok: false, reason: code === "capped" ? "capped" : code === "busy" ? "busy" : "saving" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

async function chatAct(id: string, act: "stop" | "revert" | "allow", body?: unknown): Promise<boolean> {
  try {
    return (await owned(`/chats/${encodeURIComponent(id)}/${act}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).ok;
  } catch {
    return false;
  }
}
/** Stop the chat's turn where it stands. */
export const stopChat = (id: string): Promise<boolean> => chatAct(id, "stop");
/** Undo one of the chat's turns' edits. */
export const revertChat = (id: string, turn: number): Promise<boolean> => chatAct(id, "revert", { turn });
/** Answer a refused write: allow the path for the chat's draft, or not. */
export const answerChat = (id: string, item: number, allow: boolean): Promise<boolean> => chatAct(id, "allow", { item, allow });

/** Give a chat the owner's own name for it. The chat as it now is; null when the service refused or did not answer. */
export async function renameChat(id: string, title: string): Promise<ChatSummary | null> {
  try {
    const r = await owned(`/chats/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) });
    const chat = r.ok ? ChatSummarySchema.safeParse(await r.json()) : null;
    return chat?.success ? chat.data : null;
  } catch {
    return null;
  }
}

/** Delete a chat and its lines. Its turns' commits stay on the draft. */
export async function deleteChat(id: string): Promise<boolean> {
  try {
    return (await owned(`/chats/${encodeURIComponent(id)}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

/** Told when the puzzle's tester links changed somewhere other than the links section: Save makes one. */
export const LINKS_CHANGED = "openseas:studio-links-changed";

/** Discard a draft. True when it is gone, by this call or before it. */
export async function discardDraft(id: string): Promise<boolean> {
  try {
    const r = await owned(`/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

export async function signOut(): Promise<void> {
  try {
    await owned("/auth/sign-out", { method: "POST" });
  } catch {
    /* the cookie expires on its own */
  }
}

/** Where sign-in starts: the service sends the browser to GitHub and back to this page. `dev` is the off-production sign-in with no GitHub. */
export const signInUrl = (kind: "github" | "dev"): string => `${SERVICE_URL}/auth/${kind}?return=${encodeURIComponent(window.location.href)}`;

/** The address a tester opens. */
export const linkAddress = (id: string): string => `${window.location.origin}/play/${id}`;
