import { useState, type FormEvent } from "react";
import { content, t, usePirate } from "@openseas/boards";

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

      <p className="status" data-testid="shell-note">
        {t("home.shell_note")}
      </p>

      <footer className="colophon">{t("app.footer")}</footer>
    </main>
  );
}
