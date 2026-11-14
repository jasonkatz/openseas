import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem, ChatModel, ChatState } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { answerChat, fetchChat, revertChat, sendChat, stopChat } from "./client.js";

const MODELS: readonly ChatModel[] = ["sonnet", "haiku", "opus"];
const MODEL_KEY = "openseas.studio.model";
/** How often a running turn is asked after. */
const WATCH_MS = 1200;

function readModel(): ChatModel {
  try {
    const kept = window.localStorage.getItem(MODEL_KEY);
    return MODELS.includes(kept as ChatModel) ? (kept as ChatModel) : "sonnet";
  } catch {
    return "sonnet";
  }
}
const money = (usd: number): string => t("studio.chat.money", { amount: usd.toFixed(2) });

/**
 * The chat (DESIGN.md 3.14, ADR 0047): an agent on the draft's own copy of the repository. It is
 * the signed-in owner's, on a draft the service keeps, and is not shown otherwise. Each message
 * carries what the page knows and the service does not: what the build refuses of the draft's
 * numbers, and how the last rounds went. The agent's replies are shown as it wrote them, the one
 * text in the studio that does not come from the message table; its work is a line a step.
 */
export function ChatPanel() {
  const frame = useFrame();
  const { store, ensureDraft, adoptDraft, refusals, rounds } = frame;
  const stored = store.state === "stored" ? store : null;
  const draftId = stored?.draft?.id ?? null;
  const [chat, setChat] = useState<ChatState | null>(null);
  const [text, setText] = useState("");
  const [model, setModel] = useState<ChatModel>(readModel);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (id: string): Promise<void> => {
      const state = await fetchChat(id);
      if (!state) return;
      setChat(state);
      // The agent's tool moves the draft's numbers on the service; the controls and the board follow.
      adoptDraft(state.draft);
    },
    [adoptDraft],
  );
  useEffect(() => {
    setChat(null);
    if (draftId) void load(draftId);
  }, [draftId, load]);
  const running = chat?.running ?? false;
  useEffect(() => {
    if (!draftId || !running) return;
    const id = window.setInterval(() => void load(draftId), WATCH_MS);
    return () => window.clearInterval(id);
  }, [draftId, running, load]);
  const shown = chat?.items.length ?? 0;
  useEffect(() => {
    // Braces on purpose: in a current browser this returns a promise, which an effect must not hand back as its cleanup.
    end.current?.scrollIntoView({ block: "end" });
  }, [shown]);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 8000);
    return () => window.clearTimeout(id);
  }, [note]);

  if (!stored?.canChat) return null;

  const send = async (): Promise<void> => {
    const words = text.trim();
    if (!words) return;
    setSending(true);
    // The chat is a draft's: one is opened for it if the page has none, with whatever numbers are on the page.
    const draft = stored.draft ?? (await ensureDraft());
    const sent = draft ? await sendChat(draft.id, { text: words, model, rounds: [...rounds], refusals: refusals.map((r) => `${r.key}: ${r.message}`).slice(0, 16) }) : "failed";
    setSending(false);
    if (sent !== "sent") return setNote(t(`studio.chat.${sent}`));
    setText("");
    if (draft) await load(draft.id);
  };
  const act = (work: Promise<boolean>): void =>
    void work.then(async (ok) => {
      if (!ok) setNote(t("studio.links_failed"));
      if (draftId) await load(draftId);
    });
  const capped = chat !== null && chat.cap.spentUsd >= chat.cap.capUsd;

  return (
    <section className="chat" data-testid="chat" data-running={running ? "1" : "0"} aria-label={t("studio.chat.title")}>
      <header className="chat-head">
        <span className="stat-label">{t("studio.chat.title")}</span>
        {chat && (
          <span className="muted small" data-testid="chat-spend">
            {t("studio.chat.spend", { draft: money(chat.spentUsd), all: money(chat.cap.spentUsd), cap: money(chat.cap.capUsd) })}
          </span>
        )}
      </header>
      <div className="chat-log" data-testid="chat-log">
        {shown === 0 && <p className="muted small">{t("studio.chat.empty")}</p>}
        {chat?.items.map((item) => (
          <Item key={item.id} item={item} running={running} onRevert={(turn) => draftId && act(revertChat(draftId, turn))} onAnswer={(id, allow) => draftId && act(answerChat(draftId, id, allow))} />
        ))}
        {running && (
          <p className="chat-working small" role="status" data-testid="chat-working">
            {t("studio.chat.working")}
          </p>
        )}
        <div ref={end} />
      </div>
      {capped && (
        <p className="tune-refusal" role="alert" data-testid="chat-capped">
          {t("studio.chat.capped")}
        </p>
      )}
      {note && (
        <p className="small" role="status" data-testid="chat-note">
          {note}
        </p>
      )}
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          maxLength={8000}
          placeholder={running ? t("studio.chat.steer_placeholder") : t("studio.chat.placeholder")}
          aria-label={t("studio.chat.message")}
          data-testid="chat-input"
        />
        <div className="chat-actions">
          <label className="chat-model">
            <span className="muted small">{t("studio.chat.model")}</span>
            <select
              value={model}
              onChange={(e) => {
                const next = e.target.value as ChatModel;
                setModel(next);
                try {
                  window.localStorage.setItem(MODEL_KEY, next);
                } catch {
                  /* private mode */
                }
              }}
              data-testid="chat-model"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {t(`studio.chat.model.${m}`)}
                </option>
              ))}
            </select>
          </label>
          {running && (
            <button type="button" className="btn btn-mini" onClick={() => draftId && act(stopChat(draftId))} data-testid="chat-stop">
              {t("studio.chat.stop")}
            </button>
          )}
          {/* While a number is still on its way to the service, a message would carry the old ones. */}
          <button type="submit" className="btn btn-mini" disabled={sending || text.trim() === "" || stored.status !== "saved" || (capped && !running)} data-testid="chat-send">
            {running ? t("studio.chat.steer") : t("studio.chat.send")}
          </button>
        </div>
      </form>
    </section>
  );
}

