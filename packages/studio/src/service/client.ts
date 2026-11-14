import { DraftListSchema, DraftSchema, SaveStartedSchema, StudioMeSchema, TesterLinkIdSchema, TesterLinkListSchema, TesterLinkSchema, type CreateTesterLink, type Draft, type DraftNumbers, type SaveStarted, type StudioMe, type TesterLink } from "@openseas/protocol";

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
