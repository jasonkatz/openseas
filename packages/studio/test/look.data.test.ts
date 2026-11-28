import { describe, expect, it } from "vitest";
import { CUE_NAMES, CUE_PARAMS, LIMITS, SHIPPED_CUES, cueFrom } from "@openseas/boards/cues";
import { SHIPPED_PIECES } from "@openseas/boards/pieces";
import { STOCK_KINDS, STOCK_PIECES, stockPiece } from "@openseas/boards/stock";
import { PALETTE } from "@openseas/boards/look";
import { cueProblems, drawingProblems } from "@openseas/boards/rules";
import { PUZZLE_IDS } from "@openseas/engine";
import { CueDataSchema, DrawingSchema, type CueData, type Drawing } from "@openseas/protocol";
import { noteName } from "../src/assets/cues.js";
import { dragged, fresh, handles, moved, snap, turn } from "../src/assets/sprite.js";

/**
 * The look as data (ADR 0065): the shipped pieces and cues are files the studio edits and Save
 * writes, so they are held here to the shapes and rules the editors hold a draft to.
 */

describe("the shipped cues (boards/data/cues.json)", () => {
  it("break no rule of the brand book's sound, as the editor checks them", () => {
    for (const name of CUE_NAMES) expect(cueProblems(name, SHIPPED_CUES[name]), name).toEqual([]);
  });

  it("each keeps its shape through the schema, so Save writes it back as it is", () => {
    for (const name of CUE_NAMES) expect(CueDataSchema.parse(SHIPPED_CUES[name]), name).toEqual(SHIPPED_CUES[name]);
  });
});

describe("a cue's rules", () => {
  const tone = (note: number, extra: object = {}) => ({ kind: "tone", note, wave: "sine", at: 0, attack: 0.01, release: 0.1, level: 1, ...extra }) as const;
  const params = [{ name: "n", kind: "count" }, { name: "on", kind: "flag" }] as const;
  const cue = (over: Partial<CueData>): CueData => ({ level: 1, cutoff: 2000, voices: [tone(5)], ...over });

  it("shifts every tone but a fixed one up the scale, held to the scale's ends", () => {
    const c = cue({ voices: [tone(5), tone(0, { fixed: true }), tone(14)], shift: { param: "n", per: 1, offset: -1, min: 0, max: 16, round: "floor" } });
    expect(cueFrom(c, params, [3, false]).voices.map((v) => (v.kind === "tone" ? v.note : -1))).toEqual([7, 0, 15]);
    expect(cueFrom(c, params, [0, false]).voices.map((v) => (v.kind === "tone" ? v.note : -1))).toEqual([5, 0, 14]);
  });

  it("sounds a voice only while its `when` holds, a flag reading 1 when set", () => {
    const c = cue({ voices: [tone(5), tone(9, { when: { param: "on", from: 1 } })] });
    expect(cueFrom(c, params, [0, false]).voices).toHaveLength(1);
    expect(cueFrom(c, params, [0, true]).voices).toHaveLength(2);
  });

  it("repeats a voice as many times as its parameter says, between its bounds, each a step on", () => {
    const c = cue({ voices: [tone(5, { repeat: { param: "n", min: 0, max: 3, note: 2, at: 0.05 } })] });
    expect(cueFrom(c, params, [0, false]).voices).toHaveLength(0);
    const four = cueFrom(c, params, [9, false]).voices;
    expect(four.map((v) => (v.kind === "tone" ? v.note : -1))).toEqual([5, 7, 9]);
    expect(four.map((v) => Number(v.at.toFixed(3)))).toEqual([0, 0.05, 0.1]);
  });

  it("takes another level and low-pass while `alt` holds, and swells its level by a parameter", () => {
    const c = cue({ alt: { when: { param: "on", from: 1 }, level: 2, cutoff: 900 }, swell: { param: "n", from: 0.5, to: 1 } });
    expect(cueFrom(c, params, [1, true])).toMatchObject({ cutoff: 900, gain: 2 * LIMITS.peak });
    expect(cueFrom(c, params, [0, false]).gain).toBeCloseTo(0.5 * LIMITS.peak);
  });

  it("says a cue that runs long, rises too fast, is too bright, or names a parameter the board does not pass", () => {
    const keys = (d: CueData): string[] => cueProblems("swap", d).map((p) => p.key);
    expect(keys(cue({ voices: [tone(5, { release: 0.9 })] }))).toContain("studio.check.long");
    expect(keys(cue({ voices: [tone(5, { attack: 0.001 })] }))).toContain("studio.check.attack");
    expect(keys(cue({ cutoff: 9000 }))).toContain("studio.check.bright");
    expect(keys(cue({ shift: { param: "chain", per: 1, offset: 0, min: 0, max: 4, round: "floor" } }))).toContain("studio.check.param");
    expect(CUE_PARAMS.swap).toHaveLength(0);
  });

  it("names each note of the key, G2 to G5", () => {
    expect(Array.from({ length: 16 }, (_, n) => noteName(n))).toEqual(["G2", "A2", "B2", "D3", "E3", "G3", "A3", "B3", "D4", "E4", "G4", "A4", "B4", "D5", "E5", "G5"]);
  });
});

