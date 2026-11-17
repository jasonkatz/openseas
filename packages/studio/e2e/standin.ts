import type { Page } from "@playwright/test";

/**
 * A stand-in for the studio's service, for the drafts and Save smoke. No service runs under the
 * smoke; this answers at the address the build was given (playwright.config.ts) with what the
 * real one answers, and packages/studio-server's own tests hold the real one to the same shapes.
 */
export const SERVICE = "http://localhost:8090";

export interface Numbers {
  seed: string | null;
  overrides: Record<string, unknown>;
  roundSeconds: number | null;
  paceSeconds: number | null;
  thresholds: null;
  /** Left out, the draft is one kept before picks. `sprites` only for a row kept before pieces were drawn in code (ADR 0063). */
  picks?: { sounds: Record<string, string>; sprites?: Record<string, string> };
  /** Left out, the draft is one kept before words (ADR 0057). */
  words?: { texts: Record<string, string>; category: string | null };
}
export interface Save {
  state: "idle" | "saving" | "failed";
  error: string | null;
  pull: { number: number; url: string } | null;
  savedRevision: number | null;
  behind: boolean;
  /** Left out, the service is one from before the chat's edits counted toward a Save. */
  edits?: boolean;
  /** Left out, the service is one from before a failed pick was named (ADR 0053). */
  detail?: string | null;
}
export interface Draft {
  id: string;
  puzzle: string;
  owner: string;
  numbers: Numbers;
  revision: number;
  /** Left out, the draft is one from a service older than Save, and the site must still read it. */
  save?: Save;
  createdAt: string;
  updatedAt: string;
}

export const numbers = (over: Partial<Numbers> = {}): Numbers => ({ seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, ...over });
export const draft = (over: Partial<Draft> = {}): Draft => ({ id: "draftdraft", puzzle: "cooling", owner: "octo", numbers: numbers({ overrides: { pieceKinds: 5 } }), revision: 3, createdAt: "2026-11-13T12:00:00.000Z", updatedAt: "2026-11-13T12:00:00.000Z", ...over });

export const NO_SAVE: Save = { state: "idle", error: null, pull: null, savedRevision: null, behind: false };

/** A line of a draft's chat, as the service sends it. */
export type Item = { id: number; turn: number; at: string } & (
  | { kind: "user"; text: string; model: string; steer: boolean }
  | { kind: "reply"; text: string }
  | { kind: "step"; tool: string; summary: string; detail: string | null; failed: boolean }
  | { kind: "ask"; path: string; state: "pending" | "allowed" | "refused" }
  | { kind: "turn"; status: "done" | "stopped" | "failed" | "capped"; commit: string | null; costUsd: number; reverted: boolean; reason?: "agent" | "worktree" | "restart" | "idle"; error?: string }
);
type Line<K extends Item["kind"]> = Omit<Extract<Item, { kind: K }>, "id" | "turn" | "at" | "kind">;

/** A take as the stand-in keeps it: what the service lists, and the bytes it serves under the hash. */
export interface StandinTake {
  hash: string;
  /** `sprite` only to stand in for a service older than the site, which may still list one (ADR 0063). */
  kind: "sprite" | "sound";
  puzzle: string;
  name: string;
  draft: string | null;
  take: number | null;
  prompt?: string;
  body: Buffer;
  contentType: string;
}

/** A chat as the stand-in keeps it (ADR 0060): its lines, whether a turn runs, the words of the reply being written, and the money. */
export interface StandinChat {
  id: string;
  puzzle: string;
  title: string;
  /** The draft it is on; null for one whose draft is gone. */
  draft: string | null;
  items: Item[];
  running: boolean;
  turn: number;
  live: string;
  spentUsd: number;
  updatedAt: string;
  /** False until a message or a line makes it: the first chat is there to be written to, and listed only once it has something in it. */
  made: boolean;
}

