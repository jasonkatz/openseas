import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatEvent, ChatItem, ChatList, ChatModel, ChatState, ChatSummary } from "@openseas/protocol";
import { t } from "@openseas/boards";
import { useFrame } from "../frame/RoundFrame.jsx";
import { Menu, MenuButton, useMenu } from "../studio/Menu.jsx";
import { applyChatEvent, chatToOpen } from "./chatState.js";
import { answerChat, deleteChat, fetchChat, listChats, renameChat, revertChat, sendChat, stopChat, watchChat } from "./client.js";

const ChatReply = lazy(() => import("./ChatReply.jsx"));

const MODELS: readonly ChatModel[] = ["sonnet", "haiku", "opus"];
const MODEL_KEY = "openseas.studio.model";
/** The chat last open on a puzzle's page, so a reload opens it again (ADR 0060). */
const OPEN_KEY = (puzzle: string): string => `openseas.studio.chat.${puzzle}`;
/** How long the stream may be down before the page says so and asks for the chat the slow way. A drop that mends itself sooner is not worth a word. */
const DOWN_MS = 4000;
/** How often the chat is asked for while the stream is down. */
const POLL_MS = 3000;
/** How near the end of the log counts as reading the end of it. */
const PINNED_PX = 48;
/** How many chats the list holds before it offers to find one by its words. */
const FILTER_FROM = 6;
/** The tallest the message box grows as it fills, before it scrolls. */
const COMPOSE_MAX_PX = 220;

