import type { IncomingMessage, ServerResponse } from "node:http";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { Content } from "@openseas/content";
import { CreatePirateRequestSchema, type ErrorCode, type MeResponse } from "@openseas/protocol";
import { configuredProviders, linkedProviders, type Auth } from "./auth.js";
import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import type { Logger } from "./log.js";
import { PirateExistsError, createPirate, findPirateByUser, summarizePirate } from "./pirates.js";

export interface HttpDeps {
  env: Env;
  db: Db;
  auth: Auth;
  content: Content;
  log: Logger;
}

export function applyCors(req: IncomingMessage, res: ServerResponse, origins: readonly string[]): boolean {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function fail(res: ServerResponse, status: number, error: ErrorCode): void {
  json(res, status, { error });
}

export async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function createHttpHandler(deps: HttpDeps) {
  const { env, db, auth, content, log } = deps;
  const authHandler = toNodeHandler(auth);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (applyCors(req, res, env.CLIENT_ORIGINS)) return;

    try {
      if (url.pathname.startsWith("/api/auth/")) {
        await authHandler(req, res);
        return;
      }
      if (url.pathname === "/health") {
        json(res, 200, { ok: true, contentVersion: content.world.version, commit: env.COMMIT_SHA });
        return;
      }
      if (url.pathname === "/api/me" && req.method === "GET") {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        const providers = configuredProviders(env);
        if (!session) {
          const body: MeResponse = { pirate: null, inviteRequired: env.ALPHA_INVITE_CODE !== null, providers, linked: [] };
          json(res, 200, body);
          return;
        }
        const p = await findPirateByUser(db, session.user.id);
        const body: MeResponse = {
          pirate: p ? await summarizePirate(db, content, p.id, Boolean(session.user.isAnonymous)) : null,
          inviteRequired: env.ALPHA_INVITE_CODE !== null,
          providers,
          linked: session.user.isAnonymous ? [] : await linkedProviders(db, session.user.id),
        };
        json(res, 200, body);
        return;
      }
      if (url.pathname === "/api/pirate" && req.method === "POST") {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (!session) return fail(res, 401, "unauthenticated");
        const parsed = CreatePirateRequestSchema.safeParse(await readJson(req));
        if (!parsed.success) return fail(res, 400, "bad_message");
        if (env.ALPHA_INVITE_CODE !== null) {
          if (!parsed.data.inviteCode) return fail(res, 403, "invite_required");
          if (parsed.data.inviteCode !== env.ALPHA_INVITE_CODE) return fail(res, 403, "invite_invalid");
        }
        try {
          const p = await createPirate(db, content, session.user.id);
          log.info({ pirateId: p.id, name: p.name }, "pirate created");
          json(res, 201, { pirate: await summarizePirate(db, content, p.id, Boolean(session.user.isAnonymous)) });
        } catch (e) {
          if (e instanceof PirateExistsError) return fail(res, 409, "pirate_exists");
          throw e;
        }
        return;
      }
      res.statusCode = 404;
      res.end();
    } catch (e) {
      log.error({ err: e, path: url.pathname }, "http handler failed");
      if (!res.headersSent) fail(res, 500, "internal");
      else res.end();
    }
  };
}
