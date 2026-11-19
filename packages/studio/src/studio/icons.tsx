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
      <rect x="4" y="4" width="16" height="16" rx="3" {...stroke} />
      <circle cx="10" cy="10" r="2.4" fill="currentColor" />
      <path d="M5 18l5-5 3 3 2.5-2.5L20 18" {...stroke} />
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

/** The transport bar's marks (ADR 0067), and the panel's expand and collapse. */
export type ToolIcon = "play" | "pause" | "restart" | "deal" | "compare" | "step" | "expand" | "collapse";
const TOOLS: Readonly<Record<ToolIcon, ReactNode>> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: <path d="M8 5v14M16 5v14" {...stroke} strokeWidth={3} />,
  restart: <path d="M5 12a7 7 0 1 0 2.1-5M5 4v4h4" {...stroke} />,
  deal: <path d="M4 8h11l-3-3M20 16H9l3 3M15 8l5 0M4 16h5" {...stroke} />,
  compare: (
    <>
      <circle cx="12" cy="12" r="8" {...stroke} />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  step: <path d="M6 5l9 7-9 7zM18 5v14" {...stroke} />,
  expand: <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" {...stroke} />,
  collapse: <path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" {...stroke} />,
};

export function Tool({ icon, size = 16 }: { icon: ToolIcon; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {TOOLS[icon]}
    </svg>
  );
}
