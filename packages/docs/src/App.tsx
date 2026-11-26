import { useEffect } from "react";
import { PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { API_PAGES } from "./api/pages.js";
import { t } from "./content.js";
import { DOMAIN_PAGES, GLOSSARY_SLUG } from "./domain/pages.js";
import { ApiPage } from "./pages/Api.jsx";
import { useTitle } from "./pages/DocPage.jsx";
import { DomainPage, GlossaryPage } from "./pages/Domain.jsx";
import { GuidePage } from "./pages/GuidePage.jsx";
import { Guides } from "./pages/Guides.jsx";
import { Landing } from "./pages/Landing.jsx";
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
 * `/api/<page>` and the puzzle guides at `/guides/<id>`.
 */
function Pages() {
  const { path } = useRoute();
  const [area = "", slug = "", ...rest] = path.replace(/^\/+|\/+$/g, "").split("/");
  if (rest.length > 0) return <NotFound />;
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
