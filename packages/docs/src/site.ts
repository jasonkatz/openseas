import { CORE_PUZZLE_IDS, PROTOTYPE_PUZZLE_IDS, PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { API_GROUPS, apiContent, apiPath } from "./api/pages.js";
import { t } from "./content.js";
import { GLOSSARY } from "./domain/glossary.js";
import { domainContent } from "./domain/guide.js";
import { DOMAIN_GROUPS, GLOSSARY_SLUG, domainPath } from "./domain/pages.js";
import { GUIDES } from "./guides/index.js";
import { firstLine } from "./md/parse.js";

/** The site's three areas, in the order the top bar lists them. */
export const AREAS = ["domain", "api", "guides"] as const;
export type Area = (typeof AREAS)[number];

export const areaPath = (area: Area): string => `/${area}`;
export const guidePath = (id: PuzzleId): string => `/guides/${id}`;

export function areaOf(path: string): Area | null {
  return AREAS.find((a) => path === `/${a}` || path.startsWith(`/${a}/`)) ?? null;
}

export interface NavItem {
  readonly path: string;
  readonly title: string;
}
export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

/** An area's pages, grouped, in reading order: its side list and its previous and next links. */
export function navOf(area: Area): NavGroup[] {
  if (area === "domain") return DOMAIN_GROUPS.map((g) => ({ title: g.title, items: g.pages.map((p) => ({ path: domainPath(p.slug), title: p.title })) }));
  if (area === "api") return API_GROUPS.map((g) => ({ title: g.title, items: g.pages.map((p) => ({ path: apiPath(p.slug), title: p.title })) }));
  const items = (ids: readonly PuzzleId[]): NavItem[] => ids.map((id) => ({ path: guidePath(id), title: t(`${id}.title`) }));
  return [
    { title: t("docs.guides_heading"), items: [{ path: "/guides", title: t("docs.all_guides") }] },
    { title: t("docs.core_heading"), items: items(CORE_PUZZLE_IDS) },
    { title: t("docs.prototype_heading"), items: items(PROTOTYPE_PUZZLE_IDS) },
  ];
}

export function neighbours(area: Area, path: string): { prev?: NavItem | undefined; next?: NavItem | undefined } {
  const all = navOf(area).flatMap((g) => g.items);
  const at = all.findIndex((i) => i.path === path);
  return at < 0 ? {} : { prev: all[at - 1], next: all[at + 1] };
}

/** One thing the search can find. */
export interface Hit {
  readonly title: string;
  readonly path: string;
  readonly area: Area;
  readonly kind: "page" | "section" | "term" | "guide";
  /** The page it is on, or a line about it. */
  readonly sub: string;
}

let index: Hit[] | undefined;

/** Every page, every heading, every word of the glossary and every guide. Built the first time the search opens. */
export function searchIndex(): Hit[] {
  if (index) return index;
  const out: Hit[] = [];
  for (const page of DOMAIN_GROUPS.flatMap((g) => g.pages)) {
    const path = domainPath(page.slug);
    out.push({ title: page.title, path, area: "domain", kind: "page", sub: page.lede });
    const content = domainContent(page.slug);
    if (!content) continue;
    content.tokens.forEach((tok, i) => {
      if (tok.type !== "heading") return;
      const h = content.headings.find((x) => x.id === (tok as { id?: string }).id);
      if (h) out.push({ title: h.text, path: `${path}#${h.id}`, area: "domain", kind: "section", sub: firstLine(content.tokens, i + 1) || page.title });
    });
  }
  for (const group of GLOSSARY) for (const term of group.terms) out.push({ title: term.name, path: `${domainPath(GLOSSARY_SLUG)}#${term.id}`, area: "domain", kind: "term", sub: term.text.replace(/[*`_]/g, "") });
  for (const page of API_GROUPS.flatMap((g) => g.pages)) {
    const path = apiPath(page.slug);
    out.push({ title: page.title, path, area: "api", kind: "page", sub: page.lede.replace(/`/g, "") });
    const content = apiContent(page.slug);
    if (!content) continue;
    content.tokens.forEach((tok, i) => {
      if (tok.type !== "heading") return;
      const id = (tok as { id?: string }).id;
      const h = content.headings.find((x) => x.id === id);
      if (h) out.push({ title: h.text, path: `${path}#${h.id}`, area: "api", kind: "section", sub: firstLine(content.tokens, i + 1) || page.title });
    });
  }
  for (const id of PUZZLE_IDS) out.push({ title: t(`${id}.title`), path: guidePath(id), area: "guides", kind: "guide", sub: GUIDES[id].tagline });
  index = out;
  return out;
}

const KIND_RANK: Record<Hit["kind"], number> = { page: 0, guide: 0, term: 1, section: 2 };

/** The best matches for what was typed: a title that starts with it first, then one that holds it, then one whose line does. */
export function search(query: string, limit = 12): Hit[] {
  // A plural finds its singular: "tier starts" finds "Tier start".
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  if (words.length === 0) return [];
  const scored: { hit: Hit; score: number }[] = [];
  for (const hit of searchIndex()) {
    const title = hit.title.toLowerCase();
    const sub = hit.sub.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title === w) score += 0;
      else if (title.startsWith(w)) score += 1;
      else if (new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "\\$&")}`).test(title)) score += 2;
      else if (title.includes(w)) score += 3;
      else if (sub.includes(w)) score += 6;
      else {
        score = -1;
        break;
      }
    }
    if (score >= 0) scored.push({ hit, score: score * 4 + KIND_RANK[hit.kind] });
  }
  return scored.sort((a, b) => a.score - b.score || a.hit.title.length - b.hit.title.length).slice(0, limit).map((s) => s.hit);
}
