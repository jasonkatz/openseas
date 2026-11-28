import type { Token } from "marked";
import overview from "../../content/api/overview.md?raw";
import write from "../../content/api/write-a-puzzle.md?raw";
import rules from "../../content/api/rules.md?raw";
import quickstart from "../../content/api/rungs/quickstart.md?raw";
import tune from "../../content/api/rungs/tune.md?raw";
import ownRule from "../../content/api/rungs/own-rule.md?raw";
import depth from "../../content/api/rungs/depth.md?raw";
import seats from "../../content/api/rungs/seats.md?raw";
import ship from "../../content/api/rungs/ship.md?raw";
import reference from "../../content/api/reference.md?raw";
import pathsPuzzle from "../../../../docs/puzzles/examples/paths.puzzle.json?raw";
import pathsSkin from "../../../../docs/puzzles/examples/paths.skin.json?raw";
import { lex, withIds, type Heading } from "../md/parse.js";

/**
 * The site's pages of prose about the API: one Markdown file a page, in `content/api/`. Most are
 * Guides, the how-tos read in order: getting started, then the rungs (the API from a puzzle of seven
 * lines up, a page a rung, each adding a few ideas to the one before), then writing rules and a whole
 * example. One is the front page of Reference, which says how to read it. The reference itself is
 * not prose: it is data, in `schema/` and `sdk/`, and `site.ts` lists its pages after that one.
 */
export type ProseArea = "guides" | "reference";

export interface ApiPage {
  readonly area: ProseArea;
  readonly slug: string;
  readonly title: string;
  readonly lede: string;
  readonly source: string;
}

export interface ApiGroup {
  readonly title: string;
  readonly pages: readonly ApiPage[];
}

const fence = (title: string, json: string): string => `\`\`\`json title=${title} tall\n${json.trim()}\n\`\`\``;

/** Paths written out in full: the two documents as they are in the repository, shown whole. */
const paths = [
  "Paths is a whole puzzle: a player draws a path through touching pieces of one kind to clear them, and a closed path takes every prize on the board. The space theme calls it Salvage. Both of its documents are below, exactly as they are kept.",
  "## The puzzle",
  "Six layers, a ladder of four stages, six payouts and two multipliers. Read it beside the [puzzle object](/reference/puzzle).",
  fence("paths.puzzle.json", pathsPuzzle),
  "## Its skin in the space theme",
  "A drawing for each of the eight kinds and the three other pieces, its cues, its motion and its words. Read it beside the [skin object](/reference/skin).",
  fence("paths.skin.json", pathsSkin),
].join("\n\n");

/** A page of prose, before its area is known. */
type Prose = Omit<ApiPage, "area">;
const inArea = (area: ProseArea, title: string, pages: readonly Prose[]): ApiGroup => ({ title, pages: pages.map((p) => ({ area, ...p })) });

/** The Guides area: how to write a puzzle, read in order. */
export const GUIDE_GROUPS: readonly ApiGroup[] = [
  inArea("guides", "Start here", [
    { slug: "", title: "Getting started", lede: "A puzzle starts as seven lines and grows a rung at a time. This is how the API is laid out, what a finished puzzle is made of, and where to start.", source: overview },
    { slug: "quickstart", title: "Quickstart", lede: "A whole puzzle in seven lines, a round played in three calls, and a look at everything those lines stood for.", source: quickstart },
  ]),
  inArea("guides", "Climb", [
    { slug: "tune", title: "Tune", lede: "Every number that tunes a puzzle and everything that pays, written as data. No function yet.", source: tune },
    { slug: "own-rule", title: "Write a rule", lede: "A part of your own for the rule no stock part gives: an event, a hook or two, and how it sits beside the others.", source: ownRule },
    { slug: "depth", title: "Add depth", lede: "The stages a player unlocks, and tasks, gauges, pieces that change, ticks, terrain and maps, one key at a time.", source: depth },
    { slug: "seats", title: "Seat more players", lede: "Sides, turns, phases and hidden hands, the seats the engine plays itself, and the way out for a puzzle that fits nothing.", source: seats },
    { slug: "write-a-puzzle", title: "The whole thing", lede: "The same small puzzle with every key and every hook written by hand: what every rung below expands to. Ten short steps.", source: write },
    { slug: "ship", title: "Ship it", lede: "What a puzzle needs to play, what the game asks before it deals one to players, and what promotion changes.", source: ship },
  ]),
  inArea("guides", "Rules", [
    { slug: "rules", title: "Writing rules", lede: "The one file of code in a puzzle: what it exports, the loop that runs it, and what it must never do.", source: rules },
  ]),
  inArea("guides", "Examples", [{ slug: "paths", title: "Paths, in full", lede: "A whole puzzle and its skin, to read beside the reference.", source: paths }]),
];

/** The front page of the Reference area. The reference's own pages follow it in the side list. */
export const REFERENCE_INTRO: ApiPage = {
  area: "reference",
  slug: "",
  title: "Reference",
  lede: "Every key of the puzzle, skin and theme documents, and every hook, view and context of the rules SDK: what each one is, and how to read its page.",
  source: reference,
};

/** Every page of prose, in both areas. */
export const API_PAGES: readonly ApiPage[] = [...GUIDE_GROUPS.flatMap((g) => g.pages), REFERENCE_INTRO];

export const apiPath = (page: Pick<ApiPage, "area" | "slug">): string => (page.slug === "" ? `/${page.area}` : `/${page.area}/${page.slug}`);

/** The page of prose at a path, if there is one. */
export const apiPageAt = (path: string): ApiPage | undefined => API_PAGES.find((p) => apiPath(p) === path);

export interface ApiContent {
  readonly page: ApiPage;
  readonly tokens: readonly Token[];
  readonly headings: readonly Heading[];
}

const cache = new Map<string, ApiContent>();

/** A page of prose, lexed, by its path. */
export function apiContent(path: string): ApiContent | undefined {
  const page = apiPageAt(path);
  if (!page) return undefined;
  let hit = cache.get(path);
  if (!hit) {
    const tokens = lex(page.source);
    hit = { page, tokens, headings: withIds(tokens) };
    cache.set(path, hit);
  }
  return hit;
}
