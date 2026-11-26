import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Token, Tokens } from "marked";
import { describe, expect, it } from "vitest";
import { API_PAGES, apiContent } from "../src/api/pages.js";
import { GLOSSARY } from "../src/domain/glossary.js";
import { domainContent } from "../src/domain/guide.js";
import { DOMAIN_PAGES, GLOSSARY_SLUG } from "../src/domain/pages.js";
import { ALIASES, ROOTS, TYPES_PATH, pagePath, pageView, pagesOf, refPath, rootNodes, rootPath, type RefTarget } from "../src/api/schema/index.js";
import { FUNCTIONS, ID_TYPES, SDK_ROOTS, SDK_TYPES_PATH, TYPE_GROUPS, innerAnchor, memberPath, membersOf, sdkRootPath, typeAnchor } from "../src/api/sdk/index.js";

const REF_TARGETS: readonly RefTarget[] = ["setting", "move", "control", "event", "phase", "payout", "layer", "piece", "zone", "gauge", "multiplier", "task", "draw", "check", "stand-in", "puzzle", "theme", "cue", "colour", "event field"];

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

/** Every sentence the reference is written in: each string of the typed data, however deep. */
function sentences(value: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") sentences((value as () => unknown)(), out, seen);
  else if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const [key, v] of Object.entries(value)) if (!["examples", "example", "code", "signature", "definition"].includes(key)) sentences(v, out, seen);
  }
  return out;
}

describe("the API section", () => {
  it("has a page for every address, each with something to read", () => {
    expect(new Set(API_PAGES.map((p) => p.slug)).size).toBe(API_PAGES.length);
    for (const page of API_PAGES) {
      expect(page.lede.length, page.slug).toBeGreaterThan(40);
      expect(apiContent(page.slug)!.headings.length, page.slug).toBeGreaterThan(1);
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
    for (const root of ROOTS) {
      anchors.set(rootPath(root.root), new Set([...pagesOf(root).map((p) => p.key.toLowerCase()), ...[...rootNodes(root).values()].map((n) => n.anchor)]));
      for (const page of pagesOf(root)) anchors.set(pagePath(page), new Set(pageView(page).all.map((n) => n.anchor)));
    }
    for (const root of SDK_ROOTS) {
      anchors.set(sdkRootPath(root.root), new Set(membersOf(root).map((m) => m.name.toLowerCase())));
      for (const m of membersOf(root)) {
        if (!m.page) continue;
        const inner = (m.members ?? []).flatMap((g) => g.members.map((x) => innerAnchor(g.name, x.name)));
        anchors.set(memberPath(root.root, m), new Set([...inner, ...(m.params ?? []).map((x) => innerAnchor("param", x.name)), "parameters", "returns", "what-must-hold", "refused-when", "when-it-is-asked"]));
      }
    }
    anchors.set(SDK_TYPES_PATH, new Set([...TYPE_GROUPS.flatMap((g) => g.types.map((d) => typeAnchor(d.name))), ...FUNCTIONS.map((f) => typeAnchor(f.name)), "ids", "functions", "a-generated-type", "how-a-field-reaches-the-rules", "how-a-setting-reaches-the-rules", "the-whole-surface"]));
    anchors.set(TYPES_PATH, new Set(ALIASES.map((a) => a.name.replace(/\s+/g, "-"))));

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
    // The reference: what its sentences link to, where the ideas behind a page are, and where an id is declared.
    for (const text of sentences(ROOTS)) for (const m of text.matchAll(/\]\(([^)]+)\)/g)) check(m[1]!, "the reference", "/api");
    for (const text of sentences(SDK_ROOTS)) for (const m of text.matchAll(/\]\(([^)]+)\)/g)) check(m[1]!, "the rules SDK", "/api");
    for (const text of sentences([FUNCTIONS, TYPE_GROUPS, ID_TYPES])) for (const m of text.matchAll(/\]\(([^)]+)\)/g)) check(m[1]!, "the SDK's types", SDK_TYPES_PATH);
    for (const page of ROOTS.flatMap(pagesOf)) if (page.ideas) check(page.ideas.path, pagePath(page), pagePath(page));
    for (const to of REF_TARGETS) check(refPath(to), `id of ${to}`, "/api");
    for (const page of DOMAIN_PAGES) for (const m of page.lede.matchAll(/\]\(([^)]+)\)/g)) check(m[1]!, `/domain/${page.slug}`, `/domain/${page.slug}`);
  });

  it("stands on its own: it names no decision record and no file of the repository", () => {
    for (const page of API_PAGES) {
      if (page.slug === "paths") continue;
      expect(page.source, page.slug).not.toMatch(/\bADR\b|DOMAIN\.md|CONTEXT\.md|docs\/|packages\//);
    }
    for (const text of sentences([SDK_ROOTS, FUNCTIONS, TYPE_GROUPS])) expect(text).not.toMatch(/\bADR\b|DOMAIN\.md|CONTEXT\.md|docs\/|packages\//);
    for (const text of sentences(ROOTS)) expect(text).not.toMatch(/\bADR\b|DOMAIN\.md|CONTEXT\.md|docs\/|packages\//);
  });
});
