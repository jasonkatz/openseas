import { useCallback, useEffect, useState } from "react";
import type { TesterLink, TesterLinkDraft } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { leafOverrides } from "../frame/numbers.js";
import { SERVICE_URL, createLink, linkAddress, listLinks, signInUrl, withdrawLink } from "./client.js";
import { signOut, useMe } from "./me.js";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The tuning panel's tester links (DESIGN.md 3.14): freeze the draft on the board as a link by
 * id, see this puzzle's links, withdraw one. Only the signed-in owner can; the service decides
 * who that is. With no service configured there is nothing to show, and with one that cannot be
 * reached the panel says so and everything else in the studio carries on.
 */
export function TesterLinks() {
  const { puzzle, scenario, refusals, changes } = useFrame();
  const me = useMe();
  const login = me !== "loading" && me !== null ? me.login : null;
  const [links, setLinks] = useState<TesterLink[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // The service sends a login that is not on its allowlist back here with this flag.
  const [note, setNote] = useState<string | null>(() => (new URLSearchParams(window.location.search).get("studio_sign_in") === "refused" ? t("studio.sign_in_refused") : null));

  useEffect(() => {
    setLinks([]);
    if (!login) return;
    let alive = true;
    void listLinks(puzzle.id).then((list) => alive && list && setLinks(list));
    return () => {
      alive = false;
    };
  }, [puzzle.id, login]);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(id);
  }, [note]);

  const copy = useCallback((id: string) => void copyText(linkAddress(id)).then((ok) => setNote(ok ? t("studio.copied") : t("studio.copy_failed"))), []);
  const make = async (): Promise<void> => {
    setBusy(true);
    // No refusals, so the thresholds are a content file's: the button is off otherwise.
    const draft: TesterLinkDraft = {
      seed: scenario.seed,
      overrides: leafOverrides(puzzle, scenario) as TesterLinkDraft["overrides"],
      roundSeconds: scenario.roundSeconds,
      paceSeconds: scenario.paceSeconds,
      thresholds: scenario.thresholds as TesterLinkDraft["thresholds"],
    };
    const link = await createLink({ puzzle: puzzle.id, name: name.trim(), draft });
    setBusy(false);
    if (!link) return setNote(t("studio.links_failed"));
    setLinks((l) => [link, ...l]);
    setName("");
    copy(link.id);
  };
  const withdraw = async (id: string): Promise<void> => {
    if (await withdrawLink(id)) setLinks((l) => l.filter((x) => x.id !== id));
    else setNote(t("studio.links_failed"));
  };

  if (!SERVICE_URL || me === "loading") return null;
  return (
    <section className="tune-draft" data-testid="tester-links">
      <span className="stat-label">{t("studio.links")}</span>
      {me === null && (
        <p className="muted small" data-testid="links-unreachable">
          {t("studio.links_unreachable")}
        </p>
      )}
      {me !== null && me.login === null && (
        <>
          <p className="muted small">{t("studio.links_sign_in_note")}</p>
          <div className="tune-actions">
            {me.signIn && (
              <a className="btn btn-mini" href={signInUrl("github")} data-testid="sign-in-github">
                {t("studio.sign_in_github")}
              </a>
            )}
            {me.dev && (
              <a className="btn btn-mini" href={signInUrl("dev")} data-testid="sign-in-dev">
                {t("studio.sign_in_dev")}
              </a>
            )}
            {!me.signIn && !me.dev && <span className="muted small">{t("studio.sign_in_none")}</span>}
          </div>
        </>
      )}
      {me !== null && me.login !== null && (
        <>
          <form
            className="tune-link-form"
            onSubmit={(e) => {
              e.preventDefault();
              void make();
            }}
          >
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("studio.links_name")} aria-label={t("studio.links_name")} data-testid="link-name" />
            <button type="submit" className="btn btn-mini" disabled={busy || name.trim() === "" || refusals.length > 0} data-testid="link-make">
              {t("studio.links_make")}
            </button>
          </form>
          <p className="muted small">{changes.length === 0 ? t("studio.links_shipped") : t("studio.links_frozen", { count: changes.length })}</p>
          {links.length > 0 && (
            <ul className="tune-links" data-testid="link-list">
              {links.map((l) => (
                <li key={l.id} data-testid={`link-${l.id}`}>
                  <a href={linkAddress(l.id)} target="_blank" rel="noreferrer" className="tune-link-name">
                    {l.name}
                  </a>
                  <code className="tune-unit">{l.id}</code>
                  <button type="button" className="btn btn-mini" onClick={() => copy(l.id)} data-testid={`link-copy-${l.id}`}>
                    {t("studio.links_copy")}
                  </button>
                  <button type="button" className="btn btn-mini" onClick={() => void withdraw(l.id)} data-testid={`link-withdraw-${l.id}`}>
                    {t("studio.links_withdraw")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            {t("studio.signed_in_as", { login: me.login })}{" "}
            <button
              type="button"
              className="tune-text-btn"
              onClick={() => void signOut()}
              data-testid="sign-out"
            >
              {t("studio.sign_out")}
            </button>
          </p>
        </>
      )}
      {note && (
        <p className="small" role="status" data-testid="links-note">
          {note}
        </p>
      )}
    </section>
  );
}
