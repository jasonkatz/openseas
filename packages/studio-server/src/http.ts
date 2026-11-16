import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatAllowSchema, ChatIdSchema, ChatRevertSchema, CreateDraftSchema, RenameChatSchema, CreateTesterLinkSchema, SendChatSchema, DraftIdSchema, PuzzleIdSchema, SaveDraftSchema, SaveRequestSchema, TakeHashSchema, TesterLinkIdSchema, picksOf, wordsOf, type ChatEvent, type ChatSent, type ChatState, type ChatStatus, type StudioErrorCode, type StudioMe } from "@openseas/protocol";
import type { Chat, ChatSignal } from "./chat/chat.js";
import { chatRow, chatRows, deleteChat, renameChat, toSummary, type ChatRow } from "./chat/chats.js";
import type { Db } from "./db/index.js";
import { createDraft, discardDraft, draftRow, draftRows, saveDraft, toDraft } from "./drafts.js";
import type { Env } from "./env.js";
import type { GitHub } from "./github.js";
import { createLink, findLink, listLinks, withdrawLink } from "./links.js";
import type { Logger } from "./log.js";
import type { Saver } from "./save/saver.js";
import { cookie, readCookie, seal, unseal } from "./session.js";
import type { Takes } from "./takes/takes.js";

export interface HttpDeps {
  env: Env;
  db: Db;
  /** Null when the service has no GitHub keys: nobody can sign in through GitHub. */
  github: GitHub | null;
  /** Null when the service has no clone or no GitHub App: drafts are kept, and none can be saved. */
  saver: Saver | null;
  /** Null when the service has no model key, no cap, or no user of its own for the agent: there is no chat. */
  chat: Chat | null;
  /** Null when the service has no bucket: no take is kept, listed or served. */
  takes: Takes | null;
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
 *   GET    /drafts?puzzle=    the owner's open drafts, one puzzle's or all (owner)
 *   POST   /drafts            open a puzzle's draft (owner); refused when one is open
 *   PUT    /drafts/:id        save its numbers over the revision named (owner)
 *   DELETE /drafts/:id        discard it (owner), its pull request and branch with it
 *   POST   /drafts/:id/save   Save (owner): a tester link at once, then its branch and draft pull request
 *   POST   /drafts/:id/update merge the base branch into its branch (owner), when asked
 *   POST   /drafts/:id/chat   a message to the agent (owner), in a chat it names or a new one: a turn, or a steer of the one running
 *   GET    /chats?puzzle=     the owner's chats on a puzzle, its open draft's and those whose draft is gone (owner, ADR 0060)
 *   GET    /chats/:id?after=  one chat since an item, and whether a turn is running (owner)
 *   GET    /chats/:id/events  one chat as a stream of events: the whole of it, then what happens (owner, ADR 0055)
 *   PATCH  /chats/:id         rename it (owner)
 *   DELETE /chats/:id         delete it and its lines (owner); its turns' commits stay on the draft
 *   POST   /chats/:id/stop    stop its turn where it stands (owner)
 *   POST   /chats/:id/revert  undo one of its turns' edits with a new commit (owner)
 *   POST   /chats/:id/allow   answer a refused write: allow the path for its draft, or not (owner)
 *   GET    /takes/:hash       a take's bytes, for anyone who has its hash, from any origin (ADR 0051)
 *   GET    /takes?puzzle=     a puzzle's takes (owner)
 *
 * An owner is a signed-in GitHub login on the allowlist. Whatever changes something must also
 * come from one of the studio site's own origins: the cookie alone is not enough.
 */
export function createHttpHandler(deps: HttpDeps) {
  const { env, db, github, saver, chat, takes, log } = deps;
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
    const draftPath = /^\/drafts\/([^/]+)(?:\/(save|update|chat))?$/.exec(path);
    const chatPath = /^\/chats\/([^/]+)(?:\/(events|stop|revert|allow))?$/.exec(path);
    const chatId = chatPath?.[1];
    const chatAct = chatPath?.[2];
    const draftId = draftPath?.[1];
    const draftAct = draftPath?.[2];
    const takeHash = /^\/takes\/([^/]+)$/.exec(path)?.[1];

    // The studio site may send its cookie. Anyone else may read a link or a take, and nothing more.
    res.setHeader("Vary", "Origin");
    if (fromStudio) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    } else if (linkId !== undefined || takeHash !== undefined || path === "/health") {
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
        const me: StudioMe = { login: owner(req), signIn: github !== null, dev: env.STUDIO_DEV_LOGIN !== null, save: saver !== null, chat: chat !== null, takes: takes !== null, picks: true, words: true };
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

      // A take is public by its hash, which nobody can guess and which never names other bytes: a
      // tester link will load a pick this way, and a browser may keep it for good.
      if (takeHash !== undefined && req.method === "GET") {
        const take = takes && TakeHashSchema.safeParse(takeHash).success ? await takes.read(takeHash) : null;
        if (!take) return fail(res, 404, "not_found");
        res.statusCode = 200;
        res.setHeader("Content-Type", take.contentType);
        res.setHeader("Content-Length", take.bytes.length);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.end(take.bytes);
        return;
      }

      // Everything below is the owner's, from the studio site.
      const isLinks = path === "/links" || linkId !== undefined;
      const isDrafts = path === "/drafts" || draftId !== undefined;
      const isChats = path === "/chats" || chatId !== undefined;
      if (!isLinks && !isDrafts && !isChats && path !== "/takes") return fail(res, 404, "not_found");
      const login = owner(req);
      if (!login) return fail(res, 401, "unauthorized");
      if (path === "/takes") {
        if (req.method !== "GET") return fail(res, 404, "not_found");
        if (!takes) return fail(res, 503, "unavailable");
        const puzzle = PuzzleIdSchema.safeParse(url.searchParams.get("puzzle"));
        if (!puzzle.success) return fail(res, 400, "bad_request");
        return json(res, 200, { takes: await takes.list(puzzle.data) });
      }
      /** The request's body as JSON, or undefined when it is not JSON or is too large. */
      const body = async (): Promise<unknown> => {
        try {
          return await readJson(req);
        } catch {
          return undefined;
        }
      };

      if (path === "/drafts" && req.method === "GET") {
        const raw = url.searchParams.get("puzzle");
        const puzzle = raw === null ? null : PuzzleIdSchema.safeParse(raw);
        if (puzzle && !puzzle.success) return fail(res, 400, "bad_request");
        const rows = await draftRows(db, login, puzzle?.data);
        // With Save, a listing is also when a merged or closed pull request clears its draft, and when a draft learns the base branch moved.
        const live = saver ? await saver.refresh(rows) : rows.map((row) => ({ row, behind: false }));
        return json(res, 200, { drafts: live.map(({ row, behind }) => toDraft(row, behind)) });
      }

      if (path === "/links" && req.method === "GET") {
        const puzzle = PuzzleIdSchema.safeParse(url.searchParams.get("puzzle"));
        if (!puzzle.success) return fail(res, 400, "bad_request");
        return json(res, 200, { links: await listLinks(db, puzzle.data) });
      }
      if (isChats && !chat) return fail(res, 503, "unavailable");
      if (path === "/chats" && req.method === "GET" && chat) {
        const puzzle = PuzzleIdSchema.safeParse(url.searchParams.get("puzzle"));
        if (!puzzle.success) return fail(res, 400, "bad_request");
        const rows = await chatRows(db, login, puzzle.data);
        return json(res, 200, { chats: rows.map((r) => toSummary(r, chat.running(r.id))), cap: { spentUsd: await chat.spent(), capUsd: chat.capUsd } });
      }
      /** The chat the address names, if it is the owner's. */
      const theChat = async (): Promise<ChatRow | null> => (chatId !== undefined && ChatIdSchema.safeParse(chatId).success ? chatRow(db, login, chatId) : null);
      if (chatId !== undefined && (chatAct === undefined || chatAct === "events") && req.method === "GET" && chat) {
        const first = await theChat();
        if (!first) return fail(res, 404, "not_found");
        /** Everything of the chat but its lines, as the service holds it now; null when the chat is gone. */
        const status = async (): Promise<ChatStatus | null> => {
          const now = await chatRow(db, login, first.id);
          if (!now) return null;
          const draft = now.draftId ? await draftRow(db, login, now.draftId) : null;
          const running = chat.running(now.id);
          return { chat: toSummary(now, running), busy: !running && draft !== null && chat.busy(draft.id), cap: { spentUsd: await chat.spent(), capUsd: chat.capUsd }, draft: draft ? toDraft(draft) : null };
        };
        if (chatAct === undefined) {
          const after = Number(url.searchParams.get("after") ?? 0);
          const items = await chat.items(first.id, Number.isInteger(after) && after > 0 ? after : 0);
          const now = await status();
          if (!now) return fail(res, 404, "not_found");
          const state: ChatState = { items, ...now, live: chat.live(first.id) };
          return json(res, 200, state);
        }

        // The stream (ADR 0055). The rows are still the chat: this says the whole of it first, then each thing as it
        // happens, so a page that lost the connection asks again and needs nothing it had.
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
        const write = (event: ChatEvent): void => void res.write(`data: ${JSON.stringify(event)}\n\n`);
        let held: ChatSignal[] | null = [];
        // One after another, in the order they were told: a status is read from the database, and must not overtake what came before it.
        let line: Promise<void> = Promise.resolve();
        const forward = (signal: ChatSignal): void => {
          line = line
            .then(async () => {
              if (signal.type !== "status") return write(signal);
              const now = await status();
              if (now) write({ type: "status", status: now });
            })
            .catch((err: unknown) => log.warn({ err, chat: first.id }, "chat stream: could not send an event"));
        };
        // Listening before the chat is read, so nothing falls between the two.
        const leave = chat.subscribe(first, (signal) => (held ? void held.push(signal) : forward(signal)));
        // A proxy between here and the page closes a connection that says nothing; a comment is nothing to the page.
        const beat = setInterval(() => void res.write(": still here\n\n"), 15_000);
        const end = (): void => {
          clearInterval(beat);
          leave();
        };
        req.on("close", end);
        res.on("error", end);
        try {
          const items = await chat.items(first.id, 0);
          const now = await status();
          if (!now) return void res.end();
          // Read in the same breath as the held events are let go: the words so far are exactly those of the deltas
          // told before now, which are dropped, and every delta after is sent.
          write({ type: "state", state: { items, ...now, live: chat.live(first.id) } });
          const waiting = held.filter((signal) => signal.type !== "delta");
          held = null;
          // A line told while the chat was read may be in what was read: it is the same line, by its id.
          for (const signal of waiting) forward(signal);
        } catch (err) {
          end();
          res.end();
          log.warn({ err, chat: first.id }, "chat stream: could not send the chat");
        }
        return;
      }
      if (!fromStudio) return fail(res, 403, "forbidden");
      if (path === "/links" && req.method === "POST") {
        const input = CreateTesterLinkSchema.safeParse(await body());
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

      if (path === "/drafts" && req.method === "POST") {
        const input = CreateDraftSchema.safeParse(await body());
        if (!input.success) return fail(res, 400, "bad_request");
        const draft = await createDraft(db, login, input.data);
        if (!draft) return fail(res, 409, "conflict");
        log.info({ id: draft.id, puzzle: draft.puzzle, login }, "draft opened");
        return json(res, 201, draft);
      }
      if (draftId !== undefined && !DraftIdSchema.safeParse(draftId).success) return fail(res, 404, "not_found");
      if (chatId !== undefined && chat) {
        const one = await theChat();
        if (!one) return fail(res, 404, "not_found");
        if (chatAct === undefined && req.method === "PATCH") {
          const input = RenameChatSchema.safeParse(await body());
          if (!input.success) return fail(res, 400, "bad_request");
          const renamed = await renameChat(db, login, one.id, input.data.title);
          return renamed ? json(res, 200, toSummary(renamed, chat.running(renamed.id))) : fail(res, 404, "not_found");
        }
        if (chatAct === undefined && req.method === "DELETE") {
          // A chat is stopped before it is deleted: the page offers no delete while its turn runs.
          if (chat.running(one.id)) return fail(res, 409, "conflict");
          if (!(await deleteChat(db, login, one.id))) return fail(res, 404, "not_found");
          log.info({ chat: one.id, login }, "chat deleted");
          return json(res, 200, { ok: true });
        }
        if (req.method !== "POST") return fail(res, 404, "not_found");
        if (chatAct === "stop") {
          chat.stop(one.id);
          return json(res, 202, { ok: true });
        }
        if (chatAct === "revert") {
          const input = ChatRevertSchema.safeParse(await body());
          if (!input.success) return fail(res, 400, "bad_request");
          return (await chat.revert(one, input.data.turn)) ? json(res, 200, { ok: true }) : fail(res, 409, "conflict");
        }
        if (chatAct === "allow") {
          const input = ChatAllowSchema.safeParse(await body());
          if (!input.success) return fail(res, 400, "bad_request");
          return (await chat.answer(one, input.data.item, input.data.allow)) ? json(res, 200, { ok: true }) : fail(res, 404, "not_found");
        }
        return fail(res, 404, "not_found");
      }
      if (draftId !== undefined && draftAct === "chat") {
        if (req.method !== "POST") return fail(res, 404, "not_found");
        if (!chat) return fail(res, 503, "unavailable");
        const row = await draftRow(db, login, draftId);
        if (!row) return fail(res, 404, "not_found");
        const input = SendChatSchema.safeParse(await body());
        if (!input.success) return fail(res, 400, "bad_request");
        // The chat named must be the owner's, on this puzzle, and on this draft or on none (ADR 0060).
        const to = input.data.chat ? await chatRow(db, login, input.data.chat) : null;
        if (input.data.chat && !to) return fail(res, 404, "not_found");
        if (to && (to.puzzle !== row.puzzle || (to.draftId !== null && to.draftId !== row.id))) return fail(res, 409, "conflict");
        // The branch is one writer's at a time: a Save being written and a turn do not share it.
        if (row.saveState === "saving") return fail(res, 409, "conflict");
        const steering = to !== null && chat.running(to.id);
        if (!steering && chat.busy(row.id)) return fail(res, 409, "busy");
        if (!steering && (await chat.spent()) >= chat.capUsd) return fail(res, 409, "capped");
        const sent = await chat.send(row, to, input.data);
        if (sent === "busy") return fail(res, 409, "busy");
        const answer: ChatSent = { chat: sent };
        return json(res, 202, answer);
      }
      if (draftId !== undefined && draftAct !== undefined) {
        if (req.method !== "POST") return fail(res, 404, "not_found");
        if (!saver) return fail(res, 503, "unavailable");
        const row = await draftRow(db, login, draftId);
        if (!row) return fail(res, 404, "not_found");
        if (chat?.busy(row.id)) return fail(res, 409, "conflict");
        // One at a time a draft: a second Save waits for the page to see how the first went.
        if (row.saveState === "saving") return fail(res, 409, "conflict");
        if (draftAct === "update") {
          if (!row.branch) return fail(res, 409, "conflict");
          return json(res, 202, toDraft(await saver.update(row)));
        }
        const input = SaveRequestSchema.safeParse(await body());
        if (!input.success) return fail(res, 400, "bad_request");
        // What is saved is what is on the page: a page behind its draft is told so.
        if (input.data.revision !== row.revision) return fail(res, 409, "conflict");
        // The tester link first, at once (ADR 0042 decision 10); the branch and pull request follow.
        const link = await createLink(db, login, { puzzle: row.puzzle as never, name: input.data.name, draft: { ...row.numbers, picks: picksOf(row.numbers), words: wordsOf(row.numbers) } });
        log.info({ id: row.id, link: link.id, login }, "save started");
        return json(res, 202, { draft: toDraft(await saver.save(row, login, link.id)), link });
      }
      if (draftId !== undefined && req.method === "PUT") {
        const input = SaveDraftSchema.safeParse(await body());
        if (!input.success) return fail(res, 400, "bad_request");
        const saved = await saveDraft(db, login, draftId, input.data);
        if (!saved.ok) return fail(res, saved.reason === "conflict" ? 409 : 404, saved.reason);
        return json(res, 200, saved.draft);
      }
      if (draftId !== undefined && req.method === "DELETE") {
        const row = await draftRow(db, login, draftId);
        // A turn is stopped before its draft is discarded: the page offers no discard while one runs.
        if (row && chat?.busy(row.id)) return fail(res, 409, "conflict");
        if (!row || !(await discardDraft(db, login, draftId))) return fail(res, 404, "not_found");
        if (saver) await saver.discard(row);
        log.info({ id: draftId, login }, "draft discarded");
        return json(res, 200, { ok: true });
      }
      return fail(res, 404, "not_found");
    } catch (e) {
      log.error({ err: e, path }, "request failed");
      if (!res.headersSent) fail(res, 500, "internal");
      else res.end();
    }
  };
}
