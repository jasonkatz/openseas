import { useEffect } from "react";
import { PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { apiPageAt, apiPath } from "./api/pages.js";
import { rootOf } from "./api/schema/index.js";
import { SDK_TYPES_PATH, sdkRootOf } from "./api/sdk/index.js";
import { t } from "./content.js";
import { DOMAIN_PAGES, GLOSSARY_SLUG } from "./domain/pages.js";
import { ApiPage } from "./pages/Api.jsx";
import { useTitle } from "./pages/DocPage.jsx";
import { DomainPage, GlossaryPage } from "./pages/Domain.jsx";
import { GuidePage } from "./pages/GuidePage.jsx";
import { Puzzles } from "./pages/Puzzles.jsx";
import { Landing } from "./pages/Landing.jsx";
import { RootRefPage, TypesPage } from "./pages/Reference.jsx";
import { SdkRootPage, SdkTypesPage } from "./pages/Sdk.jsx";
import { Link, Router, useRoute } from "./router.jsx";
import { Shell } from "./Shell.jsx";
import { movedTo } from "./site.js";

const isPuzzle = (id: string): id is PuzzleId => (PUZZLE_IDS as readonly string[]).includes(id);

function NotFound() {
  useTitle(t("docs.not_found_title"));
  return (
    <div className="lost">
      <h1>{t("docs.not_found_title")}</h1>
      <p className="muted" data-testid="not-found">{t("docs.not_found")}</p>
      <Link to="/" className="button">{t("docs.home_link")}</Link>
    </div>
  );
}

/** A guide used to live at `/<id>`: an old link is sent on to `/puzzles/<id>`. */
function Moved({ to }: { to: string }) {
  const { navigate } = useRoute();
  useEffect(() => navigate(to + window.location.hash, { replace: true }), [to, navigate]);
  return null;
}

/**
 * The site's pages: the front page at `/`, the domain at `/domain/<page>`, the guides at
 * `/guides/<page>`, the reference at `/reference` with one page an object at `/reference/<object>`,
 * and a page for each puzzle at `/puzzles/<id>`. Old addresses are sent on by `movedTo`.
 */
function Pages() {
  const { path } = useRoute();
  const moved = movedTo(path);
  if (moved) return <Moved to={moved} />;
  const [area = "", slug = "", sub = "", ...rest] = path.replace(/^\/+|\/+$/g, "").split("/");
  if (rest.length > 0 || sub !== "") return <NotFound />;
  if (area === "") return <Landing />;
  if (area === "domain") {
    if (slug === GLOSSARY_SLUG) return <GlossaryPage />;
    if (DOMAIN_PAGES.some((p) => p.slug === slug)) return <DomainPage key={slug} slug={slug} />;
  }
  if (area === "reference") {
    // The reference: one page for each top-level object, with every object inside it a section of that page.
    const root = rootOf(slug);
    if (root) return <RootRefPage key={slug} root={root} />;
    if (slug === "types") return <TypesPage />;
    // The rules SDK: the rules object, a view and a context, each one page with a section for every hook or member.
    const sdk = sdkRootOf(slug);
    if (sdk) return <SdkRootPage key={slug} root={sdk} />;
    if (`/reference/${slug}` === SDK_TYPES_PATH) return <SdkTypesPage />;
  }
  const prose = apiPageAt(path.replace(/\/+$/, ""));
  if (prose) return <ApiPage key={apiPath(prose)} path={apiPath(prose)} />;
  if (area === "puzzles") {
    if (slug === "") return <Puzzles />;
    if (isPuzzle(slug)) return <GuidePage key={slug} id={slug} />;
  }
  return <NotFound />;
}

export function App() {
  return (
    <Router>
      <Shell>
        <Pages />
      </Shell>
    </Router>
  );
}
