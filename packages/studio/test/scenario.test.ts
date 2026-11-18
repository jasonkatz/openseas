import { describe, expect, it } from "vitest";
import { PUZZLE_IDS, PUZZLES } from "@openseas/engine";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import { loadContent } from "@openseas/content";
import { EMPTY_SCENARIO, formatScenario, parseScenario, playLink } from "../src/scenario/codec.js";
import { applyOverrides, diffConfig, getPath, leaves, pruneOverrides } from "../src/scenario/overrides.js";
import { PRESETS, deckPresets } from "../src/scenario/presets.js";
import { validateConfig } from "../src/scenario/validate.js";
import type { StudioPuzzle } from "../src/puzzles.js";

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
      words: { texts: { "cooling.multi_2": "Twofer!", "cooling.how_to": "Swap two, clear three & more = win?" }, category: "crafting" as const },
      speed: 0.5,
      paused: true,
      hints: false,
      autostart: true,
    };
    const qs = formatScenario(s);
    expect(parseScenario(`?${qs}`)).toEqual(s);
  });

  it("opens an address kept with picks, of sprites or sounds, reading past them, and does not write them back (ADR 0063, ADR 0064)", () => {
    const hash = "d".repeat(64);
    const s = parseScenario(`?seed=keg-3&c.kinds=6&sprite.debris-gold=${hash}&sprite.crate=cut-short&sound.pop=${hash}&sound.clear=synth&sound.thud=cut-short&sound.=${hash}`);
    expect(s.seed).toBe("keg-3");
    expect(s.overrides).toEqual({ kinds: 6 });
    expect(s).not.toHaveProperty("picks");
    expect(formatScenario(s)).toBe("seed=keg-3&c.kinds=6");
  });

  it("drops a rewritten string or a category that is not one, and keeps the rest (ADR 0057)", () => {
    const s = parseScenario(`?text.cooling.go=Go!&text.nokey=x&text.cooling.title=&text.Bad.Key=x&category=parlour&text.cooling.heat=${"x".repeat(700)}`);
    expect(s.words).toEqual({ texts: { "cooling.go": "Go!" }, category: null });
  });

  it("reads an empty or junk query as the plain scenario", () => {
    expect(parseScenario("")).toEqual(EMPTY_SCENARIO);
    expect(parseScenario("?seconds=-4&speed=abc&c.=1")).toEqual(EMPTY_SCENARIO);
  });

  it("keeps string overrides as strings when they are not JSON", () => {
    expect(parseScenario("?c.name=plain").overrides).toEqual({ name: "plain" });
    expect(parseScenario("?c.n=7").overrides).toEqual({ n: 7 });
  });

  it("makes the link that plays a draft alone, without the clock's script switches", () => {
    const link = playLink("https://studio.openseas.online", "cooling", { ...EMPTY_SCENARIO, seed: "a b", paused: true, speed: 0.5, autostart: true });
    expect(link).toBe("https://studio.openseas.online/play/cooling?seed=a+b");
    expect(formatScenario(EMPTY_SCENARIO)).toBe("");
  });
});

describe("lab validation", () => {
  for (const id of PUZZLE_IDS) {
    // The two checks the validator runs, without the boards the studio's puzzle table drags in.
    const puzzle = { configSchema: PUZZLE_CONFIG_SCHEMAS[id], def: PUZZLES[id] } as unknown as StudioPuzzle<unknown, unknown, unknown>;
    it(`${id}: the content config itself passes, whatever order its keys come in`, () => {
      const base = content.puzzles[id].config as Record<string, unknown>;
      expect(validateConfig(puzzle, base).errors).toEqual([]);
      // The content schema may fill a defaulted field in a different place than the wire schema
      // declares it; the lab validator compares values, not key order.
      const reversed = Object.fromEntries(Object.entries(base).reverse());
      expect(validateConfig(puzzle, reversed).errors).toEqual([]);
      expect(validateConfig(puzzle, { ...base, bogus: 1 }).ok).toBe(false);
    });
  }
});

describe("presets", () => {
  for (const id of PUZZLE_IDS) {
    const base = content.puzzles[id].config as Record<string, unknown>;
    const presets = id === "gunnery" ? [...deckPresets(content.puzzles.gunnery.config.decks), ...PRESETS.gunnery] : PRESETS[id];
    it(`${id}: every preset passes the engine's validator, the wire schema, and creates a game`, () => {
      expect(presets.length).toBeGreaterThan(0);
      for (const p of presets) {
        const cfg = applyOverrides(base, p.overrides);
        expect(() => PUZZLES[id].validateConfig(cfg), p.id).not.toThrow();
        const parsed = PUZZLE_CONFIG_SCHEMAS[id].safeParse(cfg);
        expect(parsed.success, `${p.id}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
        expect(() => PUZZLES[id].create(`preset-${p.id}`, cfg), p.id).not.toThrow();
        // Every override names a real leaf of the content config, so a renamed field fails here.
        for (const path of Object.keys(p.overrides)) expect(getPath(base, path), `${id} ${p.id} ${path}`).not.toBeUndefined();
      }
      expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    });
    it(`${id}: every preset has its name in the message table`, () => {
      // The bench shows `studio.preset.<id>`; a preset renamed without its message would show the key.
      for (const p of PRESETS[id]) expect(content.messages, p.id).toHaveProperty([`studio.preset.${p.id}`]);
    });
  }
});

describe("stages (ADR 0065)", () => {
  for (const id of PUZZLE_IDS) {
    const file = content.puzzles[id];
    const stages = "stages" in file ? file.stages : [];
    if (stages.length === 0) continue;
    it(`${id}: every stage passes the engine's validator and the wire schema, and creates a game`, () => {
      const base = file.config as Record<string, unknown>;
      for (const stage of stages) {
        const cfg = { ...base, ...stage.config };
        expect(() => PUZZLES[id].validateConfig(cfg), stage.id).not.toThrow();
        const parsed = PUZZLE_CONFIG_SCHEMAS[id].safeParse(cfg);
        expect(parsed.success, `${stage.id}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
        expect(() => PUZZLES[id].create(`stage-${stage.id}`, cfg), stage.id).not.toThrow();
      }
    });
  }

  it("a stage rides the address, and full or junk is the whole puzzle", () => {
    expect(parseScenario("?stage=lines").stage).toBe("lines");
    expect(formatScenario({ ...EMPTY_SCENARIO, stage: "lines" })).toBe("stage=lines");
    for (const q of ["?stage=full", "?stage=Lines", "?stage=a%20b", ""]) expect(parseScenario(q).stage).toBeNull();
  });
});