describe("the shipped pieces (boards/data/pieces)", () => {
  it("every puzzle has a file of drawings, each a drawing the editor can hold", () => {
    for (const id of PUZZLE_IDS) {
      const file = SHIPPED_PIECES[id];
      expect(Object.keys(file).length, id).toBeGreaterThan(0);
      for (const [name, d] of Object.entries(file)) {
        expect(DrawingSchema.parse(d), `${id}.${name}`).toEqual(d);
        // Notes only: a shipped piece may break one on purpose (an outline drawn as a line). The check must not throw.
        expect(() => drawingProblems(d)).not.toThrow();
      }
    }
  });
});

describe("the stock skin (boards/data/stock.json)", () => {
  it("has eight outlines, each a drawing that breaks no rule of the look, in a colour of the palette", () => {
    expect(STOCK_KINDS).toBe(8);
    const seen = new Set<string>();
    for (let kind = 1; kind <= STOCK_KINDS; kind++) {
      const { drawing, color } = stockPiece(kind);
      expect(DrawingSchema.parse(drawing), `kind-${kind}`).toEqual(drawing);
      expect(drawingProblems(drawing), `kind-${kind}`).toEqual([]);
      expect(color in PALETTE, `kind-${kind}`).toBe(true);
      // No two share an outline: a board must read with every piece in one colour.
      seen.add(JSON.stringify(drawing.layers.map(({ name: _, ...shape }) => shape)));
    }
    expect(seen.size).toBe(STOCK_KINDS);
    expect(Object.keys(STOCK_PIECES)).toEqual(Array.from({ length: 8 }, (_, i) => `kind-${i + 1}`));
  });
});

describe("the sprite editor's geometry", () => {
  const rect: Drawing["layers"][number] = { kind: "rect", x: 4, y: 4, w: 6, h: 6, r: 2 };

  it("snaps to the step it is given, free of float noise", () => {
    expect(snap(3.26, 0.5)).toBe(3.5);
    expect(snap(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it("puts a layer's handles where it is drawn, turned as it is", () => {
    const body = handles({ ...rect, turn: 90 }).find((h) => h.body)!;
    const [x, y] = turn(7, 7, 90);
    expect(body.x).toBeCloseTo(x);
    expect(body.y).toBeCloseTo(y);
  });

  it("moves the whole layer by its body, and a turned layer follows the pointer", () => {
    expect(dragged(rect, "body", 9, 9, 7, 7)).toMatchObject({ x: 6, y: 6, w: 6, h: 6 });
    const turned = { ...rect, turn: 90 };
    const [ox, oy] = turn(7, 7, 90);
    const [px, py] = turn(9, 7, 90);
    const next = dragged(turned, "body", px, py, ox, oy);
    expect(next).toMatchObject({ x: 6, y: 4 });
  });

  it("resizes a rect by its corner, a disc by its edge, and moves one point of a polygon", () => {
    expect(dragged(rect, "size", 14, 12, 0, 0)).toMatchObject({ w: 10, h: 8 });
    expect(dragged({ kind: "disc", x: 12, y: 12, r: 2 }, "r", 12, 17, 0, 0)).toMatchObject({ r: 5 });
    expect(dragged({ kind: "poly", points: [0, 0, 4, 0, 4, 4], round: 2 }, "p1", 6, 1, 0, 0)).toMatchObject({ points: [0, 0, 6, 1, 4, 4] });
    expect(moved({ kind: "bar", x0: 1, y0: 1, x1: 3, y1: 3, width: 3 }, 1, 2)).toMatchObject({ x0: 2, y0: 3, x1: 4, y1: 5 });
  });

  it("starts every kind of layer as one the schema takes", () => {
    for (const kind of ["rect", "disc", "poly", "bar", "arc", "path"] as const) expect(DrawingSchema.safeParse({ layers: [fresh(kind)] }).success, kind).toBe(true);
  });
});
