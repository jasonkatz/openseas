import { t } from "../content.js";
import { GUIDE_GROUPS, apiContent, apiPath } from "../api/pages.js";
import { ROOTS, TYPES_PATH, rootPath } from "../api/schema/index.js";
import { SDK_ROOTS, SDK_TYPES_PATH, sdkRootPath } from "../api/sdk/index.js";
import { DocPage, PageCards } from "./DocPage.jsx";

/** Cards for every page of the reference: the three objects and their types, then the rules SDK and its types. */
const referenceCards = () => [
  ...ROOTS.map((r) => ({ path: rootPath(r.root), title: t("docs.ref.object", { name: r.root }), lede: r.lede })),
  { path: TYPES_PATH, title: t("docs.ref.types_title"), lede: t("docs.ref.types_lede") },
  ...SDK_ROOTS.map((r) => ({ path: sdkRootPath(r.root), title: r.title, lede: r.lede })),
  { path: SDK_TYPES_PATH, title: t("docs.sdk.types_title"), lede: t("docs.sdk.types_lede") },
];

/** Cards for every guide after the first. */
const guideCards = () =>
  GUIDE_GROUPS.flatMap((g) => g.pages)
    .filter((p) => p.slug !== "")
    .map((p) => ({ path: apiPath(p), title: p.title, lede: p.lede }));

/** One page of prose: a guide, or the front page of the reference. */
export function ApiPage({ path }: { path: string }) {
  const content = apiContent(path);
  if (!content) return null;
  const { page } = content;
  const areaName = t(`docs.area.${page.area}`);
  const group = GUIDE_GROUPS.find((g) => g.pages.includes(page));
  const first = page.slug === "";
  return (
    <DocPage
      area={page.area}
      path={path}
      eyebrow={first || !group ? areaName : `${areaName} · ${group.title}`}
      title={page.title}
      lede={page.lede}
      tokens={content.tokens}
      headings={content.headings}
      testid={`${page.area}-${page.slug || "index"}`}
      after={
        first && (
          <section className="read-on">
            <h2>{t("docs.read_on")}</h2>
            <PageCards items={page.area === "reference" ? referenceCards() : guideCards()} />
          </section>
        )
      }
    />
  );
}
