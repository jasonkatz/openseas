import { useEffect, useState } from "react";
import { lookCount, wordCount, type Draft, type TesterLink } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { Menu, MenuButton, useMenu } from "../studio/Menu.jsx";
import { linkAddress } from "./client.js";

/** A note that the service did not answer, gone after a moment. */
function useFailed(): [boolean, (failed: boolean) => void] {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed) return;
    const id = window.setTimeout(() => setFailed(false), 6000);
    return () => window.clearTimeout(id);
  }, [failed]);
  return [failed, setFailed];
}

/**
 * The band under the studio's top bar while the page is on an address's numbers and not on the
 * owner's draft (ADR 0045): nothing here is saved until the owner says which of the two to keep.
 */
export function DraftBanner() {
  const { store, keepDraft, openDraft } = useFrame();
  const [failed, setFailed] = useFailed();
  if (store.state !== "address") return null;
  const why = store.why === "link" ? (store.stored ? "link" : "link_none") : store.why;
  return (
    <section className="draft-banner" data-testid="draft-store" data-state="address" data-why={store.why}>
      <span className="stat-label">{t("studio.draft")}</span>
      <p className="small" role="status">
        {t(`studio.draft_address_${why}`)} {!store.keepable && t("studio.draft_held")}
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
      {failed && (
        <p className="small" role="status" data-testid="draft-failed">
          {t("studio.links_failed")}
        </p>
      )}
    </section>
  );
}

/**
 * The top bar's word on the draft the service keeps (ADR 0045): saved, saving, or holding a value
 * the service has no shape for. Signed out or with no service it says nothing: the address is the
 * draft, as it always was.
 */
export function DraftStatus() {
  const { store } = useFrame();
  if (store.state !== "stored") return null;
  const { draft, status } = store;
  return (
    <span className="draft-status" data-testid="draft-store" data-state="stored" data-status={status} data-draft={draft?.id ?? ""} data-revision={draft?.revision ?? 0}>
      <i className={`status-dot ${status === "saved" ? "" : "is-busy"}`} aria-hidden="true" />
      <span role="status" data-testid="draft-status">
        {status === "held" ? t("studio.draft_held") : status === "saving" ? t("studio.draft_saving") : draft ? t("studio.draft_saved") : t("studio.draft_none")}
      </span>
    </span>
  );
}

/** Discarding the stored draft, in the Share menu: asked twice, and it says when a pull request closes with it. */
export function DraftDiscard() {
  const { store, discardDraft } = useFrame();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useFailed();
  if (store.state !== "stored" || !store.draft) return null;
  const { draft, status } = store;
  return (
    <section className="menu-sec" data-testid="draft-discard-section">
      <span className="stat-label">{t("studio.draft")}</span>
      <div className="tune-actions">
        {confirming ? (
          <>
            <span className="small" data-testid="draft-discard-confirm">
              {draft.save.pull ? t("studio.draft_discard_confirm_pull") : t("studio.draft_discard_confirm")}
            </span>
            <button
              type="button"
              className="btn btn-mini btn-danger"
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
          <button type="button" className="btn btn-mini btn-danger" disabled={status === "saving" || draft.save.state === "saving"} onClick={() => setConfirming(true)} data-testid="draft-discard">
            {t("studio.draft_discard")}
          </button>
        )}
      </div>
      {failed && (
        <p className="small" role="status" data-testid="draft-failed">
          {t("studio.links_failed")}
        </p>
      )}
    </section>
  );
}

/** Save, in the top bar, for the owner whose service can write a pull request (ADR 0046). With no draft open there is nothing to save yet. */
export function SaveControl() {
  const { store } = useFrame();
  if (store.state !== "stored" || !store.canSave) return null;
  if (!store.draft)
    return (
      <button type="button" className="btn btn-mini btn-brass" disabled data-testid="save">
        {t("studio.save")}
      </button>
    );
  return <SaveRows draft={store.draft} settled={store.status === "saved"} />;
}

/**
 * Save, for a draft the service keeps (ADR 0046): the button, and beside it the sheet that holds
 * a name for the tester link and how the draft stands with its pull request: being written,
 * refused and why, open and whether it holds what is on the page, and whether main has moved
 * under it. A press of Save opens the sheet, so what Save did is in sight; a dot on the sheet's
 * button says there is something in it to see.
 */
function SaveRows({ draft, settled }: { draft: Draft; settled: boolean }) {
  const { saveDraft, updateDraft, refusals, lookRefusals, changes } = useFrame();
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
  // With no pull request yet, a draft that changes no number or word and that the chat has not worked on has nothing for one to hold.
  const nothing = save.pull === null && changes.length === 0 && wordCount(draft.numbers) === 0 && lookCount(draft.numbers) === 0 && !save.edits;
  const menu = useMenu();
  const start = async (): Promise<void> => {
    menu.setOpen(true);
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
  const off = !settled || writing || refusals.length > 0 || lookRefusals.length > 0 || nothing;
  const attention = save.state === "failed" || (save.behind && !writing);
  return (
    <Menu
      id="save"
      menu={menu}
      align="right"
      trigger={
        <span className="split">
          <button type="button" className="btn btn-mini btn-brass" disabled={off} onClick={() => void start()} data-testid="save">
            {t("studio.save")}
          </button>
          <MenuButton id="save" menu={menu} className={`btn btn-mini btn-brass btn-sq ${attention ? "has-dot" : ""}`} aria-label={t("studio.save_details")} title={t("studio.save_details")}>
            ▾
          </MenuButton>
        </span>
      }
    >
    <div className="tune-save menu-sec" data-testid="draft-save" data-state={save.state} data-error={save.error ?? ""} data-pull={save.pull?.number ?? ""} data-current={current ? "1" : "0"} data-behind={save.behind ? "1" : "0"}>
      <span className="stat-label">{t("studio.save")}</span>
      <form
        className="tune-link-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!off) void start();
        }}
      >
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("studio.save_name")} aria-label={t("studio.save_name")} data-testid="save-name" />
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
          {t(`studio.save_error.${save.error}`, { name: save.detail ?? "" })}
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
    </Menu>
  );
}
