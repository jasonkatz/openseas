import { useEffect, useState } from "react";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";

/**
 * The tuning panel's word on where the draft is kept (ADR 0045). Signed out or with no service it
 * says nothing: the address is the draft, as it always was. For the signed-in owner it says that
 * the draft is saved, or that the page is on an address's numbers and which of the two to keep,
 * and it is where a draft is discarded.
 */
export function DraftSection() {
  const { store, keepDraft, openDraft, discardDraft } = useFrame();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed) return;
    const id = window.setTimeout(() => setFailed(false), 6000);
    return () => window.clearTimeout(id);
  }, [failed]);
  if (store.state !== "address" && store.state !== "stored") return null;

  if (store.state === "address") {
    const why = store.why === "link" ? (store.stored ? "link" : "link_none") : store.why;
    return (
      <section className="tune-draft tune-store is-address" data-testid="draft-store" data-state="address" data-why={store.why}>
        <span className="stat-label">{t("studio.draft")}</span>
        <p className="small" role="status">
          {t(`studio.draft_address_${why}`)}
        </p>
        <div className="tune-actions">
          <button type="button" className="btn btn-mini" disabled={store.busy || !store.keepable} onClick={() => void keepDraft().then((ok) => setFailed(!ok))} data-testid="draft-keep">
            {store.stored ? t("studio.draft_replace") : t("studio.draft_keep")}
          </button>
          {store.stored && (
            <button type="button" className="btn btn-mini" disabled={store.busy} onClick={openDraft} data-testid="draft-open">
              {t("studio.draft_open")}
            </button>
          )}
        </div>
        {!store.keepable && <p className="muted small">{t("studio.draft_held")}</p>}
        {failed && (
          <p className="small" role="status" data-testid="draft-failed">
            {t("studio.links_failed")}
          </p>
        )}
      </section>
    );
  }

  const { draft, status } = store;
  return (
    <section className="tune-draft tune-store" data-testid="draft-store" data-state="stored" data-status={status} data-draft={draft?.id ?? ""} data-revision={draft?.revision ?? 0}>
      <span className="stat-label">{t("studio.draft")}</span>
      <p className="muted small" role="status" data-testid="draft-status">
        {status === "held" ? t("studio.draft_held") : status === "saving" ? t("studio.draft_saving") : draft ? t("studio.draft_saved") : t("studio.draft_none")}
      </p>
      {draft && (
        <div className="tune-actions">
          {confirming ? (
            <>
              <span className="small">{t("studio.draft_discard_confirm")}</span>
              <button
                type="button"
                className="btn btn-mini"
                onClick={() => {
                  setConfirming(false);
                  void discardDraft().then((ok) => setFailed(!ok));
                }}
                data-testid="draft-discard-yes"
              >
                {t("studio.draft_discard_yes")}
              </button>
              <button type="button" className="btn btn-mini" onClick={() => setConfirming(false)} data-testid="draft-discard-no">
                {t("studio.draft_discard_no")}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-mini" disabled={status === "saving"} onClick={() => setConfirming(true)} data-testid="draft-discard">
              {t("studio.draft_discard")}
            </button>
          )}
        </div>
      )}
      {failed && (
        <p className="small" role="status" data-testid="draft-failed">
          {t("studio.links_failed")}
        </p>
      )}
    </section>
  );
}
