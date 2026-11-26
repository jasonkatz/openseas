import { t } from "../content.js";
import { API_GROUPS, API_PAGES, apiContent, apiPath } from "../api/pages.js";
import { ROOTS, TYPES_PATH, rootPath } from "../api/schema/index.js";
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
            <PageCards
              items={[
                ...API_PAGES.filter((p) => p.slug === "write-a-puzzle").map((p) => ({ path: apiPath(p.slug), title: p.title, lede: p.lede })),
                ...ROOTS.map((r) => ({ path: rootPath(r.root), title: t("docs.ref.object", { name: r.root }), lede: r.lede })),
                { path: TYPES_PATH, title: t("docs.ref.types_title"), lede: t("docs.ref.types_lede") },
                ...API_PAGES.filter((p) => p.slug !== "" && p.slug !== "write-a-puzzle").map((p) => ({ path: apiPath(p.slug), title: p.title, lede: p.lede })),
              ]}
            />
          </section>
        )
      }
    />
  );
}
