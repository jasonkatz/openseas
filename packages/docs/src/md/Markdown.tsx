import { Fragment, useState, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";
import { t } from "../content.js";
import { FIGURES } from "../figures/index.js";
import { Link } from "../router.jsx";
import { highlight } from "./highlight.js";
import { plain, type HeadingToken } from "./parse.js";

/** Where a link in the prose leads on this site: an anchor of the same document may live on another page. */
export type Resolve = (href: string) => string;

const CALLOUTS = ["example", "note", "preview"] as const;
type Callout = (typeof CALLOUTS)[number];

function Inline({ tokens, resolve }: { tokens: readonly Token[] | undefined; resolve: Resolve }): ReactNode {
  if (!tokens) return null;
  return tokens.map((tok, i) => {
    switch (tok.type) {
      case "strong":
        return <strong key={i}><Inline tokens={(tok as Tokens.Strong).tokens} resolve={resolve} /></strong>;
      case "em":
        return <em key={i}><Inline tokens={(tok as Tokens.Em).tokens} resolve={resolve} /></em>;
      case "codespan":
        return <code key={i}>{(tok as Tokens.Codespan).text}</code>;
      case "br":
        return <br key={i} />;
      case "link": {
        const link = tok as Tokens.Link;
        const href = resolve(link.href);
        const body = <Inline tokens={link.tokens} resolve={resolve} />;
        if (href.startsWith("/")) return <Link key={i} to={href}>{body}</Link>;
        if (href.startsWith("#")) return <a key={i} href={href}>{body}</a>;
        return <a key={i} href={href} target="_blank" rel="noreferrer">{body}</a>;
      }
      case "text": {
        const text = tok as Tokens.Text;
        return text.tokens ? <Inline key={i} tokens={text.tokens} resolve={resolve} /> : <Fragment key={i}>{text.text}</Fragment>;
      }
      case "escape":
        return <Fragment key={i}>{(tok as Tokens.Escape).text}</Fragment>;
      default:
        return <Fragment key={i}>{"raw" in tok ? tok.raw : ""}</Fragment>;
    }
  });
}

/** A code sample: coloured, scrolling sideways on its own, with a button that copies it as written. */
export function Code({ code, lang, title, tall = false }: { code: string; lang: string; title?: string | undefined; tall?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <figure className={`code ${tall ? "code-tall" : ""}`}>
      <figcaption>
        <span className="code-title">{title ?? lang}</span>
        <button type="button" className="code-copy" onClick={copy} aria-live="polite">
          {t(copied ? "docs.copied" : "docs.copy")}
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>
          {highlight(code, lang).map((s, i) => (s.tone === "plain" ? <Fragment key={i}>{s.text}</Fragment> : <span key={i} className={`tk-${s.tone}`}>{s.text}</span>))}
        </code>
      </pre>
    </figure>
  );
}

function Table({ table, resolve }: { table: Tokens.Table; resolve: Resolve }) {
  // A table whose first column is all code is a reference table: its keys never wrap.
  const keyed = table.rows.length > 0 && table.rows.every((r) => r[0]?.tokens.length === 1 && r[0].tokens[0]!.type === "codespan");
  const blankHead = table.header.every((h) => h.text.trim() === "");
  return (
    <div className="table-scroll" tabIndex={0}>
      <table className={keyed ? "keyed" : undefined}>
        {!blankHead && (
          <thead>
            <tr>
              {table.header.map((h, i) => (
                <th key={i} scope="col"><Inline tokens={h.tokens} resolve={resolve} /></th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}><Inline tokens={cell.tokens} resolve={resolve} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A quoted block is a callout. It is an example unless its first line says `[!NOTE]` or `[!PREVIEW]`. */
function Quote({ quote, resolve }: { quote: Tokens.Blockquote; resolve: Resolve }) {
  let kind: Callout = "example";
  let tokens = quote.tokens;
  const first = tokens[0];
  if (first?.type === "paragraph") {
    const m = /^\[!(\w+)\]\s*/.exec((first as Tokens.Paragraph).text);
    const named = m?.[1]?.toLowerCase() as Callout | undefined;
    if (m && named && CALLOUTS.includes(named)) {
      kind = named;
      const inner = [...((first as Tokens.Paragraph).tokens ?? [])];
      const head = inner[0];
      if (head?.type === "text") inner[0] = { ...head, text: (head as Tokens.Text).text.replace(/^\[!\w+\]\s*/, ""), tokens: undefined } as Token;
      tokens = [{ ...first, tokens: inner } as Token, ...tokens.slice(1)];
    }
  }
  return (
    <aside className={`callout callout-${kind}`}>
      <span className="callout-label">{t(`docs.callout.${kind}`)}</span>
      <Blocks tokens={tokens} resolve={resolve} />
    </aside>
  );
}

function Blocks({ tokens, resolve }: { tokens: readonly Token[]; resolve: Resolve }): ReactNode {
  return tokens.map((tok, i) => {
    switch (tok.type) {
      case "heading": {
        const h = tok as HeadingToken;
        const Tag = `h${Math.min(h.depth, 4)}` as "h2" | "h3" | "h4";
        return (
          <Tag key={i} id={h.id}>
            <Inline tokens={h.tokens} resolve={resolve} />
            {h.id && (
              <a className="anchor" href={`#${h.id}`} aria-label={t("docs.link_to", { title: plain(h.tokens, h.text) })}>
                #
              </a>
            )}
          </Tag>
        );
      }
      case "paragraph":
        return <p key={i}><Inline tokens={(tok as Tokens.Paragraph).tokens} resolve={resolve} /></p>;
      case "text": {
        const text = tok as Tokens.Text;
        return <Fragment key={i}><Inline tokens={text.tokens ?? [text]} resolve={resolve} /></Fragment>;
      }
      case "list": {
        const list = tok as Tokens.List;
        const Tag = list.ordered ? "ol" : "ul";
        return (
          <Tag key={i}>
            {list.items.map((item, j) => (
              <li key={j}><Blocks tokens={item.tokens} resolve={resolve} /></li>
            ))}
          </Tag>
        );
      }
      case "table":
        return <Table key={i} table={tok as Tokens.Table} resolve={resolve} />;
      case "blockquote":
        return <Quote key={i} quote={tok as Tokens.Blockquote} resolve={resolve} />;
      case "code": {
        const code = tok as Tokens.Code;
        const [lang = "", ...rest] = (code.lang ?? "").split(/\s+/);
        const title = /title=(\S+)/.exec(rest.join(" "))?.[1];
        const tall = rest.includes("tall");
        return <Code key={i} code={code.text} lang={lang} title={title} tall={tall} />;
      }
      case "html": {
        // The one piece of HTML the docs read: a comment that places a figure.
        const name = /^<!--\s*figure:\s*([a-z-]+)\s*-->/.exec((tok as Tokens.HTML).text)?.[1];
        const Figure = name ? FIGURES[name] : undefined;
        return Figure ? <Figure key={i} /> : null;
      }
      case "hr":
        return <hr key={i} />;
      default:
        return null;
    }
  });
}

/** A page of prose, from tokens. */
export function Markdown({ tokens, resolve = (href) => href }: { tokens: readonly Token[]; resolve?: Resolve | undefined }) {
  return <Blocks tokens={tokens} resolve={resolve} />;
}

/** One line of prose with inline markup: a lede, a card's blurb. */
export function Line({ text, resolve = (href) => href }: { text: string; resolve?: Resolve | undefined }) {
  return <Inline tokens={inlineOf(text)} resolve={resolve} />;
}

const inlineCache = new Map<string, Token[]>();
function inlineOf(text: string): Token[] {
  let hit = inlineCache.get(text);
  if (!hit) {
    hit = marked.Lexer.lexInline(text);
    inlineCache.set(text, hit);
  }
  return hit;
}
