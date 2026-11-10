import { t } from "@openseas/boards";
import { Link } from "../router.jsx";

/** Reactor (prototype, ADR 0036). This is the stub the real page replaces. */
export function ReactorPractice() {
  return (
    <main className="page">
      <h1>{t("reactor.title")}</h1>
      <p className="muted">{t("reactor.how_to")}</p>
      <Link to="/" className="btn btn-ghost">
        {t("app.back")}
      </Link>
    </main>
  );
}