function readKept(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
function readModel(): ChatModel {
  const kept = readKept(MODEL_KEY);
  return MODELS.includes(kept as ChatModel) ? (kept as ChatModel) : "sonnet";
}
const money = (usd: number): string => t("studio.chat.money", { amount: usd.toFixed(2) });
const turnsOf = (n: number): string => (n === 1 ? t("studio.chat.turns_one") : t("studio.chat.turns", { count: n }));
/** How long ago, in the message table's words; past a week, the date. */
function ago(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("studio.chat.ago_now");
  if (minutes < 60) return t("studio.chat.ago_minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("studio.chat.ago_hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("studio.chat.ago_days", { count: days });
  return new Date(iso).toLocaleDateString();
}
const when = (iso: string): string => new Date(iso).toLocaleString();

/**
 * The chat (DESIGN.md 3.14, ADR 0047, ADR 0060): an agent on the draft's own copy of the
 * repository. It is the signed-in owner's, on a draft the service keeps, and is not shown
 * otherwise. A puzzle has as many chats as the owner starts, each its own conversation; the list
 * holds them all, the open draft's and those of drafts that are gone, and any can be opened, read
 * and carried on. Each message carries what the page knows and the service does not: what the
 * build refuses of the draft's numbers, and how the last rounds went. The agent's replies are its
 * own words, the one text in the studio that does not come from the message table, read as
 * markdown and shown as they are written; its work is a line a step. A chat arrives as a stream
 * of events (ADR 0055), and by asking, the slow way, whenever the stream is down.
 */
export function ChatPanel() {
  const frame = useFrame();
  const { store, ensureDraft, adoptDraft, refusals, rounds, puzzle } = frame;
  const stored = store.state === "stored" ? store : null;
  const canChat = stored?.canChat ?? false;
  const draftId = stored?.draft?.id ?? null;
  const puzzleId = puzzle.id;

  /** Every chat on the puzzle, and the cap; null until the service has said. */
  const [list, setList] = useState<ChatList | null>(null);
  /** The chat open; null is a new one, not yet started. */
  const [chatId, setChatId] = useState<string | null>(null);
  /** Set once the page has chosen which chat to open on arriving. */
  const chosen = useRef(false);
  const [listOpen, setListOpen] = useState(false);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [text, setText] = useState("");
  const [model, setModel] = useState<ChatModel>(readModel);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** The stream has been down long enough to say so. */
  const [down, setDown] = useState(false);
  /** The owner has scrolled back from the end of the log, and something may be under them. */
  const [away, setAway] = useState(false);
  const alive = useRef(false);
  const logBox = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canChat) return;
    const got = await listChats(puzzleId);
    if (got) setList(got);
  }, [canChat, puzzleId]);
  useEffect(() => {
    chosen.current = false;
    setList(null);
    setChatId(null);
    void refresh();
  }, [refresh]);
  // On arriving, the chat to open is chosen once the list has come and the page knows its draft.
  useEffect(() => {
    if (chosen.current || !list || !stored) return;
    chosen.current = true;
    setChatId(chatToOpen(list.chats, draftId, readKept(OPEN_KEY(puzzleId))));
  }, [list, draftId, puzzleId, stored]);
  const open = useCallback(
    (id: string | null): void => {
      setChatId(id);
      keep(OPEN_KEY(puzzleId), id);
      setListOpen(false);
      setNote(null);
      pinned.current = true;
      setAway(false);
      if (id === null) window.setTimeout(() => box.current?.focus(), 0);
    },
    [puzzleId],
  );

  /** A chat state is the page's draft's only when it is on that draft: one from a draft that is gone moves no control. */
  const adopt = useCallback((state: Pick<ChatState, "draft">): void => void (state.draft && adoptDraft(state.draft)), [adoptDraft]);
  const load = useCallback(
    async (id: string): Promise<void> => {
      const state = await fetchChat(id);
      if (!state) return;
      setChat(state);
      // The agent's tool moves the draft's numbers on the service; the controls and the board follow.
      adopt(state);
    },
    [adopt],
  );
  const onEvent = useCallback(
    (event: ChatEvent): void => {
      setChat((prev) => applyChatEvent(prev, event));
      // The agent's tool moves the draft's numbers on the service; the controls and the board follow as it does.
      if (event.type === "state") adopt(event.state);
      else if (event.type === "status") adopt(event.status);
    },
    [adopt],
  );
  useEffect(() => {
    setChat(null);
    setDown(false);
    alive.current = false;
    if (!canChat || !chatId) return;
    pinned.current = true;
    let late: number | undefined;
    const stop = watchChat(chatId, {
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
  }, [canChat, chatId, onEvent]);
  // With the stream down the chat is still its rows on the service, and the page asks for them.
  useEffect(() => {
    if (!chatId || !down) return;
    void load(chatId);
    const id = window.setInterval(() => void load(chatId), POLL_MS);
    return () => window.clearInterval(id);
  }, [chatId, down, load]);
  // The state that came is the open chat's: one still arriving for the chat left behind is not shown.
  const shownChat = chat && chat.chat.id === chatId ? chat : null;
  const running = shownChat?.chat.running ?? false;
  const busy = shownChat?.busy ?? false;
  // A turn that has ended moves the list's money and order.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void refresh();
    wasRunning.current = running;
  }, [running, refresh]);
  // A waiting chat learns the draft is free from its stream; the list learns which chat ran.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current !== busy) void refresh();
    wasBusy.current = busy;
  }, [busy, refresh]);
  const shown = shownChat?.items.length ?? 0;
  const live = shownChat?.live ?? "";
  // The log follows what is new while the owner reads its end, and stays put once they scroll back to read.
  useEffect(() => {
    const el = logBox.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else setAway(true);
  }, [shown, live, running]);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 8000);
    return () => window.clearTimeout(id);
  }, [note]);
  // The message box grows with what is in it, up to a point.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSE_MAX_PX)}px`;
  }, [text]);

  if (!stored || !canChat) return null;

  const cap = shownChat?.cap ?? list?.cap ?? null;
  const capped = cap !== null && cap.spentUsd >= cap.capUsd;
  const summary = shownChat?.chat ?? list?.chats.find((c) => c.id === chatId) ?? null;
  const carried = summary !== null && summary.draft !== draftId;
  const runningElsewhere = list?.chats.find((c) => c.running && c.id !== chatId && c.draft === draftId) ?? null;

  const send = async (): Promise<void> => {
    const words = text.trim();
    // One message a press: Enter held down, or pressed twice, is still one.
    if (!words || sending) return;
    setSending(true);
    // A chat is a draft's: one is opened for it if the page has none, with whatever numbers are on the page.
    const draft = stored.draft ?? (await ensureDraft());
    const sent = draft ? await sendChat(draft.id, { chat: chatId, text: words, model, rounds: [...rounds], refusals: refusals.map((r) => `${r.key}: ${r.message}`).slice(0, 16) }) : ({ ok: false, reason: "failed" } as const);
    setSending(false);
    if (!sent.ok) return setNote(t(`studio.chat.${sent.reason}`));
    setText("");
    pinned.current = true;
    setAway(false);
    if (sent.chat !== chatId) {
      // A new chat, started by this message: the page opens it, and the list holds it.
      setChatId(sent.chat);
      keep(OPEN_KEY(puzzleId), sent.chat);
    } else if (!alive.current) await load(sent.chat);
    void refresh();
  };
  const act = (work: Promise<boolean>): void =>
    void work.then(async (ok) => {
      if (!ok) setNote(t("studio.links_failed"));
      if (chatId && !alive.current) await load(chatId);
    });
  const toLatest = (): void => {
    const el = logBox.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinned.current = true;
    setAway(false);
  };

  return (
    <section className="chat" data-testid="chat" data-chat={chatId ?? ""} data-running={running ? "1" : "0"} aria-label={t("studio.chat.title")}>
      <ChatHead
        summary={summary}
        listOpen={listOpen}
        onToggleList={() => {
          if (!listOpen) void refresh();
          setListOpen(!listOpen);
        }}
        onNew={() => open(null)}
        onRenamed={(c) => {
          setList((l) => (l ? { ...l, chats: l.chats.map((x) => (x.id === c.id ? c : x)) } : l));
          setChat((s) => (s && s.chat.id === c.id ? { ...s, chat: { ...s.chat, title: c.title } } : s));
        }}
        onDeleted={(id) => {
          setList((l) => (l ? { ...l, chats: l.chats.filter((x) => x.id !== id) } : l));
          open(null);
        }}
        onFailed={() => setNote(t("studio.links_failed"))}
      />
      <p className="chat-spend muted small" data-testid="chat-spend">
        {cap && t("studio.chat.spend", { chat: money(summary?.spentUsd ?? 0), all: money(cap.spentUsd), cap: money(cap.capUsd) })}
      </p>
      <div className="chat-body">
        <div
          className="chat-log"
          data-testid="chat-log"
          ref={logBox}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_PX;
            if (pinned.current) setAway(false);
          }}
        >
          {chatId === null && <p className="muted small chat-empty">{t("studio.chat.empty")}</p>}
          {shownChat?.items.map((item) => (
            <Item key={item.id} item={item} running={running} onRevert={(turn) => chatId && act(revertChat(chatId, turn))} onAnswer={(id, allow) => chatId && act(answerChat(chatId, id, allow))} />
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
        {away && (
          <button type="button" className="btn btn-mini chat-latest" onClick={toLatest} data-testid="chat-latest">
            {t("studio.chat.latest")}
          </button>
        )}
        {listOpen && list && <ChatList list={list.chats} draftId={draftId} current={chatId} running={running} onOpen={open} onClose={() => setListOpen(false)} />}
      </div>
      {down && (
        <p className="small chat-down" role="status" data-testid="chat-down">
          {t("studio.chat.down")}
        </p>
      )}
      {carried && (
        <p className="small chat-carried" role="status" data-testid="chat-carried">
          {t("studio.chat.carried")}
        </p>
      )}
      {busy && (
        <p className="small chat-waiting" role="status" data-testid="chat-waiting">
          {t("studio.chat.waiting")}{" "}
          {runningElsewhere && (
            <button type="button" className="tune-text-btn" onClick={() => open(runningElsewhere.id)} data-testid="chat-go-running">
              {t("studio.chat.go_running")}
            </button>
          )}
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
                keep(MODEL_KEY, next);
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
            <button type="button" className="btn btn-mini" onClick={() => chatId && act(stopChat(chatId))} data-testid="chat-stop">
              {t("studio.chat.stop")}
            </button>
          )}
          {/* While a number is still on its way to the service, a message would carry the old ones. */}
          <button type="submit" className="btn btn-mini" disabled={sending || text.trim() === "" || stored.status !== "saved" || busy || (capped && !running)} data-testid="chat-send">
            {running ? t("studio.chat.steer") : t("studio.chat.send")}
          </button>
        </div>
      </form>
    </section>
  );
}

/** The chat's head: the list's button with the open chat's name, a new chat, and the open chat's own menu (rename, delete). */
function ChatHead({ summary, listOpen, onToggleList, onNew, onRenamed, onDeleted, onFailed }: { summary: ChatSummary | null; listOpen: boolean; onToggleList(): void; onNew(): void; onRenamed(c: ChatSummary): void; onDeleted(id: string): void; onFailed(): void }) {
  const menu = useMenu();
  const [naming, setNaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!menu.open) setConfirming(false);
  }, [menu.open]);
  // Another chat opened: whatever was being done to the last one's name is let go.
  const id = summary?.id ?? null;
  useEffect(() => setNaming(null), [id]);
  const rename = async (): Promise<void> => {
    const title = naming?.trim() ?? "";
    setNaming(null);
    if (!summary || !title || title === summary.title) return;
    const renamed = await renameChat(summary.id, title);
    if (renamed) onRenamed(renamed);
    else onFailed();
  };
  return (
    <header className="chat-head">
      {naming !== null && summary ? (
        <form
          className="chat-rename"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <input
            autoFocus
            value={naming}
            maxLength={120}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNaming(null);
            }}
            onBlur={() => void rename()}
            aria-label={t("studio.chat.rename_label")}
            data-testid="chat-title-input"
          />
        </form>
      ) : (
        <button type="button" className="chat-switch" aria-expanded={listOpen} onClick={onToggleList} title={t("studio.chat.chats")} data-testid="chat-list-toggle">
          <span className="chat-switch-icon" aria-hidden="true">
            ☰
          </span>
          <span className="chat-switch-title" data-testid="chat-title">
            {summary?.title ?? t("studio.chat.new")}
          </span>
          {summary?.running && <i className="status-dot is-busy" aria-hidden="true" />}
        </button>
      )}
      <div className="chat-head-actions">
        <button type="button" className="btn btn-mini" onClick={onNew} disabled={summary === null} title={t("studio.chat.new")} data-testid="chat-new">
          + {t("studio.chat.new")}
        </button>
        {summary && (
          <Menu
            id="chat-more"
            menu={menu}
            align="right"
            trigger={
              <MenuButton id="chat-more" menu={menu} className="btn btn-mini btn-sq" aria-label={t("studio.chat.more")} title={t("studio.chat.more")}>
                ⋯
              </MenuButton>
            }
          >
            <div className="menu-sec chat-more">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  menu.setOpen(false);
                  setNaming(summary.title);
                }}
                data-testid="chat-rename"
              >
                {t("studio.chat.rename")}
              </button>
              {confirming ? (
                <div className="chat-delete-confirm" data-testid="chat-delete-confirm">
                  <span className="small">{t("studio.chat.delete_confirm")}</span>
                  <div className="tune-actions">
                    <button
                      type="button"
                      className="btn btn-mini btn-danger"
                      onClick={() => {
                        menu.setOpen(false);
                        void deleteChat(summary.id).then((ok) => (ok ? onDeleted(summary.id) : onFailed()));
                      }}
                      data-testid="chat-delete-yes"
                    >
                      {t("studio.chat.delete_yes")}
                    </button>
                    <button type="button" className="btn btn-mini" onClick={() => setConfirming(false)} data-testid="chat-delete-no">
                      {t("studio.chat.delete_no")}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="menu-item is-danger" disabled={summary.running} onClick={() => setConfirming(true)} data-testid="chat-delete">
                  {t("studio.chat.delete")}
                </button>
              )}
            </div>
          </Menu>
        )}
      </div>
    </header>
  );
}

