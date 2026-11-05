import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import { SERVER_URL, content, t, usePirate } from "@openseas/boards";
import { parseRoundFile, stashRoundFile } from "../review/roundFile.js";
import { importErrorText } from "../bench/ImportPanel.jsx";
import { Link, useRoute } from "../router.jsx";

const GLYPHS: Record<PuzzleId, ReactNode> = {
  bilging: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <path d="M6 40 Q 16 30 26 40 T 46 40 T 66 40 V 64 H 0 Z" fill="#1a7f8a" opacity=".8" />
      <rect x="14" y="8" width="14" height="14" rx="3" fill="#f5d021" />
      <rect x="32" y="8" width="14" height="14" rx="3" fill="#f2f0e6" />
      <rect x="14" y="26" width="14" height="14" rx="3" fill="#3fa7f5" />
      <rect x="32" y="26" width="14" height="14" rx="3" fill="#e5355a" />
    </svg>
  ),
  sailing: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="8" y="40" width="48" height="6" rx="2" fill="#8a6136" />
      <rect x="14" y="26" width="12" height="12" rx="3" fill="#f2f0e6" />
      <rect x="28" y="26" width="12" height="12" rx="3" fill="#f5d021" />
      <rect x="28" y="12" width="12" height="12" rx="3" fill="#3fa7f5" />
      <rect x="42" y="26" width="12" height="12" rx="3" fill="none" stroke="#3fa7f5" strokeWidth="2" strokeDasharray="3 2" />
    </svg>
  ),
  carpentry: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="6" y="10" width="52" height="44" rx="4" fill="#6b4423" />
      <rect x="6" y="24" width="52" height="1.5" fill="#3a2412" opacity=".8" />
      <rect x="6" y="39" width="52" height="1.5" fill="#3a2412" opacity=".8" />
      <path d="M22 18h16v10h10v10H32v10H22z" fill="#0a0608" />
      <rect x="22" y="18" width="16" height="10" rx="1.5" fill="#c98a4b" stroke="#3a2412" />
      <rect x="22" y="28" width="10" height="10" rx="1.5" fill="#c98a4b" stroke="#3a2412" />
    </svg>
  ),
  gunnery: (
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
  navigation: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <circle cx="32" cy="32" r="26" fill="#070e1a" stroke="#d4a548" strokeWidth="2" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#5b7bb3" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="8" fill="none" stroke="#5b7bb3" strokeWidth="1.5" />
      <path d="M32 9 l2.4 4.8 5.3 .8 -3.8 3.7 .9 5.3 -4.8 -2.5 -4.8 2.5 .9 -5.3 -3.8 -3.7 5.3 -.8z" fill="#f5d021" />
      <path d="M18 40 l1.6 3.2 3.5 .5 -2.5 2.5 .6 3.5 -3.2 -1.7 -3.2 1.7 .6 -3.5 -2.5 -2.5 3.5 -.5z" fill="none" stroke="#7fd7ff" strokeWidth="1.6" />
      <circle cx="46" cy="40" r="4" fill="#ff6b5e" />
    </svg>
  ),
  battle: (
    <svg viewBox="0 0 64 64" width="56" height="56">
      <rect x="4" y="4" width="56" height="56" rx="6" fill="#0d2b45" />
      <path d="M4 20h56M4 36h56M20 4v56M36 4v56" stroke="#1f4f78" strokeWidth="1.5" />
      <path d="M14 46l6-12 6 12z" fill="#efe3c6" stroke="#d4a548" strokeWidth="1.5" />
      <path d="M50 18l-6 12-6-12z" fill="#1b1a22" stroke="#f0604d" strokeWidth="1.5" />
      <path d="M28 40h10" stroke="#f5d58a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="40" cy="40" r="3" fill="#fff3c4" />
      <path d="M46 48l4-6 4 6" fill="none" stroke="#7fd7ff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

/** The server's commit from /health, so the bench always says what it is testing against. */
function useServerCommit(): { commit: string | null; failed: boolean } {
  const [commit, setCommit] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`${SERVER_URL}/health`, { credentials: "omit" })
      .then((r) => r.json() as Promise<{ commit?: string | null }>)
      .then((h) => {
        if (alive) setCommit(h.commit ?? "unknown");
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { commit, failed };
}

export function Home() {
  const { phase, pirate, socketStatus, error, inviteRequired, createPirate } = usePirate();
  const { navigate } = useRoute();
  const server = useServerCommit();
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [signing, setSigning] = useState(false);
  // The socket only opens once there is a pirate; before that the pip would read "offline" for a
  // server that answered, so the row says what is true instead.
  const statusClass = phase !== "ready" ? "pip-wait" : socketStatus === "open" ? "pip-live" : socketStatus === "connecting" ? "pip-wait" : "pip-off";
  const statusText =
    phase === "needs-pirate" ? t("harness.home.not_signed_in") : phase !== "ready" ? t("app.status_connecting") : socketStatus === "open" ? t("app.status_live") : socketStatus === "connecting" ? t("app.status_connecting") : t("app.status_offline");

  const signIn = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSigning(true);
    await createPirate(invite.trim() || undefined);
    setSigning(false);
  };

  const openRound = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = parseRoundFile(paste);
    if (!parsed.ok) {
      setPasteError(importErrorText(parsed.error));
      return;
    }
    stashRoundFile(parsed.round);
    navigate(`/${parsed.round.puzzle}?review=1`);
  };

  return (
    <main className="page home harness-home">
      <header className="masthead">
        <p className="eyebrow">{t("harness.eyebrow")}</p>
        <h1 className="wordmark">{t("harness.title")}</h1>
        <div className="rule" aria-hidden="true" />
        <p className="muted">{t("harness.tagline")}</p>
      </header>

      <section className="card card-ink status-card" data-testid="status-card">
        <h2>{t("harness.home.status")}</h2>
        <dl className="ledger">
          <div>
            <dt>{t("harness.home.pirate")}</dt>
            <dd data-testid="status-pirate">
              {phase === "loading" && t("app.loading")}
              {phase === "offline" && t("app.offline")}
              {phase === "needs-pirate" && (
                <form onSubmit={signIn} className="stack sign-in" data-testid="sign-in">
                  <span>{t("harness.home.needs_pirate")}</span>
                  {inviteRequired && (
                    <label className="field">
                      <span>{t("home.invite_label")}</span>
                      <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t("home.invite_placeholder")} autoComplete="off" autoCapitalize="none" data-testid="sign-in-invite" />
                    </label>
                  )}
                  {error && <span className="error small">{t(`error.${error}`)}</span>}
                  <button className="btn btn-brass btn-mini" disabled={signing} type="submit" data-testid="sign-in-submit">
                    {signing ? t("home.creating") : t("home.create_button")}
                  </button>
                </form>
              )}
              {pirate && (
                <>
                  {pirate.name}
                  {pirate.guest && <small className="muted"> · {t("harness.home.guest")}</small>}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("harness.home.server")}</dt>
            <dd className="mono small">
              <span className={`pip ${statusClass}`}>
                <i aria-hidden="true" />
                {statusText}
              </span>{" "}
              {SERVER_URL || t("harness.home.server_same_origin")}
              {server.commit && ` · ${t("harness.home.server_commit", { commit: server.commit.slice(0, 7) })}`}
              {server.failed && ` · ${t("harness.home.server_unreachable")}`}
            </dd>
          </div>
          <div>
            <dt>{t("harness.home.build")}</dt>
            <dd className="mono small" data-testid="status-build">
              {t("harness.home.harness_commit", { commit: __HARNESS_COMMIT__.slice(0, 7) })} · {t("harness.home.content_version", { version: content.world.version })}
            </dd>
          </div>
        </dl>
        <p className="muted small">{t("harness.home.how")}</p>
      </section>

      <section className="practice">
        <h2 className="section-title">{t("harness.home.puzzles")}</h2>
        <ul className="practice-grid">
          {PUZZLE_IDS.map((id) => (
            <li key={id}>
              <Link to={`/${id}`} className="practice-tile live" data-testid={`tile-${id}`}>
                <span className="tile-glyph" aria-hidden="true">
                  {GLYPHS[id]}
                </span>
                <span className="tile-title">{t(`home.practice_${id}`)}</span>
                <span className="tile-blurb">{t(`home.practice_${id}_blurb`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-parchment">
        <h2>{t("harness.home.review")}</h2>
        <p>{t("harness.home.review_blurb")}</p>
        <form onSubmit={openRound} className="stack">
          <textarea
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setPasteError(null);
            }}
            rows={4}
            spellCheck={false}
            data-testid="home-review-text"
            placeholder='{"puzzle":"bilging","seed":"…","moves":[…]}'
          />
          {pasteError && (
            <p className="error" role="alert" data-testid="home-review-error">
              {pasteError}
            </p>
          )}
          <button className="btn btn-brass" type="submit" disabled={paste.trim().length === 0} data-testid="home-review-open">
            {t("harness.home.review_open")}
          </button>
        </form>
      </section>

      <footer className="colophon">{t("harness.home.footer")}</footer>
    </main>
  );
}
