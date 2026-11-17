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
