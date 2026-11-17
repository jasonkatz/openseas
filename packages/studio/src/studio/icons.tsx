import type { ReactNode } from "react";
import type { ModeId } from "./modes.js";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const PATHS: Readonly<Record<ModeId, ReactNode>> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  setup: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" {...stroke} />
      <path d="M4 12h16M12 4v16" {...stroke} />
    </>
  ),
  tuning: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" {...stroke} />
      <circle cx="9" cy="7" r="2.6" fill="currentColor" />
      <circle cx="15" cy="12" r="2.6" fill="currentColor" />
      <circle cx="8" cy="17" r="2.6" fill="currentColor" />
    </>
  ),
  scoring: <path d="M7 4h10v5a5 5 0 0 1-10 0zM12 14v4M8 20h8M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" {...stroke} />,
  sprites: (
    <>
      <rect x="3.5" y="3.5" width="8" height="8" rx="1.5" fill="currentColor" />
      <circle cx="17" cy="7.5" r="4" {...stroke} />
      <path d="M7.5 13.5l4 7h-8z" {...stroke} />
      <path d="M17 13.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="currentColor" />
    </>
  ),
  sounds: <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4" {...stroke} />,
  text: <path d="M5 7V5h14v2M12 5v14M9 19h6" {...stroke} strokeWidth={2.4} />,
};

/** A mode's mark, on the rail and wherever a change says which mode it was made in. */
export function ModeIcon({ mode, size = 18 }: { mode: ModeId; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {PATHS[mode]}
    </svg>
  );
}

export function Caret() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" className="caret">
      <path d="M6 9l6 6 6-6" {...stroke} strokeWidth={2.6} />
    </svg>
  );
}

const ACTIONS = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" {...stroke} />,
  sparkle: <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" fill="currentColor" />,
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" {...stroke} />,
  atlas: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" {...stroke} />
      <path d="M4 12h16M12 4v16" {...stroke} />
    </>
  ),
  wave: <path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" {...stroke} />,
  sample: <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4" {...stroke} />,
  take: <path d="M12 3l2.5 5.6 6 .7-4.5 4.1 1.3 6L12 16.3 6.7 19.4l1.3-6L3.5 9.3l6-.7z" {...stroke} />,
  file: <path d="M7 3h7l4 4v14H7zM14 3v4h4" {...stroke} />,
} as const;

/** A small mark on a button of the sprite and sound panels: what the button does, before its word is read. */
export function ActionIcon({ name, size = 14 }: { name: keyof typeof ACTIONS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="action-icon">
      {ACTIONS[name]}
    </svg>
  );
}
