import type { AuthProvider } from "@openseas/protocol";
import { t, usePirate } from "@openseas/boards";

/** A neutral mark for a sign-in button: a link of chain, the same for every provider. */
function LinkMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </svg>
  );
}

export const providerName = (p: AuthProvider): string => t(`auth.provider_${p}`);

/** One button per provider the server offers. `verb` picks the words: link a guest, sign in, or add another. */
export function ProviderButtons({ verb, only }: { verb: "link" | "sign_in" | "also"; only?: readonly AuthProvider[] }) {
  const { providers, signInWith } = usePirate();
  const list = only ?? providers;
  if (list.length === 0) return null;
  return (
    <div className="providers">
      {list.map((p) => (
        <button key={p} className={`btn btn-provider provider-${p}`} onClick={() => void signInWith(p)} data-testid={`${verb}-${p}`}>
          <LinkMark /> {t(`auth.${verb}_with`, { provider: providerName(p) })}
        </button>
      ))}
    </div>
  );
}

/**
 * The account, in the menu (DESIGN.md 3.8): a guest is offered an upgrade in place to Discord or
 * Google, and told plainly what it keeps; a linked pirate sees what is linked and may add the other.
 */
export function AccountSection() {
  const { pirate, providers, linked, error } = usePirate();
  if (!pirate) return null;
  const more = providers.filter((p) => !linked.includes(p));
  return (
    <div className="account" data-testid="account" data-guest={pirate.guest ? "1" : "0"}>
      {pirate.guest ? (
        <>
          <p className="small">{t("auth.guest_blurb")}</p>
          {providers.length > 0 ? (
            <>
              <ProviderButtons verb="link" />
              <p className="muted small">{t("auth.link_note")}</p>
            </>
          ) : (
            <p className="muted small" data-testid="no-providers">
              {t("auth.none_configured")}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="small" data-testid="linked-with">
            {linked.length > 0 ? t("auth.linked_with", { providers: linked.map(providerName).join(" & ") }) : t("menu.linked")}
          </p>
          {more.length > 0 && <ProviderButtons verb="also" only={more} />}
        </>
      )}
      {error === "link_failed" && <p className="error small">{t("auth.link_failed")}</p>}
    </div>
  );
}
