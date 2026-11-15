import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatEvent, ChatItem, ChatModel, ChatState } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { applyChatEvent } from "./chatState.js";
import { CHAT_PROPOSED, TAKES_CHANGED, answerChat, fetchChat, revertChat, sendChat, stopChat, watchChat } from "./client.js";

const ChatReply = lazy(() => import("./ChatReply.jsx"));

const MODELS: readonly ChatModel[] = ["sonnet", "haiku", "opus"];
const MODEL_KEY = "openseas.studio.model";
/** How long the stream may be down before the page says so and asks for the chat the slow way. A drop that mends itself sooner is not worth a word. */
const DOWN_MS = 4000;
/** How often the chat is asked for while the stream is down. */
const POLL_MS = 3000;
/** How near the end of the log counts as reading the end of it. */
const PINNED_PX = 48;

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
 * numbers, and how the last rounds went. The agent's replies are its own words, the one text in
 * the studio that does not come from the message table, read as markdown and shown as they are
 * written; its work is a line a step. The chat arrives as a stream of events (ADR 0055), and by
 * asking, the slow way, whenever the stream is down.
 */
export function ChatPanel() {
  const frame = useFrame();
  const { store, ensureDraft, adoptDraft, refusals, rounds } = frame;
  const stored = store.state === "stored" ? store : null;
  // No chat, no stream: a service without one, or a caller who is not the owner, is asked for nothing.
  const draftId = stored?.canChat ? (stored.draft?.id ?? null) : null;
  const [chat, setChat] = useState<ChatState | null>(null);
  const [text, setText] = useState("");
  const [model, setModel] = useState<ChatModel>(readModel);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** The stream has been down long enough to say so. */
  const [down, setDown] = useState(false);
  const alive = useRef(false);
  const logBox = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);

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
  const onEvent = useCallback(
    (event: ChatEvent): void => {
      setChat((prev) => applyChatEvent(prev, event));
      // The agent's tool moves the draft's numbers on the service; the controls and the board follow as it does.
      if (event.type === "state") adoptDraft(event.state.draft);
      else if (event.type === "status") adoptDraft(event.status.draft);
    },
    [adoptDraft],
  );
  useEffect(() => {
    setChat(null);
    setDown(false);
    alive.current = false;
    if (!draftId) return;
    pinned.current = true;
    let late: number | undefined;
    const stop = watchChat(draftId, {
      event: onEvent,
      link: (ok) => {
        alive.current = ok;
        if (ok) {
          window.clearTimeout(late);
          late = undefined;
          setDown(false);
        } else late ??= window.setTimeout(() => setDown(true), DOWN_MS);
      },
    });
    return () => {
      stop();
      window.clearTimeout(late);
    };
  }, [draftId, onEvent]);
  // With the stream down the chat is still its rows on the service, and the page asks for them.
  useEffect(() => {
    if (!draftId || !down) return;
    void load(draftId);
    const id = window.setInterval(() => void load(draftId), POLL_MS);
    return () => window.clearInterval(id);
  }, [draftId, down, load]);
  const running = chat?.running ?? false;
  // A turn that has ended may have made takes: the sprite and sound panels ask for them again (ADR 0051).
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) window.dispatchEvent(new Event(TAKES_CHANGED));
    wasRunning.current = running;
  }, [running]);
  // A row of the sprite or sound panel writes the start of a message here, for the owner to finish and send.
  useEffect(() => {
    const onProposed = (e: Event): void => {
      setText((e as CustomEvent<string>).detail);
      box.current?.focus();
    };
    window.addEventListener(CHAT_PROPOSED, onProposed);
    return () => window.removeEventListener(CHAT_PROPOSED, onProposed);
  }, []);
  const shown = chat?.items.length ?? 0;
  const live = chat?.live ?? "";
  // The log follows what is new while the owner reads its end, and stays put once they scroll back to read.
  useEffect(() => {
    const el = logBox.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown, live, running]);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 8000);
    return () => window.clearTimeout(id);
  }, [note]);

  if (!stored?.canChat) return null;

  const send = async (): Promise<void> => {
    const words = text.trim();
    // One message a press: Enter held down, or pressed twice, is still one.
    if (!words || sending) return;
    setSending(true);
    // The chat is a draft's: one is opened for it if the page has none, with whatever numbers are on the page.
    const draft = stored.draft ?? (await ensureDraft());
    const sent = draft ? await sendChat(draft.id, { text: words, model, rounds: [...rounds], refusals: refusals.map((r) => `${r.key}: ${r.message}`).slice(0, 16) }) : "failed";
    setSending(false);
    if (sent !== "sent") return setNote(t(`studio.chat.${sent}`));
    setText("");
    pinned.current = true;
    // The stream says what the message started. Without it, the page asks.
    if (draft && !alive.current) await load(draft.id);
  };
  const act = (work: Promise<boolean>): void =>
    void work.then(async (ok) => {
      if (!ok) setNote(t("studio.links_failed"));
      if (draftId && !alive.current) await load(draftId);
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
      <div
        className="chat-log"
        data-testid="chat-log"
        ref={logBox}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_PX;
        }}
      >
        {shown === 0 && <p className="muted small">{t("studio.chat.empty")}</p>}
        {chat?.items.map((item) => (
          <Item key={item.id} item={item} running={running} onRevert={(turn) => draftId && act(revertChat(draftId, turn))} onAnswer={(id, allow) => draftId && act(answerChat(draftId, id, allow))} />
        ))}
        {live.trim() !== "" && (
          <div className="chat-reply is-live" data-testid="chat-live">
            <Reply text={live} writing />
          </div>
        )}
        {running && (
          <p className="chat-working small" role="status" data-testid="chat-working">
            {t("studio.chat.working")}
          </p>
        )}
      </div>
      {down && (
        <p className="small chat-down" role="status" data-testid="chat-down">
          {t("studio.chat.down")}
        </p>
      )}
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
          ref={box}
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
  // The agent's own words: the one exception to the message table (ADR 0042), read as markdown (ADR 0055).
  if (item.kind === "reply")
    return (
      <div className="chat-reply" data-testid="chat-reply">
        <Reply text={item.text} writing={false} />
      </div>
    );
  if (item.kind === "step") {
    // A step whose turn is over and that never said how it went was cut off: it is not still running.
    const state = item.failed ? "failed" : item.detail !== null ? "done" : running ? "running" : "cut";
    return (
      <details className={`chat-step is-${state}`} data-testid="chat-step" data-failed={item.failed ? "1" : "0"} data-state={state}>
        <summary>
          <span className="chat-step-mark" role="img" aria-label={t(`studio.chat.step_${state}`)} />
          <code>{toolName(item.tool)}</code> <span className="mono">{item.summary}</span>
        </summary>
        <pre>{item.detail ?? t(`studio.chat.step_${state === "running" ? "running" : "cut"}`)}</pre>
      </details>
    );
  }
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
    <div className="chat-turn" data-testid="chat-turn" data-status={item.status} data-turn={item.turn} data-reverted={item.reverted ? "1" : "0"} data-reason={item.reason ?? ""}>
      <span className="muted small">
        {t(item.status === "failed" && item.reason ? `studio.chat.turn_failed_${item.reason}` : `studio.chat.turn_${item.status}`)} {money(item.costUsd)}
        {item.commit && ` · ${item.reverted ? t("studio.chat.reverted") : t("studio.chat.committed")}`}
      </span>
      {/* What the agent or the service said as it failed, as it said it: for the owner to read, like a step's output. */}
      {item.status === "failed" && item.error && (
        <details className="chat-turn-error" data-testid="chat-turn-error">
          <summary className="small">{t("studio.chat.turn_error")}</summary>
          <pre>{item.error}</pre>
        </details>
      )}
      {item.commit && !item.reverted && (
        <button type="button" className="tune-text-btn" disabled={running} onClick={() => onRevert(item.turn)} data-testid="chat-revert">
          {t("studio.chat.revert")}
        </button>
      )}
    </div>
  );
}

/** A tool by the name the owner knows it by: the studio's own tools without the prefix the SDK gives them. */
const toolName = (tool: string): string => tool.replace(/^mcp__studio__/, "");

/** If the markdown reader cannot be loaded or cannot read a reply, the reply is still shown, as it was written. */
class Plain extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? <span className="chat-plain">{this.props.text}</span> : this.props.children;
  }
}

function Reply({ text, writing }: { text: string; writing: boolean }) {
  return (
    <Plain text={text}>
      <Suspense fallback={<span className="chat-plain">{text}</span>}>
        <ChatReply text={text} writing={writing} />
      </Suspense>
    </Plain>
  );
}
