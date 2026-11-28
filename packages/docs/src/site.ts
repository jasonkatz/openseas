import { CORE_PUZZLE_IDS, PROTOTYPE_PUZZLE_IDS, PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { API_PAGES, GUIDE_GROUPS, REFERENCE_INTRO, apiContent, apiPath } from "./api/pages.js";
import { ALIASES, ROOTS, rootOf, TYPES_PATH, isPage, nodePath, pagePath, pageView, pagesOf, rootNodes, rootPath } from "./api/schema/index.js";
import { FUNCTIONS, SDK_ROOTS, sdkRootOf, SDK_TYPES_PATH, TYPE_DEFS, innerAnchor, memberPagesOf, memberPath, membersOf, sdkRootPath, typeAnchor } from "./api/sdk/index.js";
import { t } from "./content.js";
import { GLOSSARY } from "./domain/glossary.js";
import { domainContent } from "./domain/guide.js";
import { DOMAIN_GROUPS, GLOSSARY_SLUG, domainPath } from "./domain/pages.js";
import { GUIDES } from "./guides/index.js";
import { firstLine } from "./md/parse.js";

/**
 * The site's four areas, in the order the top bar lists them: what a puzzle is, how to write one,
 * the reference for every document and hook, and a page for each puzzle.
 */
export const AREAS = ["domain", "guides", "reference", "puzzles"] as const;
export type Area = (typeof AREAS)[number];

export const areaPath = (area: Area): string => `/${area}`;
/** A puzzle's own page, its guide from a first round to expert play. */
export const guidePath = (id: PuzzleId): string => `/puzzles/${id}`;

export function areaOf(path: string): Area | null {
  return AREAS.find((a) => path === `/${a}` || path.startsWith(`/${a}/`)) ?? null;
}

const isPuzzle = (id: string): id is PuzzleId => (PUZZLE_IDS as readonly string[]).includes(id);

/**
 * Where an old address now lives, or null. The API area was split in two: its how-tos are Guides at
 * `/guides/<page>`, and its reference is Reference at `/reference/<object>`. The puzzle guides it sat
 * beside moved from `/guides/<id>` to `/puzzles/<id>`, and before that they were at `/<id>`. A kept link
 * still arrives, at the same anchor.
 */
export function movedTo(path: string): string | null {
  const [area = "", slug = "", ...rest] = path.replace(/^\/+|\/+$/g, "").split("/");
  if (rest.length > 0) return null;
  if (area === "api") {
    if (slug === "") return "/guides";
    if (rootOf(slug) || sdkRootOf(slug) || slug === "types" || slug === "sdk") return `/reference/${slug}`;
    if (API_PAGES.some((p) => p.area === "guides" && p.slug === slug)) return `/guides/${slug}`;
    return null;
  }
  if (area === "guides" && isPuzzle(slug)) return guidePath(slug);
  if (slug === "" && isPuzzle(area)) return guidePath(area);
  return null;
}

export interface NavItem {
  readonly path: string;
  readonly title: string;
  /** Written as code: the key of an object in a file. */
  readonly code?: boolean | undefined;
  /** The sections of its page, listed while the reader is on it. */
  readonly children?: readonly NavItem[] | undefined;
}
export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

/** An area's pages, grouped, in reading order: its side list and its previous and next links. */
export function navOf(area: Area): NavGroup[] {
  if (area === "domain") return DOMAIN_GROUPS.map((g) => ({ title: g.title, items: g.pages.map((p) => ({ path: domainPath(p.slug), title: p.title })) }));
  if (area === "guides") return GUIDE_GROUPS.map((g) => ({ title: g.title, items: g.pages.map((p): NavItem => ({ path: apiPath(p), title: p.title })) }));
  if (area === "reference") {
    return [
      { title: t("docs.ref.group.reference"), items: [{ path: apiPath(REFERENCE_INTRO), title: t("docs.ref.overview") }] },
      documentsNav(),
      { title: t("docs.sdk.group"), items: sdkNav() },
    ];
  }
  const items = (ids: readonly PuzzleId[]): NavItem[] => ids.map((id) => ({ path: guidePath(id), title: t(`${id}.title`) }));
  return [
    { title: t("docs.guides_heading"), items: [{ path: "/puzzles", title: t("docs.all_guides") }] },
    { title: t("docs.core_heading"), items: items(CORE_PUZZLE_IDS) },
    { title: t("docs.prototype_heading"), items: items(PROTOTYPE_PUZZLE_IDS) },
  ];
}

/** The documents: the three top-level objects, each one page with a section for every object inside it, and the types they share. */
function documentsNav(): NavGroup {
  return {
    title: t("docs.ref.group.documents"),
    items: [
      ...ROOTS.map((root): NavItem => ({ path: rootPath(root.root), title: root.title, children: pagesOf(root).map((p) => ({ path: pagePath(p), title: p.key, code: true })) })),
      { path: TYPES_PATH, title: t("docs.ref.types_title") },
    ],
  };
}

/** The rules SDK: the rules object, a view and a context, each one page with a section for every hook or member, and its types. */
function sdkNav(): NavItem[] {
  return [
    ...SDK_ROOTS.map((root): NavItem => ({ path: sdkRootPath(root.root), title: root.title, children: memberPagesOf(root).map((m) => ({ path: memberPath(root.root, m), title: m.name, code: true })) })),
    { path: SDK_TYPES_PATH, title: t("docs.sdk.types_title") },
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
  readonly kind: "page" | "section" | "term" | "guide" | "field" | "type" | "hook" | "member";
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
  for (const page of API_PAGES) {
    const path = apiPath(page);
    out.push({ title: page.title, path, area: page.area, kind: "page", sub: page.lede.replace(/`/g, "") });
    const content = apiContent(path);
    if (!content) continue;
    content.tokens.forEach((tok, i) => {
      if (tok.type !== "heading") return;
      const id = (tok as { id?: string }).id;
      const h = content.headings.find((x) => x.id === id);
      if (h) out.push({ title: h.text, path: `${path}#${h.id}`, area: page.area, kind: "section", sub: firstLine(content.tokens, i + 1) || page.title });
    });
  }
  for (const root of ROOTS) {
    out.push({ title: t("docs.ref.object", { name: root.root }), path: rootPath(root.root), area: "reference", kind: "page", sub: root.lede });
    for (const group of root.groups) {
      for (const f of group.fields) if (!isPage(f)) out.push({ title: `${root.root}.${f.name}`, path: `${rootPath(root.root)}#${rootNodes(root).get(f)!.anchor}`, area: "reference", kind: "field", sub: clean(f.description) });
    }
    for (const page of pagesOf(root)) {
      out.push({ title: `${root.root}.${page.key}`, path: pagePath(page), area: "reference", kind: "section", sub: clean(page.lede) });
      for (const node of pageView(page).all) out.push({ title: `${page.key}.${node.path}`, path: nodePath(page, node), area: "reference", kind: "field", sub: clean(node.field.description) });
    }
  }
  for (const a of ALIASES) out.push({ title: a.name, path: `${TYPES_PATH}#${a.name.replace(/\s+/g, "-")}`, area: "reference", kind: "type", sub: clean(a.description) });
  for (const root of SDK_ROOTS) {
    const owner = root.root === "hooks" ? "" : `${root.root === "context" ? "ctx" : "view"}.`;
    out.push({ title: root.title, path: sdkRootPath(root.root), area: "reference", kind: "page", sub: clean(root.lede) });
    for (const m of membersOf(root)) {
      if (m.from) continue;
      const path = memberPath(root.root, m);
      out.push({ title: `${owner}${m.name}`, path, area: "reference", kind: m.kind === "hook" ? "hook" : "member", sub: clean(m.description) });
      for (const group of m.members ?? []) for (const inner of group.members) out.push({ title: `${group.name}.${inner.name}`, path: `${sdkRootPath(root.root)}#${innerAnchor(group.name, inner.name)}`, area: "reference", kind: "member", sub: clean(inner.description) });
    }
  }
  for (const fn of FUNCTIONS) out.push({ title: fn.name, path: `${SDK_TYPES_PATH}#${typeAnchor(fn.name)}`, area: "reference", kind: "member", sub: clean(fn.description) });
  for (const def of TYPE_DEFS) out.push({ title: def.name, path: `${SDK_TYPES_PATH}#${typeAnchor(def.name)}`, area: "reference", kind: "type", sub: clean(def.description) });
  for (const id of PUZZLE_IDS) out.push({ title: t(`${id}.title`), path: guidePath(id), area: "puzzles", kind: "guide", sub: GUIDES[id].tagline });
  index = out;
  return out;
}

/** A line of inline Markdown as plain words, for a search result. */
const clean = (text: string): string => text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`]/g, "");

const KIND_RANK: Record<Hit["kind"], number> = { page: 0, guide: 0, hook: 0, term: 1, type: 1, member: 1, section: 2, field: 3 };

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
