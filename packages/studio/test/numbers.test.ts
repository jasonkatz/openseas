import { describe, expect, it, vi } from "vitest";
import { PUZZLE_IDS } from "@openseas/engine";
import { loadContent } from "@openseas/content";

// `boards` reaches for the browser as it loads (its server connection). These tests want its
// content and nothing else, so they hand over the same content, loaded here.
vi.mock("@openseas/boards", async () => ({ content: (await import("@openseas/content")).loadContent() }));

const { changes, refusals, shippedNumbers, tunedNumbers } = await import("../src/frame/numbers.js");
const { HARNESS_PUZZLES } = await import("../src/puzzles.js");
const { EMPTY_SCENARIO, formatScenario, parseScenario } = await import("../src/scenario/codec.js");

const content = loadContent();

describe("the numbers a link carries (ADR 0042)", () => {
  const puzzle = HARNESS_PUZZLES.cooling;
  const file = content.puzzles.cooling;

  it("reads pace and thresholds from a link and writes them back", () => {
    const thresholds = [
      { score: 0, rating: 800 },
      { score: 90000, rating: 2400 },
    ];
    const s = parseScenario(`?seed=a&pace=7&thresholds=${encodeURIComponent(JSON.stringify(thresholds))}`);
    expect(s.paceSeconds).toBe(7);
    expect(s.thresholds).toEqual(thresholds);
    expect(parseScenario(formatScenario(s))).toEqual(s);
    expect(parseScenario("?seed=a")).toMatchObject({ paceSeconds: null, thresholds: null });
  });

  it("lays a link's numbers over content and lists what differs, by the content file's keys", () => {
    const plain = tunedNumbers(puzzle, EMPTY_SCENARIO);
    expect(plain).toEqual(shippedNumbers(puzzle));
    expect(refusals(puzzle, plain)).toEqual([]);
    expect(changes(puzzle, plain)).toEqual([]);

    const tuned = tunedNumbers(puzzle, { ...EMPTY_SCENARIO, overrides: { maxMoves: 3 }, roundSeconds: 40, paceSeconds: 5 });
    expect(refusals(puzzle, tuned)).toEqual([]);
    expect(changes(puzzle, tuned)).toEqual([
      { key: "config.maxMoves", shipped: file.config.maxMoves, value: 3 },
      { key: "roundSeconds", shipped: file.roundSeconds, value: 40 },
      { key: "paceSeconds", shipped: file.paceSeconds, value: 5 },
    ]);
  });

  it("refuses what the server or a content file would, naming the key", () => {
    const keys = (s: Partial<typeof EMPTY_SCENARIO>): string[] => refusals(puzzle, tunedNumbers(puzzle, { ...EMPTY_SCENARIO, ...s })).map((r) => r.key);
    expect(keys({ overrides: { width: 1 } })).toContain("config.width");
    // The wire schema would strip it, so the engine would not see what the link asked for.
    expect(keys({ overrides: { notAField: 1 } })).toEqual(["config"]);
    expect(keys({ roundSeconds: 5 })).toEqual(["roundSeconds"]);
    expect(keys({ paceSeconds: 0.5 })).toEqual(["paceSeconds"]);
    expect(keys({ thresholds: "high" })).toEqual(["thresholds"]);
    expect(keys({ thresholds: [] })).toEqual(["thresholds"]);
    // Descending, and a par outside them: what content's own startup check refuses.
    expect(keys({ thresholds: [{ score: 9, rating: 2 }, { score: 3, rating: 1 }] })).toEqual(["thresholds", "thresholds"]);
  });

  it("plays every puzzle's shipped numbers", () => {
    for (const id of PUZZLE_IDS) expect(refusals(HARNESS_PUZZLES[id], shippedNumbers(HARNESS_PUZZLES[id])), id).toEqual([]);
  });
});
