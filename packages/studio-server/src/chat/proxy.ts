import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "../log.js";
import { costUsd, type Usage } from "./prices.js";

/**
 * The agent's only way to a model (ADR 0047). The agent's process is given this proxy's address
 * and a token made for one turn; the proxy checks the token, puts the real key in its place and
 * passes the request on. So the Anthropic key never leaves the service process, a token is worth
 * nothing once its turn ends, and every response is metered here, by the service, before the
 * agent sees it: the spend cap is enforced where the agent cannot reach.
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
  };
  const read = (json: string): void => {
    try {
      const o = JSON.parse(json) as { usage?: unknown; message?: { usage?: unknown } };
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

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "host", "x-api-key", "authorization", "accept-encoding"]);

export async function createModelProxy(o: { apiKey: string; upstream?: string; log: Logger; fetcher?: typeof fetch }): Promise<ModelProxy> {
  const upstream = (o.upstream ?? "https://api.anthropic.com").replace(/\/$/, "");
  const fetcher = o.fetcher ?? fetch;
  const turns = new Map<string, { spend(usd: number): void; open(): boolean }>();

  const refuse = (res: ServerResponse, status: number, type: string, message: string): void => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type, message } }));
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const key = req.headers["x-api-key"];
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const turn = turns.get(typeof key === "string" ? key : (bearer ?? ""));
    if (!turn) return refuse(res, 401, "authentication_error", "no turn is running for this token");
    // 403 is not retried: a turn over the cap must stop, not wait.
    if (!turn.open()) return refuse(res, 403, "permission_error", "the studio's spend cap is reached");

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    let model = "";
    try {
      model = String((JSON.parse(body.toString("utf8")) as { model?: unknown }).model ?? "");
    } catch {
      /* not a JSON request */
    }
    const headers: Record<string, string> = { "x-api-key": o.apiKey };
    for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name) && typeof value === "string") headers[name] = value;

    const answer = await fetcher(`${upstream}${req.url ?? "/"}`, { method: req.method ?? "POST", headers, ...(body.length ? { body } : {}) });
    const out: Record<string, string> = {};
    answer.headers.forEach((value, name) => {
      if (!HOP.has(name)) out[name] = value;
    });
    res.writeHead(answer.status, out);
    const sse = (answer.headers.get("content-type") ?? "").includes("text/event-stream");
    const metered = answer.ok && (req.url ?? "").split("?")[0] === "/v1/messages";
    let seen = "";
    if (answer.body) {
      const decoder = new TextDecoder();
      for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
        if (metered) seen += decoder.decode(chunk, { stream: true });
      }
    }
    res.end();
    if (metered) turn.spend(costUsd(model, meterBody(seen, sse)));
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
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
