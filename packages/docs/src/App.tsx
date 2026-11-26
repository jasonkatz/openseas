import { useEffect } from "react";
import { PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { API_PAGES } from "./api/pages.js";
import { pageOf, rootOf } from "./api/schema/index.js";
import { SDK_TYPES_PATH, memberPageOf, sdkRootOf } from "./api/sdk/index.js";
import { t } from "./content.js";
import { DOMAIN_PAGES, GLOSSARY_SLUG } from "./domain/pages.js";
import { ApiPage } from "./pages/Api.jsx";
import { useTitle } from "./pages/DocPage.jsx";
import { DomainPage, GlossaryPage } from "./pages/Domain.jsx";
import { GuidePage } from "./pages/GuidePage.jsx";
import { Guides } from "./pages/Guides.jsx";
import { Landing } from "./pages/Landing.jsx";
import { ObjectRefPage, RootRefPage, TypesPage } from "./pages/Reference.jsx";
import { SdkMemberPage, SdkRootPage, SdkTypesPage } from "./pages/Sdk.jsx";
import { Link, Router, useRoute } from "./router.jsx";
import { Shell } from "./Shell.jsx";
import { guidePath } from "./site.js";

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

/** A guide used to live at `/<id>`: an old link is sent on to `/guides/<id>`. */
function Moved({ to }: { to: string }) {
  const { navigate } = useRoute();
  useEffect(() => navigate(to + window.location.hash, { replace: true }), [to, navigate]);
  return null;
}

/**
 * The site's pages: the front page at `/`, the domain at `/domain/<page>`, the API at
 * `/api/<page>` with its reference at `/api/<object>/<key>`, and the puzzle guides at `/guides/<id>`.
 */
function Pages() {
  const { path } = useRoute();
  const [area = "", slug = "", sub = "", ...rest] = path.replace(/^\/+|\/+$/g, "").split("/");
  if (rest.length > 0) return <NotFound />;
  if (area === "api") {
    // The reference: a top-level object at `/api/<object>`, and each object inside it at `/api/<object>/<key>`.
    const root = rootOf(slug);
    const page = root && sub !== "" ? pageOf(slug, sub) : undefined;
    if (root && page) return <ObjectRefPage key={path} root={root} page={page} />;
    if (root && sub === "") return <RootRefPage key={slug} root={root} />;
    if (slug === "types" && sub === "") return <TypesPage />;
    // The rules SDK: the rules object, a view and a context, each with a page for every hook or member.
    const sdk = sdkRootOf(slug);
    const member = sdk && sub !== "" ? memberPageOf(slug, sub) : undefined;
    if (sdk && member) return <SdkMemberPage key={path} root={sdk} member={member} />;
    if (sdk && sub === "") return <SdkRootPage key={slug} root={sdk} />;
    if (path.replace(/\/+$/, "") === SDK_TYPES_PATH) return <SdkTypesPage />;
  }
  if (sub !== "") return <NotFound />;
  if (area === "") return <Landing />;
  if (area === "domain") {
    if (slug === GLOSSARY_SLUG) return <GlossaryPage />;
    if (DOMAIN_PAGES.some((p) => p.slug === slug)) return <DomainPage key={slug} slug={slug} />;
  }
  if (area === "api" && API_PAGES.some((p) => p.slug === slug)) return <ApiPage key={slug} slug={slug} />;
  if (area === "guides") {
    if (slug === "") return <Guides />;
    if (isPuzzle(slug)) return <GuidePage key={slug} id={slug} />;
  }
  if (slug === "" && isPuzzle(area)) return <Moved to={guidePath(area)} />;
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
