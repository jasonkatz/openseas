import { describe, expect, it } from "vitest";
import { PUZZLE_IDS, PUZZLES } from "@openseas/engine";
import { loadContent } from "@openseas/content";
import { EMPTY_SCENARIO, formatScenario, parseScenario, shareLink } from "../src/scenario/codec.js";
import { applyOverrides, diffConfig, getPath, leaves, pruneOverrides } from "../src/scenario/overrides.js";
import { PRESETS, deckPresets } from "../src/scenario/presets.js";
import { serverAcceptsConfig } from "../src/scenario/validate.js";

const content = loadContent();

describe("overrides", () => {
  const base = { a: 1, nested: { b: 2, c: [1, 2] }, s: "x" };

  it("applies dotted paths without touching the base", () => {
    const out = applyOverrides(base, { "nested.b": 5, "nested.c": [9], a: 0 });
    expect(out).toEqual({ a: 0, nested: { b: 5, c: [9] }, s: "x" });
    expect(base.nested.b).toBe(2);
  });

  it("lists leaves in declaration order with arrays as leaves", () => {
    expect(leaves(base).map((l) => l.path)).toEqual(["a", "nested.b", "nested.c", "s"]);
  });

  it("diffs back to the overrides that produced a config", () => {
    const over = { "nested.b": 5, "nested.c": [9] };
    expect(diffConfig(base, applyOverrides(base, over))).toEqual(over);
    expect(diffConfig(base, base)).toEqual({});
  });

  it("prunes overrides equal to the base", () => {
    expect(pruneOverrides(base, { a: 1, "nested.b": 3 })).toEqual({ "nested.b": 3 });
    expect(getPath(base, "nested.c")).toEqual([1, 2]);
    expect(getPath(base, "nope.deeper")).toBeUndefined();
  });
});

describe("scenario codec", () => {
  it("round-trips through the query string", () => {
    const s = {
      ...EMPTY_SCENARIO,
      seed: "keg-3",
      roundSeconds: 60,
      overrides: { "specialChancePerMille.charge": 100, bag: [2, 2, 2, 0], decks: [["##B##", "#...C", "#...#", "#...#", "#####"]] },
      speed: 0.5,
      paused: true,
      hints: false,
      autostart: "lab" as const,
    };
    const qs = formatScenario(s);
    expect(parseScenario(`?${qs}`)).toEqual(s);
  });

  it("reads an empty or junk query as the plain scenario", () => {
    expect(parseScenario("")).toEqual(EMPTY_SCENARIO);
    expect(parseScenario("?seconds=-4&speed=abc&start=nope&c.=1")).toEqual(EMPTY_SCENARIO);
  });

  it("reads start=rated, the name before ADR 0028, as a recorded round", () => {
    expect(parseScenario("?start=rated").autostart).toBe("recorded");
    expect(parseScenario("?start=recorded").autostart).toBe("recorded");
  });

  it("keeps string overrides as strings when they are not JSON", () => {
    expect(parseScenario("?c.name=plain").overrides).toEqual({ name: "plain" });
    expect(parseScenario("?c.n=7").overrides).toEqual({ n: 7 });
  });

  it("shares a link that starts the lab round and never carries review", () => {
    const link = shareLink("https://test.openseas.online", "/cooling", { ...EMPTY_SCENARIO, seed: "a b", review: true });
    expect(link).toBe("https://test.openseas.online/cooling?seed=a+b&start=lab");
    expect(formatScenario(EMPTY_SCENARIO)).toBe("");
  });
});

describe("what the server accepts", () => {
  for (const id of PUZZLE_IDS) {
    it(`${id}: the content config itself passes, whatever order its keys come in`, () => {
      const base = content.puzzles[id].config as Record<string, unknown>;
      expect(serverAcceptsConfig(id, base).errors).toEqual([]);
      // A config edited by path or built by spreading may list its fields in any order; the check
      // compares values, not key order.
      const reversed = Object.fromEntries(Object.entries(base).reverse());
      expect(serverAcceptsConfig(id, reversed).errors).toEqual([]);
      expect(serverAcceptsConfig(id, { ...base, bogus: 1 }).errors).toEqual(["config: fields the wire schema does not know"]);
    });
  }

  it("refuses what the wire refuses, what the engine refuses, and says which", () => {
    const cooling = content.puzzles.cooling.config;
    // Past the wire's bound; the engine's own check passes.
    expect(serverAcceptsConfig("cooling", { ...cooling, maxMoves: 10_001 }).errors).toEqual([expect.stringMatching(/^maxMoves: /)]);
    // Within the wire's bound, but more cells than the racks can be dealt: the engine's cross-field rule.
    const racks = content.puzzles.racks.config;
    expect(serverAcceptsConfig("racks", { ...racks, startCells: racks.racks * (racks.height - 1) + 1 }).errors).toEqual(["invalid racks config"]);
    // Junk is refused, never thrown.
    expect(serverAcceptsConfig("gunnery", { decks: [[]] }).ok).toBe(false);
    expect(serverAcceptsConfig("battle", null).ok).toBe(false);
  });
});

describe("presets", () => {
  for (const id of PUZZLE_IDS) {
    const base = content.puzzles[id].config as Record<string, unknown>;
    const presets = id === "gunnery" ? [...deckPresets(content.puzzles.gunnery.config.decks), ...PRESETS.gunnery] : PRESETS[id];
    it(`${id}: every preset is a config the server accepts, and creates a game`, () => {
      expect(presets.length).toBeGreaterThan(0);
      for (const p of presets) {
        const cfg = applyOverrides(base, p.overrides);
        expect(serverAcceptsConfig(id, cfg).errors, p.id).toEqual([]);
        expect(() => PUZZLES[id].create(`preset-${p.id}`, cfg), p.id).not.toThrow();
        // Every override names a real leaf of the content config, so a renamed field fails here.
        for (const path of Object.keys(p.overrides)) expect(getPath(base, path), `${id} ${p.id} ${path}`).not.toBeUndefined();
      }
      expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    });
    it(`${id}: every preset has its name in the message table`, () => {
      // The bench shows `harness.preset.<id>`; a preset renamed without its message would show the key.
      for (const p of PRESETS[id]) expect(content.messages, p.id).toHaveProperty([`harness.preset.${p.id}`]);
    });
  }
});
