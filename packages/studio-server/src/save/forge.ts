import { createSign } from "node:crypto";

export type PullState = "open" | "merged" | "closed";

/**
 * What Save asks of GitHub, as the studio's GitHub App (ADR 0042 decision 9, ADR 0046): a token
 * git can push with, and a draft pull request to open, read, describe again and close. The App
 * is installed on this repository alone, with contents and pull requests to write. Its key and
 * every token made from it stay in this process.
 */
export interface Forge {
  /** An installation token, kept until shortly before it runs out. */
  token(): Promise<string>;
  /** Open a draft pull request, or find the open one the branch already has. */
  openPull(o: { head: string; base: string; title: string; body: string }): Promise<{ number: number; url: string }>;
  pullState(number: number): Promise<PullState>;
  describePull(number: number, body: string): Promise<void>;
  closePull(number: number): Promise<void>;
}

const b64 = (v: string | Buffer): string => Buffer.from(v).toString("base64url");

/** A GitHub App's key as an environment variable holds it: the PEM itself, the PEM with `\n` for its line ends, or all of it in base64. */
export function readPrivateKey(raw: string): string {
  const text = raw.includes("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return text.replace(/\\n/g, "\n").trim();
}

/** The short-lived token an App signs to speak as itself (RS256). */
export function appJwt(appId: string, privateKey: string, now = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  // Back a minute for a clock that runs ahead of GitHub's; nine minutes is under the ten GitHub allows.
  const body = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: appId }))}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey, "base64url")}`;
}

export class ForgeError extends Error {
  constructor(
    readonly what: string,
    readonly status: number,
    detail: string,
  ) {
    super(`GitHub ${what} answered ${status}: ${detail.slice(0, 200)}`);
  }
}

export function createGitHubApp(o: { appId: string; privateKey: string; repo: string; fetcher?: typeof fetch; now?: () => number }): Forge {
  const fetcher = o.fetcher ?? fetch;
  const now = o.now ?? Date.now;
  const [owner, name] = o.repo.split("/") as [string, string];
  const api = "https://api.github.com";
  let cached: { token: string; until: number } | null = null;

  async function call(what: string, auth: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const r = await fetcher(`${api}${path}`, {
      method,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${auth}`, "User-Agent": "openseas-studio", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // A list of drafts waits on this: GitHub having a slow day must not hang the studio's page.
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* an error page, say */
    }
    if (!r.ok && r.status !== 422) throw new ForgeError(what, r.status, text);
    return { status: r.status, json };
  }

  const forge: Forge = {
    async token() {
      if (cached && cached.until - now() > 5 * 60_000) return cached.token;
      const jwt = appJwt(o.appId, o.privateKey, now());
      const installation = (await call("installation", jwt, "GET", `/repos/${owner}/${name}/installation`)).json as { id?: unknown };
      if (typeof installation?.id !== "number") throw new ForgeError("installation", 200, "no installation id");
      // Asked for this repository and these two permissions only, whatever the installation holds.
      const made = await call("access token", jwt, "POST", `/app/installations/${installation.id}/access_tokens`, { repositories: [name], permissions: { contents: "write", pull_requests: "write" } });
      const t = made.json as { token?: unknown; expires_at?: unknown };
      if (made.status !== 201 || typeof t?.token !== "string") throw new ForgeError("access token", made.status, JSON.stringify(made.json));
      cached = { token: t.token, until: typeof t.expires_at === "string" ? Date.parse(t.expires_at) : now() + 55 * 60_000 };
      return cached.token;
    },
    async openPull({ head, base, title, body }) {
      const token = await forge.token();
      const made = await call("pull request", token, "POST", `/repos/${owner}/${name}/pulls`, { title, head, base, body, draft: true });
      const pull = made.json as { number?: unknown; html_url?: unknown };
      if (made.status === 201 && typeof pull?.number === "number" && typeof pull.html_url === "string") return { number: pull.number, url: pull.html_url };
      // Refused as a duplicate: the branch has an open pull request this service lost track of.
      const open = (await call("pull requests", token, "GET", `/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`)).json as Array<{ number?: unknown; html_url?: unknown }>;
      const found = Array.isArray(open) ? open[0] : undefined;
      if (found && typeof found.number === "number" && typeof found.html_url === "string") return { number: found.number, url: found.html_url };
      throw new ForgeError("pull request", made.status, JSON.stringify(made.json));
    },
    async pullState(number) {
      const pull = (await call("pull request", await forge.token(), "GET", `/repos/${owner}/${name}/pulls/${number}`)).json as { state?: unknown; merged?: unknown };
      return pull?.merged === true ? "merged" : pull?.state === "closed" ? "closed" : "open";
    },
    async describePull(number, body) {
      await call("pull request", await forge.token(), "PATCH", `/repos/${owner}/${name}/pulls/${number}`, { body });
    },
    async closePull(number) {
      await call("pull request", await forge.token(), "PATCH", `/repos/${owner}/${name}/pulls/${number}`, { state: "closed" });
    },
  };
  return forge;
}
