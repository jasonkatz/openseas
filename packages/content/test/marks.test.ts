import { describe, expect, it } from "vitest";
import {
  EnginesPieceStyleSchema,
  MARK_GEOMETRY,
  MARK_NAMES,
  PieceStyleSchema,
  StarColorSchema,
  SwordPieceStyleSchema,
  contentProblems,
  loadContent,
  type MarkContour,
  type MarkGeometry,
  type MarkName,
} from "../src/index.js";

// A mark is drawn by sampling it: the centre of each cell of an N by N grid over a square `span`
// each way of the origin, with the mark scaled by `k`.
const N = 160;

function inside(c: MarkContour, x: number, y: number): boolean {
  if (c.kind === "circle") return x * x + y * y <= c.r * c.r;
  let hit = false;
  const p = c.points;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [p[i]!, p[i + 1]!, p[j]!, p[j + 1]!];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const covers = (g: MarkGeometry, x: number, y: number): boolean => inside(g.outline, x, y) && !(g.hole && inside(g.hole, x, y));

function sample(g: MarkGeometry, k: number, span: number): boolean[] {
  const cells: boolean[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) cells.push(covers(g, (-span + ((i + 0.5) * 2 * span) / N) / k, (-span + ((j + 0.5) * 2 * span) / N) / k));
  }
  return cells;
}

/** The share of the box from -1 to 1 the mark covers. */
const coverage = (g: MarkGeometry): number => sample(g, 1, 1).filter(Boolean).length / (N * N);

function overlap(a: boolean[], b: boolean[]): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return both / either;
}

const points = (c: MarkContour): number[] => (c.kind === "circle" ? [c.r, 0, -c.r, 0, 0, c.r, 0, -c.r] : [...c.points]);

describe("marks", () => {
  it("every mark is a shape inside its box, with its hole inside its outline", () => {
    for (const name of MARK_NAMES) {
      const g = MARK_GEOMETRY[name];
      for (const v of [...points(g.outline), ...(g.hole ? points(g.hole) : [])]) expect(Math.abs(v)).toBeLessThanOrEqual(1);
      if (g.hole) for (let i = 0; i < points(g.hole).length; i += 2) expect(inside(g.outline, points(g.hole)[i]!, points(g.hole)[i + 1]!)).toBe(true);
      // Big enough to read at the size of a mark, and never the whole box.
      expect(coverage(g)).toBeGreaterThan(0.25);
      expect(coverage(g)).toBeLessThan(0.75);
    }
  });

  it("no two marks are the same shape, at any size", () => {
    // Each mark scaled to the same area, so one cannot be another drawn larger. The nearest pair,
    // the circle and the hexagon, overlap by about 0.93; the same shape twice would be 1.
    const area = 1.5;
    const masks = MARK_NAMES.map((name) => sample(MARK_GEOMETRY[name], Math.sqrt(area / (coverage(MARK_GEOMETRY[name]) * 4)), 1.5));
    for (let a = 0; a < MARK_NAMES.length; a++) {
      for (let b = a + 1; b < MARK_NAMES.length; b++) expect(overlap(masks[a]!, masks[b]!), `${MARK_NAMES[a]} and ${MARK_NAMES[b]}`).toBeLessThan(0.95);
    }
  });

  it("content names its marks from the vocabulary and refuses any other name at startup", () => {
    const style = { nameKey: "x.y", color: "#123456" };
    const schemas = [
      PieceStyleSchema.omit({ texture: true }),
      EnginesPieceStyleSchema.omit({ texture: true }),
      SwordPieceStyleSchema.omit({ texture: true }),
      StarColorSchema,
    ];
    for (const schema of schemas) {
      for (const mark of MARK_NAMES) expect(schema.safeParse({ ...style, mark }).success).toBe(true);
      expect(schema.safeParse({ ...style, mark: "moon" }).success).toBe(false);
      expect(schema.safeParse({ ...style, mark: "Circle" }).success).toBe(false);
    }
    // And what content holds today is all in it.
    const c = loadContent();
    const used: string[] = c.puzzles.navigation.colors.map((x) => x.mark);
    for (const p of Object.values(c.puzzles)) if ("pieces" in p) for (const piece of p.pieces as ReadonlyArray<{ mark: string }>) used.push(piece.mark);
    expect(used.length).toBeGreaterThan(20);
    for (const mark of used) expect(MARK_NAMES).toContain(mark);
  });

  it("refuses a puzzle whose kinds share a mark", () => {
    const c = loadContent();
    expect(contentProblems(c)).toEqual([]);
    for (const id of ["cooling", "engines", "plating", "gunnery", "swordfight"] as const) {
      const bad = structuredClone(c);
      const pieces = bad.puzzles[id].pieces as Array<{ mark: MarkName }>;
      pieces[1]!.mark = pieces[0]!.mark;
      expect(contentProblems(bad), id).toContain(`puzzles/${id}: mark "${pieces[0]!.mark}" used twice; every kind must differ by mark (rule 6)`);
    }
    const bad = structuredClone(c);
    const colors = bad.puzzles.navigation.colors as Array<{ mark: MarkName }>;
    colors[2]!.mark = colors[0]!.mark;
    expect(contentProblems(bad)).toContain(`puzzles/navigation: mark "${colors[0]!.mark}" used twice; every color must differ by mark (rule 6)`);
  });
});
