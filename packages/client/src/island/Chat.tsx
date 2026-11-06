import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatChannel } from "@openseas/protocol";
import { t, usePirate } from "@openseas/boards";
import { useCrew } from "../state/CrewProvider.jsx";
import { useSocial } from "../state/SocialProvider.jsx";

/** One chat channel: the last lines and a line to send. Ephemeral and plain (DESIGN.md 3.7). A name opens its pirate's card. */
export function Chat({ channel }: { channel: ChatChannel }) {
  const { pirate, socketStatus } = usePirate();
  const { chat, say, markRead } = useSocial();
  const { showProfile } = useCrew();
  const [text, setText] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const lines = chat[channel];
  const online = socketStatus === "open";

  useEffect(() => {
    markRead(channel);
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lines, channel, markRead]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!text.trim()) return;
    say(channel, text);
    setText("");
  };

  return (
    <div className="chat" data-testid={`chat-${channel}`}>
      <ul className="chat-lines" ref={list}>
        {lines.length === 0 && <li className="muted small chat-empty">{online ? t("chat.empty") : t("chat.offline")}</li>}
        {lines.map((m, i) => (
          <li key={`${m.at}-${i}`} className={m.pirateId === pirate?.id ? "mine" : ""}>
            <button className="pirate-link chat-who" onClick={() => showProfile({ pirateId: m.pirateId })}>
              {m.name}
            </button>{" "}
            <span>{m.text}</span>
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("chat.placeholder")} maxLength={280} disabled={!online} aria-label={t("chat.placeholder")} data-testid={`chat-input-${channel}`} />
        <button className="btn btn-brass btn-small" type="submit" disabled={!online || !text.trim()}>
          {t("chat.send")}
        </button>
      </form>
    </div>
  );
}
