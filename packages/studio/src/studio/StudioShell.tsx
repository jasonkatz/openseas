import { t } from "@openseas/boards";
import { PlayShell } from "../play/PlayShell.jsx";
import type { ShellProps } from "../practice/PracticeShell.jsx";
import { Link } from "../router.jsx";
import { TuningPanel } from "../tuning/TuningPanel.jsx";

/**
 * A puzzle's studio page (DESIGN.md 3.14), laid out for a desktop: the board in the middle at a
 * phone's proportions, exactly as `/play` draws it, and the tuning panel to one side. The other
 * side is kept for the chat. A phone never sees this: it gets the puzzle alone (App.tsx).
 */
export function StudioShell(p: ShellProps) {
  return (
    <main className="studio" data-testid="studio">
      <header className="studio-bar">
        <Link to="/" className="icon-btn" aria-label={t("app.back")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <p className="eyebrow">{t("studio.eyebrow")}</p>
        <h1 className="puzzle-title">{t(`${p.puzzle}.title`)}</h1>
      </header>
      <aside className="studio-panel" aria-label={t("studio.tuning")}>
        <TuningPanel phase={p.phase} onStart={p.onStart} />
      </aside>
      <div className="studio-stage">
        <PlayShell {...p} />
      </div>
    </main>
  );
}
