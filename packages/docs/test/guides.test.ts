import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUZZLE_IDS } from "@openseas/engine";
import { content } from "../src/content.js";
import { GUIDES, LEVELS, type Guide, type Media } from "../src/guides/index.js";

const MEDIA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "media");

function mediaOf(g: Guide): Media[] {
  return [g.hero, ...(g.rulesMedia ? [g.rulesMedia] : []), ...g.stages.flatMap((s) => s.tips.flatMap((t) => (t.media ? [t.media] : [])))];
}

function proseOf(g: Guide): string[] {
  return [
    g.tagline,
    g.theme.setting,
    g.theme.purpose,
    ...g.facts.flatMap((f) => [f.label, f.value]),
    ...g.rules,
    ...g.controls.flatMap((c) => [c.action, c.touch, c.desktop]),
    ...g.scoring,
    ...g.stages.flatMap((s) => [s.goal, s.drill, ...s.tips.flatMap((t) => [t.title, t.body])]),
    ...g.mistakes,
    ...mediaOf(g).flatMap((m) => [m.alt, m.caption]),
  ];
}

describe("every puzzle has a guide", () => {
  it("lists exactly the engine's puzzles", () => {
    expect(Object.keys(GUIDES).sort()).toEqual([...PUZZLE_IDS].sort());
  });

  for (const id of PUZZLE_IDS) {
    describe(id, () => {
      const g = GUIDES[id];

      it("is the guide for its own puzzle, with a title in the message table", () => {
        expect(g.id).toBe(id);
        expect(content.messages[`${id}.title`]).toBeTruthy();
      });

      it("keeps to the budget: a guide is one sitting", () => {
        expect(g.tagline.length).toBeLessThanOrEqual(90);
        expect(g.facts.length).toBeGreaterThanOrEqual(3);
        expect(g.facts.length).toBeLessThanOrEqual(4);
        expect(g.rules.length).toBeGreaterThanOrEqual(4);
        expect(g.rules.length).toBeLessThanOrEqual(7);
        expect(g.controls.length).toBeGreaterThanOrEqual(1);
        expect(g.scoring.length).toBeGreaterThanOrEqual(2);
        expect(g.scoring.length).toBeLessThanOrEqual(4);
        expect(g.mistakes.length).toBeGreaterThanOrEqual(3);
        expect(g.mistakes.length).toBeLessThanOrEqual(5);
        for (const text of [g.theme.setting, g.theme.purpose]) expect(text.length).toBeLessThanOrEqual(420);
      });

      it("climbs the four rungs in order, each with a goal, two to four tips and a drill", () => {
        expect(g.stages.map((s) => s.level)).toEqual([...LEVELS]);
        for (const s of g.stages) {
          expect(s.goal.length).toBeGreaterThan(0);
          expect(s.drill.length).toBeGreaterThan(0);
          expect(s.tips.length).toBeGreaterThanOrEqual(2);
          expect(s.tips.length).toBeLessThanOrEqual(4);
          for (const tip of s.tips) expect(tip.body.length, tip.title).toBeLessThanOrEqual(480);
          expect(new Set(s.tips.map((t) => t.title)).size).toBe(s.tips.length);
        }
      });

      it("has every picture it names on disk, described for a reader who cannot see it", () => {
        const media = mediaOf(g);
        expect(media.length).toBeGreaterThanOrEqual(4);
        for (const m of media) {
          expect(m.name).toMatch(/^[a-z0-9-]+$/);
          expect(m.alt.length, m.name).toBeGreaterThan(20);
          expect(m.caption.length, m.name).toBeGreaterThan(0);
          expect(existsSync(join(MEDIA, id, `${m.name}.webp`)), `${id}/${m.name}.webp`).toBe(true);
          if (m.kind === "clip") expect(existsSync(join(MEDIA, id, `${m.name}.mp4`)), `${id}/${m.name}.mp4`).toBe(true);
        }
        expect(media.some((m) => m.kind === "clip")).toBe(true);
      });

      it("leaves no number unfilled and no stray markup", () => {
        for (const text of proseOf(g)) {
          expect(text).not.toMatch(/undefined|NaN|\[object|\$\{/);
          expect((text.match(/\*\*/g) ?? []).length % 2, text).toBe(0);
        }
      });
    });
  }
});
