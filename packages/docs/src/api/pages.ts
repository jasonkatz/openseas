import type { Token } from "marked";
import overview from "../../content/api/overview.md?raw";
import write from "../../content/api/write-a-puzzle.md?raw";
import puzzle from "../../content/api/puzzle.md?raw";
import skin from "../../content/api/skin.md?raw";
import theme from "../../content/api/theme.md?raw";
import rules from "../../content/api/rules.md?raw";
import hooks from "../../content/api/hooks.md?raw";
import context from "../../content/api/context.md?raw";
import pathsPuzzle from "../../../../docs/puzzles/examples/paths.puzzle.json?raw";
import pathsSkin from "../../../../docs/puzzles/examples/paths.skin.json?raw";
import { lex, withIds, type Heading } from "../md/parse.js";

/**
 * The API section: one Markdown file a page, in `content/api/`. A page's title and lede are here,
 * with the order the section is read in. `test/api.test.ts` holds the reference to the shapes the
 * domain guide gives for the three documents, so a key added to one cannot be missed here.
 */
export interface ApiPage {
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
  "Six layers, a ladder of four stages, six payouts and two multipliers. Read it beside the [puzzle reference](/api/puzzle).",
  fence("paths.puzzle.json", pathsPuzzle),
  "## Its skin in the space theme",
  "A drawing for each of the eight kinds and the three other pieces, its cues, its motion and its words. Read it beside the [skin reference](/api/skin).",
  fence("paths.skin.json", pathsSkin),
].join("\n\n");

export const API_GROUPS: readonly ApiGroup[] = [
  {
    title: "Start here",
    pages: [
      { slug: "", title: "The API", lede: "Four files make a puzzle. This is what each one holds, who owns what, and how to read the reference.", source: overview },
      { slug: "write-a-puzzle", title: "Write a puzzle", lede: "One small puzzle, from an empty file to a round that plays. Ten short steps, and every part of the API in use.", source: write },
    ],
  },
  {
    title: "Documents",
    pages: [
      { slug: "puzzle", title: "The puzzle document", lede: "Every key of `<id>.puzzle.json`: the round, the board, the pieces, the deal, what goes in, what comes out and what pays.", source: puzzle },
      { slug: "skin", title: "The skin document", lede: "Every key of `<id>.skin.json`: drawings, cues, motion, what each event shows, and the words.", source: skin },
      { slug: "theme", title: "The theme document", lede: "Every key of `<theme>.theme.json`: the palette, type, the sound frame and what a new skin starts from.", source: theme },
      { slug: "paths", title: "Paths, in full", lede: "A shipped puzzle and its skin, whole, to read beside the reference.", source: paths },
    ],
  },
  {
    title: "Rules SDK",
    pages: [
      { slug: "rules", title: "Writing rules", lede: "The one file of code in a puzzle: what it exports, the loop that runs it, and what it must never do.", source: rules },
      { slug: "hooks", title: "Hooks", lede: "Every hook the loop asks, with its signature, when it is asked and what happens when it is left out.", source: hooks },
      { slug: "context", title: "Context and view", lede: "What a hook is handed: the view a question sees, the context that reports events, draws, the board and zones.", source: context },
    ],
  },
];

export const API_PAGES: readonly ApiPage[] = API_GROUPS.flatMap((g) => g.pages);

export const apiPath = (slug: string): string => (slug === "" ? "/api" : `/api/${slug}`);

export interface ApiContent {
  readonly page: ApiPage;
  readonly tokens: readonly Token[];
  readonly headings: readonly Heading[];
}

const cache = new Map<string, ApiContent>();

export function apiContent(slug: string): ApiContent | undefined {
  const page = API_PAGES.find((p) => p.slug === slug);
  if (!page) return undefined;
  let hit = cache.get(slug);
  if (!hit) {
    const tokens = lex(page.source);
    hit = { page, tokens, headings: withIds(tokens) };
    cache.set(slug, hit);
  }
  return hit;
}
