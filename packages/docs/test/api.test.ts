import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Token, Tokens } from "marked";
import { describe, expect, it } from "vitest";
import { API_PAGES, apiContent } from "../src/api/pages.js";
import { GLOSSARY } from "../src/domain/glossary.js";
import { domainContent } from "../src/domain/guide.js";
import { DOMAIN_PAGES, GLOSSARY_SLUG } from "../src/domain/pages.js";
import { HOOKS } from "../src/md/highlight.js";

const GUIDE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "puzzles", "DOMAIN.md"), "utf8");

/** Every token of a page, however deep. */
function walk(tokens: readonly Token[], visit: (t: Token) => void): void {
  for (const t of tokens) {
    visit(t);
    if ("tokens" in t && t.tokens) walk(t.tokens, visit);
    if (t.type === "list") for (const item of (t as Tokens.List).items) walk(item.tokens, visit);
    if (t.type === "table") {
      const table = t as Tokens.Table;
      for (const cell of [...table.header, ...table.rows.flat()]) walk(cell.tokens, visit);
    }
  }
}

function collect<T extends Token>(slug: string, type: string): T[] {
  const out: T[] = [];
  walk(apiContent(slug)!.tokens, (t) => {
    if (t.type === type) out.push(t as T);
  });
  return out;
}

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

/** What a page writes as code in its prose and tables: the keys it documents. */
function codeOf(slug: string): Set<string> {
  const words = new Set<string>();
  for (const span of collect<Tokens.Codespan>(slug, "codespan")) for (const word of span.text.match(/[A-Za-z_]+/g) ?? []) words.add(word);
  return words;
}

describe("the API section", () => {
  it("has a page for every address, each with something to read", () => {
    expect(new Set(API_PAGES.map((p) => p.slug)).size).toBe(API_PAGES.length);
    for (const page of API_PAGES) {
      expect(page.lede.length, page.slug).toBeGreaterThan(40);
      expect(apiContent(page.slug)!.headings.length, page.slug).toBeGreaterThan(1);
    }
  });

  for (const [slug, heading] of [["puzzle", "The puzzle"], ["skin", "The skin"], ["theme", "The theme"]] as const) {
    it(`documents every key the guide's shape gives ${heading.toLowerCase()} document`, () => {
      const documented = codeOf(slug);
      const missing = [...keysOf(shapeOf(heading))].filter((key) => !documented.has(key));
      expect(missing).toEqual([]);
    });
  }

  it("has a section for every hook the guide lists", () => {
    const table = GUIDE.slice(GUIDE.indexOf("### Hooks\n"), GUIDE.indexOf("### What a hook reports through"));
    const listed = [...table.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]!);
    expect(listed.length).toBeGreaterThan(18);
    const ids = new Set(apiContent("hooks")!.headings.map((h) => h.id));
    const sections = [...ids].join(" ");
    for (const hook of listed) {
      expect(sections, hook).toContain(hook.toLowerCase());
      expect(HOOKS.has(hook), `${hook} is coloured as a hook`).toBe(true);
    }
  });

  it("writes every JSON example so that it parses", () => {
    for (const page of API_PAGES) {
      for (const code of collect<Tokens.Code>(page.slug, "code")) {
        if (!code.lang?.startsWith("json")) continue;
        expect(() => JSON.parse(code.text), `${page.slug}: ${code.text.slice(0, 60)}`).not.toThrow();
      }
    }
  });

  it("builds the walkthrough's document out of keys the guide gives", () => {
    const known = new Set(Object.keys(shapeOf("The puzzle") as object));
    const written = new Set<string>();
    for (const code of collect<Tokens.Code>("write-a-puzzle", "code")) {
      if (!code.lang?.startsWith("json") || code.lang.includes("skin")) continue;
      for (const key of Object.keys(JSON.parse(code.text) as object)) written.add(key);
    }
    expect([...written].filter((key) => !known.has(key))).toEqual([]);
    // A solo puzzle leaves out only what is for a round between sides.
    expect([...known].filter((key) => !written.has(key)).sort()).toEqual(["opponents", "placing", "points"]);
  });

  it("leads every link to a page of the site, and to a heading that page has", () => {
    const anchors = new Map<string, Set<string>>();
    for (const page of DOMAIN_PAGES) {
      const path = page.slug === "" ? "/domain" : `/domain/${page.slug}`;
      const ids = page.slug === GLOSSARY_SLUG ? GLOSSARY.flatMap((g) => [g.id, ...g.terms.map((term) => term.id)]) : domainContent(page.slug)!.headings.map((h) => h.id);
      anchors.set(path, new Set(ids));
    }
    for (const page of API_PAGES) anchors.set(page.slug === "" ? "/api" : `/api/${page.slug}`, new Set(apiContent(page.slug)!.headings.map((h) => h.id)));
    anchors.set("/guides", new Set());

    const check = (href: string, from: string, own: string): void => {
      if (/^https?:/.test(href)) return;
      const [path = "", hash = ""] = href.split("#");
      const target = path === "" ? own : path;
      expect(anchors.has(target), `${from}: ${href}`).toBe(true);
      if (hash) expect(anchors.get(target)!.has(hash), `${from}: ${href}`).toBe(true);
    };
    for (const page of API_PAGES) {
      const own = page.slug === "" ? "/api" : `/api/${page.slug}`;
      for (const link of collect<Tokens.Link>(page.slug, "link")) check(link.href, own, own);
      for (const m of page.lede.matchAll(/\]\(([^)]+)\)/g)) check(m[1]!, own, own);
    }
    for (const page of DOMAIN_PAGES) for (const m of page.lede.matchAll(/\]\(([^)]+)\)/g)) check(m[1]!, `/domain/${page.slug}`, `/domain/${page.slug}`);
  });

  it("stands on its own: it names no decision record and no file of the repository", () => {
    for (const page of API_PAGES) {
      if (page.slug === "paths") continue;
      expect(page.source, page.slug).not.toMatch(/\bADR\b|DOMAIN\.md|CONTEXT\.md|docs\/|packages\//);
    }
  });
});
