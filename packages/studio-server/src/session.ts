import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A value signed with the service's secret, for a cookie: the service keeps no session table (ADR
 * 0043). `payload.signature`, both base64url. It carries its own expiry, checked on every read.
 */
export function seal(secret: string, payload: object, ttlSeconds: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** The payload of a sealed value, or null when it was not signed by this secret, is malformed or has expired. */
export function unseal<T extends object>(secret: string, sealed: string | undefined, now = Date.now()): T | null {
  if (!sealed) return null;
  const dot = sealed.indexOf(".");
  if (dot <= 0) return null;
  const body = sealed.slice(0, dot);
  const given = Buffer.from(sealed.slice(dot + 1));
  const want = Buffer.from(sign(secret, body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: unknown };
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
  /** True when the studio site and the service are on different sites. */
  crossSite: boolean;
}

export function cookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", `Max-Age=${o.maxAgeSeconds}`, `SameSite=${o.crossSite ? "None" : "Lax"}`];
  if (o.secure || o.crossSite) parts.push("Secure");
  return parts.join("; ");
}
