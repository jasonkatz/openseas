import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "../log.js";
import { anthropicUsd, ELEVENLABS_USD_PER_CREDIT, openaiUsd, SOUND_UNMETERED_USD, type ImageUsage, type Usage } from "./prices.js";

/**
 * The agent's only way to a paid API (ADR 0047, ADR 0059). The agent's process is given this
 * proxy's address and a token made for one turn; the proxy checks the token, puts the real key in
 * its place and passes the request on. Anthropic is at the root, OpenAI under `/openai` and
 * ElevenLabs under `/elevenlabs`: an image API and a sound API that stay open to the chat for
 * other work now that no piece and no cue is generated (ADR 0062 decision 6). So no key leaves the service
 * process, a token is worth nothing once its turn ends, and every response is metered here, by
 * the service, from what the response itself says it billed, before the agent sees it: the spend
 * cap is enforced where the agent cannot reach.
 */
export interface ModelProxy {
  /** Where the agent's process sends its requests. */
  readonly url: string;
  /**
   * Open the way for one turn. `spend` is told what each response cost as it ends; `open` is asked
   * before each request and refuses it when it answers false. The token goes to the agent's
   * process as its API key.
   */
  admit(o: { spend(usd: number): void; open(): boolean }): { token: string; close(): void };
  close(): Promise<void>;
}

/** A provider other than Anthropic: its key, and where its API is when that is not its own address. */
export interface Provider {
  key: string;
  upstream?: string;
}

/** Usage out of a Messages API response: one JSON body, or a stream of events where the start carries the input side and each delta the output so far. */
export function meterBody(text: string, sse: boolean): Usage {
  const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const take = (usage: unknown): void => {
    if (typeof usage !== "object" || usage === null) return;
    const g = (k: string): number | undefined => (typeof (usage as Record<string, unknown>)[k] === "number" ? ((usage as Record<string, unknown>)[k] as number) : undefined);
    // Counts are running totals, never increments: the last word on each stands.
    u.input = g("input_tokens") ?? u.input;
    u.output = g("output_tokens") ?? u.output;
    u.cacheRead = g("cache_read_input_tokens") ?? u.cacheRead;
    u.cacheWrite = g("cache_creation_input_tokens") ?? u.cacheWrite;
    // Writes split by lifetime, when the response splits them: the hour's are dearer.
    const split = (usage as { cache_creation?: unknown }).cache_creation;
    if (typeof split === "object" && split !== null) {
      const s = split as Record<string, unknown>;
      const m5 = typeof s.ephemeral_5m_input_tokens === "number" ? s.ephemeral_5m_input_tokens : 0;
      const h1 = typeof s.ephemeral_1h_input_tokens === "number" ? s.ephemeral_1h_input_tokens : 0;
      if (m5 + h1 > 0) {
        u.cacheWrite = m5;
        u.cacheWrite1h = h1;
      }
    }
    const speed = (usage as { speed?: unknown }).speed;
    if (typeof speed === "string") u.speed = speed;
  };
  const read = (json: string): void => {
    try {
      const o = JSON.parse(json) as { usage?: unknown; model?: unknown; message?: { usage?: unknown; model?: unknown } };
      const model = o.message?.model ?? o.model;
      if (typeof model === "string" && model) u.model = model;
      take(o.message?.usage);
      take(o.usage);
    } catch {
      /* not JSON: nothing to meter */
    }
  };
  if (!sse) read(text);
  else for (const line of text.split("\n")) if (line.startsWith("data:")) read(line.slice(5));
  return u;
}

/** Usage out of an Images API response: tokens by kind, under `usage`. Null when it has none. */
export function meterImages(text: string): ImageUsage | null {
  try {
    const usage = (JSON.parse(text) as { usage?: unknown }).usage;
    if (typeof usage !== "object" || usage === null) return null;
    const n = (v: unknown): number => (typeof v === "number" ? v : 0);
    const u = usage as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: Record<string, unknown>; output_tokens_details?: Record<string, unknown> };
    const inDetail = u.input_tokens_details ?? {};
    const outDetail = u.output_tokens_details ?? {};
    const cachedIn = n(inDetail.cached_tokens);
    const imageIn = n(inDetail.image_tokens);
    // Without a breakdown, every input token is priced as text and every output token as image: what a prompt and a picture are.
    const textIn = inDetail.text_tokens !== undefined ? n(inDetail.text_tokens) : Math.max(0, n(u.input_tokens) - imageIn);
    const textOut = n(outDetail.text_tokens);
    const imageOut = outDetail.image_tokens !== undefined ? n(outDetail.image_tokens) : Math.max(0, n(u.output_tokens) - textOut);
    return { textIn: Math.max(0, textIn - cachedIn), imageIn, cachedIn, imageOut, textOut };
  } catch {
    return null;
  }
}

