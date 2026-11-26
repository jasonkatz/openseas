import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { content } from "../src/content.js";
import { highlight } from "../src/md/highlight.js";
import { slug, slugger } from "../src/md/slug.js";
import { AREAS, navOf, neighbours, search, searchIndex } from "../src/site.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the site", () => {
  it("lists every page of an area once, and walks them in order", () => {
    for (const area of AREAS) {
      const paths = navOf(area).flatMap((g) => g.items.map((i) => i.path));
      expect(paths.length).toBeGreaterThan(5);
      expect(new Set(paths).size).toBe(paths.length);
      expect(neighbours(area, paths[0]!).prev).toBeUndefined();
      expect(neighbours(area, paths[0]!).next?.path).toBe(paths[1]);
      expect(neighbours(area, paths.at(-1)!).next).toBeUndefined();
    }
  });

  it("says every word of its own chrome through the message table", () => {
    const missing: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bt\(\s*"(docs\.[a-z0-9_.]+)"/g)) if (!(m[1]! in content.messages)) missing.push(m[1]!);
      for (const m of text.matchAll(/label: "(docs\.[a-z0-9_.]+)"/g)) if (!(m[1]! in content.messages)) missing.push(m[1]!);
    }
    for (const area of AREAS) for (const key of [`docs.area.${area}`, `docs.home.${area}_blurb`]) if (!(key in content.messages)) missing.push(key);
    for (const kind of ["page", "section", "term", "guide"]) if (!(`docs.kind.${kind}` in content.messages)) missing.push(`docs.kind.${kind}`);
    for (const kind of ["example", "note", "preview"]) if (!(`docs.callout.${kind}` in content.messages)) missing.push(`docs.callout.${kind}`);
    for (const n of [1, 2, 3]) for (const key of [`docs.home.step_${n}`, `docs.home.step_${n}_blurb`]) if (!(key in content.messages)) missing.push(key);
    expect(missing).toEqual([]);
  });

  it("finds a page, a heading, a word of the glossary and a guide", () => {
    expect(searchIndex().length).toBeGreaterThan(300);
    expect(search("streak")[0]?.title).toBe("Streak");
    expect(search("hooks").some((h) => h.path === "/api/hooks")).toBe(true);
    expect(search("oncascade")[0]?.path).toBe("/api/hooks#oncascade");
    expect(search("cooling")[0]?.path).toBe("/guides/cooling");
    expect(search("tier starts").length).toBeGreaterThan(0);
    expect(search("zzzz")).toEqual([]);
    expect(search("  ")).toEqual([]);
  });

  it("makes anchors the way the guide's own links are written", () => {
    expect(slug("What a hook reports through")).toBe("what-a-hook-reports-through");
    expect(slug("One board, or one each")).toBe("one-board-or-one-each");
    expect(slug("`onOpen` and `onClose`")).toBe("onopen-and-onclose");
    const make = slugger();
    expect([make("Events"), make("Events"), make("Events")]).toEqual(["events", "events-1", "events-2"]);
  });

  it("colours code without changing a character of it", () => {
    for (const [code, lang] of [
      ['{ "id": "paths", "n": 12, "ok": true }', "json"],
      ['onMove(ctx, seat, { a, b }) {\n  // a move\n  ctx.emit("swap", { a, b });\n}', "ts"],
      ["plain text", "txt"],
    ] as const) {
      const spans = highlight(code, lang);
      expect(spans.map((s) => s.text).join("")).toBe(code);
    }
    expect(highlight('{ "id": "paths" }', "json").find((s) => s.tone === "key")?.text).toBe('"id"');
    expect(highlight("onMove(ctx)", "ts")[0]).toEqual({ tone: "hook", text: "onMove" });
  });
});
