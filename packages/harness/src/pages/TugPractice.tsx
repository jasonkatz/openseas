import { t } from "@openseas/boards";
import { Link } from "../router.jsx";

/** Tug (prototype, ADR 0036). This is the stub the real page replaces. */
export function TugPractice() {
  return (
    <main className="page">
      <h1>{t("tug.title")}</h1>
      <p className="muted">{t("tug.how_to")}</p>
      <Link to="/" className="btn btn-ghost">
        {t("app.back")}
      </Link>
    </main>
  );
}
