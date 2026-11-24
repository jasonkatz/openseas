import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { skinOf, spaceTheme } from "@openseas/boards/play";
import { drawingProblems } from "@openseas/boards/rules";
import { loadContent } from "@openseas/content";
import { CueDataSchema, DrawingSchema } from "@openseas/protocol";
import { SWAP, checkSkin, checkTheme, requiredTexts, type PuzzleDoc, type Skin } from "@openseas/puzzle";

/**
 * The domain engine's puzzle as the studio shows it (ADR 0084): the game's theme and Swap's skin
 * in it are the documents docs/puzzles/DOMAIN.md asks for, and each is ready.
 */
describe("the game's theme", () => {
  it("is ready", () => {
    expect(checkTheme(spaceTheme())).toEqual([]);
  });
});

describe("the guide's example skin (docs/puzzles/examples)", () => {
  it("is ready in the game's theme, so the theme and the checks read the guide as it reads itself", () => {
    const example = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../docs/puzzles/examples/${name}`, import.meta.url), "utf8"));
    expect(checkSkin(example("paths.puzzle.json") as PuzzleDoc, example("paths.skin.json") as Skin, spaceTheme())).toEqual([]);
  });
});

describe("Swap's skin in the game's theme", () => {
  const theme = spaceTheme();
  const skin = skinOf(SWAP)!;
  const broken = (change: (s: { -readonly [K in keyof Skin]: Skin[K] }) => void): string[] => {
    const copy = structuredClone(skin) as { -readonly [K in keyof Skin]: Skin[K] };
    change(copy);
    return checkSkin(SWAP, copy, theme);
  };

  it("is ready", () => {
    expect(checkSkin(SWAP, skin, theme)).toEqual([]);
  });

  it("takes every text from the message table, keyed by the puzzle", () => {
    for (const key of requiredTexts(SWAP)) expect(skin.texts[key], key).toBe(loadContent().messages[`swap.${key}`]);
  });

  it("holds drawings and cues the game's painter and player take, by the brand book's rules", () => {
    for (const [key, drawing] of Object.entries(skin.pieces)) {
      expect(DrawingSchema.safeParse(drawing).success, key).toBe(true);
      // The drawings copied from Cooling are as shipped; the one drawn new is held to the editor's rules.
      if (key === "kind_8") expect(drawingProblems(DrawingSchema.parse(drawing)), key).toEqual([]);
    }
    for (const [name, cue] of Object.entries(skin.cues)) expect(CueDataSchema.safeParse(cue).success, name).toBe(true);
  });

  it("tells every piece from every other by its drawing alone", () => {
    const shapes = Object.values(skin.pieces).map((d) => JSON.stringify((d as { layers: unknown }).layers));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("is not ready without a drawing, a text, a beat or a known colour", () => {
    expect(broken((s) => void (s.pieces = Object.fromEntries(Object.entries(s.pieces).filter(([k]) => k !== "kind_8"))))).toContain("no drawing for kind_8");
    expect(broken((s) => void (s.texts = { ...s.texts, "event.lift": "Lift off!" }))).toContain("the text for event.lift lost its place for {count}");
    expect(broken((s) => void (s.cues = Object.fromEntries(Object.entries(s.cues).filter(([k]) => k !== "beat"))))).toContain("the skin has no beat cue");
    expect(broken((s) => void (s.board = { gauges: { level: { rows: "bottom", color: "pink" } } }))).toContain("the board shows level in pink, which is not one of the theme's colours");
    expect(broken((s) => void (s.events = { ...s.events, run: { cues: ["beat"] } }))).toContain("run plays the beat's cue, which is heard alone on the moment");
    expect(broken((s) => void (s.events = { ...s.events, trade: { points: "nowhere" } }))).toContain("trade's points rise from nowhere, which is not one of its place fields");
  });
});
