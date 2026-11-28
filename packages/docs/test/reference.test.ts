import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { budget, expand, grid, lines, puzzle, refill, swap } from "@openseas/puzzle";
import gunnery from "@openseas/puzzle/examples/gunnery";
import paths from "@openseas/puzzle/examples/paths";
import { describe, expect, it } from "vitest";
import { check } from "../src/api/schema/check.js";
import { ALIASES, PUZZLE, ROOTS, SKIN, isPage, pageAnchor, pageView, pagesOf, rootNodes, type Field, type ObjectPage, type RootObject, type Type } from "../src/api/schema/index.js";
import { PATHS } from "../src/api/schema/puzzle.js";
import { PATHS_SKIN } from "../src/api/schema/skin.js";

const GUIDE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "puzzles", "DOMAIN.md"), "utf8");

/** The shape the guide gives for one document, under `### <heading>` in its section on the documents. */
function shapeOf(heading: string): unknown {
  const at = GUIDE.indexOf(`### ${heading}\n`);
  const block = /```json\n([\s\S]*?)\n```/.exec(GUIDE.slice(at));
  return JSON.parse(block![1]!);
}

/** Every key a shape names. A key in angle brackets stands for a name the author chooses, and is skipped. */
function keysOf(shape: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(shape)) for (const item of shape) keysOf(item, out);
  else if (shape && typeof shape === "object") {
    for (const [key, value] of Object.entries(shape)) {
      if (!key.includes("<") && !key.includes("|")) out.add(key);
      keysOf(value, out);
    }
  }
  return out;
}

/** The type of a whole top-level object: its own fields and its pages, as one object. */
function typeOf(root: RootObject): Type {
  const fields: Field[] = root.groups.flatMap((g) => g.fields.map((f) => (isPage(f) ? { name: f.key, type: f.type, need: f.need, description: f.lede, ...(f.absent ? { absent: f.absent } : {}) } : f)));
  return { kind: "object", fields };
}

/** Every field name a top-level object documents, however deep. */
function documented(root: RootObject): Set<string> {
  const out = new Set<string>();
  for (const node of rootNodes(root).values()) out.add(node.field.name);
  for (const page of pagesOf(root)) {
    out.add(page.key);
    for (const node of pageView(page).all) out.add(node.field.name);
  }
  return out;
}

const everyPage: ObjectPage[] = ROOTS.flatMap(pagesOf);