/**
 * Every chat on the puzzle, over the open one's log (ADR 0060): the open draft's first, then those
 * whose draft is gone, each the one last spoken in first. A row opens its chat.
 */
function ChatList({ list, draftId, current, running, onOpen, onClose }: { list: readonly ChatSummary[]; draftId: string | null; current: string | null; running: boolean; onOpen(id: string | null): void; onClose(): void }) {
  const [find, setFind] = useState("");
  const now = useMemo(() => Date.now(), [list]);
  const words = find.trim().toLowerCase();
  const matched = words ? list.filter((c) => c.title.toLowerCase().includes(words)) : list;
  const mine = matched.filter((c) => draftId !== null && c.draft === draftId);
  const earlier = matched.filter((c) => !(draftId !== null && c.draft === draftId));
  const row = (c: ChatSummary) => (
    <li key={c.id}>
      <button type="button" className={`chat-row ${c.id === current ? "is-current" : ""}`} aria-current={c.id === current ? "true" : undefined} onClick={() => onOpen(c.id)} data-testid="chat-row" data-chat={c.id} data-running={c.running || (c.id === current && running) ? "1" : "0"}>
        <span className="chat-row-title">{c.title}</span>
        <span className="chat-row-meta muted small">
          {(c.running || (c.id === current && running)) && (
            <span className="chat-row-running">
              <i className="status-dot is-busy" aria-hidden="true" /> {t("studio.chat.list_running")} ·{" "}
            </span>
          )}
          <time dateTime={c.updatedAt} title={when(c.updatedAt)}>
            {ago(c.updatedAt, now)}
          </time>{" "}
          · {turnsOf(c.turns)} · {money(c.spentUsd)}
        </span>
      </button>
    </li>
  );
  return (
    <div
      className="chat-list"
      data-testid="chat-list"
      role="dialog"
      aria-label={t("studio.chat.list")}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="chat-list-head">
        <span className="stat-label">{t("studio.chat.list")}</span>
        <button type="button" className="tune-text-btn" onClick={onClose} data-testid="chat-list-close">
          {t("studio.chat.list_close")}
        </button>
      </div>
      {list.length >= FILTER_FROM && <input type="search" className="chat-list-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("studio.chat.list_filter")} aria-label={t("studio.chat.list_filter")} data-testid="chat-list-find" />}
      <button type="button" className={`chat-row chat-row-new ${current === null ? "is-current" : ""}`} onClick={() => onOpen(null)} data-testid="chat-list-new">
        <span className="chat-row-title">+ {t("studio.chat.new")}</span>
      </button>
      {list.length === 0 && <p className="muted small">{t("studio.chat.list_empty")}</p>}
      {list.length > 0 && matched.length === 0 && <p className="muted small">{t("studio.chat.list_none")}</p>}
      {mine.length > 0 && (
        <section data-testid="chat-list-draft">
          <span className="stat-label">{t("studio.chat.list_draft")}</span>
          <ul>{mine.map(row)}</ul>
        </section>
      )}
      {earlier.length > 0 && (
        <section data-testid="chat-list-earlier">
          <span className="stat-label">{t("studio.chat.list_earlier")}</span>
          <ul>{earlier.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

function Item({ item, running, onRevert, onAnswer }: { item: ChatItem; running: boolean; onRevert(turn: number): void; onAnswer(id: number, allow: boolean): void }) {
  if (item.kind === "user")
    return (
      <div className="chat-user" data-testid="chat-user" data-steer={item.steer ? "1" : "0"} title={when(item.at)}>
        <span className="muted small">{item.steer ? t("studio.chat.steered") : t(`studio.chat.model.${item.model}`)}</span>
        <p>{item.text}</p>
      </div>
    );
  // The agent's own words: the one exception to the message table (ADR 0042), read as markdown (ADR 0055).
  if (item.kind === "reply")
    return (
      <div className="chat-said">
        <div className="chat-reply" data-testid="chat-reply">
          <Reply text={item.text} writing={false} />
        </div>
        <CopyReply text={item.text} />
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
    <div className="chat-turn" data-testid="chat-turn" data-status={item.status} data-turn={item.turn} data-reverted={item.reverted ? "1" : "0"} data-reason={item.reason ?? ""} title={when(item.at)}>
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

/** A reply's words to the clipboard, as the agent wrote them: markdown and all. */
function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <button type="button" className="tune-text-btn chat-copy" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)} data-testid="chat-copy">
      {copied ? t("studio.chat.copied") : t("studio.chat.copy")}
    </button>
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
