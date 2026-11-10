import { t } from "@openseas/boards";
import { Link } from "../router.jsx";

/** Overload (prototype, ADR 0036). This is the stub the real page replaces. */
export function OverloadPractice() {
  return (
    <main className="page">
      <h1>{t("overload.title")}</h1>
      <p className="muted">{t("overload.how_to")}</p>
      <Link to="/" className="btn btn-ghost">
        {t("app.back")}
      </Link>
    </main>
  );
}
