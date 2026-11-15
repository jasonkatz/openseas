import { useState } from "react";
import type { PuzzleId } from "@openseas/engine";
import { t } from "@openseas/boards";
import { SoundPanel, SpritePanel } from "../assets/AssetPanels.jsx";
import { PlayShell } from "../play/PlayShell.jsx";
import type { ShellProps } from "../practice/PracticeShell.jsx";
import { Link } from "../router.jsx";
import { ChatPanel } from "../service/ChatPanel.jsx";
import { TuningPanel } from "../tuning/TuningPanel.jsx";

/**
 * A puzzle's studio page (DESIGN.md 3.14), laid out for a desktop: the board in the middle at a
 * phone's proportions, exactly as `/play` draws it, the tuning panel to one side and the chat to
 * the other (ADR 0047), for the signed-in owner. The side panel is one of three: the numbers, the
 * sprites or the sounds (ADR 0050). All three stay in the page while one shows, so a draft's
 * section and a file being tried outlast a look at another. A phone never sees this: it gets the
 * puzzle alone (App.tsx).
 */
const TABS = ["tuning", "sprites", "sounds"] as const;

export function StudioShell(p: ShellProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("tuning");
  const puzzle = p.puzzle as PuzzleId;
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
      <aside className="studio-panel" aria-label={t(`studio.tab.${tab}`)}>
        <div className="studio-tabs" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" className="btn btn-mini" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
              {t(`studio.tab.${id}`)}
            </button>
          ))}
        </div>
        <div hidden={tab !== "tuning"}>
          <TuningPanel phase={p.phase} onStart={p.onStart} />
        </div>
        <div hidden={tab !== "sprites"}>
          <SpritePanel puzzle={puzzle} legend={p.legend} active={tab === "sprites"} />
        </div>
        <div hidden={tab !== "sounds"}>
          <SoundPanel puzzle={puzzle} />
        </div>
      </aside>
      <div className="studio-stage">
        <PlayShell {...p} />
      </div>
      <aside className="studio-rest">
        <ChatPanel />
      </aside>
    </main>
  );
}