describe("the reference", () => {
  for (const [root, heading] of [["puzzle", "The puzzle"], ["skin", "The skin"], ["theme", "The theme"]] as const) {
    it(`documents every key the guide's shape gives ${heading.toLowerCase()} document`, () => {
      const have = documented(ROOTS.find((r) => r.root === root)!);
      expect([...keysOf(shapeOf(heading))].filter((key) => !have.has(key))).toEqual([]);
    });
  }

  it("gives every object that belongs to a top-level object a section of its own", () => {
    for (const root of ROOTS) {
      for (const group of root.groups) {
        for (const f of group.fields) {
          if (isPage(f)) continue;
          // What is listed without a section is a single value, never an object.
          expect(["string", "integer", "number", "boolean", "enum", "ref", "alias", "literal"], `${root.root}.${f.name}`).toContain(f.type.kind);
        }
      }
      expect(new Set(pagesOf(root).map((p) => p.key)).size).toBe(pagesOf(root).length);
    }
  });

  it("types every field down to a primitive value, with every enum value explained", () => {
    const seen = new Set<Type>();
    const visit = (type: Type, at: string): void => {
      if (seen.has(type)) return;
      seen.add(type);
      switch (type.kind) {
        case "enum":
          expect(type.values.length, at).toBeGreaterThan(1);
          for (const v of type.values) expect(v.description.length, `${at}: ${v.value}`).toBeGreaterThan(8);
          return;
        case "alias":
          expect(ALIASES.some((a) => a.name === type.name), `${at}: ${type.name}`).toBe(true);
          return;
        case "array":
          return visit(type.of, `${at}[]`);
        case "tuple":
          return type.of.forEach((t) => visit(t.type, `${at}.${t.name}`));
        case "map":
          return visit(type.of, `${at}.${type.key}`);
        case "object":
          return type.fields.forEach((f) => field(f, at));
        case "variants":
          for (const v of type.variants) v.fields.forEach((f) => field(f, `${at}(${v.value})`));
          return type.common.forEach((f) => field(f, at));
        case "union":
          expect(type.of.length, at).toBeGreaterThan(1);
          return type.of.forEach((alt) => visit(alt.type, `${at}|${alt.label}`));
        case "lazy":
          return visit(type.get(), at);
        default:
          return;
      }
    };
    const field = (f: Field, at: string): void => {
      const here = `${at}.${f.name}`;
      expect(f.description.length, here).toBeGreaterThan(8);
      // A field that may be left out says what leaving it out means, or when it is there.
      if (f.need === "optional") expect(f.absent, `${here} says what leaving it out means`).toBeTruthy();
      visit(f.type, here);
    };
    for (const root of ROOTS) visit(typeOf(root), root.root);
  });

  it("writes every example as the reference types it", () => {
    for (const root of ROOTS) expect(check(root.example.value, typeOf(root), root.root)).toEqual([]);
    for (const page of everyPage) {
      expect(page.examples.length, page.key).toBeGreaterThan(0);
      for (const example of page.examples) {
        const value = example.value as Record<string, unknown>;
        expect(Object.keys(value), `${page.root}.${page.key}: ${example.title}`).toEqual([page.key]);
        expect(check(value[page.key], page.type, `${page.root}.${page.key}`), example.title).toEqual([]);
      }
    }
  });

  it("holds the whole of Paths, the puzzle and its skin, to the reference", () => {
    expect(check(PATHS, typeOf(PUZZLE), "paths")).toEqual([]);
    expect(check(PATHS_SKIN, typeOf(SKIN), "paths.skin")).toEqual([]);
  });

  it("gives every field of a top-level object's page an anchor of its own, however deep", () => {
    for (const root of ROOTS) {
      const anchors = [...[...rootNodes(root).values()].map((n) => n.anchor), ...pagesOf(root).flatMap((p) => [pageAnchor(p), ...pageView(p).all.map((n) => n.anchor)])];
      expect(anchors.filter((a, i) => anchors.indexOf(a) !== i), root.root).toEqual([]);
      for (const page of pagesOf(root)) for (const node of pageView(page).all) expect(node.anchor.startsWith(`${pageAnchor(page)}-`), node.anchor).toBe(true);
    }
  });
});

/** The lowest rung is held to the same reference as a document written whole. */
describe("a puzzle of seven lines", () => {
  it("expands to a document the reference takes: valid, and not yet ready", () => {
    const seven = puzzle("swap", { board: grid(6, 7), pieces: 5, parts: [swap(), lines(3), refill()], ends: budget(20) });
    const document = JSON.parse(expand(seven)) as Record<string, unknown>;
    expect(check(document, typeOf(PUZZLE), "swap")).toEqual([]);
    // What it leaves for later is exactly what ready asks and valid does not.
    expect("moment" in document || "evaluation" in document).toBe(false);
    expect(document.ladder).toHaveLength(1);
  });

  it("and a puzzle of six parts over four stages expands to one too", () => {
    const document = JSON.parse(expand(paths)) as Record<string, unknown>;
    expect(check(document, typeOf(PUZZLE), "paths")).toEqual([]);
    expect(document.ladder).toHaveLength(4);
  });

  it("and a ticking puzzle on a map, with terrain and a bag, expands to one too", () => {
    const document = JSON.parse(expand(gunnery)) as Record<string, unknown>;
    expect(check(document, typeOf(PUZZLE), "gunnery")).toEqual([]);
    expect(document.round).toMatchObject({ tempo: { kind: "ticking", tickMs: 200 } });
  });
});
