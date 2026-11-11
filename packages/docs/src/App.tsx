import { PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { t } from "./content.js";
import { GuidePage } from "./pages/GuidePage.jsx";
import { Home } from "./pages/Home.jsx";
import { Link, Router, useRoute } from "./router.jsx";

/** One page per puzzle at `/<id>`, and the list of them at `/`. */
function Pages() {
  const { path } = useRoute();
  const id = path.replace(/^\/+|\/+$/g, "");
  if (id === "") return <Home />;
  if ((PUZZLE_IDS as readonly string[]).includes(id)) return <GuidePage key={id} id={id as PuzzleId} />;
  return (
    <main className="page">
      <p className="muted" data-testid="not-found">
        {t("docs.not_found")}
      </p>
      <Link to="/" className="back">
        {t("docs.all_guides")}
      </Link>
    </main>
  );
}

export function App() {
  return (
    <Router>
      <Pages />
    </Router>
  );
}
