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
}
export interface Save {
  state: "idle" | "saving" | "failed";
  error: string | null;
  pull: { number: number; url: string } | null;
  savedRevision: number | null;
  behind: boolean;
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

export interface Service {
  drafts: Draft[];
  /** The tester links Save made. */
  links: Array<{ id: string; puzzle: string; name: string }>;
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
export async function service(page: Page, o: { login: string | null; drafts?: Draft[]; save?: boolean }): Promise<Service> {
  const s: Service = {
    drafts: [...(o.drafts ?? [])],
    links: [],
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
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" } });
    s.calls.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === "/auth/me") return json(200, { login: o.login, signIn: true, dev: false, ...(o.save === undefined ? {} : { save: o.save }) });
    if (url.pathname === "/auth/sign-out") {
      o.login = null;
      return json(200, { ok: true });
    }
    if (!o.login) return json(401, { error: "unauthorized" });
    const link = (l: Service["links"][number]) => ({ ...l, author: o.login, draft: numbers(), createdAt: "2026-11-13T12:00:00.000Z", withdrawn: false });
    if (url.pathname === "/links") return json(200, { links: s.links.filter((l) => l.puzzle === url.searchParams.get("puzzle")).map(link) });
    const parts = /^\/drafts\/([^/]+)(?:\/(save|update))?$/.exec(url.pathname);
    const id = parts?.[1];
    const act = parts?.[2];
    if (url.pathname === "/drafts" && req.method() === "GET") {
      const puzzle = url.searchParams.get("puzzle");
      return json(200, { drafts: s.drafts.filter((d) => !puzzle || d.puzzle === puzzle) });
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