function Item({ item, running, onRevert, onAnswer }: { item: ChatItem; running: boolean; onRevert(turn: number): void; onAnswer(id: number, allow: boolean): void }) {
  if (item.kind === "user")
    return (
      <div className="chat-user" data-testid="chat-user" data-steer={item.steer ? "1" : "0"}>
        <span className="muted small">{item.steer ? t("studio.chat.steered") : t(`studio.chat.model.${item.model}`)}</span>
        <p>{item.text}</p>
      </div>
    );
  // The agent's own words: the one exception to the message table (ADR 0042), shown whole.
  if (item.kind === "reply")
    return (
      <div className="chat-reply" data-testid="chat-reply">
        {item.text}
      </div>
    );
  if (item.kind === "step")
    return (
      <details className={`chat-step ${item.failed ? "is-failed" : ""}`} data-testid="chat-step" data-failed={item.failed ? "1" : "0"}>
        <summary>
          <code>{item.tool}</code> <span className="mono">{item.summary}</span>
        </summary>
        <pre>{item.detail ?? t("studio.chat.step_running")}</pre>
      </details>
    );
  if (item.kind === "ask")
    return (
      <div className="chat-ask" data-testid="chat-ask" data-state={item.state}>
        <p className="small">
          {t(`studio.chat.ask_${item.state}`)} <code>{item.path}</code>
        </p>
        {item.state === "pending" && (
          <div className="tune-actions">
            <button type="button" className="btn btn-mini" onClick={() => onAnswer(item.id, true)} data-testid="chat-allow">
              {t("studio.chat.allow")}
            </button>
            <button type="button" className="btn btn-mini" onClick={() => onAnswer(item.id, false)} data-testid="chat-refuse">
              {t("studio.chat.refuse")}
            </button>
          </div>
        )}
      </div>
    );
  return (
    <div className="chat-turn" data-testid="chat-turn" data-status={item.status} data-turn={item.turn} data-reverted={item.reverted ? "1" : "0"}>
      <span className="muted small">
        {t(`studio.chat.turn_${item.status}`)} {money(item.costUsd)}
        {item.commit && ` · ${item.reverted ? t("studio.chat.reverted") : t("studio.chat.committed")}`}
      </span>
      {item.commit && !item.reverted && (
        <button type="button" className="tune-text-btn" disabled={running} onClick={() => onRevert(item.turn)} data-testid="chat-revert">
          {t("studio.chat.revert")}
        </button>
      )}
    </div>
  );
}
