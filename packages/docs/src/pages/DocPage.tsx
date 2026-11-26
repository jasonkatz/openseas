import { useEffect, useState, type ReactNode } from "react";
import type { Token } from "marked";
import { t } from "../content.js";
import { FIGURES } from "../figures/index.js";
import { Line, Markdown, type Resolve } from "../md/Markdown.jsx";
import type { Heading } from "../md/parse.js";
import { Link } from "../router.jsx";
import { Pager } from "../Shell.jsx";
import type { Area, NavItem } from "../site.js";

/** Sets the tab's title while a page is shown. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title === "" ? t("docs.brand") : `${title} · ${t("docs.brand")}`;
  }, [title]);
}

/** Which of a page's headings the reader is at: the last one that has passed the top of the window. */
function useActive(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(" ");
  useEffect(() => {
    const read = (): void => {
      let at: string | undefined = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) at = id;
      }
      setActive(at);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/** The list of a page's headings, beside it on a wide screen and folded above it on a narrow one. */
export function Contents({ headings, as }: { headings: readonly Heading[]; as: "fold" | "side" }) {
  const shown = headings.filter((h) => h.depth <= 3);
  const top = Math.min(...shown.map((h) => h.depth));
  const active = useActive(as === "side" ? shown.map((h) => h.id) : []);
  if (shown.length < 2) return as === "side" ? <div className="toc" /> : null;
  const list = (
    <ul>
      {shown.map((h) => (
        <li key={h.id} className={h.depth > top ? "sub" : undefined}>
          <a href={`#${h.id}`} aria-current={h.id === active ? "location" : undefined}>
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
  if (as === "fold") {
    return (
      <details className="toc-fold">
        <summary>{t("docs.jump")}</summary>
        {list}
      </details>
    );
  }
  return (
    <nav className="toc" aria-label={t("docs.jump")} data-testid="toc">
      <h2>{t("docs.jump")}</h2>
      {list}
    </nav>
  );
}

/** A card that leads to another page: used wherever a page lists the pages after it. */
export function PageCards({ items }: { items: readonly (NavItem & { lede: string })[] }) {
  return (
    <ul className="page-cards">
      {items.map((item) => (
        <li key={item.path}>
          <Link to={item.path} className="page-card">
            <b>{item.title}</b>
            <span><Line text={item.lede} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface DocProps {
  readonly area: Area;
  readonly path: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly figure?: string | undefined;
  readonly tokens: readonly Token[];
  readonly headings: readonly Heading[];
  readonly resolve?: Resolve | undefined;
  /** What follows the prose: a section's list of its other pages. */
  readonly after?: ReactNode;
  readonly testid: string;
}

/** A page of prose in the domain or the API section: its title, its lede, the prose, and what to read next. */
export function DocPage({ area, path, eyebrow, title, lede, figure, tokens, headings, resolve, after, testid }: DocProps) {
  useTitle(title);
  const Figure = figure ? FIGURES[figure] : undefined;
  return (
    <div className="doc" data-testid={testid}>
      <article className="prose">
        <header className="doc-head">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="lede"><Line text={lede} resolve={resolve} /></p>
        </header>
        <Contents headings={headings} as="fold" />
        {Figure && <Figure />}
        <Markdown tokens={tokens} resolve={resolve} />
        {after}
        <Pager area={area} path={path} />
      </article>
      <Contents headings={headings} as="side" />
    </div>
  );
}
