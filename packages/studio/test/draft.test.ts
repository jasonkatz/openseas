import { describe, expect, it, vi } from "vitest";

// `boards` reaches for the browser as it loads; these tests want its content and nothing else (see numbers.test.ts).
vi.mock("@openseas/boards", async () => ({ content: (await import("@openseas/content")).loadContent() }));

const { carriesDraft, draftNumbers, sameNumbers, withDraft, withoutDraft } = await import("../src/frame/draft.js");
const { HARNESS_PUZZLES } = await import("../src/puzzles.js");
const { EMPTY_SCENARIO, formatScenario, parseScenario } = await import("../src/scenario/codec.js");

const cooling = HARNESS_PUZZLES.cooling;

describe("a page's draft and the one the service keeps", () => {
  it("knows an address that carries a draft from one that only says how the clock starts", () => {
    expect(carriesDraft(EMPTY_SCENARIO)).toBe(false);
    expect(carriesDraft(parseScenario("?start=1&hints=0&speed=2"))).toBe(false);
    expect(carriesDraft(parseScenario("?seed=keg-3"))).toBe(true);
    expect(carriesDraft(parseScenario("?c.pieceKinds=5"))).toBe(true);
    expect(carriesDraft(parseScenario("?seconds=60"))).toBe(true);
    expect(carriesDraft(parseScenario("?pace=20"))).toBe(true);
    expect(carriesDraft(parseScenario('?thresholds=[{"score":1,"rating":1000}]'))).toBe(true);
  });

  it("gives the service a scenario's numbers one override a changed leaf, and drops what equals content", () => {
    const s = parseScenario(`?seed=keg-3&seconds=60&c.pieceKinds=5&c.width=${(cooling.config as { width: number }).width}`);
    expect(draftNumbers(cooling, s)).toEqual({ seed: "keg-3", overrides: { pieceKinds: 5 }, roundSeconds: 60, paceSeconds: null, thresholds: null });
  });

  it("has nothing to save while a value has no shape the service keeps", () => {
    expect(draftNumbers(cooling, parseScenario("?thresholds=[]"))).toBeNull();
    expect(draftNumbers(cooling, parseScenario('?thresholds={"score":1}'))).toBeNull();
    // A number the build refuses still has a shape: the draft is the owner's, mid-thought or not.
    expect(draftNumbers(cooling, parseScenario("?c.width=1"))).not.toBeNull();
  });

  it("lays a stored draft over a scenario and keeps how its clock starts", () => {
    const s = parseScenario("?seed=mine&c.pieceKinds=4&hints=0&speed=2");
    const stored = { seed: null, overrides: { pieceKinds: 6 }, roundSeconds: 45, paceSeconds: 20, thresholds: null };
    const laid = withDraft(s, stored);
    expect(draftNumbers(cooling, laid)).toEqual(stored);
    expect(laid).toMatchObject({ hints: false, speed: 2 });
    expect(formatScenario(withoutDraft(laid))).toBe("speed=2&hints=0");
    expect(carriesDraft(withDraft(s, null))).toBe(false);
  });

  it("compares numbers whatever order the database hands their keys back in", () => {
    const a = { seed: null, overrides: { "raider.hull": 3, pieceKinds: 5, bag: [{ b: 1, a: 2 }] }, roundSeconds: null, paceSeconds: null, thresholds: [{ score: 10, rating: 1000 }] };
    const b = { thresholds: [{ rating: 1000, score: 10 }], paceSeconds: null, roundSeconds: null, overrides: { bag: [{ a: 2, b: 1 }], pieceKinds: 5, "raider.hull": 3 }, seed: null };
    expect(sameNumbers(a, b)).toBe(true);
    expect(sameNumbers(a, { ...b, seed: "x" })).toBe(false);
    expect(sameNumbers(a, { ...b, overrides: { ...b.overrides, bag: [{ a: 2, b: 2 }] } })).toBe(false);
  });
});
