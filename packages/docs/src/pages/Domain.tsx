import { useMemo, useState } from "react";
import { t } from "../content.js";
import { GLOSSARY, TERM_COUNT } from "../domain/glossary.js";
import { domainAnchor, domainContent } from "../domain/guide.js";
import { DOMAIN_GROUPS, DOMAIN_PAGES, GLOSSARY_SLUG, domainPath } from "../domain/pages.js";
import { Line } from "../md/Markdown.jsx";
import { Pager } from "../Shell.jsx";
import { Contents, DocPage, PageCards, useTitle } from "./DocPage.jsx";

/** A link inside the guide names a heading of the guide: on the site that heading may be on another page. */
const resolve = (href: string): string => (href.startsWith("#") ? (domainAnchor(href.slice(1)) ?? href) : href);

/** One page of the domain section, cut from the guide. */
export function DomainPage({ slug }: { slug: string }) {
  const content = domainContent(slug);
  if (!content) return null;
  const { page } = content;
  const group = DOMAIN_GROUPS.find((g) => g.pages.includes(page))!;
  const first = slug === "";
  return (
    <DocPage
      area="domain"
      path={domainPath(slug)}
      eyebrow={first ? t("docs.area.domain") : `${t("docs.area.domain")} · ${group.title}`}
      title={page.title}
      lede={page.lede}
      figure={page.figure}
      tokens={content.tokens}
      headings={content.headings}
      resolve={resolve}
      testid={`domain-${slug || "index"}`}
      after={
        first && (
          <section className="read-on">
            <h2>{t("docs.read_on")}</h2>
            <PageCards items={DOMAIN_PAGES.filter((p) => p.slug !== "").map((p) => ({ path: domainPath(p.slug), title: p.title, lede: p.lede }))} />
          </section>
        )
      }
    />
  );
}

/** The glossary: every word of the domain in its groups, narrowed as the reader types. */
export function GlossaryPage() {
  const page = DOMAIN_PAGES.find((p) => p.slug === GLOSSARY_SLUG)!;
  useTitle(page.title);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () => GLOSSARY.map((g) => ({ ...g, terms: g.terms.filter((term) => q === "" || term.name.toLowerCase().includes(q) || term.text.toLowerCase().includes(q)) })).filter((g) => g.terms.length > 0),
    [q],
  );
  const heads = groups.map((g) => ({ id: g.id, depth: 2, text: g.title }));
  const shown = groups.reduce((n, g) => n + g.terms.length, 0);
  return (
    <div className="doc" data-testid="domain-glossary">
      <article className="prose">
        <header className="doc-head">
          <p className="eyebrow">{t("docs.area.domain")} · {DOMAIN_GROUPS.find((g) => g.pages.includes(page))!.title}</p>
          <h1>{page.title}</h1>
          <p className="lede">{page.lede} {t("docs.glossary_note")}</p>
        </header>
        <Contents headings={heads} as="fold" />
        <label className="filter">
          <span className="sr">{t("docs.glossary_filter")}</span>
          <input type="search" value={query} placeholder={t("docs.glossary_filter")} onChange={(e) => setQuery(e.target.value)} data-testid="glossary-filter" />
          <span className="filter-count" aria-live="polite">{t("docs.glossary_count", { shown, total: TERM_COUNT })}</span>
        </label>
        {groups.map((g) => (
          <section key={g.id} className="terms">
            <h2 id={g.id}>{g.title}</h2>
            <dl>
              {g.terms.map((term) => (
                <div key={term.id} id={term.id} className="term" data-testid="term">
                  <dt>{term.name}</dt>
                  <dd>
                    <Line text={term.text} />
                    {term.avoid && (
                      <span className="avoid">
                        <b>{t("docs.glossary_avoid")}</b> {term.avoid}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {groups.length === 0 && <p className="muted">{t("docs.search_none", { query: query.trim() })}</p>}
        <Pager area="domain" path={domainPath(GLOSSARY_SLUG)} />
      </article>
      <Contents headings={heads} as="side" />
    </div>
  );
}
