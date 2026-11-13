import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { newLinkId } from "../src/links.js";
import { cookie, readCookie, seal, unseal } from "../src/session.js";

const secret = "test-secret-test-secret";

describe("a sealed cookie value", () => {
  it("opens with the secret that sealed it, until it expires", () => {
    const now = 1_700_000_000_000;
    const sealed = seal(secret, { login: "octo" }, 60, now);
    expect(unseal<{ login: string }>(secret, sealed, now + 59_000)?.login).toBe("octo");
    expect(unseal(secret, sealed, now + 60_000)).toBeNull();
  });

  it("does not open when it was tampered with, signed by another secret, or is not one at all", () => {
    const sealed = seal(secret, { login: "octo" }, 60);
    const [body, sig] = sealed.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ login: "mallory", exp: 9_999_999_999 })).toString("base64url");
    expect(unseal(secret, `${forged}.${sig}`)).toBeNull();
    expect(unseal("another-secret-another-secret", sealed)).toBeNull();
    expect(unseal(secret, body)).toBeNull();
    expect(unseal(secret, "")).toBeNull();
    expect(unseal(secret, undefined)).toBeNull();
  });

  it("round-trips through a cookie header", () => {
    const sealed = seal(secret, { login: "octo" }, 60);
    const set = cookie("studio_session", sealed, { maxAgeSeconds: 60, secure: false, crossSite: false });
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).not.toContain("Secure");
    expect(readCookie(`a=1; ${set.split(";")[0]}; b=2`, "studio_session")).toBe(sealed);
    expect(cookie("x", "y", { maxAgeSeconds: 1, secure: false, crossSite: true })).toMatch(/SameSite=None; Secure/);
  });
});

describe("the service's environment", () => {
  const base = { DATABASE_URL: "postgres://x", STUDIO_SECRET: "0123456789abcdef" };

  it("reads owners as lower-case logins and counts the dev login among them", () => {
    const env = loadEnv({ ...base, STUDIO_OWNERS: "Octo, hubot", STUDIO_DEV_LOGIN: "Dev" });
    expect(env.STUDIO_OWNERS).toEqual(["octo", "hubot", "dev"]);
  });

  it("refuses a dev login in production, and a short secret anywhere", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", STUDIO_DEV_LOGIN: "dev" })).toThrow(/STUDIO_DEV_LOGIN/);
    expect(() => loadEnv({ ...base, STUDIO_SECRET: "short" })).toThrow(/STUDIO_SECRET/);
  });
});

describe("a tester link's id", () => {
  it("is ten readable characters and never a puzzle's id", () => {
    for (let i = 0; i < 200; i++) expect(newLinkId()).toMatch(/^[a-z2-9]{10}$/);
  });
});
