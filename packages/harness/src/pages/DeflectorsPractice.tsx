import { t } from "@openseas/boards";
import { Link } from "../router.jsx";

/** Deflectors (prototype, ADR 0036). This is the stub the real page replaces. */
export function DeflectorsPractice() {
  return (
    <main className="page">
      <h1>{t("deflectors.title")}</h1>
      <p className="muted">{t("deflectors.how_to")}</p>
      <Link to="/" className="btn btn-ghost">
        {t("app.back")}
      </Link>
    </main>
  );
}
