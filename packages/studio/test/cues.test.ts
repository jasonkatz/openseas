import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUZZLE_IDS } from "@openseas/engine";
import { CUES } from "@openseas/boards/cues";
import { OWN_CUE_FALLBACKS, PUZZLE_CUES, ROUND_CUES, cuesOf } from "../src/assets/cues.js";

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Every cue a source file asks `sfx` for: `sfx.clear(`, or a puzzle's own, `sfx.cue("clash", ...)`.
 * A board that asks for the beat (`this.beat(`) plays the beat's cue: the kit's `fx.beat` and each
 * game board's own `beat()` ask `sfx` for it with the pulse.
 */
function played(source: string): { shared: string[]; own: string[] } {
  const shared = [...source.matchAll(/\bsfx\.([a-zA-Z]+)\b/g)].map((m) => m[1]!).filter((c) => c !== "cue");
  if (/\bthis\.beat\(/.test(source)) shared.push("beat");
  const own = [...source.matchAll(/\bsfx\.cue\(\s*"([^"]+)"/g)].map((m) => m[1]!);
  return { shared, own };
}

/** A puzzle's sounds are played from its board's folder in `boards` and from its page here. */
function sources(id: string): string {
  const folder = at(`../../boards/src/${id}`);
  const page = at(`../src/pages/${id[0]!.toUpperCase()}${id.slice(1)}Practice.tsx`);
  const files = readdirSync(folder)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `${folder}/${f}`);
  if (existsSync(page)) files.push(page);
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

describe("the sound panel's cues (DESIGN.md 3.14, ADR 0050)", () => {
  for (const id of PUZZLE_IDS) {
    it(`${id}: the list is what its board and its page play`, () => {
      const { shared, own } = played(sources(id));
      expect([...PUZZLE_CUES[id]].sort()).toEqual([...new Set([...shared, ...own])].sort());
      // Each of the puzzle's own cues names the synthesized cues behind it, so the panel can play them.
      expect(Object.keys(OWN_CUE_FALLBACKS[id] ?? {}).sort()).toEqual([...new Set(own)].sort());
      expect(new Set(cuesOf(id)).size).toBe(cuesOf(id).length);
    });
  }

  it("the round's cues are what the page plays around every board", () => {
    const { shared } = played(readFileSync(at("../src/practice/usePractice.ts"), "utf8"));
    expect([...ROUND_CUES].sort()).toEqual([...new Set(shared)].sort());
  });

  it("a fallback is a synthesized cue", () => {
    for (const cues of Object.values(OWN_CUE_FALLBACKS)) for (const names of Object.values(cues ?? {})) for (const name of names) expect(Object.keys(CUES), name).toContain(name);
  });

  it("the beat sounds from the beat itself, on every board", () => {
    // The kit's pulse asks for its sound, and so does each game board's own.
    expect(readFileSync(at("../../boards/src/kit/fx.ts"), "utf8")).toMatch(/beat\(strength = 0\.5\): void \{[^}]*sfx\.beat\(/);
    for (const id of PUZZLE_IDS) {
      const renderer = readFileSync(at(`../../boards/src/${id}/renderer.ts`), "utf8");
      expect(PUZZLE_CUES[id], id).toContain("beat");
      if (/private beat\(/.test(renderer)) expect(renderer, id).toMatch(/private beat\(strength: number\): void \{[^}]*sfx\.beat\(strength\)/);
      else expect(renderer, id).toMatch(/extends KitBoard</);
    }
  });
});
