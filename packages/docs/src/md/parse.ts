import { marked, type Token, type Tokens } from "marked";
import { slugger } from "./slug.js";

/** One heading of a page, for its anchors, its contents list and the search. */
export interface Heading {
  readonly id: string;
  readonly depth: number;
  readonly text: string;
}

/** A heading token after `withIds` has been over it. */
export type HeadingToken = Tokens.Heading & { id?: string };

/** Markdown to marked's tokens: the docs render tokens to React themselves, so no HTML string is ever injected. */
export function lex(source: string): Token[] {
  return marked.lexer(source, { gfm: true });
}

/** What a run of inline tokens says, with its markup dropped. */
export function plain(tokens: readonly Token[] | undefined, fallback = ""): string {
  if (!tokens) return fallback;
  return tokens
    .map((t) => {
      if (t.type === "codespan" || t.type === "escape") return (t as Tokens.Codespan).text;
      if ("tokens" in t && t.tokens) return plain(t.tokens);
      return "text" in t ? String(t.text) : "";
    })
    .join("");
}

/** Gives every heading its anchor, in order, and lists them. `make` is shared when several pages are cut from one document. */
export function withIds(tokens: readonly Token[], make: (text: string) => string = slugger()): Heading[] {
  const out: Heading[] = [];
  for (const t of tokens) {
    if (t.type !== "heading") continue;
    const h = t as HeadingToken;
    const text = plain(h.tokens, h.text);
    h.id = make(text);
    out.push({ id: h.id, depth: h.depth, text });
  }
  return out;
}

/** The prose under a heading, for the search's one line of context. */
export function firstLine(tokens: readonly Token[], from: number): string {
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "heading") return "";
    if (t.type === "paragraph") return plain((t as Tokens.Paragraph).tokens);
  }
  return "";
}
