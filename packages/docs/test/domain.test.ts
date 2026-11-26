import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GLOSSARY, TERM_COUNT } from "../src/domain/glossary.js";
import { GUIDE_SECTIONS, domainAnchor, domainContent, guideLinks } from "../src/domain/guide.js";
import { DOMAIN_PAGES, GLOSSARY_SLUG } from "../src/domain/pages.js";

const PUZZLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "puzzles");

/** The domain section is the domain guide, cut into pages. These hold the cut to the guide. */
describe("the domain section", () => {
  it("shows every section of the guide on exactly one page", () => {
    const placed = DOMAIN_PAGES.flatMap((p) => p.sections);
    expect([...placed].sort()).toEqual([...GUIDE_SECTIONS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("has a page for every address, each with a title, a lede and something to read", () => {
    expect(new Set(DOMAIN_PAGES.map((p) => p.slug)).size).toBe(DOMAIN_PAGES.length);
    for (const page of DOMAIN_PAGES) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.lede.length, page.slug).toBeGreaterThan(40);
      if (page.slug === GLOSSARY_SLUG) continue;
      expect(domainContent(page.slug)!.tokens.length, page.slug).toBeGreaterThan(2);
    }
  });

  it("leads every link inside the guide to a heading on some page", () => {
    const links = guideLinks();
    expect(links.length).toBeGreaterThan(10);
    for (const id of links) expect(domainAnchor(id), `#${id}`).toMatch(/^\/domain/);
  });

  it("gives every heading on a page an anchor of its own", () => {
    const ids = DOMAIN_PAGES.flatMap((p) => domainContent(p.slug)?.headings.map((h) => h.id) ?? []);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stands on its own: it names no decision record and no file of the repository", () => {
    for (const file of ["DOMAIN.md", "CONTEXT.md"]) {
      const text = readFileSync(join(PUZZLES, file), "utf8");
      expect(text, file).not.toMatch(/\bADR\b|\.md\b|docs\/|packages\//);
    }
    for (const page of DOMAIN_PAGES) expect(page.lede).not.toMatch(/\bADR\b|\.md\b/);
  });

  it("lists every word of the glossary", () => {
    const text = readFileSync(join(PUZZLES, "CONTEXT.md"), "utf8");
    expect(TERM_COUNT).toBe((text.match(/^\*\*.+\*\*:$/gm) ?? []).length);
    expect(TERM_COUNT).toBeGreaterThan(100);
    const ids = GLOSSARY.flatMap((g) => g.terms.map((term) => term.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GLOSSARY) for (const term of g.terms) expect(term.text.length, term.name).toBeGreaterThan(10);
  });
});
