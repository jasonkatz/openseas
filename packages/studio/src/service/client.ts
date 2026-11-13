import { StudioMeSchema, TesterLinkIdSchema, TesterLinkListSchema, TesterLinkSchema, type CreateTesterLink, type StudioMe, type TesterLink } from "@openseas/protocol";

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
