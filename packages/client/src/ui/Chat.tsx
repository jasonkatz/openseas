import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const EMOTES = ['wave', 'dance', 'cheer', 'bow', 'arr'];

export function Chat() {
  const chat = useStore((s) => s.chat);
  const send = useStore((s) => s.send);
  const crew = useStore((s) => s.crew);
  const unread = useStore((s) => s.unread);
  const markRead = useStore((s) => s.markChatRead);
  const [channel, setChannel] = useState<'local' | 'crew' | 'global'>('local');
  const [text, setText] = useState('');
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 700);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (!collapsed) markRead();
  }, [chat, collapsed, markRead]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        const host = document.querySelector('.puzzle-host');
        if (host) return; // puzzles own the keyboard
        inputRef.current?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = chat.filter((m) => channel === 'local' ? m.channel !== 'crew' && m.channel !== 'global' : m.channel === channel || m.channel === 'system');

  const submit = () => {
    const t = text.trim();
    if (!t) { inputRef.current?.blur(); return; }
    if (t.startsWith('/')) {
      const [cmd, ...rest] = t.slice(1).split(' ');
      if (cmd === 'me' || cmd === 'emote') send({ t: 'emote', emote: rest.join(' ').slice(0, 20) || 'wave' });
      else if (EMOTES.includes(cmd ?? '')) send({ t: 'emote', emote: cmd! });
      else if (cmd === 'g' || cmd === 'global') send({ t: 'chat', channel: 'global', text: rest.join(' ') });
      else if (cmd === 'c' || cmd === 'crew') send({ t: 'chat', channel: 'crew', text: rest.join(' ') });
      else useStore.getState().toast('Commands: /wave /dance /cheer /bow /arr, /g text, /c text', 'info');
    } else {
      send({ t: 'chat', channel, text: t });
    }
    setText('');
    inputRef.current?.blur();
  };

  return (
    <div className={`chat ${collapsed ? 'collapsed' : ''}`}>
      <div className="chat-tabs">
        {(['local', 'crew', 'global'] as const).map((c) => (
          <button key={c} className={channel === c ? 'active' : ''} onClick={() => { setChannel(c); setCollapsed(false); }} disabled={c === 'crew' && !crew}>{c}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setCollapsed(!collapsed)} title="Collapse">{collapsed ? `▲${unread ? ` ${unread}` : ''}` : '▼'}</button>
      </div>
      <div className="chat-log" ref={logRef}>
        {visible.length === 0 && <div className="muted">Press <kbd>Enter</kbd> to talk. Try /wave or /dance.</div>}
        {visible.map((m) => (
          <div key={m.id} className={`m ${m.channel}`}>
            {m.channel === 'system' ? <span>{m.text}</span> : <><span className="who">{m.from}:</span> {m.text}</>}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input ref={inputRef} className="input" value={text} placeholder={`Say something (${channel})…`} maxLength={240}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') inputRef.current?.blur(); e.stopPropagation(); }} />
        <button className="btn small" onClick={submit}>Send</button>
      </div>
    </div>
  );
}
