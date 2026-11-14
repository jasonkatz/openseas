import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForgeError, appJwt, createGitHubApp, readPrivateKey } from "../src/save/forge.js";
import { tokenEnv } from "../src/save/repo.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

interface Call {
  method: string;
  path: string;
  auth: string;
  body: unknown;
}

/** A stand-in for api.github.com: it records what it is asked and answers from a script. */
function github(answers: (c: Call) => { status: number; json: unknown }): { calls: Call[]; fetcher: typeof fetch } {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const call: Call = { method: init?.method ?? "GET", path: String(input).replace("https://api.github.com", ""), auth: headers.Authorization!.replace("Bearer ", ""), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const a = answers(call);
    return new Response(JSON.stringify(a.json), { status: a.status });
  }) as typeof fetch;
  return { calls, fetcher };
}

const T0 = Date.parse("2026-11-14T12:00:00Z");

describe("the studio's GitHub App", () => {
  it("signs a token GitHub can check, good for under ten minutes", () => {
    const jwt = appJwt("12345", privateKey, T0);
    const [head, payload, signature] = jwt.split(".") as [string, string, string];
    expect(createVerify("RSA-SHA256").update(`${head}.${payload}`).verify(publicKey, signature, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe("12345");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(claims.iat).toBeLessThan(T0 / 1000);
  });

  it("reads its key however the environment holds it", () => {
    expect(readPrivateKey(privateKey)).toBe(privateKey.trim());
    expect(readPrivateKey(privateKey.replace(/\n/g, "\\n"))).toBe(privateKey.trim());
    expect(readPrivateKey(Buffer.from(privateKey).toString("base64"))).toBe(privateKey.trim());
  });

  it("asks for a token for this repository and these two permissions, and keeps it until it is nearly out", async () => {
    let now = T0;
    let minted = 0;
    const gh = github((c) => {
      if (c.path === "/repos/octo/openseas/installation") return { status: 200, json: { id: 77 } };
      if (c.path === "/app/installations/77/access_tokens") return { status: 201, json: { token: `inst-${++minted}`, expires_at: new Date(now + 60 * 60_000).toISOString() } };
      return { status: 404, json: {} };
    });
    const app = createGitHubApp({ appId: "12345", privateKey, repo: "octo/openseas", fetcher: gh.fetcher, now: () => now });
    expect(await app.token()).toBe("inst-1");
    expect(gh.calls[1]).toMatchObject({ method: "POST", body: { repositories: ["openseas"], permissions: { contents: "write", pull_requests: "write" } } });
    // The App speaks as itself, with the signed token, to get one.
    expect(gh.calls[0]!.auth.split(".")).toHaveLength(3);
    now += 50 * 60_000;
    expect(await app.token()).toBe("inst-1");
    now += 6 * 60_000;
    expect(await app.token()).toBe("inst-2");
  });

  it("opens a draft pull request, reads its state, describes it again and closes it", async () => {
    const state = { state: "open", merged: false };
    const gh = github((c) => {
      if (c.path.endsWith("/installation")) return { status: 200, json: { id: 77 } };
      if (c.path.endsWith("/access_tokens")) return { status: 201, json: { token: "inst", expires_at: new Date(T0 + 3_600_000).toISOString() } };
      if (c.method === "POST" && c.path === "/repos/octo/openseas/pulls") return { status: 201, json: { number: 9, html_url: "https://github.com/octo/openseas/pull/9" } };
      if (c.path === "/repos/octo/openseas/pulls/9") return { status: 200, json: state };
      return { status: 404, json: {} };
    });
    const app = createGitHubApp({ appId: "1", privateKey, repo: "octo/openseas", fetcher: gh.fetcher, now: () => T0 });
    expect(await app.openPull({ head: "studio/cooling-abc", base: "main", title: "T", body: "B" })).toEqual({ number: 9, url: "https://github.com/octo/openseas/pull/9" });
    expect(gh.calls.at(-1)).toMatchObject({ auth: "inst", body: { title: "T", head: "studio/cooling-abc", base: "main", body: "B", draft: true } });
    expect(await app.pullState(9)).toBe("open");
    state.state = "closed";
    expect(await app.pullState(9)).toBe("closed");
    state.merged = true;
    expect(await app.pullState(9)).toBe("merged");
    await app.describePull(9, "again");
    expect(gh.calls.at(-1)).toMatchObject({ method: "PATCH", path: "/repos/octo/openseas/pulls/9", body: { body: "again" } });
    await app.closePull(9);
    expect(gh.calls.at(-1)).toMatchObject({ method: "PATCH", body: { state: "closed" } });
  });

  it("finds the pull request a branch already has, and says so when GitHub refuses", async () => {
    let listed: unknown[] = [{ number: 4, html_url: "https://github.com/octo/openseas/pull/4" }];
    const gh = github((c) => {
      if (c.path.endsWith("/installation")) return { status: 200, json: { id: 77 } };
      if (c.path.endsWith("/access_tokens")) return { status: 201, json: { token: "inst", expires_at: new Date(T0 + 3_600_000).toISOString() } };
      if (c.method === "POST") return { status: 422, json: { message: "A pull request already exists" } };
      if (c.path.startsWith("/repos/octo/openseas/pulls?")) return { status: 200, json: listed };
      return { status: 500, json: { message: "boom" } };
    });
    const app = createGitHubApp({ appId: "1", privateKey, repo: "octo/openseas", fetcher: gh.fetcher, now: () => T0 });
    expect(await app.openPull({ head: "studio/x", base: "main", title: "T", body: "B" })).toEqual({ number: 4, url: "https://github.com/octo/openseas/pull/4" });
    expect(gh.calls.at(-1)!.path).toContain(`head=${encodeURIComponent("octo:studio/x")}`);
    listed = [];
    await expect(app.openPull({ head: "studio/x", base: "main", title: "T", body: "B" })).rejects.toBeInstanceOf(ForgeError);
    await expect(app.pullState(1)).rejects.toThrow(/answered 500/);
  });
});

describe("the token git pushes with", () => {
  it("rides in one command's environment, for the remote's host alone", () => {
    const env = tokenEnv("https://github.com/octo/openseas.git", "inst-1");
    expect(env).toEqual({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from("x-access-token:inst-1").toString("base64")}` });
    expect(tokenEnv("https://github.com/octo/openseas.git", null)).toEqual({});
    expect(tokenEnv("/tmp/origin.git", "inst-1")).toEqual({});
    expect(tokenEnv("http://github.com/octo/openseas.git", "inst-1")).toEqual({});
  });
});
