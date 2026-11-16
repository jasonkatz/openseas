import { getIP } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { IP_ADDRESS_OPTIONS } from "../src/auth.js";

describe("the caller's address for sign-in rate limits", () => {
  it("is read from X-Real-IP, which Railway's edge sets", () => {
    // X-Forwarded-For has more than one hop behind Railway, which Better Auth will not trust. Under
    // test it falls back to 127.0.0.1 when it finds no address, so the real one proves the header.
    const req = new Request("https://api.example.test/api/auth/get-session", {
      headers: { "x-real-ip": "47.230.129.84", "x-forwarded-for": "47.230.129.84, 10.0.0.1" },
    });
    expect(getIP(req, { advanced: { ipAddress: IP_ADDRESS_OPTIONS } })).toBe("47.230.129.84");
  });
});
