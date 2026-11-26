import { t } from "../content.js";
import { API_GROUPS, API_PAGES, apiContent, apiPath } from "../api/pages.js";
import { DocPage, PageCards } from "./DocPage.jsx";

/** One page of the API section. */
export function ApiPage({ slug }: { slug: string }) {
  const content = apiContent(slug);
  if (!content) return null;
  const { page } = content;
  const group = API_GROUPS.find((g) => g.pages.includes(page))!;
  const first = slug === "";
  return (
    <DocPage
      area="api"
      path={apiPath(slug)}
      eyebrow={first ? t("docs.area.api") : `${t("docs.area.api")} · ${group.title}`}
      title={page.title}
      lede={page.lede}
      tokens={content.tokens}
      headings={content.headings}
      testid={`api-${slug || "index"}`}
      after={
        first && (
          <section className="read-on">
            <h2>{t("docs.read_on")}</h2>
            <PageCards items={API_PAGES.filter((p) => p.slug !== "").map((p) => ({ path: apiPath(p.slug), title: p.title, lede: p.lede }))} />
          </section>
        )
      }
    />
  );
}
