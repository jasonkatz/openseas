import { t } from "@openseas/boards";
import { Link } from "../router.jsx";

/** Scanner (prototype, ADR 0036). This is the stub the real page replaces. */
export function ScannerPractice() {
  return (
    <main className="page">
      <h1>{t("scanner.title")}</h1>
      <p className="muted">{t("scanner.how_to")}</p>
      <Link to="/" className="btn btn-ghost">
        {t("app.back")}
      </Link>
    </main>
  );
}
