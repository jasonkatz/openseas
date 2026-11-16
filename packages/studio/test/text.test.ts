import { describe, expect, it } from "vitest";
import { PUZZLE_IDS } from "@openseas/engine";
import { PUZZLE_CATEGORIES, loadContent } from "@openseas/content";
import { PuzzleCategorySchema, isPuzzleText, textVars } from "@openseas/protocol";
import { TEXT_GROUPS, textEntries, textGroup, textProblem } from "../src/studio/texts.js";

const content = loadContent();

describe("the Text mode's strings (ADR 0057)", () => {
  it("keeps the draft's categories and the content files' the same list", () => {
    expect(PuzzleCategorySchema.options).toEqual([...PUZZLE_CATEGORIES]);
    for (const id of PUZZLE_IDS) expect(PUZZLE_CATEGORIES, id).toContain(content.puzzles[id].category);
  });

  for (const id of PUZZLE_IDS) {
    it(`${id}: its strings are its own, its name leads, and each has a section`, () => {
      const entries = textEntries(id, content.messages);
      expect(entries[0]!.key).toBe(`${id}.title`);
      expect(entries.map((e) => e.key)).toEqual(expect.arrayContaining([`home.practice_${id}`, `home.practice_${id}_blurb`]));
      for (const e of entries) {
        expect(isPuzzleText(id, e.key), e.key).toBe(true);
        expect(TEXT_GROUPS, e.key).toContain(e.group);
        expect(e.label.length, e.key).toBeGreaterThan(0);
      }
      // Another puzzle's strings are never offered.
      const other = PUZZLE_IDS.find((p) => p !== id && !p.startsWith(id) && !id.startsWith(p))!;
      expect(entries.some((e) => e.key.startsWith(`${other}.`))).toBe(false);
    });
  }

  it("sorts a string into a section by its key", () => {
    expect(textGroup("cooling", "cooling.title")).toBe("identity");
    expect(textGroup("cooling", "home.practice_cooling_blurb")).toBe("identity");
    expect(textGroup("cooling", "cooling.how_to_keyboard")).toBe("intro");
    expect(textGroup("cooling", "cooling.hint_note")).toBe("intro");
    expect(textGroup("cooling", "cooling.special.slag_help")).toBe("pieces");
    expect(textGroup("cooling", "cooling.result_vented")).toBe("result");
    expect(textGroup("cooling", "cooling.multi_2")).toBe("play");
  });

  it("holds rewritten words to the names the shipped string fills in", () => {
    expect(textVars("{count} in a row, {name}!")).toEqual(["count", "name"]);
    expect(textProblem("{count} in a row!", "{count} straight!")).toBeNull();
    expect(textProblem("{count} in a row!", "Many straight!")).toBe("vars");
    expect(textProblem("Double!", "Twofer {count}!")).toBe("vars");
    expect(textProblem("Double!", "   ")).toBe("empty");
    expect(textProblem("Double!", "x".repeat(601))).toBe("long");
  });
});
