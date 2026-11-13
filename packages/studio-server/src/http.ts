import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CreateTesterLinkSchema, PuzzleIdSchema, TesterLinkIdSchema, type StudioErrorCode, type StudioMe } from "@openseas/protocol";
import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import type { GitHub } from "./github.js";
import { createLink, findLink, listLinks, withdrawLink } from "./links.js";
import type { Logger } from "./log.js";
import { cookie, readCookie, seal, unseal } from "./session.js";

export interface HttpDeps {
  env: Env;
  db: Db;
  /** Null when the service has no GitHub keys: nobody can sign in through GitHub. */
  github: GitHub | null;
  log: Logger;
}

const SESSION = "studio_session";
const OAUTH = "studio_oauth";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_SECONDS = 10 * 60;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
const fail = (res: ServerResponse, status: number, error: StudioErrorCode): void => json(res, status, { error });

function redirect(res: ServerResponse, to: string): void {
  res.statusCode = 302;
  res.setHeader("Location", to);
  res.end();
}

async function readJson(req: IncomingMessage, limit = 32 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/**
 * The service's whole surface (ADR 0043):
 *
 *   GET    /health            which commit is live
 *   GET    /auth/me           who the caller is taken for
 *   GET    /auth/github       off to GitHub, and /auth/callback back from it
 *   GET    /auth/dev          off production: sign the configured login in with no GitHub
 *   POST   /auth/sign-out
 *   GET    /links/:id         a tester link, for anyone, from any origin
 *   GET    /links?puzzle=     a puzzle's links (owner)
 *   POST   /links             freeze a draft as a link (owner)
 *   DELETE /links/:id         withdraw one (owner)
 *
 * An owner is a signed-in GitHub login on the allowlist. Whatever changes something must also
 * come from one of the studio site's own origins: the cookie alone is not enough.
 */
export function createHttpHandler(deps: HttpDeps) {
  const { env, db, github, log } = deps;
  const secure = env.NODE_ENV === "production";
  const cookieFor = (name: string, value: string, maxAgeSeconds: number): string => cookie(name, value, { maxAgeSeconds, secure, crossSite: env.CROSS_SITE_COOKIES });
  const callbackUrl = `${env.STUDIO_PUBLIC_URL.replace(/\/$/, "")}/auth/callback`;

  const owner = (req: IncomingMessage): string | null => {
    const session = unseal<{ login: string }>(env.STUDIO_SECRET, readCookie(req.headers.cookie, SESSION));
    return session && env.STUDIO_OWNERS.includes(session.login.toLowerCase()) ? session.login : null;
  };
  /** Where sign-in returns the browser: only ever a page of the studio site. */
  const returnTo = (raw: string | null): string => {
    const fallback = `${env.STUDIO_ORIGINS[0] ?? env.STUDIO_PUBLIC_URL}/`;
    if (!raw) return fallback;
    try {
      const url = new URL(raw);
      return env.STUDIO_ORIGINS.includes(url.origin) ? url.toString() : fallback;
    } catch {
      return fallback;
    }
  };
  const signIn = (res: ServerResponse, login: string, to: string): void => {
    res.setHeader("Set-Cookie", [cookieFor(SESSION, seal(env.STUDIO_SECRET, { login }, SESSION_SECONDS), SESSION_SECONDS), cookieFor(OAUTH, "", 0)]);
    redirect(res, to);
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = req.headers.origin;
    const fromStudio = origin !== undefined && env.STUDIO_ORIGINS.includes(origin);
    const linkId = /^\/links\/([^/]+)$/.exec(path)?.[1];

    // The studio site may send its cookie. Anyone else may read a link, and nothing more.
    res.setHeader("Vary", "Origin");
    if (fromStudio) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    } else if (linkId !== undefined || path === "/health") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (path === "/health" && req.method === "GET") return json(res, 200, { ok: true, commit: env.COMMIT_SHA });

      if (path === "/auth/me" && req.method === "GET") {
        const me: StudioMe = { login: owner(req), signIn: github !== null, dev: env.STUDIO_DEV_LOGIN !== null };
        return json(res, 200, me);
      }
      if (path === "/auth/github" && req.method === "GET") {
        if (!github) return fail(res, 404, "not_found");
        const state = randomBytes(16).toString("base64url");
        res.setHeader("Set-Cookie", cookieFor(OAUTH, seal(env.STUDIO_SECRET, { state, to: returnTo(url.searchParams.get("return")) }, OAUTH_SECONDS), OAUTH_SECONDS));
        return redirect(res, github.authorizeUrl(state, callbackUrl));
      }
      if (path === "/auth/callback" && req.method === "GET") {
        const pending = unseal<{ state: string; to: string }>(env.STUDIO_SECRET, readCookie(req.headers.cookie, OAUTH));
        const code = url.searchParams.get("code");
        if (!github || !pending || !code || url.searchParams.get("state") !== pending.state) return fail(res, 400, "bad_request");
        const login = await github.loginFor(code, callbackUrl);
        if (!login || !env.STUDIO_OWNERS.includes(login.toLowerCase())) {
          log.warn({ login }, "sign-in refused: not on the allowlist");
          res.setHeader("Set-Cookie", cookieFor(OAUTH, "", 0));
          const back = new URL(pending.to);
          back.searchParams.set("studio_sign_in", "refused");
          return redirect(res, back.toString());
        }
        log.info({ login }, "owner signed in");
        return signIn(res, login, pending.to);
      }
      if (path === "/auth/dev" && req.method === "GET") {
        if (!env.STUDIO_DEV_LOGIN) return fail(res, 404, "not_found");
        return signIn(res, env.STUDIO_DEV_LOGIN, returnTo(url.searchParams.get("return")));
      }
      if (path === "/auth/sign-out" && req.method === "POST") {
        if (!fromStudio) return fail(res, 403, "forbidden");
        res.setHeader("Set-Cookie", cookieFor(SESSION, "", 0));
        return json(res, 200, { ok: true });
      }

      if (linkId !== undefined && req.method === "GET") {
        const link = TesterLinkIdSchema.safeParse(linkId).success ? await findLink(db, linkId) : null;
        if (!link) return fail(res, 404, "not_found");
        if (link.withdrawn) return fail(res, 410, "withdrawn");
        return json(res, 200, link);
      }

      // Everything below is the owner's, from the studio site.
      const isLinks = path === "/links" || linkId !== undefined;
      if (!isLinks) return fail(res, 404, "not_found");
      const login = owner(req);
      if (!login) return fail(res, 401, "unauthorized");

      if (path === "/links" && req.method === "GET") {
        const puzzle = PuzzleIdSchema.safeParse(url.searchParams.get("puzzle"));
        if (!puzzle.success) return fail(res, 400, "bad_request");
        return json(res, 200, { links: await listLinks(db, puzzle.data) });
      }
      if (!fromStudio) return fail(res, 403, "forbidden");
      if (path === "/links" && req.method === "POST") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          return fail(res, 400, "bad_request");
        }
        const input = CreateTesterLinkSchema.safeParse(body);
        if (!input.success) return fail(res, 400, "bad_request");
        const link = await createLink(db, login, input.data);
        log.info({ id: link.id, puzzle: link.puzzle, login }, "tester link made");
        return json(res, 201, link);
      }
      if (linkId !== undefined && req.method === "DELETE") {
        const link = TesterLinkIdSchema.safeParse(linkId).success ? await withdrawLink(db, linkId) : null;
        if (!link) return fail(res, 404, "not_found");
        log.info({ id: link.id, login }, "tester link withdrawn");
        return json(res, 200, link);
      }
      return fail(res, 404, "not_found");
    } catch (e) {
      log.error({ err: e, path }, "request failed");
      if (!res.headersSent) fail(res, 500, "internal");
      else res.end();
    }
  };
}
