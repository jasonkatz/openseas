import { describe, expect, it } from "vitest";
import { MODE_IDS } from "../src/studio/modes.js";
import { canWiden, isWide } from "../src/studio/wide.js";

describe("panels opened wide (ADR 0067)", () => {
  it("is one switch for every mode, and never widens Play", () => {
    expect(canWiden("play")).toBe(false);
    expect(isWide(true, "play")).toBe(false);
    for (const m of MODE_IDS.filter((m) => m !== "play")) {
      expect(isWide(true, m)).toBe(true);
      expect(isWide(false, m)).toBe(false);
    }
  });
});
