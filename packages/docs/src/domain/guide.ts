import type { Token, Tokens } from "marked";
import guideSource from "../../../../docs/puzzles/DOMAIN.md?raw";
import { lex, plain, withIds, type Heading, type HeadingToken } from "../md/parse.js";
import { slugger } from "../md/slug.js";
import { DOMAIN_PAGES, domainPath, type DomainPage } from "./pages.js";

/** One page of the domain section, cut from the guide. */
export interface DomainContent {
  readonly page: DomainPage;
  readonly tokens: readonly Token[];
  /** The headings a reader can jump to on this page. */
  readonly headings: readonly Heading[];
}

interface Section {
  readonly title: string;
  readonly tokens: Token[];
}

/** The guide's `##` sections, in order. What comes before the first is the guide's note to its editors, and is not shown. */
function sectionsOf(source: string): Section[] {
  const out: Section[] = [];
  for (const tok of lex(source)) {
    if (tok.type === "heading" && (tok as Tokens.Heading).depth === 2) out.push({ title: plain((tok as Tokens.Heading).tokens), tokens: [tok] });
    else if (out.length > 0 && tok.type !== "space") out[out.length - 1]!.tokens.push(tok);
  }
  return out;
}

const SECTIONS = sectionsOf(guideSource);

/** Every `##` heading of the guide: the test holds each to exactly one page. */
export const GUIDE_SECTIONS: readonly string[] = SECTIONS.map((s) => s.title);

// One run of anchors over the whole guide, so a link written `(#sight)` means the same heading it does in the file.
const make = slugger();
/** Each anchor's section, and each section's own anchor. */
const sectionOf = new Map<string, string>();
const topOf = new Map<string, string>();
for (const s of SECTIONS) {
  const headings = withIds(s.tokens, make);
  topOf.set(s.title, headings[0]!.id);
  for (const h of headings) sectionOf.set(h.id, s.title);
}

const cut = new Map<string, DomainContent>();
for (const page of DOMAIN_PAGES) {
  const parts = page.sections.map((title) => SECTIONS.find((s) => s.title === title)).filter((s): s is Section => s !== undefined);
  // A page that is one section of the guide wears its own title, so that section's heading is dropped.
  const tokens = parts.length === 1 ? parts[0]!.tokens.slice(1) : parts.flatMap((s) => s.tokens);
  const headings = tokens.filter((t) => t.type === "heading").map((t) => ({ id: (t as HeadingToken).id!, depth: (t as Tokens.Heading).depth, text: plain((t as Tokens.Heading).tokens) }));
  cut.set(page.slug, { page, tokens, headings });
}

export function domainContent(slug: string): DomainContent | undefined {
  return cut.get(slug);
}

/** Where an anchor of the guide is on this site, or undefined when the guide has no such heading. */
export function domainAnchor(id: string): string | undefined {
  const section = sectionOf.get(id);
  if (section === undefined) return undefined;
  const page = DOMAIN_PAGES.find((p) => p.sections.includes(section));
  if (!page) return undefined;
  // A section that is a whole page has no heading of its own there: its anchor is the page.
  const whole = page.sections.length === 1 && topOf.get(section) === id;
  return whole ? domainPath(page.slug) : `${domainPath(page.slug)}#${id}`;
}

/** Every anchor the guide's own links name, for the test that none dangles. */
export function guideLinks(): string[] {
  return [...guideSource.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
}
