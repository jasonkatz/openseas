import { t } from "@openseas/boards";
import { Link } from "../router.jsx";

/** Cutting (prototype, ADR 0036). This is the stub the real page replaces. */
export function CuttingPractice() {
  return (
    <main className="page">
      <h1>{t("cutting.title")}</h1>
      <p className="muted">{t("cutting.how_to")}</p>
      <Link to="/" className="btn btn-ghost">
        {t("app.back")}
      </Link>
    </main>
  );
}
