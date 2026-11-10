import { t } from "@openseas/boards";
import { Link } from "../router.jsx";

/** Racks (prototype, ADR 0036). This is the stub the real page replaces. */
export function RacksPractice() {
  return (
    <main className="page">
      <h1>{t("racks.title")}</h1>
      <p className="muted">{t("racks.how_to")}</p>
      <Link to="/" className="btn btn-ghost">
        {t("app.back")}
      </Link>
    </main>
  );
}
