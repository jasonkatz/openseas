import { describe, expect, it, vi } from "vitest";

// `boards` reaches for the browser as it loads; these tests want its content and nothing else (see numbers.test.ts).
vi.mock("@openseas/boards", async () => ({ content: (await import("@openseas/content")).loadContent() }));

const { carriesDraft, draftNumbers, sameNumbers, withDraft, withoutDraft } = await import("../src/frame/draft.js");
const { STUDIO_PUZZLES } = await import("../src/puzzles.js");
const { EMPTY_SCENARIO, formatScenario, parseScenario } = await import("../src/scenario/codec.js");

const cooling = STUDIO_PUZZLES.cooling;

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
    expect(draftNumbers(cooling, s)).toEqual({ seed: "keg-3", overrides: { pieceKinds: 5 }, roundSeconds: 60, paceSeconds: null, thresholds: null, words: { texts: {}, category: null } });
  });

  it("has nothing to save while a value has no shape the service keeps", () => {
    expect(draftNumbers(cooling, parseScenario("?thresholds=[]"))).toBeNull();
    expect(draftNumbers(cooling, parseScenario('?thresholds={"score":1}'))).toBeNull();
    // A number the build refuses still has a shape: the draft is the owner's, mid-thought or not.
    expect(draftNumbers(cooling, parseScenario("?c.width=1"))).not.toBeNull();
  });

  it("lays a stored draft over a scenario and keeps how its clock starts", () => {
    const s = parseScenario("?seed=mine&c.pieceKinds=4&hints=0&speed=2");
    const stored = { seed: null, overrides: { pieceKinds: 6 }, roundSeconds: 45, paceSeconds: 20, thresholds: null, words: { texts: {}, category: null } };
    const laid = withDraft(s, stored);
    expect(draftNumbers(cooling, laid)).toEqual(stored);
    expect(laid).toMatchObject({ hints: false, speed: 2 });
    expect(formatScenario(withoutDraft(laid))).toBe("speed=2&hints=0");
    expect(carriesDraft(withDraft(s, null))).toBe(false);
  });

  it("carries a draft's words with its numbers, and leaves them with the page when the service is older than them (ADR 0057)", () => {
    const s = parseScenario("?text.cooling.multi_2=Twofer!&category=crafting&c.pieceKinds=5");
    expect(carriesDraft(parseScenario("?text.cooling.multi_2=Twofer!"))).toBe(true);
    expect(draftNumbers(cooling, s)!.words).toEqual({ texts: { "cooling.multi_2": "Twofer!" }, category: "crafting" });
    // A draft kept before words has none, and is the same draft as one with none.
    const old = { seed: null, overrides: { pieceKinds: 5 }, roundSeconds: null, paceSeconds: null, thresholds: null };
    expect(withDraft(s, old).words).toEqual({ texts: {}, category: null });
    expect(sameNumbers(old, draftNumbers(cooling, withDraft(s, old))!)).toBe(true);
    const older = { words: false };
    expect(draftNumbers(cooling, s, older)!.words).toEqual({ texts: {}, category: null });
    expect(withDraft(s, old, older).words).toEqual(s.words);
    expect(formatScenario(withoutDraft(s, older))).toBe("text.cooling.multi_2=Twofer%21&category=crafting");
  });

  it("reads a draft kept with picks, of sprites or sounds, as one that picks nothing (ADR 0063, ADR 0064)", () => {
    const hash = "a".repeat(64);
    // A row from before ADR 0062: a take picked for a frame, and for two cues.
    const stored = { seed: null, overrides: { pieceKinds: 6 }, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: { cog: hash }, sounds: { clear: "synth", pop: hash } } } as unknown as Parameters<typeof withDraft>[1];
    const laid = withDraft(parseScenario(""), stored);
    expect(laid).not.toHaveProperty("picks");
    expect(laid.overrides).toEqual({ pieceKinds: 6 });
    // What the page would send back for it holds no pick, and the address carries none.
    expect(draftNumbers(cooling, laid)).not.toHaveProperty("picks");
    expect(formatScenario(laid)).toBe("c.pieceKinds=6");
    // It is the same draft as one that never had any, so opening it does not save it over.
    expect(sameNumbers(draftNumbers(cooling, laid)!, { seed: null, overrides: { pieceKinds: 6 }, roundSeconds: null, paceSeconds: null, thresholds: null })).toBe(true);
  });

  it("an address that carries only picks carries no draft", () => {
    const s = parseScenario(`?sound.pop=${"a".repeat(64)}&sound.clear=synth&sprite.cog=${"b".repeat(64)}`);
    expect(carriesDraft(s)).toBe(false);
    expect(formatScenario(withoutDraft(s))).toBe("");
  });

  it("compares numbers whatever order the database hands their keys back in", () => {
    const a = { seed: null, overrides: { "raider.hull": 3, pieceKinds: 5, bag: [{ b: 1, a: 2 }] }, roundSeconds: null, paceSeconds: null, thresholds: [{ score: 10, rating: 1000 }] };
    const b = { thresholds: [{ rating: 1000, score: 10 }], paceSeconds: null, roundSeconds: null, overrides: { bag: [{ a: 2, b: 1 }], pieceKinds: 5, "raider.hull": 3 }, seed: null };
    expect(sameNumbers(a, b)).toBe(true);
    expect(sameNumbers(a, { ...b, seed: "x" })).toBe(false);
    expect(sameNumbers(a, { ...b, overrides: { ...b.overrides, bag: [{ a: 2, b: 2 }] } })).toBe(false);
  });
});
