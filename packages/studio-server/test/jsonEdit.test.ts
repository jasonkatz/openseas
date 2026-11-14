import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getJsonValue, removeJsonValue, setJsonValue } from "../src/save/jsonEdit.js";

const dir = join(fileURLToPath(import.meta.url), "../../../content/data/puzzles");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

/** Every path of object keys in a value, branches and leaves alike. */
function paths(value: unknown, prefix: string[] = []): string[][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return [...(prefix.length ? [prefix] : []), ...Object.entries(value).flatMap(([k, v]) => paths(v, [...prefix, k]))];
}

describe("a value set in a content file", () => {
  it("leaves the file byte for byte when the value is the one already there, at every path of every puzzle", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    let checked = 0;
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const path of paths(JSON.parse(text))) {
        expect(setJsonValue(text, path, getJsonValue(text, path)), `${file} ${path.join(".")}`).toBe(text);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("changes the one value and nothing around it", () => {
    const text = readFileSync(join(dir, "cooling.json"), "utf8");
    const next = setJsonValue(text, ["config", "pieceKinds"], 5);
    expect(next).toBe(text.replace('"pieceKinds": 7', '"pieceKinds": 5'));
    expect(setJsonValue(text, ["config", "specialChancePerMille", "charge"], 40)).toBe(text.replace('"charge": 12', '"charge": 40'));
    expect(setJsonValue(text, ["config", "shipHeat"], false)).toBe(text.replace('"shipHeat": true', '"shipHeat": false'));
  });

  it("draws a new value the way the one it replaces was drawn", () => {
    const text = readFileSync(join(dir, "cooling.json"), "utf8");
    // A curve stays on its line, however long it grows.
    expect(setJsonValue(text, ["config", "cascadeMultipliers"], [1, 2, 4, 8])).toBe(text.replace('"cascadeMultipliers": [1, 2, 3]', '"cascadeMultipliers": [1, 2, 4, 8]'));
    // Thresholds stay one a line, each on its own line, and a seventh is drawn as the sixth was.
    const thresholds = (getJsonValue(text, ["thresholds"]) as Array<{ score: number; rating: number }>).map((t) => ({ ...t, score: t.score + 5 }));
    const moved = setJsonValue(text, ["thresholds"], [...thresholds, { score: 9000, rating: 2300 }]);
    expect(moved).toContain('    { "score": 95, "rating": 1100 },\n');
    expect(moved).toContain('    { "score": 1755, "rating": 2100 },\n    { "score": 9000, "rating": 2300 }\n  ],');
    expect(moved.split("\n").length).toBe(text.split("\n").length + 1);
    expect(JSON.parse(moved)).toEqual({ ...(JSON.parse(text) as object), thresholds: [...thresholds, { score: 9000, rating: 2300 }] });
    // A deck keeps a row a line.
    const gunnery = readFileSync(join(dir, "gunnery.json"), "utf8");
    const decks = getJsonValue(gunnery, ["config", "decks"]) as string[][];
    const swapped = setJsonValue(gunnery, ["config", "decks"], [decks[1], decks[0], ...decks.slice(2)]);
    expect(swapped.split("\n").length).toBe(gunnery.split("\n").length);
    expect(getJsonValue(swapped, ["config", "decks"])).toEqual([decks[1], decks[0], ...decks.slice(2)]);
  });

  it("adds a key the file lacks beside the keys it has, and never a branch it lacks", () => {
    const text = readFileSync(join(dir, "cooling.json"), "utf8");
    expect(getJsonValue(text, ["paceSeconds"])).toBeUndefined();
    const paced = setJsonValue(text, ["paceSeconds"], 12, "roundSeconds");
    expect(paced).toBe(text.replace('  "roundSeconds": 150,', '  "paceSeconds": 12,\n  "roundSeconds": 150,'));
    const last = setJsonValue('{\n  "a": 1,\n  "b": { "c": 2 }\n}\n', ["d"], [1, 2]);
    expect(last).toBe('{\n  "a": 1,\n  "b": { "c": 2 },\n  "d": [1, 2]\n}\n');
    expect(setJsonValue('{\n  "a": 1,\n  "b": { "c": 2 }\n}\n', ["b", "e"], true)).toBe('{\n  "a": 1,\n  "b": { "c": 2, "e": true }\n}\n');
    // Taking a key away again gives the file back, wherever in its object the key stood.
    expect(removeJsonValue(paced, ["paceSeconds"])).toBe(text);
    expect(removeJsonValue(last, ["d"])).toBe('{\n  "a": 1,\n  "b": { "c": 2 }\n}\n');
    expect(removeJsonValue(last, ["a"])).toBe('{\n  "b": { "c": 2 },\n  "d": [1, 2]\n}\n');
    expect(removeJsonValue(last, ["b", "c"])).toBe('{\n  "a": 1,\n  "b": {},\n  "d": [1, 2]\n}\n');
    expect(removeJsonValue(last, ["nothing"])).toBe(last);
    expect(() => setJsonValue(text, ["config", "nothing", "here"], 1)).toThrow(/no config.nothing.here/);
    expect(() => setJsonValue(text, ["config", "width", "x"], 1)).toThrow();
    expect(() => setJsonValue("{ nope", ["a"], 1)).toThrow(/not JSON/);
  });
});