/** A field of a request, from a JSON body or a multipart form. */
export function fieldOf(body: Buffer, name: string): string {
  const text = body.toString("utf8");
  try {
    return String((JSON.parse(text) as Record<string, unknown>)[name] ?? "");
  } catch {
    return new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]+)`).exec(text)?.[1]?.trim() ?? "";
  }
}

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "host", "x-api-key", "xi-api-key", "authorization", "accept-encoding"]);

type Route = { name: "anthropic" | "openai" | "elevenlabs"; upstream: string; path: string; token: string; auth: Record<string, string> };

export async function createModelProxy(o: {
  apiKey: string;
  upstream?: string;
  /** The image API, once the sprite script's (ADR 0040) and kept for the chat's other work (ADR 0062). Without it the proxy refuses `/openai`. */
  openai?: Provider;
  /** The sound API, once the sound script's (ADR 0040) and kept for the chat's other work (ADR 0062), and what one of its credits costs on the owner's plan. Without it the proxy refuses `/elevenlabs`. */
  elevenlabs?: Provider & { usdPerCredit?: number };
  log: Logger;
  fetcher?: typeof fetch;
}): Promise<ModelProxy> {
  const upstream = (o.upstream ?? "https://api.anthropic.com").replace(/\/$/, "");
  const fetcher = o.fetcher ?? fetch;
  const bare = (u: string): string => u.replace(/\/$/, "");
  const header = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
  const bearer = (req: IncomingMessage): string => /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";

  /** Where a request goes, with what key, and which of its headers carries the turn's token. Null for a provider the service has no key for. */
  const route = (req: IncomingMessage): Route | null => {
    const url = req.url ?? "/";
    const under = (prefix: string): string | null => (url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`) ? url.slice(prefix.length) || "/" : null);
    const openai = under("/openai");
    if (openai !== null) return o.openai ? { name: "openai", upstream: bare(o.openai.upstream ?? "https://api.openai.com"), path: openai, token: bearer(req), auth: { authorization: `Bearer ${o.openai.key}` } } : null;
    const eleven = under("/elevenlabs");
    if (eleven !== null) return o.elevenlabs ? { name: "elevenlabs", upstream: bare(o.elevenlabs.upstream ?? "https://api.elevenlabs.io"), path: eleven, token: header(req.headers["xi-api-key"]), auth: { "xi-api-key": o.elevenlabs.key } } : null;
    return { name: "anthropic", upstream, path: url, token: header(req.headers["x-api-key"]) || bearer(req), auth: { "x-api-key": o.apiKey } };
  };
  const turns = new Map<string, { spend(usd: number): void; open(): boolean }>();

  const refuse = (res: ServerResponse, status: number, type: string, message: string): void => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type, message } }));
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const to = route(req);
    if (to === null) return refuse(res, 404, "not_found_error", "the studio has no key for this API");
    const turn = turns.get(to.token);
    if (!turn) return refuse(res, 401, "authentication_error", "no turn is running for this token");
    // 403 is not retried: a turn over the cap must stop, not wait.
    if (!turn.open()) return refuse(res, 403, "permission_error", "the studio's spend cap is reached");

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const model = fieldOf(body, "model");
    const images = Math.max(1, Number(fieldOf(body, "n")) || 1);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name) && typeof value === "string") headers[name] = value;
    Object.assign(headers, to.auth);

    // An agent that is stopped drops its request. The model is then told to stop too: nobody is left to read what it would write, and it is paid for by the word.
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) gone.abort();
    });
    const answer = await fetcher(`${to.upstream}${to.path}`, { method: req.method ?? "POST", headers, signal: gone.signal, ...(body.length ? { body } : {}) });
    const out: Record<string, string> = {};
    answer.headers.forEach((value, name) => {
      if (!HOP.has(name)) out[name] = value;
    });
    res.writeHead(answer.status, out);
    const sse = (answer.headers.get("content-type") ?? "").includes("text/event-stream");
    const path = to.path.split("?")[0]!;
    // What is billed: a message, a picture, a sound. Anything else (a model list, a token count) is free.
    const metered = answer.ok && (to.name === "anthropic" ? path === "/v1/messages" : to.name === "openai" ? path.startsWith("/v1/images/") : path.startsWith("/v1/sound-generation"));
    // ElevenLabs says what it charged in a header; its body is the sound, and is not read.
    const reads = metered && to.name !== "elevenlabs";
    let seen = "";
    try {
      if (answer.body) {
        const decoder = new TextDecoder();
        for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) {
          res.write(chunk);
          if (reads) seen += decoder.decode(chunk, { stream: true });
        }
      }
      res.end();
    } finally {
      // Whatever arrived was paid for, whether or not the answer was read to its end.
      if (metered) turn.spend(cost(to.name, model, images, seen, sse, answer.headers));
    }
  }

  /** Dollars from what a response says it billed (ADR 0059). */
  function cost(name: Route["name"], model: string, images: number, seen: string, sse: boolean, headers: Headers): number {
    if (name === "anthropic") return anthropicUsd(model, meterBody(seen, sse));
    if (name === "openai") {
      const u = meterImages(seen);
      if (u) return openaiUsd(model, u);
      // Pictures cut off before their usage arrived were still made: each is priced as a high-quality square one.
      o.log.warn({ model, images }, "model proxy: an image response had no usage; charged an estimate");
      return openaiUsd(model, { textIn: 0, imageIn: 0, cachedIn: 0, imageOut: 4160 * images, textOut: 0 });
    }
    const credits = Number(headers.get("character-cost") ?? headers.get("x-character-count") ?? NaN);
    if (Number.isFinite(credits) && credits >= 0) return credits * (o.elevenlabs?.usdPerCredit ?? ELEVENLABS_USD_PER_CREDIT);
    o.log.warn("model proxy: a sound response did not say what it charged; charged an estimate");
    return SOUND_UNMETERED_USD;
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      // The agent hung up, and the request upstream was dropped with it: nothing failed.
      if (res.destroyed) return;
      o.log.warn({ err }, "model proxy: request failed");
      if (!res.headersSent) refuse(res, 502, "api_error", "the studio could not reach the model");
      else res.end();
    });
  });
  // This machine only: the agent's process is the one caller.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    admit(turn) {
      const token = `studio-turn-${randomBytes(24).toString("base64url")}`;
      turns.set(token, turn);
      return { token, close: () => void turns.delete(token) };
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
