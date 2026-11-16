import { describe, expect, it } from "vitest";
import { MODE_IDS, MODE_SECTIONS, NUMBER_MODES, RAIL, humanize, labelOf, modeOfSection } from "../src/studio/modes.js";
import { GROUP_IDS } from "../src/tuning/groups.js";

describe("the studio's modes (ADR 0056)", () => {
  it("puts every tuning group, the stray keys, the round and the rating in exactly one numbers mode", () => {
    const placed = NUMBER_MODES.flatMap((m) => MODE_SECTIONS[m]);
    expect([...placed].sort()).toEqual([...GROUP_IDS, "other", "round", "rating"].sort());
    expect(new Set(placed).size).toBe(placed.length);
    for (const mode of NUMBER_MODES) for (const section of MODE_SECTIONS[mode]) expect(modeOfSection(section)).toBe(mode);
  });

  it("has every mode on the rail once", () => {
    expect(RAIL.filter((m) => m !== null)).toEqual([...MODE_IDS]);
  });

  it("reads a key as a label and says its unit once", () => {
    expect(humanize("heatRisePerMoves")).toBe("Heat rise per moves");
    expect(labelOf("streakStepPercent", null, "percent")).toEqual({ label: "Streak step", branch: null, unit: "percent" });
    expect(labelOf("charge", "specialChancePerMille", "permille")).toEqual({ label: "Charge", branch: "Special chance", unit: "permille" });
    // A unit the name reads well with stays in the label and gets no tag.
    expect(labelOf("heatRisePerMoves", null, "moves")).toEqual({ label: "Heat rise per moves", branch: null, unit: null });
    expect(labelOf("width", null, null)).toEqual({ label: "Width", branch: null, unit: null });
  });
});
