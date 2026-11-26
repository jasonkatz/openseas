import source from "../../../../docs/puzzles/CONTEXT.md?raw";
import { slug } from "../md/slug.js";

/** One word of the domain: what it means here, and the words that mean something else. */
export interface Term {
  readonly id: string;
  readonly name: string;
  /** Its definition, as a line of Markdown. */
  readonly text: string;
  readonly avoid?: string | undefined;
}

export interface TermGroup {
  readonly id: string;
  readonly title: string;
  readonly terms: readonly Term[];
}

/** The glossary file is a list of `**Term**:` entries under `##` groups, each with an optional `_Avoid_:` line. */
function parse(text: string): TermGroup[] {
  return text
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title = "", ...rest] = block.split("\n");
      const terms: Term[] = [];
      for (const m of rest.join("\n").matchAll(/^\*\*(.+?)\*\*:\n([\s\S]*?)(?=^\*\*|(?![\s\S]))/gm)) {
        let body = m[2]!.trim();
        let avoid: string | undefined;
        const a = /^_Avoid_: (.*)$/m.exec(body);
        if (a) {
          avoid = a[1];
          body = body.slice(0, a.index).trim();
        }
        terms.push({ id: `term-${slug(m[1]!)}`, name: m[1]!, text: body.split(/\s+/).join(" "), avoid });
      }
      return { id: slug(title), title: title.trim(), terms };
    });
}

export const GLOSSARY: readonly TermGroup[] = parse(source);
export const TERM_COUNT = GLOSSARY.reduce((n, g) => n + g.terms.length, 0);
