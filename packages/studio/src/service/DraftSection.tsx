import { useEffect, useState } from "react";
import type { Draft, TesterLink } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { linkAddress } from "./client.js";

/**
 * The tuning panel's word on where the draft is kept (ADR 0045). Signed out or with no service it
 * says nothing: the address is the draft, as it always was. For the signed-in owner it says that
 * the draft is saved, or that the page is on an address's numbers and which of the two to keep,
 * and it is where a draft is saved as a pull request (ADR 0046) and where it is discarded.
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

  const { draft, status, canSave } = store;
  return (
    <section className="tune-draft tune-store" data-testid="draft-store" data-state="stored" data-status={status} data-draft={draft?.id ?? ""} data-revision={draft?.revision ?? 0}>
      <span className="stat-label">{t("studio.draft")}</span>
      <p className="muted small" role="status" data-testid="draft-status">
        {status === "held" ? t("studio.draft_held") : status === "saving" ? t("studio.draft_saving") : draft ? t("studio.draft_saved") : t("studio.draft_none")}
      </p>
      {draft && canSave && <SaveRows draft={draft} settled={status === "saved"} />}
      {draft && (
        <div className="tune-actions">
          {confirming ? (
            <>
              <span className="small">{draft.save.pull ? t("studio.draft_discard_confirm_pull") : t("studio.draft_discard_confirm")}</span>
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
            <button type="button" className="btn btn-mini" disabled={status === "saving" || draft.save.state === "saving"} onClick={() => setConfirming(true)} data-testid="draft-discard">
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

/**
 * Save, for a draft the service keeps (ADR 0046): a name for the tester link, the button, and
 * how the draft stands with its pull request: being written, refused and why, open and whether
 * it holds what is on the page, and whether main has moved under it.
 */
function SaveRows({ draft, settled }: { draft: Draft; settled: boolean }) {
  const { saveDraft, updateDraft, refusals, changes } = useFrame();
  const [name, setName] = useState("");
  const [link, setLink] = useState<TesterLink | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(id);
  }, [note]);
  const { save } = draft;
  const writing = save.state === "saving";
  const current = save.pull !== null && save.savedRevision === draft.revision;
  // With no pull request yet, a draft that changes no number has nothing for one to hold.
  const nothing = save.pull === null && changes.length === 0;
  const start = async (): Promise<void> => {
    const made = await saveDraft(name.trim() || t("studio.save_default_name", { revision: draft.revision }));
    if (!made) return setNote(t("studio.links_failed"));
    setLink(made);
    setName("");
  };
  const copy = (id: string): void =>
    void navigator.clipboard.writeText(linkAddress(id)).then(
      () => setNote(t("studio.copied")),
      () => setNote(t("studio.copy_failed")),
    );
  return (
    <div className="tune-save" data-testid="draft-save" data-state={save.state} data-error={save.error ?? ""} data-pull={save.pull?.number ?? ""} data-current={current ? "1" : "0"} data-behind={save.behind ? "1" : "0"}>
      <form
        className="tune-link-form"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("studio.save_name")} aria-label={t("studio.save_name")} data-testid="save-name" />
        <button type="submit" className="btn btn-mini" disabled={!settled || writing || refusals.length > 0 || nothing} data-testid="save">
          {t("studio.save")}
        </button>
      </form>
      {writing && (
        <p className="small" role="status" data-testid="save-writing">
          {t("studio.save_writing")}
        </p>
      )}
      {link && (
        <p className="small" data-testid="save-link">
          {t("studio.save_link")}{" "}
          <a href={linkAddress(link.id)} target="_blank" rel="noreferrer">
            <code>{link.id}</code>
          </a>{" "}
          <button type="button" className="tune-text-btn" onClick={() => copy(link.id)} data-testid="save-link-copy">
            {t("studio.links_copy")}
          </button>
        </p>
      )}
      {save.state === "failed" && save.error && (
        <p className="tune-refusal" role="alert" data-testid="save-failed">
          {t(`studio.save_error.${save.error}`)}
        </p>
      )}
      {save.pull && (
        <p className="small" data-testid="save-pull">
          <a href={save.pull.url} target="_blank" rel="noreferrer">
            {t("studio.save_pull", { number: save.pull.number })}
          </a>{" "}
          <span className="muted">{writing ? "" : current ? t("studio.save_pull_current") : t("studio.save_pull_stale")}</span>
        </p>
      )}
      {!save.pull && !writing && save.state !== "failed" && <p className="muted small">{nothing ? t("studio.save_nothing") : t("studio.save_note")}</p>}
      {save.behind && !writing && (
        <p className="small" data-testid="save-behind">
          {t("studio.save_behind")}{" "}
          <button type="button" className="tune-text-btn" onClick={() => void updateDraft().then((ok) => !ok && setNote(t("studio.links_failed")))} data-testid="save-update">
            {t("studio.save_update")}
          </button>
        </p>
      )}
      {note && (
        <p className="small" role="status" data-testid="save-note">
          {note}
        </p>
      )}
    </div>
  );
}
