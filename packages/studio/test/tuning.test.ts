import { describe, expect, it, vi } from "vitest";
import { PUZZLE_IDS } from "@openseas/engine";

// `boards` reaches for the browser as it loads. These tests want its content and nothing else.
vi.mock("@openseas/boards", async () => ({ content: (await import("@openseas/content")).loadContent() }));

const { HARNESS_PUZZLES } = await import("../src/puzzles.js");
const { configControls, sliderRange, unitOf } = await import("../src/tuning/controls.js");
const { TUNING_GROUPS } = await import("../src/tuning/groups/index.js");
const { leaves } = await import("../src/scenario/overrides.js");

describe("the tuning panel's controls (DESIGN.md 3.14)", () => {
  for (const id of PUZZLE_IDS) {
    const puzzle = HARNESS_PUZZLES[id];
    const groups = configControls(puzzle, TUNING_GROUPS[id]);
    const controls = groups.flatMap((g) => g.controls);

    it(`${id}: a control for every config key, each in a section, each with its line`, () => {
      expect(controls.map((c) => c.key).sort()).toEqual(
        leaves(puzzle.config)
          .map((l) => `config.${l.path}`)
          .sort(),
      );
      // A key the groups file forgot would land here.
      expect(groups.find((g) => g.id === "other")?.controls.map((c) => c.key) ?? []).toEqual([]);
      expect(controls.filter((c) => !c.description).map((c) => c.key)).toEqual([]);
      for (const c of controls) expect(c.description!.length, c.key).toBeLessThanOrEqual(140);
    });

    it(`${id}: its groups file names only keys the content file has`, () => {
      const paths = leaves(puzzle.config).map((l) => l.path);
      for (const entries of Object.values(TUNING_GROUPS[id])) {
        for (const entry of entries ?? []) expect(paths.some((p) => p === entry || p.startsWith(`${entry}.`)), `${id}: ${entry}`).toBe(true);
      }
    });

    it(`${id}: every control's shipped value is inside what it offers`, () => {
      for (const c of controls) {
        if (typeof c.shipped !== "number") continue;
        if (c.min !== null) expect(c.shipped, c.key).toBeGreaterThanOrEqual(c.min);
        if (c.max !== null) expect(c.shipped, c.key).toBeLessThanOrEqual(c.max);
        const range = sliderRange(c, c.shipped);
        expect(range.min, c.key).toBeLessThanOrEqual(c.shipped);
        expect(range.max, c.key).toBeGreaterThanOrEqual(c.shipped);
        if (c.max !== null) expect(range.max, c.key).toBeLessThanOrEqual(Math.max(c.max, c.shipped));
      }
    });
  }

  it("reads a unit from a key's name, and from its branch's", () => {
    expect(unitOf("config.specialChancePerMille.charge")).toBe("permille");
    expect(unitOf("config.streakMaxPercent")).toBe("percent");
    expect(unitOf("config.broadsidePoints")).toBe("points");
    expect(unitOf("config.heatRisePerMoves")).toBe("moves");
    expect(unitOf("config.spawnEveryTicks")).toBe("ticks");
    expect(unitOf("config.tickMs")).toBe("ms");
    expect(unitOf("roundSeconds")).toBe("seconds");
    expect(unitOf("config.width")).toBeNull();
  });

  it("picks a stepper for a small whole number, a slider for a range, a curve for a list", () => {
    const kinds = Object.fromEntries(configControls(HARNESS_PUZZLES.cooling, TUNING_GROUPS.cooling).flatMap((g) => g.controls.map((c) => [c.key, c.kind])));
    expect(kinds["config.pieceKinds"]).toBe("stepper");
    expect(kinds["config.heatDropPerPoints"]).toBe("slider");
    expect(kinds["config.cascadeMultipliers"]).toBe("curve");
    expect(kinds["config.shipHeat"]).toBe("toggle");
  });
});
