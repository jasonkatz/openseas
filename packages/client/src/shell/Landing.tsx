import { useState, type FormEvent } from "react";
import { t, usePirate } from "@openseas/boards";
import { ProviderButtons } from "./Account.jsx";

/**
 * The only thing before the world: a title card while the guest signs in, an invite form when the
 * alpha gate is on, and a plain word when the server is out of reach. Once a pirate exists the world
 * takes over and stays until sign-out (DESIGN.md 3.8, 3.11).
 */
export function Landing() {
  const { phase, error, inviteRequired, createPirate, refresh, providers, playAsGuest } = usePirate();
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    await createPirate(invite.trim() || undefined);
    setBusy(false);
  };

  return (
    <main className="landing" data-testid="landing" data-phase={phase}>
      <div className="landing-sea" aria-hidden="true">
        <i className="wave w1" />
        <i className="wave w2" />
        <i className="wave w3" />
      </div>
      <header className="masthead">
        <p className="eyebrow">{t("world.title_eyebrow")}</p>
        <h1 className="wordmark">{t("app.title")}</h1>
        <div className="rule" aria-hidden="true" />
      </header>

      {phase === "loading" && (
        <p className="status" role="status">
          <span className="spinner" aria-hidden="true" />
          {t("app.loading")}
        </p>
      )}

      {phase === "offline" && (
        <section className="card card-parchment" role="status">
          <h2>{t("world.offline_title")}</h2>
          <p>{t("world.offline_blurb")}</p>
          <div className="stack">
            <button className="btn btn-brass" onClick={() => void refresh()} data-testid="retry">
              {t("world.retry")}
            </button>
          </div>
        </section>
      )}

      {phase === "signed-out" && (
        <section className="card card-parchment" data-testid="signed-out">
          <h2>{t("auth.signed_out_title")}</h2>
          <p>{t("auth.signed_out_blurb")}</p>
          <ProviderButtons verb="sign_in" />
          <button className="btn btn-ghost" onClick={() => void playAsGuest()} data-testid="play-as-guest">
            {t("auth.play_as_guest")}
          </button>
          {error === "link_failed" && <p className="error">{t("auth.link_failed")}</p>}
        </section>
      )}

      {phase === "needs-pirate" && (
        <section className="card card-parchment">
          <h2>{t("home.pirate_create")}</h2>
          <p>{t("world.signin_blurb")}</p>
          <form onSubmit={submit} className="stack">
            {inviteRequired && (
              <label className="field">
                <span>{t("home.invite_label")}</span>
                <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t("home.invite_placeholder")} autoComplete="off" autoCapitalize="none" data-testid="invite" />
              </label>
            )}
            {error && <p className="error">{t(`error.${error}`)}</p>}
            <button className="btn btn-brass" disabled={busy} type="submit" data-testid="enter">
              {busy ? t("world.entering") : t("world.enter")}
            </button>
          </form>
          {providers.length > 0 && (
            <div className="returning">
              <p className="muted small">{t("auth.returning")}</p>
              <ProviderButtons verb="sign_in" />
            </div>
          )}
        </section>
      )}

      {phase === "ready" && (
        <p className="status" role="status">
          <span className="spinner" aria-hidden="true" />
          {t("world.entering")}
        </p>
      )}

      <footer className="colophon">{t("app.footer")}</footer>
    </main>
  );
}