export interface Service {
  /** The first chat on the one draft the chat tests use; a message to no chat starts it. */
  chat: StandinChat;
  /** The chats after the first: those a test makes, and those the page starts once the first is made. */
  others: StandinChat[];
  /** The one cap all drafts share, and what has been spent against it. */
  cap: { spentUsd: number; capUsd: number };
  /** Set, a chat's event stream is refused, as when the connection is lost: the page is left to ask for the chat. */
  streamDown: boolean;
  /** Add a line to a chat (the first, unless another is named), as the agent's turn would. */
  say<K extends Item["kind"]>(kind: K, data: Line<K>, to?: StandinChat): Item;
  /** Add a chat, as earlier turns would have. */
  addChat(over: Partial<StandinChat> & { id: string }): StandinChat;
  drafts: Draft[];
  /** The tester links Save made. */
  links: Array<{ id: string; puzzle: string; name: string }>;
  /** The takes the service keeps (ADR 0051); a test adds to them as a turn of the chat would. */
  takes: StandinTake[];
  /** How the Save or update now being written ends, when the test says so: the stand-in holds it at `saving` until then. */
  finish(id: string, save: Partial<Save>): void;
  /** Every request that would change a draft, as `METHOD path`, with its body. */
  writes: Array<{ call: string; body: unknown }>;
  /** Every request at all. */
  calls: string[];
  /** Set to answer the next saves as the real service would when it cannot or will not take them. */
  fail: null | "conflict" | "down";
}

