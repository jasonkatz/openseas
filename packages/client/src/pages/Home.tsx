import { useState, type FormEvent, type ReactNode } from "react";
import { content, t } from "../content.js";
import { usePirate } from "../state/PirateProvider.jsx";
import { Link } from "../router.jsx";

/** Practice pages that have shipped, in milestone order. The rest stay greyed out. */
const LIVE: Array<{ id: string; glyph: ReactNode }> = [
  {
    id: "sailing",
    glyph: (
      <svg viewBox="0 0 64 64" width="56" height="56">
        <rect x="8" y="40" width="48" height="6" rx="2" fill="#8a6136" />
        <rect x="14" y="26" width="12" height="12" rx="3" fill="#f2f0e6" />
        <rect x="28" y="26" width="12" height="12" rx="3" fill="#f5d021" />
        <rect x="28" y="12" width="12" height="12" rx="3" fill="#3fa7f5" />
        <rect x="42" y="26" width="12" height="12" rx="3" fill="none" stroke="#3fa7f5" strokeWidth="2" strokeDasharray="3 2" />
      </svg>
    ),
  },
  {
    id: "carpentry",
    glyph: (
      <svg viewBox="0 0 64 64" width="56" height="56">
        <rect x="6" y="10" width="52" height="44" rx="4" fill="#6b4423" />
        <rect x="6" y="24" width="52" height="1.5" fill="#3a2412" opacity=".8" />
        <rect x="6" y="39" width="52" height="1.5" fill="#3a2412" opacity=".8" />
        <path d="M22 18h16v10h10v10H32v10H22z" fill="#0a0608" />
        <rect x="22" y="18" width="16" height="10" rx="1.5" fill="#c98a4b" stroke="#3a2412" />
        <rect x="22" y="28" width="10" height="10" rx="1.5" fill="#c98a4b" stroke="#3a2412" />
      </svg>
    ),
  },
  {
    id: "gunnery",
    glyph: (
      <svg viewBox="0 0 64 64" width="56" height="56">
        <rect x="6" y="6" width="52" height="52" rx="6" fill="#4e3419" />
        <rect x="10" y="10" width="44" height="44" rx="4" fill="#7a5533" />
        <rect x="6" y="20" width="12" height="10" rx="3" fill="#3a3f47" />
        <rect x="46" y="34" width="12" height="10" rx="3" fill="#3a3f47" />
        <circle cx="32" cy="32" r="7" fill="#5c3d21" stroke="#d4a548" strokeWidth="2" />
        <circle cx="22" cy="42" r="4" fill="#2b2b33" />
        <circle cx="40" cy="20" r="4" fill="#f2f0e6" />
        <path d="M24 24h10m0 0l-3-3m3 3l-3 3" fill="none" stroke="#f5d58a" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
  },
];
const SOON = ["navigation"];

export function Home() {
  const { phase, pirate, error, inviteRequired, createPirate } = usePirate();
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    await createPirate(invite.trim() || undefined);
    setBusy(false);
  };

  return (
    <main className="page home">
      <header className="masthead">
        <p className="eyebrow">{t("app.tagline")}</p>
        <h1 className="wordmark">{t("app.title")}</h1>
        <div className="rule" aria-hidden="true" />
      </header>

      {phase === "loading" && <p className="status">{t("app.loading")}</p>}
      {phase === "offline" && (
        <p className="status status-warn" role="status">
          {t("app.offline")}
        </p>
      )}

      {phase === "needs-pirate" && (
        <section className="card card-parchment">
          <h2>{t("home.pirate_create")}</h2>
          <p>{t("home.pirate_create_blurb")}</p>
          <form onSubmit={submit} className="stack">
            {inviteRequired && (
              <label className="field">
                <span>{t("home.invite_label")}</span>
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder={t("home.invite_placeholder")}
                  autoComplete="off"
                  autoCapitalize="none"
                />
              </label>
            )}
            {error && <p className="error">{t(`error.${error}`)}</p>}
            <button className="btn btn-brass" disabled={busy} type="submit">
              {busy ? t("home.creating") : t("home.create_button")}
            </button>
          </form>
        </section>
      )}

      {pirate && (
        <section className="card card-ink hail">
          <h2 className="hail-name">{t("home.welcome", { name: pirate.name })}</h2>
          {pirate.guest && <p className="muted small">{t("home.guest_hint")}</p>}
          <dl className="ledger">
            <div>
              <dt>{t("home.ratings_heading")}</dt>
              <dd>
                {pirate.ratings.length === 0 && <span className="muted">{t("home.no_ratings")}</span>}
                {pirate.ratings.map((r) => (
                  <span key={r.puzzle} className="tier-chip">
                    {t(`home.practice_${r.puzzle}`)} · {t(`tier.${r.tier}`)}{" "}
                    <small>{t("home.rounds", { count: r.rounds })}</small>
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt>{t("home.ships_heading")}</dt>
              <dd>
                {pirate.ships.map((s) => (
                  <span key={s.id}>
                    {s.name} <small className="muted">({t(content.world.shipClasses.find((c) => c.id === s.classId)?.nameKey ?? s.classId)})</small>
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt>{t("home.balance", { coins: pirate.balance })}</dt>
            </div>
          </dl>
        </section>
      )}

      <section className="practice">
        <h2 className="section-title">{t("home.practice_heading")}</h2>
        <ul className="practice-grid">
          <li>
            <Link to="/practice/bilging" className="practice-tile live">
              <span className="tile-glyph" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="56" height="56">
                  <path d="M6 40 Q 16 30 26 40 T 46 40 T 66 40 V 64 H 0 Z" fill="#1a7f8a" opacity=".8" />
                  <rect x="14" y="8" width="14" height="14" rx="3" fill="#f5d021" />
                  <rect x="32" y="8" width="14" height="14" rx="3" fill="#f2f0e6" />
                  <rect x="14" y="26" width="14" height="14" rx="3" fill="#3fa7f5" />
                  <rect x="32" y="26" width="14" height="14" rx="3" fill="#e5355a" />
                </svg>
              </span>
              <span className="tile-title">{t("home.practice_bilging")}</span>
              <span className="tile-blurb">{t("home.practice_bilging_blurb")}</span>
            </Link>
          </li>
          {LIVE.map((p) => (
            <li key={p.id}>
              <Link to={`/practice/${p.id}`} className="practice-tile live">
                <span className="tile-glyph" aria-hidden="true">
                  {p.glyph}
                </span>
                <span className="tile-title">{t(`home.practice_${p.id}`)}</span>
                <span className="tile-blurb">{t(`home.practice_${p.id}_blurb`)}</span>
              </Link>
            </li>
          ))}
          {SOON.map((id) => (
            <li key={id}>
              <div className="practice-tile soon" aria-disabled="true">
                <span className="tile-title">{t(`home.practice_${id}`)}</span>
                <span className="tile-blurb">{t("home.coming_soon")}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <footer className="colophon">{t("app.footer")}</footer>
    </main>
  );
}
