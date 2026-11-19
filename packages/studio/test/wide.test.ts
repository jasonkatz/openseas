import { describe, expect, it } from "vitest";
import { MODE_IDS } from "../src/studio/modes.js";
import { NARROW, canWiden, isWide, scopeWide, toggleWide } from "../src/studio/wide.js";

describe("a panel opened wide (ADR 0067)", () => {
  it("never widens Play, and every other mode can", () => {
    expect(canWiden("play")).toBe(false);
    for (const m of MODE_IDS.filter((m) => m !== "play")) expect(canWiden(m)).toBe(true);
    expect(toggleWide(NARROW, "play")).toBe(NARROW);
    expect(isWide({ scope: "all", all: true, modes: [] }, "play")).toBe(false);
  });

  it("remembers each mode on its own by default", () => {
    const w = toggleWide(NARROW, "sprites");
    expect(isWide(w, "sprites")).toBe(true);
    expect(isWide(w, "tuning")).toBe(false);
    expect(isWide(toggleWide(w, "sprites"), "sprites")).toBe(false);
  });

  it("shares one switch across every mode when the scope is all", () => {
    const w = toggleWide({ ...NARROW, scope: "all" }, "setup");
    for (const m of ["setup", "tuning", "scoring", "sprites", "sounds", "text"] as const) expect(isWide(w, m)).toBe(true);
  });

  it("keeps the panel on screen as it is when the scope changes", () => {
    const each = toggleWide(NARROW, "tuning");
    const all = scopeWide(each, "all", "tuning");
    expect(isWide(all, "tuning")).toBe(true);
    expect(isWide(all, "text")).toBe(true);
    const back = scopeWide({ scope: "all", all: false, modes: [] }, "mode", "text");
    expect(isWide(back, "text")).toBe(false);
    const kept = scopeWide({ scope: "all", all: true, modes: [] }, "mode", "text");
    expect(kept.modes).toEqual(["text"]);
  });
});