/** A stand-in service: one owner (or nobody), and the drafts the test gives it, kept as the real one keeps them. */
export async function service(page: Page, o: { login: string | null; drafts?: Draft[]; save?: boolean; chat?: boolean; takes?: StandinTake[]; picks?: boolean; words?: boolean }): Promise<Service> {
  const fresh = (over: Partial<StandinChat> & { id: string }): StandinChat => ({ puzzle: "cooling", title: "Chat", draft: "draftdraft", items: [], running: false, turn: 0, live: "", spentUsd: 0, updatedAt: "2026-11-14T12:00:00.000Z", made: true, ...over });
  /** Line ids run across every chat, as the service's do. */
  let lines = 0;
  /** Each message makes its chat the one last spoken in. */
  let clock = 0;
  const s: Service = {
    chat: fresh({ id: "chatchat01", made: false }),
    others: [],
    cap: { spentUsd: 0, capUsd: 20 },
    streamDown: false,
    say(kind, data, to = s.chat) {
      const made = { id: ++lines, turn: to.turn, at: "2026-11-14T12:00:00.000Z", kind, ...data } as unknown as Item;
      to.items.push(made);
      to.made = true;
      return made;
    },
    addChat(over) {
      const made = fresh(over);
      s.others.push(made);
      return made;
    },
    drafts: [...(o.drafts ?? [])],
    links: [],
    takes: [...(o.takes ?? [])],
    writes: [],
    calls: [],
    fail: null,
    finish(id, save) {
      const d = s.drafts.find((x) => x.id === id);
      if (d) d.save = { ...NO_SAVE, ...d.save, state: "idle", error: null, ...save };
    },
  };
  await page.route(`${SERVICE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { "Access-Control-Allow-Origin": req.headers().origin ?? "*", "Access-Control-Allow-Credentials": "true" };
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS" } });
    s.calls.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === "/auth/me") return json(200, { login: o.login, signIn: true, dev: false, ...(o.save === undefined ? {} : { save: o.save }), ...(o.chat === undefined ? {} : { chat: o.chat }), ...(o.takes === undefined ? {} : { takes: true }), ...(o.picks === undefined ? {} : { picks: o.picks }), ...(o.words === undefined ? {} : { words: o.words }) });
    if (url.pathname === "/auth/sign-out") {
      o.login = null;
      return json(200, { ok: true });
    }
    // A take is anyone's who has its hash.
    const hash = /^\/takes\/([0-9a-f]{64})$/.exec(url.pathname)?.[1];
    if (hash) {
      const take = s.takes.find((t) => t.hash === hash);
      return take ? route.fulfill({ status: 200, contentType: take.contentType, headers: { "Access-Control-Allow-Origin": "*" }, body: take.body }) : json(404, { error: "not_found" });
    }
    if (!o.login) return json(401, { error: "unauthorized" });
    if (url.pathname === "/takes")
      return json(200, {
        takes: s.takes.filter((t) => t.puzzle === url.searchParams.get("puzzle")).map((t) => ({ hash: t.hash, kind: t.kind, puzzle: t.puzzle, name: t.name, bytes: t.body.length, prompt: t.prompt ?? null, draft: t.draft, take: t.take, createdAt: "2026-11-15T12:00:00.000Z" })),
      });
    const link = (l: Service["links"][number]) => ({ ...l, author: o.login, draft: numbers(), createdAt: "2026-11-13T12:00:00.000Z", withdrawn: false });
    if (url.pathname === "/links") return json(200, { links: s.links.filter((l) => l.puzzle === url.searchParams.get("puzzle")).map(link) });
    const parts = /^\/drafts\/([^/]+)(?:\/(save|update|chat))?$/.exec(url.pathname);
    const id = parts?.[1];
    const act = parts?.[2];
    if (url.pathname === "/drafts" && req.method() === "GET") {
      const puzzle = url.searchParams.get("puzzle");
      return json(200, { drafts: s.drafts.filter((d) => !puzzle || d.puzzle === puzzle) });
    }

    // The chats (ADR 0060): the first, once made, and the others, the one last spoken in first.
    const all = (): StandinChat[] => [s.chat, ...s.others].filter((c) => c.made).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const summary = (c: StandinChat) => ({ id: c.id, puzzle: c.puzzle, title: c.title, draft: c.draft, turns: c.turn, spentUsd: c.spentUsd, running: c.running, createdAt: "2026-11-13T12:00:00.000Z", updatedAt: c.updatedAt });
    const stateOf = (c: StandinChat) => {
      const d = s.drafts.find((x) => x.id === c.draft) ?? null;
      const busy = !c.running && all().some((o) => o !== c && o.running && o.draft !== null && o.draft === c.draft);
      return { chat: summary(c), items: c.items, busy, live: c.live, cap: s.cap, draft: d };
    };
    const touch = (c: StandinChat): void => void (c.updatedAt = new Date(Date.now() + ++clock).toISOString());
    if (url.pathname === "/chats" && req.method() === "GET") return json(200, { chats: all().filter((c) => c.puzzle === url.searchParams.get("puzzle")).map(summary), cap: s.cap });
    const chatParts = /^\/chats\/([^/]+)(?:\/(events|stop|revert|allow))?$/.exec(url.pathname);
    if (chatParts) {
      const c = all().find((x) => x.id === chatParts[1]);
      const cAct = chatParts[2];
      if (!c) return cAct === "events" ? route.abort() : json(404, { error: "not_found" });
      if (cAct === undefined && req.method() === "GET") return json(200, stateOf(c));
      // The stream (ADR 0055), as a route can answer it: the whole chat, and the connection ends. The page asks
      // again, as it does after any drop, so each thing a test does to the chat reaches the page on the next connection.
      if (cAct === "events") {
        if (s.streamDown) return route.abort();
        return route.fulfill({ status: 200, contentType: "text/event-stream", headers: cors, body: `data: ${JSON.stringify({ type: "state", state: stateOf(c) })}\n\n` });
      }
      s.writes.push({ call: `${req.method()} ${url.pathname}`, body: req.postDataJSON() as unknown });
      if (cAct === undefined && req.method() === "PATCH") {
        c.title = (req.postDataJSON() as { title: string }).title.trim();
        return json(200, summary(c));
      }
      if (cAct === undefined && req.method() === "DELETE") {
        if (c.running) return json(409, { error: "conflict" });
        if (c === s.chat) Object.assign(s.chat, fresh({ id: "chatchat01", made: false }));
        else s.others = s.others.filter((x) => x !== c);
        return json(200, { ok: true });
      }
      if (cAct === "stop") {
        c.running = false;
        s.say("turn", { status: "stopped", commit: null, costUsd: 0.01, reverted: false }, c);
        return json(202, { ok: true });
      }
      if (cAct === "revert") {
        const turn = (req.postDataJSON() as { turn: number }).turn;
        for (const i of c.items) if (i.kind === "turn" && i.turn === turn) i.reverted = true;
        return json(200, { ok: true });
      }
      if (cAct === "allow") {
        const body = req.postDataJSON() as { item: number; allow: boolean };
        for (const i of c.items) if (i.kind === "ask" && i.id === body.item) i.state = body.allow ? "allowed" : "refused";
        return json(200, { ok: true });
      }
      return json(404, { error: "not_found" });
    }
    if (url.pathname !== "/drafts" && !id) return json(404, { error: "not_found" });
    s.writes.push({ call: `${req.method()} ${url.pathname}`, body: req.postDataJSON() as unknown });
    if (s.fail === "down") return route.abort();
    if (s.fail === "conflict") return json(409, { error: "conflict" });
    if (url.pathname === "/drafts") {
      const body = req.postDataJSON() as { puzzle: string; numbers: Numbers };
      if (s.drafts.some((d) => d.puzzle === body.puzzle)) return json(409, { error: "conflict" });
      const made = draft({ id: "newdraft22", puzzle: body.puzzle, numbers: body.numbers, revision: 1 });
      s.drafts.push(made);
      return json(201, made);
    }
    const found = s.drafts.find((d) => d.id === id);
    if (!found) return json(404, { error: "not_found" });
    if (act === "chat") {
      const body = req.postDataJSON() as { chat: string | null; text: string; model: string };
      // A message to no chat starts one: the first, while it is not made, and a new one after.
      let c = body.chat === null ? null : (all().find((x) => x.id === body.chat) ?? null);
      if (body.chat !== null && !c) return json(404, { error: "not_found" });
      const steer = c?.running ?? false;
      if (!steer && all().some((o) => o.running && o.draft === found.id)) return json(409, { error: "busy" });
      if (s.cap.spentUsd >= s.cap.capUsd && !steer) return json(409, { error: "capped" });
      if (!c) {
        c = s.chat.made ? s.addChat({ id: `newchat${String(s.others.length + 1).padStart(3, "0")}`, title: body.text }) : s.chat;
        Object.assign(c, { made: true, title: body.text, draft: found.id });
      }
      c.draft = found.id;
      if (!steer) c.turn += 1;
      s.say("user", { text: body.text, model: body.model, steer }, c);
      c.running = true;
      touch(c);
      return json(202, { chat: c.id });
    }
    if (act === "save") {
      const body = req.postDataJSON() as { revision: number; name: string };
      if (body.revision !== found.revision) return json(409, { error: "conflict" });
      const made = { id: `savelink${String(s.links.length + 1).padStart(2, "2")}`, puzzle: found.puzzle, name: body.name };
      s.links.unshift(made);
      found.save = { ...NO_SAVE, ...found.save, state: "saving", error: null };
      return json(202, { draft: found, link: { ...link(made), draft: found.numbers } });
    }
    if (act === "update") {
      found.save = { ...NO_SAVE, ...found.save, state: "saving", error: null };
      return json(202, found);
    }
    if (req.method() === "PUT") {
      const body = req.postDataJSON() as { numbers: Numbers; revision: number };
      if (body.revision !== found.revision) return json(409, { error: "conflict" });
      found.numbers = body.numbers;
      // A service older than picks keeps none of what it is sent.
      if (!o.picks) delete found.numbers.picks;
      // Nor does one older than words.
      if (!o.words) delete found.numbers.words;
      found.revision += 1;
      return json(200, found);
    }
    if (req.method() === "DELETE") {
      s.drafts = s.drafts.filter((d) => d.id !== id);
      return json(200, { ok: true });
    }
    return json(404, { error: "not_found" });
  });
  return s;
}

