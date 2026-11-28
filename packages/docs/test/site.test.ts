import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { content } from "../src/content.js";
import { highlight } from "../src/md/highlight.js";
import { slug, slugger } from "../src/md/slug.js";
import { PUZZLE_IDS } from "@openseas/engine";
import { API_PAGES, apiPath } from "../src/api/pages.js";
import { ROOTS, TYPES_PATH, rootPath } from "../src/api/schema/index.js";
import { SDK_ROOTS, SDK_TYPES_PATH, sdkRootPath } from "../src/api/sdk/index.js";
import { AREAS, areaOf, guidePath, movedTo, navOf, neighbours, search, searchIndex } from "../src/site.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

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

  it("has four areas: the domain, the guides, the reference and the puzzles", () => {
    expect(AREAS).toEqual(["domain", "guides", "reference", "puzzles"]);
    const paths = (area: (typeof AREAS)[number]) => navOf(area).flatMap((g) => g.items.map((i) => i.path));
    // Guides are the how-tos: getting started, the climb, writing rules and the whole example.
    expect(paths("guides")).toEqual(API_PAGES.filter((p) => p.area === "guides").map(apiPath));
    expect(paths("guides")).toEqual(expect.arrayContaining(["/guides", "/guides/quickstart", "/guides/tune", "/guides/ship", "/guides/rules", "/guides/paths"]));
    // Reference is only the documents and the SDK, after a page on how to read them.
    expect(paths("reference")).toEqual(["/reference", ...ROOTS.map((r) => rootPath(r.root)), TYPES_PATH, ...SDK_ROOTS.map((r) => sdkRootPath(r.root)), SDK_TYPES_PATH]);
    // Puzzles is a page for each puzzle.
    expect(paths("puzzles")).toEqual(["/puzzles", ...PUZZLE_IDS.map(guidePath)]);
    for (const area of AREAS) for (const path of paths(area)) expect(areaOf(path), path).toBe(area);
  });

  it("sends every old address on to where it lives now", () => {
    expect(movedTo("/api")).toBe("/guides");
    expect(movedTo("/api/quickstart")).toBe("/guides/quickstart");
    expect(movedTo("/api/write-a-puzzle")).toBe("/guides/write-a-puzzle");
    expect(movedTo("/api/rules")).toBe("/guides/rules");
    expect(movedTo("/api/puzzle")).toBe("/reference/puzzle");
    expect(movedTo("/api/types")).toBe("/reference/types");
    expect(movedTo("/api/hooks")).toBe("/reference/hooks");
    expect(movedTo("/api/sdk")).toBe("/reference/sdk");
    expect(movedTo("/guides/cooling")).toBe("/puzzles/cooling");
    expect(movedTo("/cooling")).toBe("/puzzles/cooling");
    for (const path of ["/", "/guides", "/guides/tune", "/reference", "/puzzles/cooling", "/api/nope", "/api/puzzle/round"]) expect(movedTo(path), path).toBeNull();
    // Every page of the old API area has somewhere to go.
    for (const page of API_PAGES.filter((p) => p.area === "guides")) expect(movedTo(page.slug === "" ? "/api" : `/api/${page.slug}`)).toBe(apiPath(page));
    for (const path of [...ROOTS.map((r) => rootPath(r.root)), TYPES_PATH, ...SDK_ROOTS.map((r) => sdkRootPath(r.root)), SDK_TYPES_PATH]) expect(movedTo(path.replace("/reference", "/api"))).toBe(path);
  });

  it("redirects on the host exactly as the site does", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { redirects: { source: string; destination: string }[] };
    const host = (path: string): string | null => {
      for (const r of vercel.redirects) {
        const m = /^(.*?):(\w+)\(([^)]+)\)$/.exec(r.source);
        if (!m) {
          if (r.source === path) return r.destination;
          continue;
        }
        const [, prefix, name, alts] = m;
        if (!path.startsWith(prefix!)) continue;
        const rest = path.slice(prefix!.length);
        if (alts!.split("|").includes(rest)) return r.destination.replace(`:${name}`, rest);
      }
      return null;
    };
    const old = [
      "/api",
      ...API_PAGES.filter((p) => p.area === "guides" && p.slug !== "").map((p) => `/api/${p.slug}`),
      ...[...ROOTS.map((r) => r.root), "types", ...SDK_ROOTS.map((r) => r.root), "sdk"].map((s) => `/api/${s}`),
      ...PUZZLE_IDS.flatMap((id) => [`/guides/${id}`, `/${id}`]),
    ];
    for (const path of old) expect(host(path), path).toBe(movedTo(path));
    for (const path of ["/guides", "/guides/tune", "/reference/puzzle", "/puzzles/cooling", "/domain"]) expect(host(path), path).toBeNull();
  });

  it("says every word of its own chrome through the message table", () => {
    const missing: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bt\(\s*"(docs\.[a-z0-9_.]+)"/g)) if (!(m[1]! in content.messages)) missing.push(m[1]!);
      for (const m of text.matchAll(/label: "(docs\.[a-z0-9_.]+)"/g)) if (!(m[1]! in content.messages)) missing.push(m[1]!);
    }
    for (const area of AREAS) for (const key of [`docs.area.${area}`, `docs.home.${area}_blurb`]) if (!(key in content.messages)) missing.push(key);
    for (const kind of ["page", "section", "term", "guide", "field", "type", "hook", "member"]) if (!(`docs.kind.${kind}` in content.messages)) missing.push(`docs.kind.${kind}`);
    for (const kind of ["example", "note", "preview"]) if (!(`docs.callout.${kind}` in content.messages)) missing.push(`docs.callout.${kind}`);
    for (const n of [1, 2, 3]) for (const key of [`docs.home.step_${n}`, `docs.home.step_${n}_blurb`]) if (!(key in content.messages)) missing.push(key);
    expect(missing).toEqual([]);
  });

  it("finds a page, a heading, a word of the glossary and a guide", () => {
    expect(searchIndex().length).toBeGreaterThan(300);
    expect(search("streak")[0]?.title).toBe("Streak");
    expect(search("hooks").some((h) => h.path === "/reference/hooks")).toBe(true);
    expect(search("oncascade")[0]?.path).toBe("/reference/hooks#oncascade");
    expect(search("ctx.emit")[0]?.path).toBe("/reference/context#emit");
    expect(search("e.arrive")[0]?.path).toBe("/reference/context#e-arrive");
    expect(search("NewPiece")[0]?.path).toBe("/reference/sdk#newpiece");
    expect(search("cooling")[0]?.path).toBe("/puzzles/cooling");
    expect(search("tier starts").length).toBeGreaterThan(0);
    // A field of the reference, by its name, and a named type.
    expect(search("loglimit")[0]?.path).toBe("/reference/puzzle#round-loglimit");
    expect(search("tickMs").some((h) => h.kind === "field" && h.path.startsWith("/reference/puzzle#round-"))).toBe(true);
    expect(search("puzzle.round")[0]?.path).toBe("/reference/puzzle#round");
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
